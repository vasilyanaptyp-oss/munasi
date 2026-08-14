import type { GauntletResult } from "../sim/gauntlet.js";
import { FIGHTER_HALF_HEIGHT } from "../sim/movement.js";
import { ARENA } from "./gauntletTheme.js";
import { HEIGHT } from "./theme.js";

/**
 * The camera, solved once per run.
 *
 * Almost nothing is solved any more, and that is the point. The fighters bounce
 * around a flat arena at a fixed size, so there is no depth to stage, no spread
 * to fit and no size to negotiate: a fighter is `FIGHTER_HALF_HEIGHT` of the
 * arena tall because the simulation bounces a box of exactly that size, and the
 * renderer draws that box.
 *
 * What is left is the shot: it pans after the midpoint between the two and
 * breathes its zoom, both lagged, because in the reference the arena's own frame
 * slides and rescales in every single frame and is regularly cropped by the edge
 * of the video. Measured across 721 frames of one reference: the black frame
 * wanders about a third of the frame height and never once holds still.
 *
 * A lag is stateful and `gauntletFrameLayout` has to stay a pure function of
 * `(result, frame)`, so the whole track is solved in one pass and cached against
 * the result object.
 */

/** How far the pan and zoom move toward their target each frame. */
const PAN_LERP = 0.045;
const ZOOM_LERP = 0.02;
/**
 * How far the shot may push in and pull back.
 *
 * Above 1 the arena is larger than its slot and the frame crops it — which the
 * reference does constantly, often cutting a whole wall off the screen. Measured
 * across 721 reference frames, the arena's own black border never once holds
 * still and wanders about a third of the frame height.
 */
const MIN_ZOOM = 0.92;
const MAX_ZOOM = 1.15;
/** Seconds for one full breath of the zoom. */
const ZOOM_PERIOD = 9;

export interface CameraFrame {
  /** World x and y the camera is centred on, in arena units. */
  x: number;
  y: number;
  zoom: number;
}

export interface CameraTrack {
  frames: CameraFrame[];
}

/** Height a fighter is drawn at, in pixels. Fixed — see the note above. */
export const FIGHTER_HEIGHT_UNITS = FIGHTER_HALF_HEIGHT * 2;

/**
 * The arena as it lands on screen under a camera.
 *
 * The arena moves. It used to be nailed to a constant and only the contents
 * moved inside it, which is backwards: in the reference the whole scene —
 * square, border and all — sits under a camera that pans and scales, and the
 * edge of the video crops it.
 */
export function arenaOnScreen(camera: CameraFrame): { x: number; y: number; side: number } {
  const side = ARENA.side * camera.zoom;
  const x = ARENA.centre.x - (camera.x - 0.5) * side - side / 2;
  let y = ARENA.centre.y - (camera.y - 0.5) * side - side / 2;

  // Vertically the arena is fenced in, horizontally it is not.
  //
  // The title sits above the square and the caption below it, and both have to
  // stay legible — losing half a name costs the joke, and the joke is the whole
  // video. So the square may slide and scale but never climb into the title or
  // drop onto the caption. Sideways it is free to run off the edge and be
  // cropped, which is what the reference does most of the time.
  y = Math.max(TITLE_FLOOR, Math.min(CAPTION_CEILING - side, y));
  return { x, y, side };
}

/** The arena's top may not rise above this: the title lives up there. */
const TITLE_FLOOR = Math.round(HEIGHT * 0.28);
/** Nor may its bottom fall below this: the caption lives down there. */
const CAPTION_CEILING = Math.round(HEIGHT * 0.885);

/** Screen position of a point in arena units under a camera. */
export function worldToScreen(x: number, y: number, camera: CameraFrame): { x: number; y: number } {
  const arena = arenaOnScreen(camera);
  const border = ARENA.border * camera.zoom;
  const inner = arena.side - border * 2;
  return { x: arena.x + border + x * inner, y: arena.y + border + y * inner };
}

const cache = new WeakMap<GauntletResult, CameraTrack>();

export function cameraTrack(result: GauntletResult): CameraTrack {
  const cached = cache.get(result);
  if (cached) return cached;

  const frames: CameraFrame[] = [];
  let camX = 0.5;
  let camY = 0.5;
  let zoom = 1;

  result.snapshots.forEach((snap, i) => {
    const midX = (snap.challenger.x + snap.opponent.x) / 2;
    const midY = (snap.challenger.y + snap.opponent.y) / 2;

    // A slow breath rather than a reaction to the pair's spread: the fighters
    // cross the whole arena constantly, so a spread-driven zoom would pump.
    const breath = (Math.sin((i / 30 / ZOOM_PERIOD) * Math.PI * 2) + 1) / 2;
    const target = MIN_ZOOM + (MAX_ZOOM - MIN_ZOOM) * breath;

    camX += (midX - camX) * PAN_LERP;
    camY += (midY - camY) * PAN_LERP;
    zoom += (target - zoom) * ZOOM_LERP;

    // Free to drift: the reference lets the arena slide right out to the edge
    // of the video and clips it. Held to half the arena so a wall is always in
    // shot and the square never reads as having wandered off.
    camX = Math.max(0.25, Math.min(0.75, camX));
    camY = Math.max(0.25, Math.min(0.75, camY));

    frames.push({ x: camX, y: camY, zoom });
  });

  const track: CameraTrack = { frames };
  cache.set(result, track);
  return track;
}
