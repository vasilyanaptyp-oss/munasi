import type { GauntletResult } from "../sim/gauntlet.js";
import { FIGHTER_HALF_HEIGHT } from "../sim/movement.js";
import { ARENA, HP_WIDGET } from "./gauntletTheme.js";
import { HEIGHT, WIDTH } from "./theme.js";

/**
 * The camera, solved once per run.
 *
 * **The camera translates the scene and does nothing else.** Title, arena and
 * caption are one rigid group; the camera slides that group around behind the
 * frame, and the frame crops whatever falls outside. Nothing is pinned to the
 * screen and nothing scales.
 *
 * Both halves of that were measured on 721 frames of one reference, at full
 * resolution, not on crops:
 *
 * - **No zoom.** The arena's black border measures 612-613px tall in every one
 *   of the 721 frames — a spread of one pixel across the whole video. It never
 *   scales. Ours used to breathe between 0.92x and 1.15x, which is a thing the
 *   format does not do.
 * - **The overlay is welded to the arena.** The caption's top edge sits
 *   30-32px below the arena's bottom border in every frame (spread: 2px), and
 *   the title's top edge sits 76-77px above the arena's top border on every
 *   frame where the title is not clipped. Meanwhile both slide 200-250px around
 *   the screen. They are not two things that happen to move alike; they are one
 *   thing. Ours held the title still at a fixed y and let the arena slide out
 *   from under it, which is the defect being fixed here.
 *
 * The overlay is therefore allowed to run off the edge and be cut in half. That
 * is not a regression: the reference does it constantly, and both frames the
 * owner sent as "this is how it should look" have the title clipped by the frame
 * edge.
 *
 * A lag is stateful and `gauntletFrameLayout` has to stay a pure function of
 * `(result, frame)`, so the whole track is solved in one pass and cached against
 * the result object.
 */

/** How far the pan moves toward its target each frame. */
const PAN_LERP = 0.045;

/**
 * How far the scene may slide from its home position, as a share of the frame.
 *
 * From the reference: the arena's top border wanders between y=27 and y=276 on a
 * 1024-tall frame, so the scene travels about 24% of the frame height. Sideways
 * it goes further — a wall is off screen on roughly 40% of frames. Held to a
 * little under the measured range so a fighter is never chased entirely out of
 * shot.
 */
const PAN_RANGE_X = 0.16;
const PAN_RANGE_Y = 0.11;

/**
 * How hard the camera leans on the pair's midpoint.
 *
 * Two fighters bouncing around a shared arena have a midpoint that sits near the
 * centre most of the time — one is high when the other is low. Following it
 * one-for-one produced a camera that barely moved: measured on a finished video,
 * the arena's top edge travelled 33px where the reference's travels 249px. The
 * gain saturates the pan against its limits instead, so the arena runs to the
 * edge of the frame and is cropped there, which is what the reference does on
 * roughly 40% of its frames.
 */
const PAN_GAIN = 3.2;

export interface CameraFrame {
  /** Scene translation in pixels. The whole group moves by this and nothing else. */
  dx: number;
  dy: number;
}

export interface CameraTrack {
  frames: CameraFrame[];
}

/** Height a fighter is drawn at, as a share of the arena's inner box. */
export const FIGHTER_HEIGHT_UNITS = FIGHTER_HALF_HEIGHT * 2;

/**
 * The arena as it lands on screen under a camera.
 *
 * A fixed square at a fixed size, offset by the camera. The clamps that used to
 * fence it away from the title and the caption are gone: those two now move with
 * it, so there is nothing to collide with, and holding the square inside a box
 * was what stopped the shot from ever looking like the reference.
 */
export function arenaOnScreen(camera: CameraFrame): { x: number; y: number; side: number } {
  return { x: ARENA.x + camera.dx, y: ARENA.y + camera.dy, side: ARENA.side };
}

/** Screen position of a point in arena units under a camera. */
export function worldToScreen(x: number, y: number, camera: CameraFrame): { x: number; y: number } {
  return {
    x: ARENA.inner.x + camera.dx + x * ARENA.inner.w,
    y: ARENA.inner.y + camera.dy + y * ARENA.inner.h,
  };
}

/**
 * The band of camera translations that keeps both fighters — and the HP plus
 * over each — fully inside the frame.
 *
 * Returns an inverted band (`lo > hi`) when the pair is too far apart to fit,
 * which the caller reads as "no constraint": at that point holding one of them
 * on screen would mean shoving the other off, and the follow is the better
 * behaviour.
 */
function keepBoth(snap: GauntletResult["snapshots"][number]): {
  loX: number;
  hiX: number;
  loY: number;
  hiY: number;
} {
  const inner = ARENA.inner;
  const halfH = (FIGHTER_HEIGHT_UNITS * inner.h) / 2;
  // The widest thing over a fighter is the plus, not the photo.
  const halfW = Math.max((FIGHTER_HEIGHT_UNITS * inner.h) / 2, HP_WIDGET.width / 2);
  const above = halfH + HP_WIDGET.height + Math.round(WIDTH * 0.02);

  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const who of [snap.challenger, snap.opponent]) {
    const cx = inner.x + who.x * inner.w;
    const cy = inner.y + who.y * inner.h;
    left = Math.min(left, cx - halfW);
    right = Math.max(right, cx + halfW);
    top = Math.min(top, cy - above);
    bottom = Math.max(bottom, cy + halfH);
  }
  return {
    loX: -left,
    hiX: WIDTH - right,
    loY: -top,
    hiY: HEIGHT - bottom,
  };
}

const cache = new WeakMap<GauntletResult, CameraTrack>();

export function cameraTrack(result: GauntletResult): CameraTrack {
  const cached = cache.get(result);
  if (cached) return cached;

  const frames: CameraFrame[] = [];
  const maxX = Math.round(WIDTH * PAN_RANGE_X);
  const maxY = Math.round(HEIGHT * PAN_RANGE_Y);
  let dx = 0;
  let dy = 0;

  for (const snap of result.snapshots) {
    // Follow the midpoint of the pair. The camera moves the scene the *opposite*
    // way to the thing it is following: to put a fighter on the right of the
    // frame you slide the world left.
    const midX = (snap.challenger.x + snap.opponent.x) / 2;
    const midY = (snap.challenger.y + snap.opponent.y) / 2;
    const targetX = -(midX - 0.5) * 2 * maxX * PAN_GAIN;
    const targetY = -(midY - 0.5) * 2 * maxY * PAN_GAIN;

    dx += (targetX - dx) * PAN_LERP;
    dy += (targetY - dy) * PAN_LERP;
    dx = Math.max(-maxX, Math.min(maxX, dx));
    dy = Math.max(-maxY, Math.min(maxY, dy));

    // **Never lose a fighter off the edge.**
    //
    // The arena is wider than the frame — that is the format — so the camera can
    // put a wall off screen, and with it whoever is standing near it. Losing a
    // figure is one thing; losing the HP number over their head is another, and
    // it is the number the whole fight is read from. So the pan is held to a
    // window that keeps both figures, and the plus above each of them, inside
    // the frame. Within that window it still follows the pair and still runs the
    // arena's walls off the edge.
    // When the band inverts the pair is wider than the frame — they are on
    // opposite walls of an arena that is itself frame-width — and no pan holds
    // both whole. Split the difference rather than dropping the rule: a sliver
    // off each figure beats losing one of them off the edge entirely.
    const span = keepBoth(snap);
    dx = span.loX <= span.hiX
      ? Math.max(span.loX, Math.min(span.hiX, dx))
      : (span.loX + span.hiX) / 2;
    dy = span.loY <= span.hiY
      ? Math.max(span.loY, Math.min(span.hiY, dy))
      : (span.loY + span.hiY) / 2;

    frames.push({ dx, dy });
  }

  const track: CameraTrack = { frames };
  cache.set(result, track);
  return track;
}
