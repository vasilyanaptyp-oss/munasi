import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MatchResult } from "../sim/types.js";
import { buildRenderIndex, renderSingleFrame } from "./frame.js";

export * from "./frame.js";
export * from "./sprites.js";
export { HEIGHT, LAYOUT, WIDTH } from "./theme.js";

/** Zero-padded so ffmpeg's image2 demuxer reads them in order. */
export function frameFileName(frame: number): string {
  return `frame_${String(frame).padStart(6, "0")}.png`;
}

export interface RenderFramesOptions {
  /** Called after each frame; use for progress reporting. */
  onProgress?: (done: number, total: number) => void;
  /** Extra frames of the winner overlay appended after the match ends. */
  victoryFrames?: number;
}

/**
 * Renders every frame of a match into `outDir` as `frame_000000.png`.
 * The directory is created if missing.
 */
export async function renderFrames(
  result: MatchResult,
  outDir: string,
  options: RenderFramesOptions = {},
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const index = buildRenderIndex(result);
  const victoryFrames = options.victoryFrames ?? 0;
  const total = result.durationFrames + victoryFrames;

  for (let frame = 0; frame < result.durationFrames; frame += 1) {
    const png = renderSingleFrame(result, frame, { index });
    await writeFile(join(outDir, frameFileName(frame)), png);
    options.onProgress?.(frame + 1, total);
  }

  // Freeze on the last frame with the winner banner over it.
  if (victoryFrames > 0) {
    const png = renderSingleFrame(result, result.durationFrames - 1, {
      index,
      victoryOverlay: true,
    });
    for (let i = 0; i < victoryFrames; i += 1) {
      await writeFile(join(outDir, frameFileName(result.durationFrames + i)), png);
      options.onProgress?.(result.durationFrames + i + 1, total);
    }
  }
}
