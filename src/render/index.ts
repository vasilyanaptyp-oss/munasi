import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GauntletResult } from "../sim/gauntlet.js";
import type { MatchResult } from "../sim/types.js";
import { buildRenderIndex, renderSingleFrame } from "./frame.js";
import { defaultPlan, type FramePlan } from "./framePlan.js";
import { renderGauntletFrame } from "./gauntletFrame.js";

export * from "./frame.js";
export * from "./gauntletFrame.js";
export * from "./gauntletTheme.js";
export * from "./framePlan.js";
export * from "./sprites.js";
export * from "./drawFighter.js";
export * from "./silhouette.js";
export { HEIGHT, LAYOUT, WIDTH } from "./theme.js";

/**
 * Either mode. The pipeline below is written against this rather than against
 * `MatchResult`, so the gauntlet and the original 1v1 share the frame plan,
 * the worker split and the encoder.
 */
export type Renderable = MatchResult | GauntletResult;

export function isGauntlet(result: Renderable): result is GauntletResult {
  return "rounds" in result;
}

/** Renders one frame of whichever mode this is. */
export function renderAnyFrame(
  result: Renderable,
  frame: number,
  options: { index?: ReturnType<typeof buildRenderIndex>; planned?: FramePlan[number] } = {},
): Buffer {
  const shared = {
    ...(options.index === undefined ? {} : { index: options.index }),
    ...(options.planned === undefined ? {} : { planned: options.planned }),
  };
  return isGauntlet(result)
    ? renderGauntletFrame(result, frame, shared)
    : renderSingleFrame(result, frame, shared);
}

/** Zero-padded so ffmpeg's image2 demuxer reads them in order. */
export function frameFileName(frame: number): string {
  return `frame_${String(frame).padStart(6, "0")}.png`;
}

export interface RenderFramesOptions {
  /** Called after each frame; use for progress reporting. */
  onProgress?: (done: number, total: number) => void;
  /** Extra frames of the winner overlay appended after the match ends. */
  victoryFrames?: number;
  /** Explicit frame order. Overrides `victoryFrames` when given. */
  plan?: FramePlan;
}

export function planFor(result: Renderable, options: RenderFramesOptions): FramePlan {
  return options.plan ?? defaultPlan(result, options.victoryFrames ?? 0);
}

/**
 * Renders every frame of a match into `outDir` as `frame_000000.png`.
 * The directory is created if missing.
 */
export async function renderFrames(
  result: Renderable,
  outDir: string,
  options: RenderFramesOptions = {},
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const index = buildRenderIndex(result);
  const plan = planFor(result, options);

  for (const [output, planned] of plan.entries()) {
    const png = renderAnyFrame(result, planned.source, { index, planned });
    await writeFile(join(outDir, frameFileName(output)), png);
    options.onProgress?.(output + 1, plan.length);
  }
}
