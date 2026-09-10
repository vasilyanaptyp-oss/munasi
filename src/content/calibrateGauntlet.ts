import { scoreGauntletDrama, simulateGauntlet, type GauntletRules } from "../sim/gauntlet.js";
import { FPS } from "../sim/types.js";
import { isMain } from "../util/main.js";
import { loadFighters } from "./index.js";
import {
  buildGauntlet,
  gauntletMatchups,
  GAUNTLET_RULES,
  GAUNTLET_TUNING,
  type GauntletTuning,
} from "./teams.js";

/**
 * Calibrates the gauntlet against three targets, which pull against each other:
 *
 *   - the challenger clears the whole team 45-55% of the time
 *   - the run is decided in the last round at least 70% of the time
 *   - the whole thing lasts 25-35 seconds
 *
 * Both sides carry their own roster HP — 1000 to 1400, workers and bosses drawn
 * from the same range — so the challenger's edge has to be damage. Two knobs,
 * and they are close to orthogonal: `tempo` scales *both* sides, moving length
 * without touching the win rate; `challengerPower` scales only the challenger,
 * moving the win rate.
 *
 * Every measurement here runs under `GAUNTLET_RULES` unless a caller asks for
 * something else — see `sampleGauntlets`.
 */

export interface GauntletStats {
  runs: number;
  /** Share of runs where the challenger cleared the team. */
  clearRate: number;
  /** Share of runs that reached the final round. */
  reachedFinalRound: number;
  /** Share ending in each round, 1-based. */
  endedInRound: number[];
  meanSeconds: number;
  /** Share of runs where a round hit its frame cap. */
  timeoutRate: number;
  /** Mean gauntlet drama score, 0..100. */
  meanDrama: number;
  /** Best drama score seen — what seed selection would actually pick. */
  bestDrama: number;
}

export interface GauntletSampleOptions {
  runs?: number;
  tuning?: GauntletTuning;
  rules?: GauntletRules;
  /** Matchups to sample. Defaults to a spread across the whole roster. */
  limit?: number;
}

/**
 * Measures a configuration over `runs` gauntlets.
 *
 * `rules` defaults to `GAUNTLET_RULES` — the shipped ones — and that default is
 * load-bearing. It used to be `{}`, so every caller that forgot the argument
 * silently measured a gauntlet nobody ships: 1v1 damage spread, no pickups, no
 * opening cooldown, one swing per beat. That is where the 49.4% clear rate in
 * the old reports came from. Measuring something else is still possible, it just
 * has to be asked for.
 */
export function sampleGauntlets(options: GauntletSampleOptions = {}): GauntletStats {
  const runs = options.runs ?? 500;
  const tuning = options.tuning ?? GAUNTLET_TUNING;
  const rules: GauntletRules = options.rules ?? GAUNTLET_RULES;
  const roster = loadFighters();
  const matchups = gauntletMatchups(roster);
  const limit = Math.min(options.limit ?? matchups.length, matchups.length);

  let cleared = 0;
  let reachedFinal = 0;
  let frames = 0;
  let timeouts = 0;
  let dramaTotal = 0;
  let dramaBest = 0;
  const teamSize = matchups[0]!.members.length;
  const endedIn = new Array<number>(teamSize).fill(0);

  for (let i = 0; i < runs; i += 1) {
    // Walk the matchup list alongside the seeds so the sample covers the
    // whole roster rather than one pairing measured many times.
    const matchup = matchups[i % limit]!;
    const config = buildGauntlet(matchup.challenger, matchup.members, tuning);
    const result = simulateGauntlet(config, i, rules);

    const drama = scoreGauntletDrama(result);
    dramaTotal += drama;
    if (drama > dramaBest) dramaBest = drama;
    if (result.challengerWon) cleared += 1;
    if (result.rounds.length === teamSize) reachedFinal += 1;
    endedIn[result.rounds.length - 1] = (endedIn[result.rounds.length - 1] ?? 0) + 1;
    frames += result.durationFrames;

    const lastRound = result.rounds.at(-1)!;
    const capped = lastRound.endFrame - lastRound.startFrame >= (rules.roundFrameCap ?? 20 * FPS) - 2;
    if (capped) timeouts += 1;
  }

  return {
    runs,
    clearRate: cleared / runs,
    reachedFinalRound: reachedFinal / runs,
    endedInRound: endedIn.map((n) => n / runs),
    meanSeconds: frames / runs / FPS,
    timeoutRate: timeouts / runs,
    meanDrama: dramaTotal / runs,
    bestDrama: dramaBest,
  };
}

/** Bisects one knob until `measure` crosses `target`. */
function solve(
  lo: number,
  hi: number,
  steps: number,
  measure: (value: number) => number,
  target: number,
): number {
  let low = lo;
  let high = hi;
  for (let i = 0; i < steps; i += 1) {
    const mid = (low + high) / 2;
    if (measure(mid) < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export function calibrateGauntlet(runs = 200, passes = 2): GauntletTuning {
  const tuning: GauntletTuning = { ...GAUNTLET_TUNING };

  for (let pass = 0; pass < passes; pass += 1) {
    // Win rate first: only the challenger's multiplier moves it.
    tuning.challengerPower = solve(
      1.2,
      6,
      9,
      (challengerPower) =>
        sampleGauntlets({ runs, tuning: { ...tuning, challengerPower } }).clearRate,
      0.5,
    );
    // Then length, which tempo moves without disturbing the ratio. Measured
    // negatively because more tempo means a shorter run.
    tuning.tempo = solve(
      0.8,
      8,
      9,
      (tempo) => -sampleGauntlets({ runs, tuning: { ...tuning, tempo } }).meanSeconds,
      -30,
    );
  }
  return {
    tempo: Math.round(tuning.tempo * 100) / 100,
    challengerPower: Math.round(tuning.challengerPower * 100) / 100,
  };
}

function report(label: string, stats: GauntletStats): void {
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  console.log(
    `${label.padEnd(22)}${pct(stats.clearRate).padStart(9)}` +
      `${pct(stats.reachedFinalRound).padStart(11)}` +
      `${stats.endedInRound.map((v) => pct(v).padStart(9)).join("")}` +
      `${`${stats.meanSeconds.toFixed(1)}s`.padStart(9)}` +
      `${stats.meanDrama.toFixed(1).padStart(8)}` +
      `${stats.bestDrama.toFixed(1).padStart(8)}`,
  );
}

function header(): void {
  console.log(
    `${"configuration".padEnd(22)}${"clears".padStart(9)}${"reach R3".padStart(11)}` +
      `${"end R1".padStart(9)}${"end R2".padStart(9)}${"end R3".padStart(9)}` +
      `${"length".padStart(9)}${"drama".padStart(8)}${"best".padStart(8)}`,
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const runs = Number(args.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 500);

  if (args.includes("--solve")) {
    console.log("Solving tempo and challengerPower...\n");
    const solved = calibrateGauntlet(200, 2);
    console.log(`  tempo ${solved.tempo}   challengerPower ${solved.challengerPower}`);
    console.log(`\n  Paste into GAUNTLET_TUNING in src/content/teams.ts, then re-run without --solve.\n`);
    header();
    report("solved", sampleGauntlets({ runs, tuning: solved }));
    return;
  }

  console.log(`Gauntlet balance, ${runs} runs per configuration\n`);
  header();
  // With GAUNTLET_RULES, not without. Passing no rules measured a gauntlet that
  // is not shipped — 1v1 damage spread, no pickups, no opening cooldown — and
  // reported 49.4% clears for a build that actually clears far more. The empty
  // rules are still printed, but as a labelled comparison rather than by default.
  report("shipped", sampleGauntlets({ runs, rules: GAUNTLET_RULES }));
  report("no rules (was reported)", sampleGauntlets({ runs, rules: {} }));

  if (args.includes("--variance")) {
    // Does the format still need fat crits? The gauntlet manufactures a close
    // finish on its own, so the wide damage spread may be doing nothing.
    // Everything but the spread stays at the shipped rules, or the row measures
    // three changes at once and blames them all on the variance.
    console.log();
    for (const variance of [0.35, 0.25, 0.15]) {
      report(
        `variance +/-${(variance * 100).toFixed(0)}%`,
        sampleGauntlets({ runs, rules: { ...GAUNTLET_RULES, damageVariance: variance } }),
      );
    }
  }
  console.log();
}

if (isMain(import.meta.url)) main();
