import { evaluateRoster } from "../content/balance.js";
import { getFighter, loadFighters } from "../content/index.js";
import { scoreDrama } from "../sim/drama.js";
import { simulate } from "../sim/simulate.js";
import type { Fighter, MatchRules } from "../sim/types.js";
import { isMain } from "../util/main.js";

/**
 * Diagnostics:
 *
 *   pnpm diagnose              drama-score distribution and side bias
 *   pnpm diagnose --comeback   also compares the rubber-band prototype
 *
 * Read-only: nothing here changes the shipped roster or rules.
 */

const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";
const heading = (text: string): void => console.log(`\n${BOLD}${text}${RESET}`);

function quantile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

/** 1. Is picking the best of 500 seeds actually worth anything? */
function dramaDistribution(seeds: number): void {
  heading(`1. Drama score distribution over ${seeds} seeds`);
  const roster = loadFighters();
  const matchups: [Fighter, Fighter][] = [
    [getFighter("plumber", roster), getFighter("councillor", roster)],
    [getFighter("baker", roster), getFighter("gatekeeper", roster)],
    [getFighter("nailmaster", roster), getFighter("loader", roster)],
  ];

  console.log(
    `${"matchup".padEnd(30)}${"median".padStart(8)}${"p90".padStart(8)}` +
      `${"max".padStart(8)}${"max/median".padStart(12)}`,
  );
  const lifts: number[] = [];
  for (const [a, b] of matchups) {
    const scores: number[] = [];
    for (let seed = 0; seed < seeds; seed += 1) scores.push(scoreDrama(simulate({ a, b }, seed)));
    scores.sort((x, y) => x - y);
    const median = quantile(scores, 0.5);
    const p90 = quantile(scores, 0.9);
    const max = scores.at(-1)!;
    const lift = median > 0 ? (max / median - 1) * 100 : Infinity;
    lifts.push(lift);
    console.log(
      `${`${a.id} vs ${b.id}`.padEnd(30)}${median.toFixed(1).padStart(8)}` +
        `${p90.toFixed(1).padStart(8)}${max.toFixed(1).padStart(8)}` +
        `${`+${lift.toFixed(1)}%`.padStart(12)}`,
    );
  }

  const worst = Math.min(...lifts);
  console.log();
  if (worst < 15) {
    console.log(
      `${BOLD}VERDICT: selection is barely paying for itself.${RESET} The weakest matchup gains` +
        ` only ${worst.toFixed(1)}% from best-of-${seeds}, under the 15% bar. Either widen what` +
        ` scoreDrama rewards, or drop the seed count and spend the time elsewhere.`,
    );
  } else {
    console.log(
      `${BOLD}VERDICT: selection is worth it.${RESET} The weakest matchup still gains` +
        ` ${worst.toFixed(1)}% over its median seed, above the 15% bar.`,
    );
  }
}

/** 2. Any side bias left, and how a mutual kill resolves. */
function sideBias(matches: number): void {
  heading(`2. Side bias over ${matches.toLocaleString("en-US")} matches with identical fighters`);
  const roster = loadFighters();
  const base = getFighter("gatekeeper", roster);
  const a: Fighter = { ...base, id: "same_a", name: "SAME A" };
  const b: Fighter = { ...base, id: "same_b", name: "SAME B" };

  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  for (let seed = 0; seed < matches; seed += 1) {
    const result = simulate({ a, b }, seed);
    if (result.winner === "a") winsA += 1;
    else if (result.winner === "b") winsB += 1;
    else draws += 1;
  }

  // Draws split evenly; a systematic edge would show up in the share.
  const share = (winsA + draws / 2) / matches;
  const stderr = Math.sqrt((share * (1 - share)) / matches);
  const lo = share - 1.96 * stderr;
  const hi = share + 1.96 * stderr;

  console.log(`  A ${winsA}   B ${winsB}   draws ${draws} (${((draws / matches) * 100).toFixed(1)}%)`);
  console.log(
    `  side A share ${(share * 100).toFixed(2)}%  ` +
      `95% CI [${(lo * 100).toFixed(2)}%, ${(hi * 100).toFixed(2)}%]`,
  );
  const fair = lo <= 0.5 && hi >= 0.5;
  console.log(
    fair
      ? `  ${BOLD}No detectable bias${RESET}: the interval contains 50%.`
      : `  ${BOLD}Bias detected${RESET}: the interval excludes 50%.`,
  );

  console.log(`\n  ${DIM}How a mutual kill in one tick resolves, in code:${RESET}`);
  console.log(
    [
      "    simulate.ts: damage is queued during a tick, applied only once every",
      "    actor has swung (applyPendingDamage), then both sides are checked",
      "    together:",
      "",
      "        const aDead = sides.a.hp <= 0;",
      "        const bDead = sides.b.hp <= 0;",
      "        winner = aDead && bDead ? \"draw\" : aDead ? \"b\" : \"a\";",
      "",
      "    So a tick that kills both is a draw, not a win for whichever side",
      "    happened to be checked first. Drama scoring then penalises draws to",
      "    0.2x, so they are never chosen for a video.",
    ].join("\n"),
  );
}

/** 3. Does a mechanical comeback beat the lucky-crit one? */
function comebackComparison(sample: number): void {
  heading("3. Rubber-band comeback prototype");
  const roster = loadFighters();

  // Split into parts, so a bad result says *which* half is at fault.
  const variants: [string, MatchRules][] = [
    ["baseline", {}],
    ["rubber only", { rubberBand: 0.5 }],
    ["waves only", { comebackWaves: [0.5, 0.25], comebackWaveSize: 2 }],
    ["both", { rubberBand: 0.5, comebackWaves: [0.5, 0.25], comebackWaveSize: 2 }],
    ["mild rubber", { rubberBand: 0.2 }],
  ];

  console.log(
    `${"variant".padEnd(14)}${"drama".padStart(8)}${"length".padStart(9)}` +
      `${"winrate spread".padStart(16)}${"off-band".padStart(10)}${"draws".padStart(8)}`,
  );

  for (const [label, rules] of variants) {
    const report = evaluateRoster(roster, { sample, rules });
    const spread = report.pairs.map((p) => p.winRateA);
    const meanSeconds =
      report.pairs.reduce((sum, p) => sum + p.meanSeconds, 0) / report.pairs.length;

    // Drama is scored on a smaller, fixed set of matchups to keep this quick.
    let dramaTotal = 0;
    let dramaCount = 0;
    let draws = 0;
    for (let i = 0; i < roster.length; i += 1) {
      const a = roster[i]!;
      const b = roster[(i + 1) % roster.length]!;
      for (let seed = 0; seed < 40; seed += 1) {
        const result = simulate({ a, b }, seed, rules);
        dramaTotal += scoreDrama(result);
        dramaCount += 1;
        if (result.winner === "draw") draws += 1;
      }
    }

    const min = Math.min(...spread);
    const max = Math.max(...spread);
    const offBand = report.offBalance.length;
    console.log(
      `${label.padEnd(14)}${(dramaTotal / dramaCount).toFixed(1).padStart(8)}` +
        `${`${meanSeconds.toFixed(1)}s`.padStart(9)}` +
        `${`${(min * 100).toFixed(0)}-${(max * 100).toFixed(0)}%`.padStart(16)}` +
        `${String(offBand).padStart(10)}` +
        `${`${((draws / dramaCount) * 100).toFixed(1)}%`.padStart(8)}`,
    );
  }
  console.log(
    [
      "",
      `  ${DIM}Reading this: the roster's attack values are calibrated for the`,
      "  baseline rules, so any variant is expected to lose some balance until it",
      "  is recalibrated — judge the off-band column loosely. Mean drama and mean",
      "  length are the numbers that decide it, and both are rule-agnostic.",
      "",
      "  The rules default to off and nothing ships with them enabled. Merge only",
      `  if drama rises and length stays inside the 22-38s window.${RESET}`,
    ].join("\n"),
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const number = (name: string, fallback: number): number => {
    const raw = args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
    return raw === undefined ? fallback : Number(raw);
  };

  const started = Date.now();
  dramaDistribution(number("seeds", 500));
  sideBias(number("matches", 10_000));
  if (args.includes("--comeback")) comebackComparison(number("sample", 120));
  console.log(`\n${((Date.now() - started) / 1000).toFixed(1)}s`);
}

if (isMain(import.meta.url)) main();

export { comebackComparison, dramaDistribution, sideBias };
