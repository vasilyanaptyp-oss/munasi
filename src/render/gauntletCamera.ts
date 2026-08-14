import type { GauntletResult } from "../sim/gauntlet.js";
import { FIGHTER_HALF_HEIGHT } from "../sim/movement.js";
import { ARENA } from "./gauntletTheme.js";

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
const PAN_LERP = 0.05;
const ZOOM_LERP = 0.03;
/** How far the shot may push in and pull back. */
const MIN_ZOOM = 0.94;
const MAX_ZOOM = 1.16;
/** Seconds for one full breath of the zoom. */
const ZOOM_PERIOD = 7.5;

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
export const FIGHTER_HEIGHT_PX = FIGHTER_HALF_HEIGHT * 2 * ARENA.inner.h;

/** Screen position of a point in arena units under a camera. */
export function worldToScreen(x: number, y: number, camera: CameraFrame): { x: number; y: number } {
  return {
    x: ARENA.centre.x + (x - camera.x) * ARENA.inner.w * camera.zoom,
    y: ARENA.centre.y + (y - camera.y) * ARENA.inner.h * camera.zoom,
  };
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

    // The shot may drift off-centre but never so far that the arena stops
    // covering the frame — the reference crops its arena, it never shows past it.
    const slack = (1 - 1 / zoom) / 2;
    camX = Math.max(0.5 - slack, Math.min(0.5 + slack, camX));
    camY = Math.max(0.5 - slack, Math.min(0.5 + slack, camY));

    frames.push({ x: camX, y: camY, zoom });
  });

  const track: CameraTrack = { frames };
  cache.set(result, track);
  return track;
}
