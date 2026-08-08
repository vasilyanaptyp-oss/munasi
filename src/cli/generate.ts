import { rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { generateMatchups, type Matchup } from "../content/generateMatchups.js";
import { loadFighters } from "../content/index.js";
import { buildGauntlet, gauntletMatchups, GAUNTLET_RULES } from "../content/teams.js";
import { findBestGauntlet, type GauntletResult } from "../sim/gauntlet.js";
import type { Fighter } from "../sim/types.js";
import { exportVideo, FfmpegMissingError, checkFfmpeg, VICTORY_FREEZE_FRAMES } from "../export/video.js";
import { defaultPlan, sourceFrames } from "../render/framePlan.js";
import { coldOpenPlan } from "../render/framePlan.js";
import { VICTORY_CARD_FRAMES } from "../render/gauntletLayout.js";
import { defaultWorkerCount, renderFramesParallel } from "../render/parallel.js";
import { describeColdOpen, findColdOpen, findGauntletColdOpen } from "../sim/coldOpen.js";
import { findBestMatch } from "../sim/drama.js";
import { FPS } from "../sim/types.js";
import { isMain } from "../util/main.js";
import {
  gauntletKey,
  pairKey,
  readManifest,
  renderedGauntlets,
  renderedPairs,
  writeManifest,
  type ManifestEntry,
} from "./manifest.js";
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
  /**
   * Open on the fight's most arresting earlier moment before starting it.
   * Off by default so both cuts can be posted and compared on watch time.
   */
  coldOpen: boolean;
  /**
   * Indices into the matchup list, for producing a chosen set rather than the
   * next few in order. Used to cut sample videos that span several challengers.
   */
  pick?: number[];
  /**
   * Run the original one-on-one format instead of the gauntlet. The gauntlet
   * is the default: one worker against three bosses is the format the
   * reference uses and the one the titles are written for.
   */
  duel: boolean;
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
    // On by default: the first two seconds decide whether the video is
    // watched at all. `--no-cold-open` posts the straight cut for comparison.
    coldOpen: !argv.includes("--no-cold-open"),
    duel: argv.includes("--duel"),
    ...(flag("pick") === undefined
      ? {}
      : { pick: flag("pick")!.split(",").map((n) => Number(n.trim())).filter(Number.isFinite) }),
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

  const window = options.coldOpen ? findColdOpen(best.result) : null;
  const plan = window
    ? coldOpenPlan(best.result, window, VICTORY_FREEZE_FRAMES)
    : defaultPlan(best.result, VICTORY_FREEZE_FRAMES);
  const totalFrames = plan.length;

  const framesDir = join(
    options.outDir,
    ".frames",
    `${matchup.a.id}-vs-${matchup.b.id}-${best.seed}`,
  );
  await mkdir(framesDir, { recursive: true });

  try {
    bar.setLabel(`${position} ${label}  render`);
    await renderFramesParallel(best.result, framesDir, {
      plan,
      workers: options.workers,
      onProgress: (done) => bar.update(done, totalFrames),
    });

    bar.setLabel(`${position} ${label}  encode`);
    bar.update(0, 1);
    const exported = await exportVideo(best.result, {
      framesDir,
      outDir: options.outDir,
      sourceFrames: sourceFrames(plan),
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
      ...(window
        ? {
            coldOpen: {
              startFrame: window.startFrame,
              endFrame: window.endFrame,
              reason: window.reason,
              damage: window.damage,
              leadChanges: window.leadChanges,
              why: describeColdOpen(window),
            },
          }
        : {}),
    };
  } finally {
    if (!options.keepFrames) rmSync(framesDir, { recursive: true, force: true });
  }
}

/** One gauntlet: pick the most dramatic seed, render it, encode it. */
async function generateGauntlet(
  challenger: Fighter,
  members: Fighter[],
  options: GenerateOptions,
  bar: ProgressBar,
  position: string,
): Promise<ManifestEntry> {
  const label = `${challenger.name} vs ${members.map((m) => m.name).join(", ")}`;
  bar.setLabel(`${position} ${label}  drama`);
  bar.update(0, 1);

  const config = buildGauntlet(challenger, members);
  const best = findBestGauntlet(config, { count: options.seeds, rules: GAUNTLET_RULES });
  const result: GauntletResult = best.result;

  const window = options.coldOpen ? findGauntletColdOpen(result) : null;
  // The gauntlet's closing card is a card, not a wall: held 1.13s, not 2s.
  const plan = window
    ? coldOpenPlan(result, window, VICTORY_CARD_FRAMES)
    : defaultPlan(result, VICTORY_CARD_FRAMES);
  const totalFrames = plan.length;

  const framesDir = join(
    options.outDir,
    ".frames",
    `${challenger.id}-vs-${members.map((m) => m.id).join("-")}-${best.seed}`,
  );
  await mkdir(framesDir, { recursive: true });

  try {
    bar.setLabel(`${position} ${label}  render`);
    await renderFramesParallel(result, framesDir, {
      plan,
      workers: options.workers,
      onProgress: (done) => bar.update(done, totalFrames),
    });

    bar.setLabel(`${position} ${label}  encode`);
    bar.update(0, 1);
    const exported = await exportVideo(result, {
      framesDir,
      outDir: options.outDir,
      sourceFrames: sourceFrames(plan),
    });
    bar.update(1, 1);

    return {
      file: exported.path.split("/").pop()!,
      fighters: [challenger.id, members.map((m) => m.id).join("+")],
      fighterNames: [challenger.name, result.team.name],
      seed: best.seed,
      dramaScore: Math.round(best.score * 10) / 10,
      durationSeconds: Math.round(exported.durationSeconds * 100) / 100,
      frames: totalFrames,
      winnerId: result.challengerWon ? challenger.id : (result.rounds.at(-1)?.opponentId ?? null),
      sizeBytes: exported.sizeBytes,
      generatedAt: new Date().toISOString(),
      gauntlet: {
        challengerId: challenger.id,
        teamIds: members.map((m) => m.id),
        cleared: result.challengerWon,
        decidedInRound: result.rounds.length,
        hpByRound: result.rounds.map((r) => Math.round(r.challengerHpEnd)),
      },
      ...(window
        ? {
            coldOpen: {
              startFrame: window.startFrame,
              endFrame: window.endFrame,
              reason: window.reason,
              damage: window.damage,
              leadChanges: window.leadChanges,
              why: describeColdOpen(window),
            },
          }
        : {}),
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

  const roster = options.roster ?? loadFighters();

  interface QueueItem {
    label: string;
    run: (bar: ProgressBar, position: string) => Promise<ManifestEntry>;
  }
  let queue: QueueItem[];

  if (options.duel) {
    console.log(`Ranking duels (${options.matchupSample} matches per pair)...`);
    const ranked = generateMatchups({ roster, sample: options.matchupSample });
    queue = ranked
      .filter((m) => !alreadyDone.has(pairKey(m.a.id, m.b.id)))
      .slice(0, options.count)
      .map((matchup) => ({
        label: `${matchup.a.name} vs ${matchup.b.name}`,
        run: (bar, position) => generateOne(matchup, options, bar, position),
      }));
  } else {
    const done = renderedGauntlets(manifest);
    const all = gauntletMatchups(roster);
    const chosen = options.pick ? options.pick.map((i) => all[i]).filter((m) => m !== undefined) : all;
    queue = chosen
      .filter((m) => !done.has(gauntletKey(m.challenger.id, m.members.map((x) => x.id))))
      .slice(0, options.count)
      .map((m) => ({
        label: `${m.challenger.name} vs ${m.members.map((x) => x.name).join(", ")}`,
        run: (bar, position) => generateGauntlet(m.challenger, m.members, options, bar, position),
      }));
  }

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

  for (const [index, item] of queue.entries()) {
    const position = `[${index + 1}/${queue.length}]`;
    const label = item.label;
    const startedAt = Date.now();
    try {
      const entry = await item.run(bar, position);
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
