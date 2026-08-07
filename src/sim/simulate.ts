import { mulberry32, type Rng } from "./rng.js";
import type {
  Ability,
  Fighter,
  MatchConfig,
  MatchEvent,
  MatchResult,
  Minion,
  MinionSnapshot,
  MinionSpec,
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
  minions: MinionState[];
  minionsSpawned: number;
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
export function simulate(config: MatchConfig, seed: number): MatchResult {
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
    hp: base.maxHp,
    attackCooldown: ticksPerAttack(base.attackSpeed),
    abilityCooldowns: base.abilities.map((ab) => ab.cooldown * TICKS_PER_SECOND),
    buffs: [],
    minions: [],
    minionsSpawned: 0,
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

  const rollDamage = (rng: Rng, attack: number): number =>
    Math.max(1, Math.round(attack * rng.range(1 - DAMAGE_VARIANCE, 1 + DAMAGE_VARIANCE)));

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

  const castAbility = (state: FighterState, ability: Ability): void => {
    const enemy = opponentOf(state);
    switch (ability.type) {
      case "spawn_minion": {
        const spec = minionSpec(ability);
        const hp = Math.max(1, Math.round(spec.hp));
        state.minionsSpawned += 1;
        state.minions.push({
          id: `${state.base.id}#m${state.minionsSpawned}`,
          ownerId: state.base.id,
          hp,
          maxHp: hp,
          attack: spec.attack,
          attackSpeed: spec.attackSpeed,
          lifetime: spec.lifetime,
          attackCooldown: ticksPerAttack(spec.attackSpeed),
          ticksLeft: Math.round(spec.lifetime * TICKS_PER_SECOND),
        });
        events.push({
          frame,
          type: "spawn",
          actorId: state.base.id,
          targetId: state.minions[state.minions.length - 1]!.id,
          value: hp,
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
      const raw = effectiveAttack(side) * (isCrit ? side.base.critMult : 1);
      const dealt = damageFighter(enemy, rollDamage(side.rng, raw));
      events.push({
        frame,
        type: isCrit ? "crit" : "hit",
        actorId: side.base.id,
        targetId: enemy.base.id,
        value: dealt,
      });
      side.attackCooldown += ticksPerAttack(side.base.attackSpeed);
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
    });
  };

  takeSnapshot();

  for (frame = 1; frame < MAX_FRAMES; frame += 1) {
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
