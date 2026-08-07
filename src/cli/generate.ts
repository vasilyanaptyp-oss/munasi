import { rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { generateMatchups, type Matchup } from "../content/generateMatchups.js";
import { loadFighters } from "../content/index.js";
import type { Fighter } from "../sim/types.js";
import { exportVideo, FfmpegMissingError, checkFfmpeg, VICTORY_FREEZE_FRAMES } from "../export/video.js";
import { defaultWorkerCount, renderFramesParallel } from "../render/parallel.js";
import { findBestMatch } from "../sim/drama.js";
import { FPS } from "../sim/types.js";
import { isMain } from "../util/main.js";
import { pairKey, readManifest, renderedPairs, writeManifest, type ManifestEntry } from "./manifest.js";
import { ProgressBar } from "./progress.js";

/**
 * Batch generator:
 *
 *   pnpm generate --count 20
 *
 * Walks the matchup list most-even-first, picks the most dramatic seed for each
 * pair, renders and encodes it, and records the result in `out/manifest.json`.
 * Pairs already in the manifest are skipped, so re-running continues where the
 * last batch stopped. One video failing never takes the batch down with it.
 */

export interface GenerateOptions {
  count: number;
  /** Seeds searched per matchup when hunting for drama. */
  seeds: number;
  outDir: string;
  workers: number;
  /** Matches per pair when ranking matchups by evenness. */
  matchupSample: number;
  /** Leave the intermediate PNGs on disk. */
  keepFrames: boolean;
  /** Ignore the manifest and generate from the top of the list. */
  redo: boolean;
  /** Roster to draw from. Defaults to the shipped one. */
  roster?: Fighter[];
}

export function parseArgs(argv: string[]): GenerateOptions {
  const flag = (name: string): string | undefined => {
    const withEquals = argv.find((a) => a.startsWith(`--${name}=`));
    if (withEquals) return withEquals.split("=").slice(1).join("=");
    const index = argv.indexOf(`--${name}`);
    if (index >= 0) {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) return next;
    }
    return undefined;
  };
  const number = (name: string, fallback: number): number => {
    const raw = flag(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`--${name} expects a positive number, got ${JSON.stringify(raw)}`);
    }
    return value;
  };

  return {
    count: Math.floor(number("count", 10)),
    seeds: Math.floor(number("seeds", 500)),
    outDir: flag("out") ?? join(process.cwd(), "out"),
    workers: Math.floor(number("workers", defaultWorkerCount())),
    matchupSample: Math.floor(number("sample", 40)),
    keepFrames: argv.includes("--keep-frames"),
    redo: argv.includes("--redo"),
  };
}

export interface GenerateSummary {
  produced: ManifestEntry[];
  failures: { matchup: string; reason: string }[];
}

async function generateOne(
  matchup: Matchup,
  options: GenerateOptions,
  bar: ProgressBar,
  position: string,
): Promise<ManifestEntry> {
  const label = `${matchup.a.name} vs ${matchup.b.name}`;

  bar.setLabel(`${position} ${label}  drama`);
  bar.update(0, 1);
  const best = findBestMatch({ a: matchup.a, b: matchup.b }, { count: options.seeds });
  const totalFrames = best.result.durationFrames + VICTORY_FREEZE_FRAMES;

  const framesDir = join(
    options.outDir,
    ".frames",
    `${matchup.a.id}-vs-${matchup.b.id}-${best.seed}`,
  );
  await mkdir(framesDir, { recursive: true });

  try {
    bar.setLabel(`${position} ${label}  render`);
    await renderFramesParallel(best.result, framesDir, {
      victoryFrames: VICTORY_FREEZE_FRAMES,
      workers: options.workers,
      onProgress: (done) => bar.update(done, totalFrames),
    });

    bar.setLabel(`${position} ${label}  encode`);
    bar.update(0, 1);
    const exported = await exportVideo(best.result, {
      framesDir,
      outDir: options.outDir,
    });
    bar.update(1, 1);

    return {
      file: exported.path.split("/").pop()!,
      fighters: [matchup.a.id, matchup.b.id],
      fighterNames: [matchup.a.name, matchup.b.name],
      seed: best.seed,
      dramaScore: Math.round(best.score * 10) / 10,
      durationSeconds: Math.round(exported.durationSeconds * 100) / 100,
      frames: totalFrames,
      winnerId: best.result.winnerId,
      sizeBytes: exported.sizeBytes,
      generatedAt: new Date().toISOString(),
    };
  } finally {
    if (!options.keepFrames) rmSync(framesDir, { recursive: true, force: true });
  }
}

export async function generate(options: GenerateOptions): Promise<GenerateSummary> {
  checkFfmpeg();
  await mkdir(options.outDir, { recursive: true });

  const manifest = options.redo ? { entries: [] } : readManifest(options.outDir);
  const alreadyDone = renderedPairs(manifest);

  console.log(
    `Ranking matchups (${options.matchupSample} matches per pair)...`,
  );
  const roster = options.roster ?? loadFighters();
  const ranked = generateMatchups({ roster, sample: options.matchupSample });
  const queue = ranked
    .filter((m) => !alreadyDone.has(pairKey(m.a.id, m.b.id)))
    .slice(0, options.count);

  if (queue.length === 0) {
    console.log("Nothing to do — every matchup is already in the manifest (use --redo to start over).");
    return { produced: [], failures: [] };
  }
  console.log(
    `${queue.length} video(s) to generate, ${options.workers} render worker(s), ` +
      `${options.seeds} seeds per matchup\n`,
  );

  const summary: GenerateSummary = { produced: [], failures: [] };
  const bar = new ProgressBar("");

  for (const [index, matchup] of queue.entries()) {
    const position = `[${index + 1}/${queue.length}]`;
    const label = `${matchup.a.name} vs ${matchup.b.name}`;
    const startedAt = Date.now();
    try {
      const entry = await generateOne(matchup, options, bar, position);
      summary.produced.push(entry);
      manifest.entries.push(entry);
      // Written after every video so an interrupted batch keeps its progress.
      writeManifest(options.outDir, manifest);
      bar.finish(
        `${position} ${label}  ->  ${entry.file}  ` +
          `seed ${entry.seed}  drama ${entry.dramaScore.toFixed(1)}  ` +
          `${entry.durationSeconds.toFixed(1)}s  ${((Date.now() - startedAt) / 1000).toFixed(0)}s`,
      );
    } catch (error) {
      // A single bad video must not take the batch down.
      const reason = error instanceof Error ? error.message : String(error);
      summary.failures.push({ matchup: label, reason });
      bar.finish(`${position} ${label}  FAILED: ${reason.split("\n")[0]}`);
      if (error instanceof FfmpegMissingError) throw error;
    }
  }

  console.log(
    `\n${summary.produced.length} video(s) written to ${options.outDir}` +
      (summary.failures.length > 0 ? `, ${summary.failures.length} failed` : ""),
  );
  for (const failure of summary.failures) {
    console.log(`  failed: ${failure.matchup} — ${failure.reason.split("\n")[0]}`);
  }
  if (summary.produced.length > 0) {
    const meanDrama =
      summary.produced.reduce((sum, e) => sum + e.dramaScore, 0) / summary.produced.length;
    const meanSeconds =
      summary.produced.reduce((sum, e) => sum + e.durationSeconds, 0) / summary.produced.length;
    console.log(
      `mean drama ${meanDrama.toFixed(1)}, mean length ${meanSeconds.toFixed(1)}s ` +
        `(${(meanSeconds * FPS).toFixed(0)} frames)`,
    );
  }
  return summary;
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    const summary = await generate(options);
    process.exitCode = summary.failures.length > 0 && summary.produced.length === 0 ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (isMain(import.meta.url)) await main();
