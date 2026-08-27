import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMain } from "../util/main.js";
import { evaluateRoster } from "./balance.js";
import { GAUNTLET_RULES } from "./teams.js";

/**
 * Solves every fighter's `fieldScale` at once:
 *
 *   pnpm solve [rounds] [matches-per-pair]
 *
 * **Bisection stops working past two fighters.** Each one's winrate depends on
 * all the others, so nudging one moves everybody and there is nothing left to
 * bisect. This treats the whole roster as a fixed point instead: calibrate,
 * play every ordered pair, push each scale toward an even score, repeat.
 *
 * It rewrites `fieldScale` in `roster.ts` and re-runs `pnpm calibrate` between
 * rounds, so the file on disk is the answer when it finishes.
 *
 * **The step size is the whole trick, and getting it wrong is not subtle.** With
 * the crits flat a fight is close to deterministic in power: measured on this
 * roster, a winrate moves about four points per percent of strength. A step of
 * 0.35 — which looks like gentle damping — is roughly three times the correction
 * needed, so it overshoots, and four rounds of it drove the spread from 22 points
 * to 66. At 0.10 the same roster converges in two.
 *
 * This lived in a scratch file for three separate rounds of balancing and had to
 * be rewritten from memory each time, once with the wrong gain. It is a command
 * now because a ten-fighter roster is forty-five pairs and nobody is going to
 * hand-solve that.
 */

/** Fraction of the measured error fed back into the scale each round. */
const GAIN = 0.1;

const ROSTER_PATH = join(import.meta.dirname, "roster.ts");

/** Reads the `fieldScale` of every fighter, in file order. */
export function readScales(source: string): Map<string, number> {
  const out = new Map<string, number>();
  const re = /id:\s*"([a-z_]+)"[\s\S]*?fieldScale:\s*([0-9.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.set(m[1]!, Number(m[2]!));
  return out;
}

/** Writes them back, touching nothing else in the file. */
export function writeScales(source: string, scales: Map<string, number>): string {
  let out = source;
  for (const [id, value] of scales) {
    const re = new RegExp(`(id:\\s*"${id}"[\\s\\S]*?fieldScale:\\s*)[0-9.]+`);
    if (!re.test(out)) throw new Error(`no fieldScale to update for ${id}`);
    out = out.replace(re, `$1${value.toFixed(4)}`);
  }
  return out;
}

/**
 * One round's correction: the mean winrate each fighter posts across his pairs,
 * and the scale that should replace his.
 */
export function nextScales(
  scales: Map<string, number>,
  meanWinRates: Map<string, number>,
  gain = GAIN,
): Map<string, number> {
  const out = new Map(scales);
  for (const [id, mean] of meanWinRates) {
    const current = scales.get(id);
    if (current === undefined) continue;
    out.set(id, current * (1 - gain * (mean - 0.5) * 2));
  }
  return out;
}

async function main(): Promise<void> {
  const rounds = Number(process.argv[2] ?? 3);
  const sample = Number(process.argv[3] ?? 400);
  const cwd = join(import.meta.dirname, "..", "..");

  for (let round = 1; round <= rounds; round += 1) {
    execFileSync("pnpm", ["calibrate"], { cwd, stdio: "ignore" });
    // Imported fresh each round: `pnpm calibrate` has just rewritten
    // `fighters.json` and a cached module would still hold the old numbers.
    const { loadFighters } = await import(`./index.js?round=${round}`);
    const report = evaluateRoster(loadFighters(), { sample, rules: GAUNTLET_RULES });

    const rates = new Map<string, number[]>();
    const add = (id: string, rate: number): void => {
      const list = rates.get(id);
      if (list) list.push(rate);
      else rates.set(id, [rate]);
    };
    for (const pair of report.pairs) {
      add(pair.aId, pair.winRateA);
      add(pair.bId, 1 - pair.winRateA);
    }
    const means = new Map(
      [...rates].map(([id, list]) => [id, list.reduce((s, r) => s + r, 0) / list.length]),
    );

    const spread = Math.max(...means.values()) - Math.min(...means.values());
    console.log(`\n— круг ${round}: разброс ${(spread * 100).toFixed(1)} п.п. —`);

    const source = readFileSync(ROSTER_PATH, "utf8");
    const scales = readScales(source);
    const next = nextScales(scales, means);
    for (const [id, mean] of means) {
      console.log(
        `${id.padEnd(12)} ${(mean * 100).toFixed(1)}%  ` +
          `${scales.get(id)?.toFixed(4) ?? "—"} -> ${next.get(id)?.toFixed(4) ?? "—"}`,
      );
    }
    const outside = report.pairs.filter((p) => p.winRateA < 0.35 || p.winRateA > 0.65);
    console.log(
      outside.length === 0
        ? "все пары внутри 35-65%"
        : `вне полосы: ${outside.map((p) => `${p.aId}/${p.bId} ${(p.winRateA * 100).toFixed(0)}%`).join(", ")}`,
    );
    writeFileSync(ROSTER_PATH, writeScales(source, next));
  }

  execFileSync("pnpm", ["calibrate"], { cwd, stdio: "ignore" });
  console.log("\nfighters.json пересобран из roster.ts");
}

if (isMain(import.meta.url)) await main();
