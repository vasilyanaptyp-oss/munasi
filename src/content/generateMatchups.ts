import { readFileSync } from "node:fs";
import type { Fighter } from "../sim/types.js";
import { isMain } from "../util/main.js";
import type { BalanceReport, PairResult } from "./balance.js";
import { evaluateRoster, imbalanceOf } from "./balance.js";
import { loadFighters } from "./index.js";

/** Sample size used when a matchup list has to measure winrates itself. */
export const MATCHUP_SAMPLE = 40;

export interface Matchup {
  a: Fighter;
  b: Fighter;
  /** Measured winrate of `a` against `b`. */
  winRateA: number;
  /** Distance from a coin flip, in winrate points. Lower is more dramatic. */
  imbalance: number;
  /** Mean length of the matchup in seconds. */
  meanSeconds: number;
}

export interface MatchupOptions {
  /** Roster to draw from. Defaults to the shipped one. */
  roster?: Fighter[];
  /** Reuse a report from `validateBalance --out=` instead of measuring again. */
  report?: BalanceReport;
  /** Matches per pair when measuring. Defaults to 40. */
  sample?: number;
  /** Cap the returned list. */
  limit?: number;
}

/**
 * Every pair, most even matchup first. Even pairs are the ones worth rendering:
 * a coin-flip matchup is what produces comebacks and last-second finishes.
 */
export function generateMatchups(options: MatchupOptions = {}): Matchup[] {
  const roster = options.roster ?? loadFighters();
  const byId = new Map(roster.map((f) => [f.id, f]));
  const report =
    options.report ?? evaluateRoster(roster, { sample: options.sample ?? MATCHUP_SAMPLE });

  const matchups: Matchup[] = [];
  for (const pair of report.pairs) {
    const a = byId.get(pair.aId);
    const b = byId.get(pair.bId);
    if (!a || !b) continue;
    matchups.push({
      a,
      b,
      winRateA: pair.winRateA,
      imbalance: imbalanceOf(pair),
      meanSeconds: pair.meanSeconds,
    });
  }

  // Ties break on fighter ids so the ordering is stable run to run.
  matchups.sort(
    (x, y) =>
      x.imbalance - y.imbalance ||
      x.a.id.localeCompare(y.a.id) ||
      x.b.id.localeCompare(y.b.id),
  );
  return options.limit === undefined ? matchups : matchups.slice(0, options.limit);
}

function readReport(path: string): BalanceReport {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const report = parsed as BalanceReport;
  if (!Array.isArray(report.pairs)) throw new Error(`${path}: not a balance report`);
  return report;
}

function main(): void {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const sampleArg = args.find((a) => a.startsWith("--sample="));
  const reportArg = args.find((a) => a.startsWith("--report="));

  const options: MatchupOptions = {};
  if (limitArg) options.limit = Number(limitArg.split("=")[1]);
  if (sampleArg) options.sample = Number(sampleArg.split("=")[1]);
  if (reportArg) options.report = readReport(reportArg.split("=")[1]!);

  for (const [i, m] of generateMatchups(options).entries()) {
    console.log(
      `${String(i + 1).padStart(3)}. ${m.a.name} vs ${m.b.name}`.padEnd(46) +
        `${(m.winRateA * 100).toFixed(0)}% / ${((1 - m.winRateA) * 100).toFixed(0)}%   ` +
        `${m.meanSeconds.toFixed(1)}s`,
    );
  }
}

if (isMain(import.meta.url)) main();

export type { PairResult };
