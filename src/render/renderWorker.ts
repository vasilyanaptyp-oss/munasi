import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRenderIndex } from "./frame.js";
import type { FramePlan } from "./framePlan.js";
import { frameFileName, renderAnyFrame, type Renderable } from "./index.js";

/**
 * Frame-range renderer, run as a forked child by `parallel.ts`.
 *
 * Rendering a frame depends only on the match result and the frame number, so a
 * worker can be handed any stripe of frames and produce bytes identical to a
 * single-threaded run.
 */

export interface RenderJob {
  result: Renderable;
  outDir: string;
  /** The whole frame plan; this worker renders a slice of it. */
  plan: FramePlan;
  /** Inclusive index into `plan`. */
  startIndex: number;
  /** Exclusive index into `plan`. */
  endIndex: number;
}

export type WorkerMessage =
  | { type: "progress"; frames: number }
  | { type: "done" }
  | { type: "error"; message: string };

async function run(job: RenderJob): Promise<void> {
  const { result, outDir, plan } = job;
  const index = buildRenderIndex(result);

  for (let output = job.startIndex; output < job.endIndex; output += 1) {
    const planned = plan[output]!;
    const png = renderAnyFrame(result, planned.source, { index, planned });
    await writeFile(join(outDir, frameFileName(output)), png);
    process.send?.({ type: "progress", frames: 1 } satisfies WorkerMessage);
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
