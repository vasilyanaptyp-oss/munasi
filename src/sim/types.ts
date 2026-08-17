/** Simulation tick rate. Two ticks per video frame. */
export const TICKS_PER_SECOND = 60;
/** Video frame rate. */
export const FPS = 30;
export const TICKS_PER_FRAME = TICKS_PER_SECOND / FPS;
/** Hard timeout: 60 seconds of video. */
export const MAX_FRAMES = 60 * FPS;

/**
 * `magnetic_north` and `nobody_moves` are signature abilities: they do no damage
 * and instead seize the other fighter's *movement*, which in a game whose whole
 * picture is two figures bouncing is the strongest thing an ability can do.
 */
export type AbilityType =
  | "spawn_minion"
  | "heal"
  | "buff_attack"
  | "aoe"
  | "magnetic_north"
  | "nobody_moves"
  | "thrown_out"
  | "haymaker"
  | "glasses_throw"
  | "four_eyes";

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
  /**
   * How many separate hits one cast lands, as `[min, max]` rolled per cast.
   * Defaults to one.
   *
   * This is what makes a thrower a thrower: Glasses Guy's cast is 2-4 pairs of
   * spectacles, each arriving on its own and each carrying its own number, so
   * what the viewer counts on screen is what came off the health bar. The rest
   * cast once and hit once.
   */
  pulses?: [number, number];
  /**
   * Weight of each of this ability's hits, relative to the standard signature
   * pulse. Defaults to one.
   *
   * A haymaker is supposed to be the hardest thing that happens to you, and it
   * was landing the *smallest* number in the video: every ability dealt one
   * standard pulse, so the boxer's big swing came in under his own ordinary
   * punches. Few and heavy for him; many and light for a man throwing glasses.
   */
  hitShare?: number;
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
  /**
   * The figure's outline: `[left, right]` per horizontal band, top to bottom,
   * as fractions of the sprite's own width. Written by the calibrator straight
   * out of the PNG's alpha channel — see `spriteProfile`.
   *
   * **This is what two fighters collide on.** A bounding box scaled by a
   * hand-set share was the wrong shape in both directions at once: too narrow
   * across the shoulders, too wide beside the head. Because the numbers are
   * fractions of the drawn sprite, the outline the simulation bounces is the
   * outline the renderer draws, at whatever size it draws it.
   *
   * Optional so a fighter invented in a test does not need a PNG; without it
   * the whole rectangle is solid.
   */
  silhouette?: [number, number][];
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
  /**
   * Multiplier on the damage this fighter deals **by running into the other
   * one**, separately from what its ability deals. Defaults to 1.
   *
   * This is where a character's fighting style lives, and it is the difference
   * between two figures that behave the same and two that do not. A boxer hits
   * you when he reaches you: he is the one with the heavy hands, and his
   * contact damage should be the biggest number in the video. A man who throws
   * his glasses across the arena does not brawl — bumping into him should
   * barely register, and everything he is worth arrives from range.
   *
   * Kept apart from `attack` because `attack` is *solved* by the calibrator to
   * even the fighters out. Folding style into it would have the calibrator undo
   * the style on its next run.
   */
  meleeShare?: number;
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
  | "pickup_claim"
  /** A signature ability fired. `value` carries whatever it needs to draw. */
  | "signature";

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
  /**
   * Where in the arena's unit square the blow landed, when it landed anywhere
   * in particular. Present on contact hits, so the renderer can draw the impact
   * between the two figures instead of leaving a number to appear from nowhere.
   */
  atX?: number;
  atY?: number;
  /**
   * Which ability a `signature` event came from.
   *
   * A fighter may carry more than one — Glasses Guy has his ordinary throw and
   * his volley — and the renderer has to draw the one that actually fired. It
   * used to look the ability up by owner and take the first that draws
   * anything, which is only correct while everybody has exactly one.
   */
  ability?: AbilityType;
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
