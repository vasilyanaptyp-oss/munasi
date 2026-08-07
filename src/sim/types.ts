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

export type Side = "a" | "b";

export interface FighterSnapshot {
  id: string;
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
  | "victory";

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
