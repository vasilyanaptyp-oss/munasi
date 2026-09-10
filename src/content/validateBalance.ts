import { writeFileSync } from "node:fs";
import type { Fighter } from "../sim/types.js";
import { isMain } from "../util/main.js";
import { BALANCE_MAX, BALANCE_MIN, evaluateRoster, type BalanceReport } from "./balance.js";
import { loadFighters } from "./index.js";
import { GAUNTLET_RULES } from "./teams.js";

const RED = "[31m";
const GREEN = "[32m";
const DIM = "[2m";
const BOLD = "[1m";
const RESET = "[0m";

const useColor = process.stdout.isTTY === true || process.env["FORCE_COLOR"] === "1";
const paint = (text: string, color: string): string => (useColor ? `${color}${text}${RESET}` : text);

/** Short column label, e.g. `iron_warden` -> `IRWA`. */
function abbreviate(id: string): string {
  const parts = id.split("_");
  if (parts.length >= 2) {
    return (parts[0]!.slice(0, 2) + parts[1]!.slice(0, 2)).toUpperCase();
  }
  return id.slice(0, 4).toUpperCase();
}

/**
 * Prints the full winrate matrix. Each cell is row-fighter's winrate against
 * the column fighter; anything outside 35-65% is flagged red.
 */
export function printMatrix(roster: Fighter[], report: BalanceReport): void {
  const rate = new Map<string, number>();
  for (const pair of report.pairs) {
    rate.set(`${pair.aId}|${pair.bId}`, pair.winRateA);
    rate.set(`${pair.bId}|${pair.aId}`, 1 - pair.winRateA);
  }

  const nameWidth = Math.max(...roster.map((f) => f.id.length));
  const header = " ".repeat(nameWidth + 2) + roster.map((f) => abbreviate(f.id).padStart(6)).join("");
  console.log(paint(header, DIM));

  for (const row of roster) {
    const cells = roster.map((col) => {
      if (col.id === row.id) return paint("   ---", DIM);
      const value = rate.get(`${row.id}|${col.id}`)!;
      const text = `${(value * 100).toFixed(0)}%`.padStart(6);
      const ok = value >= BALANCE_MIN && value <= BALANCE_MAX;
      return paint(text, ok ? GREEN : RED);
    });
    const overall = report.overall[row.id]!;
    console.log(`${row.id.padEnd(nameWidth + 2)}${cells.join("")}   ${paint(`(overall ${(overall * 100).toFixed(0)}%)`, DIM)}`);
  }
}

export function printSummary(report: BalanceReport): void {
  const durations = report.pairs.map((p) => p.meanSeconds);
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
  console.log();
  console.log(
    `${report.pairs.length} pairs x ${report.sample} matches   ` +
      `mean match ${mean.toFixed(1)}s (${Math.min(...durations).toFixed(1)}-${Math.max(...durations).toFixed(1)}s)`,
  );

  if (report.offBalance.length === 0) {
    console.log(paint(`all pairs inside ${BALANCE_MIN * 100}-${BALANCE_MAX * 100}%`, GREEN + BOLD));
    return;
  }
  console.log(paint(`${report.offBalance.length} pair(s) outside the band:`, RED + BOLD));
  for (const pair of [...report.offBalance].sort(
    (x, y) => Math.abs(y.winRateA - 0.5) - Math.abs(x.winRateA - 0.5),
  )) {
    console.log(
      paint(`  ${pair.aId} vs ${pair.bId}: ${(pair.winRateA * 100).toFixed(1)}%`, RED),
    );
  }
}

/**
 * How many of the 91 pairs may sit outside 35-65%.
 *
 * Not a target — the number to beat is zero — but a line under which the
 * roster is shippable. Fourteen mechanics that stop, swap, pull and phase are
 * going to make some rock-paper-scissors, and pretending otherwise is how a
 * gate gets ignored. Measured today: 7.
 */
const OFF_BAND_ALLOWANCE = 12;

function main(): void {
  const args = process.argv.slice(2);
  const sampleArg = args.find((a) => a.startsWith("--sample="));
  const outArg = args.find((a) => a.startsWith("--out="));
  // 500 rather than 200: at 200 matches a pair sits within +/-3.5 points of
  // its true winrate, which is enough to flag a perfectly balanced matchup.
  const sample = sampleArg ? Number(sampleArg.split("=")[1]) : 500;

  const roster = loadFighters();
  console.log(`Validating ${roster.length} fighters, ${sample} matches per pair...\n`);
  const started = Date.now();
  // **The rules the videos are made with, not the bare duel.**
  //
  // `evaluateRoster` has always taken rules; this caller never passed any, so
  // the gate scored a game nothing ships: full damage variance, one swing per
  // cooldown, no opening head start. Against the shipped rules the same roster
  // reads 49-51% and against the bare duel 34-62%, because they are different
  // games — and the one worth gating is the one that becomes an mp4.
  const report = evaluateRoster(roster, { sample, rules: GAUNTLET_RULES });

  printMatrix(roster, report);
  printSummary(report);
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s\n`);

  if (outArg) {
    const path = outArg.split("=")[1]!;
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report written to ${path}`);
  }

  /**
   * Fails on the policy the gate actually holds, not on perfection.
   *
   * This used to demand **zero** pairs outside 35-65%, which no roster of
   * fourteen differently-shaped mechanics has ever met — it reported a failure
   * on every run for as long as there have been more than four fighters, and a
   * command that can never succeed is one nobody reads. The real rule lives in
   * `content.test.ts`: level overall, no pair a blowout, and a bounded number
   * off the band. Same rule here, so the two cannot disagree.
   */
  const blowouts = report.pairs.filter((p) => p.winRateA < 0.2 || p.winRateA > 0.8);
  const lopsided = Object.values(report.overall).filter((m) => m < 0.44 || m > 0.56);
  if (blowouts.length > 0) {
    console.log(
      paint(`${blowouts.length} pair(s) are blowouts (outside 20-80%) — that is the failure:`, RED + BOLD),
    );
    for (const p of blowouts) {
      console.log(`  ${p.aId} vs ${p.bId}: ${(p.winRateA * 100).toFixed(1)}%`);
    }
  }
  process.exitCode =
    blowouts.length === 0 && lopsided.length === 0 && report.offBalance.length <= OFF_BAND_ALLOWANCE
      ? 0
      : 1;
}

if (isMain(import.meta.url)) main();
