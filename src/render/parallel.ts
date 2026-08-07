import { fork } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { planFor, renderFrames, type Renderable, type RenderFramesOptions } from "./index.js";
import type { RenderJob, WorkerMessage } from "./renderWorker.js";

const WORKER_PATH = fileURLToPath(new URL("./renderWorker.ts", import.meta.url));

/**
 * The worker is TypeScript, so the child needs a loader that can read it.
 * `execArgv` is not inherited in every runner (vitest, for one, transforms
 * in-process and passes nothing along), so ask for tsx explicitly.
 */
const WORKER_EXEC_ARGV = WORKER_PATH.endsWith(".ts") ? ["--import", "tsx"] : [];

/** Leave one core for the parent process and whatever else is running. */
export function defaultWorkerCount(): number {
  return Math.max(1, availableParallelism() - 1);
}

export interface ParallelRenderOptions extends RenderFramesOptions {
  /** Defaults to CPU count minus one. */
  workers?: number;
}

/**
 * Renders a match across several processes. Each worker owns a contiguous
 * stripe of frames; because `renderSingleFrame` is pure, the result is
 * byte-identical to rendering them all in one process.
 */
export async function renderFramesParallel(
  result: Renderable,
  outDir: string,
  options: ParallelRenderOptions = {},
): Promise<void> {
  const plan = planFor(result, options);
  const total = plan.length;
  const workers = Math.max(1, Math.min(options.workers ?? defaultWorkerCount(), total));

  if (workers === 1) {
    await renderFrames(result, outDir, options);
    return;
  }

  await mkdir(outDir, { recursive: true });

  const perWorker = Math.ceil(total / workers);
  const jobs: RenderJob[] = [];
  for (let i = 0; i < workers; i += 1) {
    const startIndex = i * perWorker;
    const endIndex = Math.min(total, startIndex + perWorker);
    if (startIndex >= endIndex) continue;
    jobs.push({ result, outDir, plan, startIndex, endIndex });
  }

  let done = 0;
  await Promise.all(
    jobs.map(
      (job) =>
        new Promise<void>((resolve, reject) => {
          const child = fork(WORKER_PATH, {
            stdio: ["ignore", "inherit", "inherit", "ipc"],
            execArgv: WORKER_EXEC_ARGV,
          });
          let settled = false;
          const finish = (error?: Error): void => {
            if (settled) return;
            settled = true;
            child.kill();
            if (error) reject(error);
            else resolve();
          };

          child.on("message", (message: WorkerMessage) => {
            if (message.type === "progress") {
              done += message.frames;
              options.onProgress?.(done, total);
            } else if (message.type === "done") {
              finish();
            } else {
              finish(new Error(`render worker failed: ${message.message}`));
            }
          });
          child.on("error", (error) => finish(error));
          child.on("exit", (code) => {
            if (!settled) {
              finish(
                code === 0
                  ? new Error("render worker exited before finishing its frames")
                  : new Error(`render worker exited with code ${code}`),
              );
            }
          });
          child.send(job);
        }),
    ),
  );
}
