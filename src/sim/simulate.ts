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
  const fighters = { a: cloneFighter(config.a), b: cloneFighter(config.b) };

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
    attackCooldown: ticksPerAttack(base.attackSpeed),
    abilityCooldowns: base.abilities.map((ab) => ab.cooldown * TICKS_PER_SECOND),
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

  const castAbility = (state: FighterState, ability: Ability): void => {
    const enemy = opponentOf(state);
    switch (ability.type) {
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

    // Basic attacks.
    for (const side of [sides.a, sides.b]) {
      const enemy = opponentOf(side);
      side.attackCooldown -= 1;
      if (side.attackCooldown > 0) continue;
      const isCrit = side.rng.chance(side.base.critChance);
      const raw =
        effectiveAttack(side) *
        (isCrit ? side.base.critMult : 1) *
        comebackMultiplier(side, rubberBand);
      const dealt = damageFighter(enemy, rollDamage(side.rng, raw));
      events.push({
        frame,
        type: isCrit ? "crit" : "hit",
        actorId: side.base.id,
        targetId: enemy.base.id,
        value: dealt,
      });
      side.attackCooldown += ticksPerAttack(effectiveAttackSpeed(side));
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
        hp: Math.max(0, sides.a.hp),
        maxHp: sides.a.base.maxHp,
        attack: effectiveAttack(sides.a),
        alive: sides.a.hp > 0,
        buffed: sides.a.buffs.length > 0,
      },
      b: {
        id: sides.b.base.id,
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
