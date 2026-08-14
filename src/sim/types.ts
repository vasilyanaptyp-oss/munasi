/** Simulation tick rate. Two ticks per video frame. */
export const TICKS_PER_SECOND = 60;
/** Video frame rate. */
export const FPS = 30;
export const TICKS_PER_FRAME = TICKS_PER_SECOND / FPS;
/** Hard timeout: 60 seconds of video. */
export const MAX_FRAMES = 60 * FPS;

export type AbilityType = "spawn_minion" | "heal" | "buff_attack" | "aoe";

/** Stats of a minion produced by a `spawn_minion` ability. */
export interface MinionSpec {
  hp: number;
  attack: number;
  /** Attacks per second. */
  attackSpeed: number;
  /** Seconds the minion lives before expiring. */
  lifetime: number;
}

export interface Ability {
  type: AbilityType;
  /** Seconds between casts. The first cast happens after one full cooldown. */
  cooldown: number;
  /**
   * Meaning depends on `type`:
   * - `spawn_minion` — minion HP (other stats derived, or overridden by `minion`)
   * - `heal` — HP restored
   * - `buff_attack` — added to the attack multiplier (0.3 = +30%)
   * - `aoe` — damage dealt to the enemy fighter and every enemy minion
   */
  power: number;
  /** `buff_attack` only: seconds the buff lasts. Defaults to 5. */
  duration?: number;
  /** `spawn_minion` only: explicit stats instead of the derived ones. */
  minion?: MinionSpec;
}

export interface Fighter {
  id: string;
  name: string;
  spriteId: string;
  /**
   * Width over height of the fighter's cut-out.
   *
   * The simulation needs it because a fighter bounces off the walls as a box,
   * and a wide figure has to turn around sooner than a narrow one. It comes from
   * the PNG's own dimensions (`pnpm cutout` writes it into the roster), so the
   * box the simulation bounces is the box the renderer draws — the two cannot
   * drift apart.
   */
  aspect: number;
  maxHp: number;
  /** Current HP. Equals `maxHp` at the start of a match. */
  hp: number;
  attack: number;
  /** Attacks per second. */
  attackSpeed: number;
  /** 0..1 */
  critChance: number;
  /** Damage multiplier on a crit, e.g. 2 for double damage. */
  critMult: number;
  abilities: Ability[];
}

export interface Minion {
  id: string;
  ownerId: string;
  hp: number;
  maxHp: number;
  attack: number;
  /** Attacks per second. */
  attackSpeed: number;
  /** Seconds remaining before the minion expires. */
  lifetime: number;
}

export interface MatchConfig {
  a: Fighter;
  b: Fighter;
}

/**
 * Optional rule changes, all off by default so the shipped behaviour and every
 * recorded seed stay exactly as they were.
 *
 * These exist to test whether a *mechanical* comeback reads better than the
 * lucky-crit comeback the base game produces. See `pnpm diagnose --comeback`.
 */
export interface MatchRules {
  /**
   * Damage bonus that grows as a fighter loses HP: a fighter at zero HP would
   * hit for `1 + rubberBand` times normal. 0 disables it.
   */
  rubberBand?: number;
  /**
   * HP shares (e.g. [0.5, 0.25]) at which a fighter summons a defensive wave
   * of minions, once each per match.
   */
  comebackWaves?: number[];
  /** Minions per wave. */
  comebackWaveSize?: number;
  /**
   * Challenger's starting HP. Used by the gauntlet, where HP carries across
   * rounds instead of resetting. Defaults to `a.maxHp`.
   */
  startHpA?: number;
  /** Per-match frame cap. Defaults to the 60-second timeout. */
  maxFrames?: number;
  /** Overrides `DAMAGE_VARIANCE` for this match. */
  damageVariance?: number;
  /**
   * Trades damage per hit for hits per second: `attackSpeed` is multiplied by
   * this and `attack` divided by it, so damage per second is unchanged.
   *
   * The reference channel lands small numbers almost every frame; ours landed
   * rare big ones with dead air between. Defaults to 1, so the duel is
   * untouched.
   */
  attackRate?: number;
  /**
   * Multiplier on both fighters' first attack cooldown, 0..1.
   *
   * The gauntlet uses it to shorten the dead air at a round change: after a
   * death the video held ~0.9s for the death animation and then waited another
   * 0.7-1.1s for the newcomer's first swing. Both sides get the same head
   * start, so the race is unchanged. Defaults to 1, which is what the duel
   * uses — the 1v1 format is untouched.
   */
  openingCooldown?: number;
  /** Arena pickups. Omit to disable them. */
  pickups?: PickupRules;
}

export type Side = "a" | "b";

export interface FighterSnapshot {
  id: string;
  /**
   * Position in the arena's unit square: `x` left to right, `y` far to near.
   * See `movement.ts` — the renderer maps these onto its two ground lines.
   */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Effective attack including active buffs. */
  attack: number;
  alive: boolean;
  /** True while at least one `buff_attack` is active. */
  buffed: boolean;
}

export interface MinionSnapshot {
  id: string;
  ownerId: string;
  hp: number;
  maxHp: number;
}

/** One entry per video frame. */
export interface Snapshot {
  frame: number;
  a: FighterSnapshot;
  b: FighterSnapshot;
  minions: MinionSnapshot[];
  /** Item currently on the floor, if any. */
  pickup?: PickupSnapshot;
}

export type PickupType = "heal" | "damage_buff" | "attack_speed";

/**
 * A pickup on the arena floor. There is no positional simulation: the item
 * appears, both fighters reach for it, and who gets there first is decided by
 * attack speed plus the seeded roll — which is all the viewer can read anyway.
 */
export interface PickupSnapshot {
  id: string;
  type: PickupType;
  /** Frame it appeared on. */
  spawnFrame: number;
  /** Frame it will be claimed on. */
  resolveFrame: number;
}

export interface PickupRules {
  /** Frame of the first spawn. */
  firstFrame?: number;
  /** Frames between spawns. */
  intervalFrames?: number;
  /** Frames a pickup sits on the floor before someone reaches it. */
  reachFrames?: number;
  /** HP restored by a `heal`. */
  healPower?: number;
  /** Attack multiplier added by a `damage_buff`. */
  damageBuff?: number;
  /** Attack-speed multiplier added by an `attack_speed`. */
  speedBuff?: number;
  /** Seconds a pickup buff lasts. */
  buffDuration?: number;
}

export type EventType =
  | "hit"
  | "crit"
  | "minion_hit"
  | "heal"
  | "buff"
  | "aoe"
  | "spawn"
  | "death"
  | "minion_death"
  | "victory"
  | "pickup_spawn"
  | "pickup_claim";

export interface MatchEvent {
  /** Video frame the event belongs to. */
  frame: number;
  type: EventType;
  /** Fighter or minion id that caused the event. */
  actorId: string;
  /** Fighter or minion id it landed on. Equals `actorId` for self-targeted effects. */
  targetId: string;
  /** Damage, healing, minion HP, buff power — depends on `type`. */
  value: number;
}

export type Winner = Side | "draw";

export interface MatchResult {
  seed: number;
  /** Immutable copies of the fighters as they entered the match. */
  fighters: { a: Fighter; b: Fighter };
  snapshots: Snapshot[];
  events: MatchEvent[];
  winner: Winner;
  /** Id of the winning fighter, or null on a draw. */
  winnerId: string | null;
  /** Number of snapshots, i.e. length of the video in frames. */
  durationFrames: number;
  /** True when the match hit the 60-second timeout instead of a knockout. */
  timedOut: boolean;
}
