import { simulate } from "./simulate.js";
import type {
  Fighter,
  FighterSnapshot,
  MatchEvent,
  MatchResult,
  MinionSnapshot,
  PickupSnapshot,
  PickupRules,
} from "./types.js";
import { FPS } from "./types.js";

/**
 * One fighter against a team, one member at a time.
 *
 * The shape comes from the reference frames (see `refs/README.md`): two
 * fighters on screen at once, the roster panel's pointer walking down the team,
 * and the challenger's HP falling across the whole run without ever resetting.
 * Each team member, by contrast, starts their round at full health — which is
 * what makes the third round the one that matters.
 */

export interface Team {
  id: string;
  name: string;
  members: Fighter[];
}

export interface GauntletConfig {
  challenger: Fighter;
  team: Team;
}

/** Frames one round may run before it is called on remaining HP. */
export const ROUND_FRAME_CAP = 20 * FPS;
/**
 * Frames held on the last snapshot of a round. Without this the loser's death
 * animation has a single frame to play before the next round replaces them,
 * so the figure appears to stand there intact at 0 HP.
 */
export const ROUND_HOLD_FRAMES = 26;

export interface GauntletRules {
  /** Per-round frame cap. */
  roundFrameCap?: number;
  /** Frames held after a round ends, for the death animation. */
  roundHoldFrames?: number;
  /** Overrides the simulation's damage spread. */
  damageVariance?: number;
  /** Arena pickups. Omit for none. */
  pickups?: PickupRules;
}

export interface GauntletRound {
  /** 0-based. */
  index: number;
  opponentId: string;
  opponentName: string;
  /** Inclusive, on the continuous timeline. */
  startFrame: number;
  /** Exclusive, on the continuous timeline. */
  endFrame: number;
  challengerWon: boolean;
  challengerHpStart: number;
  challengerHpEnd: number;
  opponentHpEnd: number;
}

export interface GauntletSnapshot {
  /** Frame on the continuous timeline. */
  frame: number;
  /** Which round this frame belongs to. */
  round: number;
  challenger: FighterSnapshot;
  opponent: FighterSnapshot;
  minions: MinionSnapshot[];
  pickup?: PickupSnapshot;
}

export interface GauntletResult {
  seed: number;
  challenger: Fighter;
  team: Team;
  rounds: GauntletRound[];
  /** One entry per video frame, continuous across rounds. */
  snapshots: GauntletSnapshot[];
  /** Frames are on the continuous timeline. */
  events: MatchEvent[];
  /** True only if the challenger cleared every member. */
  challengerWon: boolean;
  /** 1-based round the run was decided in. */
  decidedInRound: number;
  durationFrames: number;
}

/** Per-round seeds, so a round's rolls do not depend on the previous one. */
function roundSeed(seed: number, index: number): number {
  let h = (seed ^ 0x27d4eb2d) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h = Math.imul(h ^ (index + 1), 0x9e3779b1);
  return (h ^ (h >>> 13)) | 0;
}

/**
 * Runs the whole gauntlet. Pure and deterministic: same config and seed give
 * the same run, and neither argument is mutated.
 */
export function simulateGauntlet(
  config: GauntletConfig,
  seed: number,
  rules: GauntletRules = {},
): GauntletResult {
  const { challenger, team } = config;
  const frameCap = rules.roundFrameCap ?? ROUND_FRAME_CAP;
  const holdFrames = rules.roundHoldFrames ?? ROUND_HOLD_FRAMES;

  const rounds: GauntletRound[] = [];
  const snapshots: GauntletSnapshot[] = [];
  const events: MatchEvent[] = [];

  let carriedHp = challenger.maxHp;
  let offset = 0;
  let challengerWon = true;
  let decidedInRound = team.members.length;

  for (const [index, member] of team.members.entries()) {
    const round: MatchResult = simulate({ a: challenger, b: member }, roundSeed(seed, index), {
      startHpA: carriedHp,
      maxFrames: frameCap,
      ...(rules.damageVariance === undefined ? {} : { damageVariance: rules.damageVariance }),
      ...(rules.pickups === undefined ? {} : { pickups: rules.pickups }),
    });

    // The first frame of a round repeats the last frame of the previous one
    // (both fighters standing, nothing has happened yet), so it is dropped to
    // keep the continuous feed free of a stutter at every round boundary.
    const skip = index === 0 ? 0 : 1;
    for (const snap of round.snapshots.slice(skip)) {
      snapshots.push({
        frame: offset + snap.frame - skip,
        round: index,
        challenger: snap.a,
        opponent: snap.b,
        minions: snap.minions,
        ...(snap.pickup === undefined ? {} : { pickup: snap.pickup }),
      });
    }
    for (const event of round.events) {
      if (event.frame < skip) continue;
      events.push({ ...event, frame: offset + event.frame - skip });
    }

    const last = round.snapshots[round.snapshots.length - 1]!;
    const startFrame = offset;
    offset += round.snapshots.length - skip;

    // Hold on the final frame so the death plays out before the next member
    // walks on. The events are already recorded, so the renderer just keeps
    // advancing the death animation.
    for (let i = 0; i < holdFrames; i += 1) {
      snapshots.push({
        frame: offset + i,
        round: index,
        challenger: last.a,
        opponent: last.b,
        minions: last.minions,
      });
    }
    offset += holdFrames;

    const wonRound = last.a.hp > 0 && last.b.hp <= 0;
    rounds.push({
      index,
      opponentId: member.id,
      opponentName: member.name,
      startFrame,
      endFrame: offset,
      challengerWon: wonRound,
      challengerHpStart: carriedHp,
      challengerHpEnd: last.a.hp,
      opponentHpEnd: last.b.hp,
    });

    carriedHp = last.a.hp;
    if (!wonRound) {
      challengerWon = false;
      decidedInRound = index + 1;
      break;
    }
  }

  return {
    seed,
    challenger,
    team,
    rounds,
    snapshots,
    events,
    challengerWon,
    decidedInRound: challengerWon ? team.members.length : decidedInRound,
    durationFrames: snapshots.length,
  };
}

/**
 * Drama for a gauntlet. The 1v1 scorer reads a single HP race; here the shape
 * that matters is different — a run decided in the last round with the
 * challenger nearly dead is the one worth posting.
 */
export interface GauntletDrama {
  /** How little the winner had left. */
  closeness: number;
  /** How deep into the team the run went. */
  depth: number;
  /** Length against the 25-35 second window. */
  pacing: number;
  /** How close the final round was. */
  finalRound: number;
  total: number;
}

const WEIGHTS = { closeness: 30, depth: 30, pacing: 20, finalRound: 20 } as const;
const PACING_IDEAL: [number, number] = [25, 35];
const PACING_ZERO: [number, number] = [12, 50];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function pacingScore(seconds: number): number {
  const [lo, hi] = PACING_IDEAL;
  if (seconds >= lo && seconds <= hi) return 1;
  const [zeroLo, zeroHi] = PACING_ZERO;
  return seconds < lo
    ? clamp01((seconds - zeroLo) / (lo - zeroLo))
    : clamp01((zeroHi - seconds) / (zeroHi - hi));
}

export function scoreGauntletDramaDetailed(result: GauntletResult): GauntletDrama {
  const last = result.rounds.at(-1);
  const finalSnap = result.snapshots.at(-1);
  if (!last || !finalSnap) return { closeness: 0, depth: 0, pacing: 0, finalRound: 0, total: 0 };

  const closeness = result.challengerWon
    ? clamp01(1 - last.challengerHpEnd / result.challenger.maxHp)
    : clamp01(1 - last.opponentHpEnd / (finalSnap.opponent.maxHp || 1));

  // Reaching the last member is most of what makes the format work.
  const depth = clamp01((result.rounds.length - 1) / Math.max(1, result.team.members.length - 1));
  const pacing = pacingScore(result.durationFrames / FPS);

  // How close the deciding round itself was, by HP share at its end.
  const loserShare = result.challengerWon
    ? last.challengerHpEnd / result.challenger.maxHp
    : last.opponentHpEnd / (finalSnap.opponent.maxHp || 1);
  const finalRound = clamp01(1 - loserShare);

  const total =
    closeness * WEIGHTS.closeness +
    depth * WEIGHTS.depth +
    pacing * WEIGHTS.pacing +
    finalRound * WEIGHTS.finalRound;

  return { closeness, depth, pacing, finalRound, total };
}

export function scoreGauntletDrama(result: GauntletResult): number {
  return scoreGauntletDramaDetailed(result).total;
}

export interface BestGauntlet {
  seed: number;
  result: GauntletResult;
  score: number;
}

/** Best of a block of seeds, ties broken toward the lower seed. */
export function findBestGauntlet(
  config: GauntletConfig,
  options: { start?: number; count?: number; rules?: GauntletRules } = {},
): BestGauntlet {
  const start = options.start ?? 0;
  const count = options.count ?? 500;
  if (count <= 0) throw new Error("findBestGauntlet: seed count must be positive");

  let best: BestGauntlet | null = null;
  for (let i = 0; i < count; i += 1) {
    const seed = start + i;
    const result = simulateGauntlet(config, seed, options.rules ?? {});
    const score = scoreGauntletDrama(result);
    if (best === null || score > best.score) best = { seed, result, score };
  }
  return best!;
}
