import { execFileSync } from "node:child_process";
import { FPS } from "../sim/types.js";

/**
 * How much the picture actually moves, measured on the encoded mp4.
 *
 * The composition gate proves the frame is laid out correctly and the tempo
 * gate proves events keep landing, and a video can pass both while barely
 * moving: fighters pinned to fixed slots, numbers popping on and off, nothing
 * travelling across the screen. This measures the thing a viewer reads as
 * "alive", straight off the delivered file rather than off the layout.
 *
 * Measured against the reference channel: 12.7% of pixels change per frame
 * there, and no frame at all is static.
 */

/** Luma steps below this are encoder noise, not motion. */
const CHANGE_THRESHOLD = 8;
/** Frames are compared at quarter resolution: fast, and still 270x480. */
const SAMPLE_WIDTH = 270;
const SAMPLE_HEIGHT = 480;

export interface MotionReport {
  /** Mean share of pixels that changed from the previous frame, 0..1. */
  meanChanged: number;
  /** Share of frames that changed less than 1% of their pixels, 0..1. */
  staticShare: number;
  /** Per-frame changed shares, in order. */
  perFrame: number[];
  framesMeasured: number;
}

export interface MotionOptions {
  /** Seconds of video to measure. Defaults to 6. */
  windowSeconds?: number;
  /**
   * Where the window starts, as a share of the file. Defaults to the middle,
   * which for a gauntlet is the second round — a representative stretch that
   * excludes both the opening and the closing card.
   */
  startShare?: number;
}

/** Duration of an encoded file, in seconds. */
export function videoDuration(path: string): number {
  const out = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      path,
    ],
    { encoding: "utf8" },
  );
  const seconds = Number(out.trim());
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe gave no duration for ${path}`);
  return seconds;
}

/**
 * Decodes a window of the file to greyscale and counts, for each frame, how
 * many pixels differ from the frame before it.
 */
export function measureMotion(path: string, options: MotionOptions = {}): MotionReport {
  const windowSeconds = options.windowSeconds ?? 6;
  const startShare = options.startShare ?? 0.5;
  const duration = videoDuration(path);
  const start = Math.max(0, duration * startShare - windowSeconds / 2);

  const raw = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      start.toFixed(3),
      "-t",
      windowSeconds.toFixed(3),
      "-i",
      path,
      "-vf",
      `scale=${SAMPLE_WIDTH}:${SAMPLE_HEIGHT}`,
      "-pix_fmt",
      "gray",
      "-f",
      "rawvideo",
      "-",
    ],
    { maxBuffer: 1 << 30 },
  );

  const pixels = SAMPLE_WIDTH * SAMPLE_HEIGHT;
  const frames = Math.floor(raw.length / pixels);
  if (frames < 2) throw new Error(`${path}: decoded ${frames} frames, need at least 2`);

  const perFrame: number[] = [];
  for (let f = 1; f < frames; f += 1) {
    const prev = f - 1;
    let changed = 0;
    for (let i = 0; i < pixels; i += 1) {
      const delta = raw[f * pixels + i]! - raw[prev * pixels + i]!;
      if (delta > CHANGE_THRESHOLD || delta < -CHANGE_THRESHOLD) changed += 1;
    }
    perFrame.push(changed / pixels);
  }

  const meanChanged = perFrame.reduce((a, b) => a + b, 0) / perFrame.length;
  const staticShare = perFrame.filter((share) => share < 0.01).length / perFrame.length;
  return { meanChanged, staticShare, perFrame, framesMeasured: perFrame.length };
}

/** Thresholds the gate holds videos to. */
export const MOTION_TARGET = {
  /** Reference measures 12.7%. */
  meanChanged: 0.08,
  /** Reference measures 0%. */
  staticShare: 0.05,
} as const;

export function describeMotion(report: MotionReport): string {
  return (
    `${(report.meanChanged * 100).toFixed(1)}% of pixels change per frame, ` +
    `${(report.staticShare * 100).toFixed(1)}% of frames are static ` +
    `(${report.framesMeasured} frames at ${FPS}fps)`
  );
}
