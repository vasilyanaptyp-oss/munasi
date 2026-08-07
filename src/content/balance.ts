import { simulate } from "../sim/simulate.js";
import type { Fighter } from "../sim/types.js";
import { FPS } from "../sim/types.js";

/** A matchup is considered balanced inside this winrate band. */
export const BALANCE_MIN = 0.35;
export const BALANCE_MAX = 0.65;
/** Matches run per pair when validating. */
export const DEFAULT_SAMPLE = 200;

export interface PairResult {
  aId: string;
  bId: string;
  /** Share of matches won by `a`. Draws count as half a win to each side. */
  winRateA: number;
  /** Mean match length in seconds. */
  meanSeconds: number;
  matches: number;
}

export interface BalanceReport {
  fighterIds: string[];
  pairs: PairResult[];
  /** Overall winrate per fighter across every opponent. */
  overall: Record<string, number>;
  /** Pairs outside the 35-65% band. */
  offBalance: PairResult[];
  sample: number;
}

export interface BalanceOptions {
  /** Matches per pair. Defaults to 200. */
  sample?: number;
  /** First seed. Every pair uses the same seed block, so runs are comparable. */
  startSeed?: number;
}

/** Runs one pair head to head. Pure: same inputs, same numbers, every time. */
export function evaluatePair(a: Fighter, b: Fighter, options: BalanceOptions = {}): PairResult {
  const sample = options.sample ?? DEFAULT_SAMPLE;
  const startSeed = options.startSeed ?? 0;
  let winsA = 0;
  let frames = 0;
  for (let i = 0; i < sample; i += 1) {
    const result = simulate({ a, b }, startSeed + i);
    if (result.winner === "a") winsA += 1;
    else if (result.winner === "draw") winsA += 0.5;
    frames += result.durationFrames;
  }
  return {
    aId: a.id,
    bId: b.id,
    winRateA: winsA / sample,
    meanSeconds: frames / sample / FPS,
    matches: sample,
  };
}

export function evaluateRoster(roster: Fighter[], options: BalanceOptions = {}): BalanceReport {
  const sample = options.sample ?? DEFAULT_SAMPLE;
  const pairs: PairResult[] = [];
  const wins: Record<string, number> = {};
  const played: Record<string, number> = {};
  for (const fighter of roster) {
    wins[fighter.id] = 0;
    played[fighter.id] = 0;
  }

  for (let i = 0; i < roster.length; i += 1) {
    for (let j = i + 1; j < roster.length; j += 1) {
      const a = roster[i]!;
      const b = roster[j]!;
      const pair = evaluatePair(a, b, options);
      pairs.push(pair);
      wins[a.id]! += pair.winRateA;
      wins[b.id]! += 1 - pair.winRateA;
      played[a.id]! += 1;
      played[b.id]! += 1;
    }
  }

  const overall: Record<string, number> = {};
  for (const fighter of roster) {
    overall[fighter.id] = played[fighter.id]! > 0 ? wins[fighter.id]! / played[fighter.id]! : 0;
  }

  return {
    fighterIds: roster.map((f) => f.id),
    pairs,
    overall,
    offBalance: pairs.filter((p) => p.winRateA < BALANCE_MIN || p.winRateA > BALANCE_MAX),
    sample,
  };
}

/** How far a pair sits from a coin flip, in winrate points. */
export function imbalanceOf(pair: PairResult): number {
  return Math.abs(pair.winRateA - 0.5);
}
