import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MatchResult } from "../sim/types.js";
import { buildRenderIndex, renderSingleFrame } from "./frame.js";
import { frameFileName } from "./index.js";

/**
 * Frame-range renderer, run as a forked child by `parallel.ts`.
 *
 * Rendering a frame depends only on the match result and the frame number, so a
 * worker can be handed any stripe of frames and produce bytes identical to a
 * single-threaded run.
 */

export interface RenderJob {
  result: MatchResult;
  outDir: string;
  /** Inclusive. */
  startFrame: number;
  /** Exclusive. */
  endFrame: number;
  /** Frames of victory freeze that follow the match, rendered by one worker. */
  victoryFrames: number;
}

export type WorkerMessage =
  | { type: "progress"; frames: number }
  | { type: "done" }
  | { type: "error"; message: string };

async function run(job: RenderJob): Promise<void> {
  const { result, outDir } = job;
  const index = buildRenderIndex(result);

  for (let frame = job.startFrame; frame < job.endFrame; frame += 1) {
    const png = renderSingleFrame(result, frame, { index });
    await writeFile(join(outDir, frameFileName(frame)), png);
    process.send?.({ type: "progress", frames: 1 } satisfies WorkerMessage);
  }

  if (job.victoryFrames > 0) {
    const png = renderSingleFrame(result, result.durationFrames - 1, {
      index,
      victoryOverlay: true,
    });
    for (let i = 0; i < job.victoryFrames; i += 1) {
      await writeFile(join(outDir, frameFileName(result.durationFrames + i)), png);
      process.send?.({ type: "progress", frames: 1 } satisfies WorkerMessage);
    }
  }
}

process.on("message", (job: RenderJob) => {
  run(job)
    .then(() => process.send?.({ type: "done" } satisfies WorkerMessage))
    .catch((error: unknown) => {
      process.send?.({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      } satisfies WorkerMessage);
    });
});
