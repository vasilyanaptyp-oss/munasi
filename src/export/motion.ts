import { execFileSync } from "node:child_process";
import { ROUND_HOLD_FRAMES } from "../sim/gauntlet.js";
import { FPS } from "../sim/types.js";
import { VICTORY_CARD_FRAMES } from "../render/framePlan.js";
import { ffmpegBin, ffprobeBin } from "../util/tools.js";

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

/**
 * Frames at the end of a gauntlet that are *meant* to hold still.
 *
 * The last round's death hold plus the closing card. This is the whole reason
 * the gate can look at the entire file instead of one comfortable window: a
 * still frame is either inside this allowance or it is a regression, and the
 * two used to be indistinguishable because the gate only ever measured the
 * middle six seconds. Measured on shipped videos, the closing stretch ran
 * 6.7-7.7% changed with 22-30% of frames static — numbers that fail the gate's
 * own thresholds, on files that passed.
 *
 * Derived, not written down: both halves are the constants the pipeline uses.
 */
export const STATIC_TAIL_ALLOWANCE = ROUND_HOLD_FRAMES + VICTORY_CARD_FRAMES;

/** Duration of an encoded file, in seconds. */
export function videoDuration(path: string): number {
  const out = execFileSync(
    ffprobeBin(),
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
  return report(decode(path, ["-ss", start.toFixed(3), "-t", windowSeconds.toFixed(3)]));
}

/** Every frame of the file, in order. */
export function measureWholeVideo(path: string): MotionReport {
  return report(decode(path, []));
}

function decode(path: string, seek: string[]): number[] {
  const raw = execFileSync(
    ffmpegBin(),
    [
      "-v",
      "error",
      ...seek,
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
  return perFrame;
}

function report(perFrame: number[]): MotionReport {
  const meanChanged = perFrame.reduce((a, b) => a + b, 0) / perFrame.length;
  const staticShare = perFrame.filter((share) => share < STATIC_BELOW).length / perFrame.length;
  return { meanChanged, staticShare, perFrame, framesMeasured: perFrame.length };
}

/** A frame that changed less than this is standing still. */
const STATIC_BELOW = 0.01;

export interface WholeVideoVerdict {
  /** Every frame of the file. */
  whole: MotionReport;
  /** The file minus the frames the closing hold and card are allowed. */
  body: MotionReport;
  /** Static frames anywhere in the file. */
  staticFrames: number;
  /** Static frames outside the tail allowance — these are the ones that count. */
  staticBeyondAllowance: number;
  failures: string[];
}

/**
 * The gate, over the whole file rather than one window.
 *
 * Two rules. The body — everything before the tail allowance — has to move like
 * the reference and hold still almost never. And the file as a whole may not
 * contain more still frames than the closing hold and card explain, which is
 * what makes a deliberate pause distinguishable from a regression: if the end
 * grows or the middle starts freezing, the count goes over and this fails.
 */
export function judgeMotion(path: string): WholeVideoVerdict {
  const perFrame = decode(path, []);
  const whole = report(perFrame);
  const bodyFrames = perFrame.slice(0, Math.max(1, perFrame.length - STATIC_TAIL_ALLOWANCE));
  const body = report(bodyFrames);

  const staticFrames = perFrame.filter((s) => s < STATIC_BELOW).length;
  const staticBeyondAllowance = Math.max(0, staticFrames - STATIC_TAIL_ALLOWANCE);

  const failures: string[] = [];
  if (body.meanChanged < MOTION_TARGET.meanChanged) {
    failures.push(
      `body moves ${(body.meanChanged * 100).toFixed(1)}% per frame, under the ` +
        `${(MOTION_TARGET.meanChanged * 100).toFixed(0)}% floor`,
    );
  }
  if (body.staticShare >= MOTION_TARGET.staticShare) {
    failures.push(
      `${(body.staticShare * 100).toFixed(1)}% of body frames are static, over the ` +
        `${(MOTION_TARGET.staticShare * 100).toFixed(0)}% limit`,
    );
  }
  if (staticBeyondAllowance > 0) {
    failures.push(
      `${staticFrames} static frames in the file, ${staticBeyondAllowance} more than the ` +
        `${STATIC_TAIL_ALLOWANCE} the death hold and closing card account for`,
    );
  }
  return { whole, body, staticFrames, staticBeyondAllowance, failures };
}

/**
 * Thresholds the gate holds videos to, applied to the body of the file — see
 * `judgeMotion`, which measures every frame and lets the closing hold and card
 * have `STATIC_TAIL_ALLOWANCE` still frames and not one more.
 */
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
