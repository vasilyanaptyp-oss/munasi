import {
  dash,
  initialMovement,
  resolveCollision,
  setHeading,
  stepMovement,
  type MovementState,
} from "./movement.js";
import { mulberry32, type Rng } from "./rng.js";
import type {
  Ability,
  Fighter,
  MatchConfig,
  MatchRules,
  MatchEvent,
  MatchResult,
  Minion,
  MinionSnapshot,
  MinionSpec,
  PickupSnapshot,
  PickupType,
  Side,
  Snapshot,
  Winner,
} from "./types.js";
import { MAX_FRAMES, TICKS_PER_FRAME, TICKS_PER_SECOND } from "./types.js";

/**
 * Damage rolls land within this fraction of the fighter's attack stat.
 * Deliberately wide: with ~25 swings per match, per-hit spread is what keeps
 * the outcome genuinely uncertain. Tighten it and a 3% stat edge becomes a
 * 100% winrate, which makes both balance and drama impossible.
 */
export const DAMAGE_VARIANCE = 0.35;

/**
 * Seconds between a signature being cast and its damage landing.
 *
 * Exported because the renderer has to fly the effect across in exactly this
 * time: the thing a viewer sees arrive and the tick the health drops have to be
 * the same moment, or the ability reads as decoration again.
 */
export const SIGNATURE_LEAD_SECONDS = 0.35;

/**
 * Seconds between one pulse of a cast and the next.
 *
 * Exported for the same reason as the lead: a four-glass volley has to arrive on
 * the frames its four numbers appear on, so the renderer spaces the objects it
 * throws by exactly this.
 */
export const SIGNATURE_PULSE_SECONDS = 0.22;

/**
 * Damage one signature pulse deals, as a share of the caster's attack.
 *
 * Exported because the calibrator has to solve `attack` from the total damage a
 * fighter puts out, and for these four fighters most of that total arrives
 * through here. See `analyticAttack`.
 */
export const SIGNATURE_PULSE_SHARE = 1.33;

/**
 * How much faster Boxer Guy travels while closing for `HAYMAKER`.
 *
 * Enough to cross most of a typical gap inside the lead time, so the punch
 * lands from somewhere near the other man rather than across the square.
 */
const HAYMAKER_DASH = 4.5;
/**
 * How much faster the man Bodyguard Guy has thrown travels, and for how long.
 *
 * Long enough to cross the square and reach a wall, so the throw ends where a
 * throw should end: against something.
 */
const THROW_SPEED = 4.2;
const THROW_SECONDS = 0.75;
/** Derived minion stats, used when an ability has no explicit `minion` block. */
const DERIVED_MINION_ATTACK_RATIO = 0.28;
const DERIVED_MINION_ATTACK_SPEED = 0.9;
const DERIVED_MINION_LIFETIME = 8;
/** Default `buff_attack` duration in seconds. */
const DEFAULT_BUFF_DURATION = 5;

/** Stats of a comeback-wave minion, as fractions of its owner's numbers. */
const WAVE_MINION_HP_SHARE = 0.12;
const WAVE_MINION_ATTACK_SHARE = 0.45;
const WAVE_MINION_SPEED = 0.9;
const WAVE_MINION_LIFETIME = 6;
const DEFAULT_WAVE_SIZE = 2;

/** Arena pickup defaults. */
const PICKUP_DEFAULTS = {
  firstFrame: 90,
  intervalFrames: 150,
  reachFrames: 45,
  healPower: 120,
  damageBuff: 0.35,
  speedBuff: 0.35,
  buffDuration: 6,
} as const;
const PICKUP_TYPES: PickupType[] = ["heal", "damage_buff", "attack_speed"];

interface ActiveBuff {
  power: number;
  /** Tick at which the buff stops applying. */
  expiresAtTick: number;
}

interface FighterState {
  side: Side;
  base: Fighter;
  /**
   * Each side rolls from its own stream. Sharing one stream interleaves the
   * two fighters' draws, and the serial correlation that introduces is worth a
   * measurable winrate edge to whichever side draws first.
   */
  rng: Rng;
  hp: number;
  /** Ticks until the next basic attack. */
  attackCooldown: number;
  /** Ticks until each ability (by index) is castable again. */
  abilityCooldowns: number[];
  buffs: ActiveBuff[];
  /** Attack-speed multipliers from pickups. */
  speedBuffs: ActiveBuff[];
  minions: MinionState[];
  minionsSpawned: number;
  /** Comeback-wave thresholds already triggered. */
  wavesTriggered: number[];
}

interface MinionState extends Minion {
  /** Ticks until the next attack. */
  attackCooldown: number;
  /** Ticks until the minion expires. */
  ticksLeft: number;
}

function cloneFighter(f: Fighter): Fighter {
  return {
    ...f,
    hp: f.maxHp,
    abilities: f.abilities.map((a) => ({ ...a })),
  };
}

function ticksPerAttack(attacksPerSecond: number): number {
  if (attacksPerSecond <= 0) return Number.POSITIVE_INFINITY;
  return TICKS_PER_SECOND / attacksPerSecond;
}

function attackMultiplier(state: FighterState): number {
  let mult = 1;
  for (const buff of state.buffs) mult += buff.power;
  return mult;
}

function effectiveAttack(state: FighterState): number {
  return state.base.attack * attackMultiplier(state);
}

function effectiveAttackSpeed(state: FighterState): number {
  let mult = 1;
  for (const buff of state.speedBuffs) mult += buff.power;
  return state.base.attackSpeed * mult;
}

/**
 * Rubber-band bonus: the further a fighter is from full HP, the harder it
 * hits. Returns exactly 1 when the rule is off, so the default path is
 * arithmetically untouched.
 */
function comebackMultiplier(state: FighterState, rubberBand: number): number {
  if (rubberBand <= 0) return 1;
  const share = Math.max(0, Math.min(1, state.hp / state.base.maxHp));
  return 1 + rubberBand * (1 - share);
}

function minionSpec(ability: Ability): MinionSpec {
  if (ability.minion) return { ...ability.minion };
  return {
    hp: ability.power,
    attack: ability.power * DERIVED_MINION_ATTACK_RATIO,
    attackSpeed: DERIVED_MINION_ATTACK_SPEED,
    lifetime: DERIVED_MINION_LIFETIME,
  };
}

/**
 * Runs a full match. Pure: the only entropy is `seed`, and neither argument is
 * mutated. Identical `(config, seed)` always yields a byte-identical result.
 */
export function simulate(
  config: MatchConfig,
  seed: number,
  rules: MatchRules = {},
): MatchResult {
  // More hits for less each, at identical damage per second. Applied to the
  // fighters up front so every downstream read — stat lines, minions derived
  // from ability power, the snapshot's `attack` — sees one consistent roster.
  const attackRate = rules.attackRate ?? 1;
  const paced = (f: Fighter): Fighter =>
    attackRate === 1
      ? f
      : { ...f, attack: f.attack / attackRate, attackSpeed: f.attackSpeed * attackRate };
  const fighters = { a: cloneFighter(paced(config.a)), b: cloneFighter(paced(config.b)) };

  // Two independent streams derived from the one seed, so the match stays
  // reproducible while neither side's rolls disturb the other's.
  const deriveSeed = (salt: number): number => {
    let h = (seed ^ 0x9e3779b9) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ salt, 0xc2b2ae35);
    return (h ^ (h >>> 13)) | 0;
  };

  const makeState = (side: Side, base: Fighter, rng: Rng): FighterState => ({
    side,
    base,
    rng,
    // The gauntlet carries the challenger's HP in from the previous round.
    hp: side === "a" ? (rules.startHpA ?? base.maxHp) : base.maxHp,
    // Multiplied, never rounded: at the default 1 this has to be bit-identical
    // to the old expression or every 1v1 replay changes.
    attackCooldown: ticksPerAttack(base.attackSpeed) * (rules.openingCooldown ?? 1),
    /**
     * **Abilities open short too.**
     *
     * They used to start on a full cooldown, so the first signature landed five
     * or six seconds in — and since a signature is one of only two things that
     * deal damage, a fight whose pair had not happened to run into each other
     * yet opened on five seconds of two people flying around with nothing
     * happening. Measured on the gate's own matchup: first event at 5.00s, first
     * damage at 5.37s, which is past the 5.0s the reference never exceeds *in
     * the middle of a fight*, let alone at the front of one.
     *
     * The reference's ability is running from its first frame — the note track
     * is already streaming and already taking health off. Same opening share as
     * the attack schedule, so the two stay in step.
     */
    abilityCooldowns: base.abilities.map(
      (ab) => ab.cooldown * TICKS_PER_SECOND * (rules.openingCooldown ?? 1),
    ),
    buffs: [],
    speedBuffs: [],
    minions: [],
    minionsSpawned: 0,
    wavesTriggered: [],
  });

  const sides: Record<Side, FighterState> = {
    a: makeState("a", fighters.a, mulberry32(deriveSeed(1))),
    b: makeState("b", fighters.b, mulberry32(deriveSeed(2))),
  };
  const opponentOf = (s: FighterState): FighterState =>
    s.side === "a" ? sides.b : sides.a;

  // Streams 4 and 5: added after the fact, so they cannot disturb the draws
  // that decide the fight (1 and 2) or the pickups (3).
  const movementRng: Record<Side, Rng> = {
    a: mulberry32(deriveSeed(4)),
    b: mulberry32(deriveSeed(5)),
  };
  const movement: Record<Side, MovementState> = {
    a: initialMovement("a", fighters.a.aspect, movementRng.a),
    b: initialMovement("b", fighters.b.aspect, movementRng.b),
  };

  const events: MatchEvent[] = [];
  const snapshots: Snapshot[] = [];

  let tick = 0;
  let frame = 0;
  let winner: Winner | null = null;

  const variance = rules.damageVariance ?? DAMAGE_VARIANCE;
  const rollDamage = (rng: Rng, attack: number): number =>
    Math.max(1, Math.round(attack * rng.range(1 - variance, 1 + variance)));

  /**
   * Damage is queued during a tick and applied once every actor has swung.
   * Resolving it immediately would hand the fighter checked first a free win on
   * any tick where both would have landed a killing blow — a systematic ~3
   * percentage point edge for side A.
   */
  const pendingFighterDamage: { target: FighterState; amount: number }[] = [];
  const pendingMinionDamage: { target: MinionState; amount: number }[] = [];

  const damageFighter = (target: FighterState, amount: number): number => {
    pendingFighterDamage.push({ target, amount });
    return amount;
  };

  const applyPendingDamage = (): void => {
    for (const { target, amount } of pendingFighterDamage) target.hp -= amount;
    for (const { target, amount } of pendingMinionDamage) target.hp -= amount;
    pendingFighterDamage.length = 0;
    pendingMinionDamage.length = 0;
  };

  /**
   * Pickups. No positions are simulated: the item appears, sits for
   * `reachFrames`, and is then claimed by whoever wins a roll weighted by
   * attack speed. Speed is the stat a viewer can already see in the stat line,
   * so the outcome reads as earned rather than arbitrary.
   */
  const pickupRules = rules.pickups;
  const pickupCfg = { ...PICKUP_DEFAULTS, ...(pickupRules ?? {}) };
  const pickupRng = mulberry32(deriveSeed(3));
  let pickup: PickupSnapshot | null = null;
  let pickupsSpawned = 0;
  let nextPickupFrame = pickupCfg.firstFrame;

  const claimPickup = (item: PickupSnapshot): void => {
    const speedA = effectiveAttackSpeed(sides.a);
    const speedB = effectiveAttackSpeed(sides.b);
    const chanceA = speedA / (speedA + speedB);
    const winner = pickupRng.next() < chanceA ? sides.a : sides.b;
    const duration = pickupCfg.buffDuration;

    switch (item.type) {
      case "heal": {
        const healed = Math.min(
          Math.round(pickupCfg.healPower),
          winner.base.maxHp - winner.hp,
        );
        if (healed > 0) winner.hp += healed;
        break;
      }
      case "damage_buff":
        winner.buffs.push({
          power: pickupCfg.damageBuff,
          expiresAtTick: tick + Math.round(duration * TICKS_PER_SECOND),
        });
        break;
      case "attack_speed":
        winner.speedBuffs.push({
          power: pickupCfg.speedBuff,
          expiresAtTick: tick + Math.round(duration * TICKS_PER_SECOND),
        });
        break;
    }
    events.push({
      frame,
      type: "pickup_claim",
      actorId: winner.base.id,
      targetId: item.id,
      value: item.type === "heal" ? pickupCfg.healPower : Math.round(pickupCfg.damageBuff * 100),
    });
  };

  const stepPickups = (): void => {
    if (!pickupRules) return;
    if (pickup === null && frame >= nextPickupFrame) {
      pickupsSpawned += 1;
      const type = PICKUP_TYPES[pickupRng.int(PICKUP_TYPES.length)]!;
      pickup = {
        id: `pickup${pickupsSpawned}`,
        type,
        spawnFrame: frame,
        resolveFrame: frame + pickupCfg.reachFrames,
      };
      events.push({
        frame,
        type: "pickup_spawn",
        actorId: pickup.id,
        targetId: pickup.id,
        value: 0,
      });
    } else if (pickup !== null && frame >= pickup.resolveFrame) {
      claimPickup(pickup);
      pickup = null;
      nextPickupFrame = frame + pickupCfg.intervalFrames;
    }
  };

  const rubberBand = rules.rubberBand ?? 0;
  const waveThresholds = rules.comebackWaves ?? [];
  const waveSize = rules.comebackWaveSize ?? DEFAULT_WAVE_SIZE;

  const spawnMinion = (state: FighterState, spec: MinionSpec): MinionState => {
    const hp = Math.max(1, Math.round(spec.hp));
    state.minionsSpawned += 1;
    const minion: MinionState = {
      id: `${state.base.id}#m${state.minionsSpawned}`,
      ownerId: state.base.id,
      hp,
      maxHp: hp,
      attack: spec.attack,
      attackSpeed: spec.attackSpeed,
      lifetime: spec.lifetime,
      attackCooldown: ticksPerAttack(spec.attackSpeed),
      ticksLeft: Math.round(spec.lifetime * TICKS_PER_SECOND),
    };
    state.minions.push(minion);
    return minion;
  };

  /** Defensive wave when a fighter drops through a threshold, once each. */
  const checkComebackWaves = (state: FighterState): void => {
    if (waveThresholds.length === 0) return;
    const share = state.hp / state.base.maxHp;
    for (const threshold of waveThresholds) {
      if (share > threshold || state.wavesTriggered.includes(threshold)) continue;
      state.wavesTriggered.push(threshold);
      if (state.hp <= 0) continue;
      for (let i = 0; i < waveSize; i += 1) {
        const minion = spawnMinion(state, {
          hp: state.base.maxHp * WAVE_MINION_HP_SHARE,
          attack: state.base.attack * WAVE_MINION_ATTACK_SHARE,
          attackSpeed: WAVE_MINION_SPEED,
          lifetime: WAVE_MINION_LIFETIME,
        });
        events.push({
          frame,
          type: "spawn",
          actorId: state.base.id,
          targetId: minion.id,
          value: minion.hp,
        });
      }
    }
  };

  /**
   * Damage a signature is still owed, tick by tick.
   *
   * **A signature has to land damage, and land it visibly.** Ours took over the
   * screen for 1.4 seconds and did nothing to anyone's health: every point of
   * damage in the video came from somewhere else, so the biggest thing on screen
   * was decoration and the fight was decided off-camera. The reference does the
   * opposite — its one signature is a note highway that deals essentially all of
   * the damage a viewer can see arriving, note by note, each with its own flash
   * and its own number.
   *
   * So a cast schedules a short burst rather than one lump: several pulses over
   * the animation, each rolled and reported separately, each carrying the
   * victim's position so the renderer can mark it on them. Contact hits alone
   * cannot carry the fight either way — measured, two fighters meet every 2.3s
   * at best, against the reference's 1.20s between blows, and its own worst gap
   * of 4.87s. The pulses fill exactly the stretches where nobody is touching.
   */

  const SIGNATURE_FIRST_TICK = Math.round(SIGNATURE_LEAD_SECONDS * TICKS_PER_SECOND);
  /**
   * Ticks between pulses of one cast.
   *
   * Tight enough that a four-glass volley is over inside the effect's own 1.4s
   * animation: the last of four lands at 1.01s. At the old half-second spacing
   * the fourth arrived after the glasses had stopped being drawn, so a number
   * appeared with nothing attached to it.
   */
  const SIGNATURE_PULSE_GAP = Math.round(SIGNATURE_PULSE_SECONDS * TICKS_PER_SECOND);
  const pulses: { atTick: number; side: Side; knockback: boolean; share: number }[] = [];

  /**
   * Schedules one cast's worth of hits and returns how many there are, so the
   * caller can put the count in the event and the renderer can draw exactly
   * that many objects in flight.
   */
  const scheduleSignature = (
    state: FighterState,
    ability: Ability,
    knockback = false,
  ): number => {
    const range = ability.pulses;
    const count = range
      ? Math.round(state.rng.range(range[0], range[1] + 0.999 - 1e-9))
      : 1;
    for (let i = 0; i < count; i += 1) {
      pulses.push({
        atTick: tick + SIGNATURE_FIRST_TICK + i * SIGNATURE_PULSE_GAP,
        side: state.side,
        knockback,
        share: ability.hitShare ?? 1,
      });
    }
    return count;
  };

  const castAbility = (state: FighterState, ability: Ability): void => {
    const enemy = opponentOf(state);
    switch (ability.type) {
      // MAGNETIC NORTH. The needle picks a direction and everyone else is
      // pointed at it, whether they liked where they were going or not.
      case "magnetic_north": {
        const heading = movementRng[state.side].range(0, Math.PI * 2);
        setHeading(movement[enemy.side], heading);
        scheduleSignature(state, ability);
        events.push({
          frame: Math.floor(tick / TICKS_PER_FRAME),
          type: "signature",
          ability: ability.type,
          actorId: state.base.id,
          targetId: enemy.base.id,
          value: heading,
        });
        break;
      }
      /**
       * HAYMAKER — Boxer Guy throws a glove across the arena.
       *
       * The knock is the character: whatever it lands on is sent flying the way
       * the punch was going. Same shape as the other two — it leaves him, it
       * crosses, it arrives on the frame the damage lands.
       */
      case "haymaker": {
        const heading = Math.atan2(
          movement[enemy.side].y - movement[state.side].y,
          movement[enemy.side].x - movement[state.side].x,
        );
        // **He closes the distance himself.** A boxer does not throw his gloves
        // across the arena; he gets in range and hits you. So the dash moves the
        // caster, at a speed that covers most of the gap inside the lead time,
        // and the punch lands when he arrives.
        dash(
          movement[state.side],
          heading,
          HAYMAKER_DASH,
          tick + Math.round(SIGNATURE_LEAD_SECONDS * TICKS_PER_SECOND),
          true,
        );
        scheduleSignature(state, ability, true);
        events.push({
          frame: Math.floor(tick / TICKS_PER_FRAME),
          type: "signature",
          ability: ability.type,
          actorId: state.base.id,
          targetId: enemy.base.id,
          value: heading,
        });
        break;
      }
      /**
       * FOUR EYES — Glasses Guy flings a volley of spectacles.
       *
       * They land as a spread rather than a single hit, so the effect reads as a
       * scatter; the freeze-frame of a pair of glasses spinning across the
       * arena is the whole gag.
       */
      /**
       * GLASSES THROW — his ordinary attack, and the only one he has.
       *
       * He does not punch: `meleeShare` is zero, so running into him costs
       * nothing. One pair of spectacles, thrown hard, four or so times a fight.
       */
      case "glasses_throw": {
        const thrownOne = scheduleSignature(state, ability);
        events.push({
          frame: Math.floor(tick / TICKS_PER_FRAME),
          type: "signature",
          ability: ability.type,
          actorId: state.base.id,
          targetId: enemy.base.id,
          value: thrownOne,
        });
        break;
      }
      case "four_eyes": {
        // The count is rolled here and carried in the event, so the renderer
        // throws exactly as many pairs as land. Deriving it separately in the
        // render layer would let the picture and the health bar disagree.
        const thrown = scheduleSignature(state, ability);
        events.push({
          frame: Math.floor(tick / TICKS_PER_FRAME),
          type: "signature",
          ability: ability.type,
          actorId: state.base.id,
          targetId: enemy.base.id,
          value: thrown,
        });
        break;
      }
      /**
       * THROWN OUT — Bodyguard Guy.
       *
       * **He is a bouncer, so he throws you out.** He grabs whoever is in front
       * of him and hurls them the length of the arena; they cross it at four
       * times their own speed and hit the far wall.
       *
       * The ability he had was hazard tape and a freeze, and both were wrong.
       * The tape is a *detective's* prop — it was copied off the reference's
       * Detective Guy and put on the wrong man — and a bodyguard who stops the
       * arena dead is doing a policeman's job. What a bodyguard does is move
       * people, which is also the one verb this format is built out of: the
       * whole picture is two figures crossing a square.
       */
      case "thrown_out": {
        const away = Math.atan2(
          movement[enemy.side].y - movement[state.side].y,
          movement[enemy.side].x - movement[state.side].x,
        );
        dash(
          movement[enemy.side],
          away,
          THROW_SPEED,
          tick + Math.round(THROW_SECONDS * TICKS_PER_SECOND),
        );
        scheduleSignature(state, ability);
        events.push({
          frame: Math.floor(tick / TICKS_PER_FRAME),
          type: "signature",
          ability: ability.type,
          actorId: state.base.id,
          targetId: enemy.base.id,
          value: away,
        });
        break;
      }
      // NOBODY MOVES. He lowers the sunglasses and the arena stops.
      case "nobody_moves": {
        movement[enemy.side].frozenUntilTick = tick + Math.round((ability.duration ?? 1.2) * TICKS_PER_SECOND);
        scheduleSignature(state, ability);
        events.push({
          frame: Math.floor(tick / TICKS_PER_FRAME),
          type: "signature",
          ability: ability.type,
          actorId: state.base.id,
          targetId: enemy.base.id,
          value: ability.duration ?? 1.2,
        });
        break;
      }
      case "spawn_minion": {
        const minion = spawnMinion(state, minionSpec(ability));
        events.push({
          frame,
          type: "spawn",
          actorId: state.base.id,
          targetId: minion.id,
          value: minion.hp,
        });
        break;
      }
      case "heal": {
        const healed = Math.min(
          Math.round(ability.power),
          state.base.maxHp - state.hp,
        );
        if (healed <= 0) break;
        state.hp += healed;
        events.push({
          frame,
          type: "heal",
          actorId: state.base.id,
          targetId: state.base.id,
          value: healed,
        });
        break;
      }
      case "buff_attack": {
        const duration = ability.duration ?? DEFAULT_BUFF_DURATION;
        state.buffs.push({
          power: ability.power,
          expiresAtTick: tick + Math.round(duration * TICKS_PER_SECOND),
        });
        events.push({
          frame,
          type: "buff",
          actorId: state.base.id,
          targetId: state.base.id,
          value: ability.power,
        });
        break;
      }
      case "aoe": {
        const damage = Math.max(1, Math.round(ability.power));
        const dealt = damageFighter(enemy, damage);
        events.push({
          frame,
          type: "aoe",
          actorId: state.base.id,
          targetId: enemy.base.id,
          value: dealt,
        });
        for (const minion of enemy.minions) {
          pendingMinionDamage.push({ target: minion, amount: damage });
        }
        break;
      }
    }
  };

  const step = (): void => {
    tick += 1;

    // Buffs expire before anything reads the attack stat this tick.
    for (const side of [sides.a, sides.b]) {
      if (side.buffs.length > 0) {
        side.buffs = side.buffs.filter((b) => b.expiresAtTick > tick);
      }
      if (side.speedBuffs.length > 0) {
        side.speedBuffs = side.speedBuffs.filter((b) => b.expiresAtTick > tick);
      }
    }

    // Abilities, in fighter order then ability order — fixed, so the RNG stream
    // is consumed identically on every run.
    for (const side of [sides.a, sides.b]) {
      for (let i = 0; i < side.abilityCooldowns.length; i += 1) {
        side.abilityCooldowns[i] = side.abilityCooldowns[i]! - 1;
        if (side.abilityCooldowns[i]! > 0) continue;
        const ability = side.base.abilities[i]!;
        castAbility(side, ability);
        side.abilityCooldowns[i] = ability.cooldown * TICKS_PER_SECOND;
      }
    }

    // **A charge homes on the man it was aimed at.**
    //
    // `HAYMAKER` used to set the heading once, at the moment of the cast, and
    // then run for the lead time — during which the other man keeps bouncing and
    // the boxer's own wall reflections re-steer him. So he arrived at where the
    // target had been a third of a second ago, and the punch landed on empty
    // arena while the number appeared on somebody standing elsewhere. Re-aiming
    // every tick is what makes a charge a charge: he lands *on* him.
    for (const side of [sides.a, sides.b]) {
      const me = movement[side.side];
      // Only a *charge* homes. A man who has been thrown flies where he was
      // thrown — steering him back at the thrower would be a boomerang.
      if (tick >= me.dashUntilTick || !me.dashHoming) continue;
      const them = movement[opponentOf(side).side];
      setHeading(me, Math.atan2(them.y - me.y, them.x - me.x));
    }

    // The bounce...
    for (const side of [sides.a, sides.b]) {
      stepMovement(movement[side.side], { tick, rng: movementRng[side.side] });
    }
    // ...and then off each other. After both have travelled, so the pair is
    // resolved from the positions they actually reached rather than from one
    // fighter's stale position, which would make the outcome depend on which of
    // them stepped first.
    const contact = resolveCollision(movement.a, movement.b, tick);

    /**
     * **Damage lands on contact.** This is the fight.
     *
     * It used to come off a clock, at whatever distance the pair happened to
     * be, and the owner's verdict on that was that they were hitting air: a
     * number appeared over someone standing alone in an empty half of the
     * arena, and nothing on screen said why. Traced through the reference frame
     * by frame, that is not what it does. When the two run into each other:
     *
     *   - **both take damage in the same frame**, each dealing their own — one
     *     video shows "-75" over one man and "-120" over the other, together;
     *   - both flash white, and an impact mark is drawn where they met.
     *
     * So the swing happens where a viewer is already looking, and the cause is
     * on screen. The cooldown survives as a readiness gate rather than a
     * metronome: a fighter who has just swung cannot swing again until it
     * refills, so lying against each other for a few ticks is one blow, not
     * twenty.
     */
    if (contact?.closing === true) {
      const landed: { side: FighterState; dealt: number; crit: boolean }[] = [];
      for (const side of [sides.a, sides.b]) {
        if (side.attackCooldown > 0) continue;
        // A fighter with no melee at all lands nothing by bumping into someone,
        // and must not push a "-0" onto the screen for it. Glasses Guy touches
        // nobody: every point he takes off the other man is thrown.
        if ((side.base.meleeShare ?? 1) <= 0) continue;
        const isCrit = side.rng.chance(side.base.critChance);
        const raw =
          effectiveAttack(side) *
          // What this fighter is worth in a collision — see `meleeShare`. The
          // boxer's is the heaviest number on screen; the man who throws his
          // glasses barely registers when you bump into him.
          (side.base.meleeShare ?? 1) *
          (isCrit ? side.base.critMult : 1) *
          comebackMultiplier(side, rubberBand);
        landed.push({ side, dealt: rollDamage(side.rng, raw), crit: isCrit });
      }
      // Rolled for both before either is applied, so a fighter who dies to this
      // exchange still lands the blow they were throwing. A mutual knockout is
      // a real outcome of running into each other and reads as one.
      for (const { side, dealt, crit } of landed) {
        const enemy = opponentOf(side);
        const done = damageFighter(enemy, dealt);
        events.push({
          frame,
          type: crit ? "crit" : "hit",
          actorId: side.base.id,
          targetId: enemy.base.id,
          value: done,
          atX: contact.x,
          atY: contact.y,
        });
        side.attackCooldown = ticksPerAttack(effectiveAttackSpeed(side));
      }
    }
    for (const side of [sides.a, sides.b]) {
      if (side.attackCooldown > 0) side.attackCooldown -= 1;
    }

    // Signature pulses that come due this tick. Reported at the victim's own
    // position rather than the caster's: the effect fills the arena, so what a
    // viewer needs marked is where it bit.
    for (let i = pulses.length - 1; i >= 0; i -= 1) {
      const pulse = pulses[i]!;
      if (pulse.atTick !== tick) continue;
      pulses.splice(i, 1);
      const caster = sides[pulse.side];
      const victim = opponentOf(caster);
      if (caster.hp <= 0 || victim.hp <= 0) continue;
      const isCrit = caster.rng.chance(caster.base.critChance);
      const raw =
        effectiveAttack(caster) *
        SIGNATURE_PULSE_SHARE *
        pulse.share *
        (isCrit ? caster.base.critMult : 1) *
        comebackMultiplier(caster, rubberBand);
      const dealt = damageFighter(victim, rollDamage(caster.rng, raw));
      const at = movement[victim.side];
      // The knock happens when the punch lands, not when it was thrown. Sending
      // the victim flying before the blow arrives is exactly the incoherence
      // this whole pass is about.
      if (pulse.knockback) {
        setHeading(
          at,
          Math.atan2(at.y - movement[caster.side].y, at.x - movement[caster.side].x),
        );
      }
      events.push({
        frame,
        type: isCrit ? "crit" : "hit",
        actorId: caster.base.id,
        targetId: victim.base.id,
        value: dealt,
        atX: at.x,
        atY: at.y,
      });
    }

    // Minions attack the enemy fighter and age.
    for (const side of [sides.a, sides.b]) {
      const enemy = opponentOf(side);
      for (const minion of side.minions) {
        if (minion.hp <= 0) continue;
        minion.attackCooldown -= 1;
        if (minion.attackCooldown <= 0) {
          const dealt = damageFighter(enemy, rollDamage(side.rng, minion.attack));
          events.push({
            frame,
            type: "minion_hit",
            actorId: minion.id,
            targetId: enemy.base.id,
            value: dealt,
          });
          minion.attackCooldown += ticksPerAttack(minion.attackSpeed);
        }
        minion.ticksLeft -= 1;
      }
    }

    applyPendingDamage();

    if (waveThresholds.length > 0) {
      checkComebackWaves(sides.a);
      checkComebackWaves(sides.b);
    }

    // Minions that ran out of HP or lifetime leave the field.
    for (const side of [sides.a, sides.b]) {
      const survivors: MinionState[] = [];
      for (const minion of side.minions) {
        if (minion.hp > 0 && minion.ticksLeft > 0) {
          survivors.push(minion);
          continue;
        }
        events.push({
          frame,
          type: "minion_death",
          actorId: minion.id,
          targetId: minion.id,
          value: 0,
        });
      }
      side.minions = survivors;
    }

    // Deaths. Simultaneous KO counts as a draw.
    const aDead = sides.a.hp <= 0;
    const bDead = sides.b.hp <= 0;
    if (aDead || bDead) {
      winner = aDead && bDead ? "draw" : aDead ? "b" : "a";
      if (aDead) {
        events.push({
          frame,
          type: "death",
          actorId: sides.a.base.id,
          targetId: sides.a.base.id,
          value: 0,
        });
      }
      if (bDead) {
        events.push({
          frame,
          type: "death",
          actorId: sides.b.base.id,
          targetId: sides.b.base.id,
          value: 0,
        });
      }
    }
  };

  const snapshotMinions = (): MinionSnapshot[] => {
    const out: MinionSnapshot[] = [];
    for (const side of [sides.a, sides.b]) {
      for (const m of side.minions) {
        out.push({ id: m.id, ownerId: m.ownerId, hp: m.hp, maxHp: m.maxHp });
      }
    }
    return out;
  };

  const takeSnapshot = (): void => {
    snapshots.push({
      frame,
      a: {
        id: sides.a.base.id,
        x: movement.a.x,
        y: movement.a.y,
        hp: Math.max(0, sides.a.hp),
        maxHp: sides.a.base.maxHp,
        attack: effectiveAttack(sides.a),
        alive: sides.a.hp > 0,
        buffed: sides.a.buffs.length > 0,
      },
      b: {
        id: sides.b.base.id,
        x: movement.b.x,
        y: movement.b.y,
        hp: Math.max(0, sides.b.hp),
        maxHp: sides.b.base.maxHp,
        attack: effectiveAttack(sides.b),
        alive: sides.b.hp > 0,
        buffed: sides.b.buffs.length > 0,
      },
      minions: snapshotMinions(),
      ...(pickup === null ? {} : { pickup: { ...pickup } }),
    });
  };

  takeSnapshot();

  const frameCap = Math.min(MAX_FRAMES, rules.maxFrames ?? MAX_FRAMES);
  for (frame = 1; frame < frameCap; frame += 1) {
    stepPickups();
    for (let i = 0; i < TICKS_PER_FRAME && winner === null; i += 1) step();
    takeSnapshot();
    if (winner !== null) break;
  }

  const timedOut = winner === null;
  const decideOnTimeout = (): Winner => {
    // Timeout: whoever kept the larger share of their health bar takes it.
    const aShare = sides.a.hp / sides.a.base.maxHp;
    const bShare = sides.b.hp / sides.b.base.maxHp;
    return aShare === bShare ? "draw" : aShare > bShare ? "a" : "b";
  };
  const finalWinner: Winner = winner ?? decideOnTimeout();

  const lastFrame = snapshots[snapshots.length - 1]!.frame;
  const winnerId =
    finalWinner === "draw" ? null : finalWinner === "a" ? fighters.a.id : fighters.b.id;
  if (winnerId !== null) {
    events.push({
      frame: lastFrame,
      type: "victory",
      actorId: winnerId,
      targetId: winnerId,
      value: 0,
    });
  }

  return {
    seed,
    fighters,
    snapshots,
    events,
    winner: finalWinner,
    winnerId,
    durationFrames: snapshots.length,
    timedOut,
  };
}
