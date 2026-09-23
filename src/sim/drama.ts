import { simulate } from "./simulate.js";
import type { MatchConfig, MatchResult, Side } from "./types.js";
import { FPS } from "./types.js";

/**
 * Drama scoring. A random match is almost always boring — this is how we pick
 * the few worth rendering.
 *
 * Each component is normalised to 0..1, then weighted into a 0..100 score.
 */
export interface DramaBreakdown {
  /** How little HP the winner had left. Bloodied winner = good. */
  closeness: number;
  /** How often the HP-percentage lead flipped between the fighters. */
  leadChanges: number;
  /** The biggest deficit the winner clawed back from. */
  comeback: number;
  /** Length of the match against the 22-38 second sweet spot. */
  pacing: number;
  /** How late in the match the outcome was still genuinely in doubt. */
  deathTiming: number;
  /** Weighted total, 0..100. */
  total: number;
}

const WEIGHTS = {
  closeness: 30,
  leadChanges: 20,
  comeback: 20,
  pacing: 20,
  deathTiming: 10,
} as const;

/** A match that never produced a knockout keeps only this share of its score. */
const TIMEOUT_MULTIPLIER = 0.35;
/** A double KO is a non-ending; worse than a timeout. */
const DRAW_MULTIPLIER = 0.2;

/** HP-percentage gap below which neither side counts as leading. */
const LEAD_DEADBAND = 0.02;
/** Lead flips needed for a full leadChanges score. */
const LEAD_CHANGES_FOR_MAX = 6;
/** Deficit (in HP-percentage points) that counts as a maximal comeback. */
const COMEBACK_FOR_MAX = 0.5;
/** A gap this small means the match was still anyone's to win. */
const CONTESTED_GAP = 0.1;

const PACING_IDEAL_MIN = 22;
const PACING_IDEAL_MAX = 38;
const PACING_ZERO_SHORT = 10;
const PACING_ZERO_LONG = 55;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function pacingScore(seconds: number): number {
  if (seconds >= PACING_IDEAL_MIN && seconds <= PACING_IDEAL_MAX) return 1;
  if (seconds < PACING_IDEAL_MIN) {
    return clamp01(
      (seconds - PACING_ZERO_SHORT) / (PACING_IDEAL_MIN - PACING_ZERO_SHORT),
    );
  }
  return clamp01((PACING_ZERO_LONG - seconds) / (PACING_ZERO_LONG - PACING_IDEAL_MAX));
}

/**
 * Breaks a match down into its drama components. Pure — reads only the
 * simulation result.
 */
export function scoreDramaDetailed(result: MatchResult): DramaBreakdown {
  const { snapshots, durationFrames } = result;
  const last = snapshots[snapshots.length - 1]!;

  const pctA = (i: number): number => {
    const s = snapshots[i]!;
    return s.a.maxHp > 0 ? s.a.hp / s.a.maxHp : 0;
  };
  const pctB = (i: number): number => {
    const s = snapshots[i]!;
    return s.b.maxHp > 0 ? s.b.hp / s.b.maxHp : 0;
  };

  const winnerSide: Side | null = result.winner === "draw" ? null : result.winner;

  // closeness — the winner limping over the line beats a clean sweep.
  const winnerRemaining =
    winnerSide === "a"
      ? last.a.hp / last.a.maxHp
      : winnerSide === "b"
        ? last.b.hp / last.b.maxHp
        : 0;
  const closeness = clamp01(1 - winnerRemaining);

  // leadChanges — a deadband keeps single-hit jitter from counting as a flip.
  let leader: Side | null = null;
  let flips = 0;
  let maxDeficit = 0;
  let lastContestedFrame = 0;
  for (let i = 0; i < snapshots.length; i += 1) {
    const gap = pctA(i) - pctB(i);
    if (Math.abs(gap) >= LEAD_DEADBAND) {
      const current: Side = gap > 0 ? "a" : "b";
      if (leader !== null && current !== leader) flips += 1;
      leader = current;
    }
    if (winnerSide !== null) {
      const deficit = winnerSide === "a" ? -gap : gap;
      if (deficit > maxDeficit) maxDeficit = deficit;
    }
    if (Math.abs(gap) <= CONTESTED_GAP) lastContestedFrame = i;
  }
  const leadChanges = clamp01(flips / LEAD_CHANGES_FOR_MAX);
  const comeback = clamp01(maxDeficit / COMEBACK_FOR_MAX);

  const pacing = pacingScore(durationFrames / FPS);

  // deathTiming — how deep into the match the outcome was still in doubt.
  // Full marks when the fight was contested inside the closing 15%.
  const contestedShare = durationFrames > 1 ? lastContestedFrame / (durationFrames - 1) : 0;
  const deathTiming = clamp01((contestedShare - 0.5) / 0.35);

  let total =
    closeness * WEIGHTS.closeness +
    leadChanges * WEIGHTS.leadChanges +
    comeback * WEIGHTS.comeback +
    pacing * WEIGHTS.pacing +
    deathTiming * WEIGHTS.deathTiming;

  if (result.winner === "draw") total *= DRAW_MULTIPLIER;
  else if (result.timedOut) total *= TIMEOUT_MULTIPLIER;

  return { closeness, leadChanges, comeback, pacing, deathTiming, total };
}

/** Weighted drama score, 0..100. Higher is more watchable. */
export function scoreDrama(result: MatchResult): number {
  return scoreDramaDetailed(result).total;
}

export interface SeedRange {
  /** First seed to try. Defaults to 0. */
  start?: number;
  /** How many consecutive seeds to try. Defaults to 500. */
  count?: number;
}

export interface BestMatch {
  seed: number;
  result: MatchResult;
  score: number;
  breakdown: DramaBreakdown;
  /** Seeds actually simulated. */
  searched: number;
}

/**
 * Simulates a block of seeds and returns the most dramatic one. Ties break
 * toward the lower seed, so the search is reproducible.
 */
export function findBestMatch(config: MatchConfig, seedRange: SeedRange = {}): BestMatch {
  const start = seedRange.start ?? 0;
  const count = seedRange.count ?? 500;
  if (count <= 0) throw new Error("findBestMatch: seed count must be positive");

  let best: BestMatch | null = null;
  for (let i = 0; i < count; i += 1) {
    const seed = start + i;
    const result = simulate(config, seed);
    const breakdown = scoreDramaDetailed(result);
    if (best === null || breakdown.total > best.score) {
      best = { seed, result, score: breakdown.total, breakdown, searched: count };
    }
  }
  return best!;
}
