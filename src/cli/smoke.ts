import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGauntlet, GAUNTLET_RULES } from "../content/teams.js";
import { getFighter, loadFighters } from "../content/index.js";
import { judgeMotion, STATIC_TAIL_ALLOWANCE } from "../export/motion.js";
import { exportVideo } from "../export/video.js";
import { coldOpenPlan, defaultPlan, sourceFrames, VICTORY_CARD_FRAMES } from "../render/framePlan.js";
import { renderFramesParallel } from "../render/parallel.js";
import { findGauntletColdOpen } from "../sim/coldOpen.js";
import { simulateGauntlet } from "../sim/gauntlet.js";
import { FPS } from "../sim/types.js";
import { isMain } from "../util/main.js";
import { generate } from "./generate.js";
import { readManifest, type ManifestEntry } from "./manifest.js";

/**
 * End-to-end smoke test of the shipped path:
 *
 *   pnpm smoke
 *
 * Everything else runs on something adjacent to what ships. The unit suite's
 * only end-to-end run of `generate` is the **duel**, on a two-fighter synthetic
 * roster with the cold open off and eight seeds — so the gauntlet, which is the
 * default and the only format anyone posts, was never once executed from end to
 * end by a test. This does that: the real roster, the real rules, the real
 * defaults, an mp4 on disk, and a manifest row.
 *
 * Slow on purpose (minutes, not seconds) and kept out of `pnpm test` for that
 * reason. It is the thing to run before cutting a batch.
 */

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

function sha(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Rebuilds a video from nothing but its manifest row.
 *
 * This is the reproducibility contract stated as code: seed plus matchup plus
 * the recorded constants have to give back the same bytes. If it ever stops
 * holding, the manifest is decoration.
 */
async function reproduce(entry: ManifestEntry, outDir: string): Promise<string> {
  const roster = loadFighters();
  const g = entry.gauntlet!;
  const config = buildGauntlet(
    getFighter(g.challengerId, roster),
    g.teamIds.map((id) => getFighter(id, roster)),
  );
  const result = simulateGauntlet(config, entry.seed, GAUNTLET_RULES);
  const window = entry.coldOpen ? findGauntletColdOpen(result) : null;
  const plan = window
    ? coldOpenPlan(result, window, VICTORY_CARD_FRAMES)
    : defaultPlan(result, VICTORY_CARD_FRAMES);

  const frames = join(outDir, "frames");
  await renderFramesParallel(result, frames, { plan, workers: 4 });
  const exported = await exportVideo(result, {
    framesDir: frames,
    outDir,
    sourceFrames: sourceFrames(plan),
  });
  rmSync(frames, { recursive: true, force: true });
  return exported.path;
}

async function main(): Promise<void> {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    console.error("ffmpeg is required for the smoke test");
    process.exitCode = 1;
    return;
  }

  const seeds = Number(process.argv.find((a) => a.startsWith("--seeds="))?.split("=")[1] ?? 60);
  const outDir = mkdtempSync(join(tmpdir(), "munasi-smoke-"));
  console.log(`Smoke test of the gauntlet path, ${seeds} seeds, into ${outDir}\n`);

  try {
    // Exactly the defaults `pnpm generate` runs with, minus the seed budget,
    // which only costs time. Nothing here builds its own rules or its own plan.
    const summary = await generate({
      count: 1,
      seeds,
      outDir,
      workers: 4,
      matchupSample: 40,
      keepFrames: false,
      redo: false,
      coldOpen: true,
      duel: false,
    });

    console.log("");
    check("one video produced, none failed", summary.produced.length === 1 && summary.failures.length === 0,
      `${summary.produced.length} produced, ${summary.failures.length} failed`);
    if (summary.produced.length === 0) throw new Error("nothing produced");

    const entry = summary.produced[0]!;
    const path = join(outDir, entry.file);

    check("the mp4 is on disk and not empty", existsSync(path) && statSync(path).size > 0,
      `${(statSync(path).size / 1e6).toFixed(1)} MB`);
    check("the file runs as long as the frames it was built from",
      Math.abs(entry.frames / FPS - entry.durationSeconds) < 0.05,
      `${entry.frames} frames vs ${entry.durationSeconds.toFixed(2)}s`);
    check("it is a gauntlet row, decided in a round of the run",
      entry.gauntlet !== undefined && entry.gauntlet.decidedInRound >= 1,
      entry.gauntlet ? `round ${entry.gauntlet.decidedInRound}, cleared=${entry.gauntlet.cleared}` : "no gauntlet block");
    check("the cold open is on by default and recorded", entry.coldOpen !== undefined,
      entry.coldOpen ? entry.coldOpen.why : "missing");

    // Provenance: the point of it is that a row is still usable in a month.
    const p = entry.provenance;
    check("provenance carries the commit and the constants",
      p !== undefined && p.constants.rules.attackRate === GAUNTLET_RULES.attackRate &&
        p.constants.victoryCardFrames === VICTORY_CARD_FRAMES,
      p ? `${p.commit?.slice(0, 8) ?? "no commit"}${p.dirty ? " (dirty)" : ""}, roster ${p.rosterHash}` : "missing");

    check("the manifest on disk holds the same row",
      readManifest(outDir).entries.length === 1,
      `${readManifest(outDir).entries.length} row(s)`);

    // The gate that runs on the artefact rather than on the plan.
    const verdict = judgeMotion(path);
    check("the delivered file passes the motion gate", verdict.failures.length === 0,
      `${(verdict.body.meanChanged * 100).toFixed(1)}% changed in the body, ` +
        `${verdict.staticFrames} still frames of ${STATIC_TAIL_ALLOWANCE} allowed` +
        (verdict.failures.length > 0 ? ` — ${verdict.failures.join("; ")}` : ""));

    console.log("\n  rebuilding it from the manifest row alone...");
    const again = await reproduce(entry, join(outDir, "again"));
    check("regenerating from the manifest gives the same bytes", sha(again) === sha(path),
      `${sha(path).slice(0, 16)} vs ${sha(again).slice(0, 16)}`);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) {
    for (const c of failed) console.log(`  failed: ${c.name}`);
    process.exitCode = 1;
  }
}

if (isMain(import.meta.url)) await main();
