import type { ColdOpenWindow } from "../sim/coldOpen.js";
import { FPS } from "../sim/types.js";

/**
 * The order frames are emitted in.
 *
 * Output frame index and simulation frame are normally the same thing, but a
 * cold open replays an earlier stretch of the fight before the fight starts, so
 * the mapping has to be explicit. Everything downstream — the renderer, the
 * worker split, the SFX bus — reads the plan rather than assuming 1:1.
 */
export interface PlannedFrame {
  /** Frame of the simulation this output frame shows. */
  source: number;
  /** Draw the winner banner over it. */
  victoryOverlay?: boolean;
  /** Badge drawn during the cold open. */
  coldOpenLabel?: string;
  /** Badge drawn just after cutting back to the start. */
  startLabel?: string;
  /** 0..1 white flash, used on the cut. */
  flash?: number;
}

export type FramePlan = PlannedFrame[];

/** Anything with a frame count — a 1v1 match or a gauntlet run. */
export interface Timeline {
  durationFrames: number;
}

/** Straight play-through, with the winner freeze appended. */
export function defaultPlan(result: Timeline, victoryFrames = 0): FramePlan {
  const plan: FramePlan = [];
  for (let frame = 0; frame < result.durationFrames; frame += 1) plan.push({ source: frame });
  for (let i = 0; i < victoryFrames; i += 1) {
    plan.push({ source: result.durationFrames - 1, victoryOverlay: true });
  }
  return plan;
}

/**
 * Frames the gauntlet's closing card is held. Capped so the video does not end
 * on a wall of static — 34 frames is 1.13s.
 *
 * Lives here rather than in the layout because it is a property of the plan, and
 * because `src/export/motion.ts` needs the number to know how much stillness the
 * end of a video is allowed to have. Importing it from the layout dragged the
 * canvas and the font loader into a module that only wanted an integer.
 */
export const VICTORY_CARD_FRAMES = 34;

/** Frames of white flash on the cut back to the start. */
const CUT_FLASH_FRAMES = 4;
/** Frames the "start" badge stays up after the cut. */
const START_BADGE_FRAMES = 20;

/**
 * Cold open: play `window`, cut, then play the match from the top.
 *
 * The label counts forward to when the previewed moment happens, so the cut
 * reads as a rewind rather than a glitch.
 */
export function coldOpenPlan(
  result: Timeline,
  window: ColdOpenWindow,
  victoryFrames = 0,
): FramePlan {
  const plan: FramePlan = [];
  const secondsIn = Math.max(1, Math.round(window.startFrame / FPS));
  const label = `${secondsIn} SEC LATER`;

  for (let frame = window.startFrame; frame < window.endFrame; frame += 1) {
    plan.push({ source: frame, coldOpenLabel: label });
  }

  const body = defaultPlan(result, victoryFrames);
  body.forEach((planned, i) => {
    const entry: PlannedFrame = { ...planned };
    if (i < CUT_FLASH_FRAMES) entry.flash = 1 - i / CUT_FLASH_FRAMES;
    if (i < START_BADGE_FRAMES) entry.startLabel = "FROM THE TOP";
    plan.push(entry);
  });
  return plan;
}

/** Source frame for each output frame — what the audio bus needs. */
export function sourceFrames(plan: FramePlan): number[] {
  return plan.map((entry) => entry.source);
}
