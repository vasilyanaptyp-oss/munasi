import type { GauntletResult } from "../sim/gauntlet.js";
import { LANES } from "../sim/movement.js";
import { FIGHTER_OUTLINE } from "./drawFighter.js";
import { ARENA, HP_WIDGET, HP_WIDGET_SLOTS } from "./gauntletTheme.js";
import { spriteBounds, spriteMotionBounds } from "./silhouette.js";
import { HEIGHT } from "./theme.js";

/**
 * The camera track, solved once per run.
 *
 * The fighters now move (`sim/movement.ts`), so the shot has something to
 * follow: the camera pans after the midpoint between them and zooms in as they
 * close and out as they break apart. Both are lagged, which is what makes it
 * read as a camera rather than as a rubber band.
 *
 * A lag is stateful and `gauntletFrameLayout` has to stay a pure function of
 * `(result, frame)`, so the whole track is solved in one pass and cached
 * against the result object. Frame 900 does not need frames 0-899 replayed.
 */

/** How far the pan and zoom move toward their target each frame. */
const PAN_LERP = 0.16;
const ZOOM_LERP = 0.09;
/**
 * Zoom range. Below 1 the shot pulls back as the pair breaks apart, above it
 * pushes in as they close — which is where the motion in the picture comes
 * from as much as the fighters' own travel.
 */
const MIN_ZOOM = 0.9;
const MAX_ZOOM = 1.12;
/** Kept clear of the arena wall. */
const PAD = Math.round(ARENA.inner.w * 0.012) + FIGHTER_OUTLINE;
/** Clearance under the arena roof, covering the keyline. */
const VERTICAL_PAD = Math.round(HEIGHT * 0.006) + FIGHTER_OUTLINE + 2;
/** Height floor a fighter never drops under, even at full zoom-out. */
const MIN_HEIGHT_SHARE = 0.2;
/** Depth scaling: the far fighter is drawn smaller than the near one. */
const DEPTH_RANGE = 0.18;

export interface CameraFrame {
  /** World x the camera is centred on. */
  x: number;
  zoom: number;
}

export interface CameraTrack {
  frames: CameraFrame[];
  /** Pixels per unit of `drawFighter`'s `size`, before zoom and depth, per round. */
  baseSize: number[];
}

/** Perspective factor for a fighter at depth `y`. */
export function depthScale(y: number): number {
  return 1 + (y - 0.5) * DEPTH_RANGE;
}

/** Screen y a fighter at depth `y` stands on. */
export function groundAt(y: number): number {
  const far = ARENA.groundFarY;
  const near = ARENA.groundY;
  const lo = LANES.a.min;
  const hi = LANES.b.max;
  const t = (y - lo) / (hi - lo);
  return far + (near - far) * Math.max(0, Math.min(1, t));
}

/** Screen x of a world position under a camera. */
export function worldToScreen(x: number, camera: CameraFrame): number {
  return ARENA.centre.x + (x - camera.x) * ARENA.inner.w * camera.zoom;
}

const cache = new WeakMap<GauntletResult, CameraTrack>();

/**
 * Largest base size at which everything either fighter can ever draw still sits
 * inside the arena, given the widest the pair ever gets and the deepest either
 * ever stands.
 *
 * Solved from the run's own positions rather than from a worst case over the
 * whole unit square: the fighters visit a fraction of it, and budgeting for
 * places they never go costs real size on screen.
 */
function solveBaseSize(result: GauntletResult, round: number, minZoom = MIN_ZOOM): number {
  const opponent = result.team.members[round] ?? result.team.members[0]!;
  const far = {
    rest: spriteBounds(result.challenger.spriteId),
    motion: spriteMotionBounds(result.challenger.spriteId, true),
  };
  const near = {
    rest: spriteBounds(opponent.spriteId),
    motion: spriteMotionBounds(opponent.spriteId, true),
  };

  // The spread the pair actually spends its time at, not the widest it ever
  // reaches: the zoom absorbs the rest. Sizing for the widest moment made every
  // fighter 9% of frame height, because two fighters at a readable size plus
  // their travel simply do not fit in 924px at once.
  const spreads: number[] = [];
  let deepestFar: number = LANES.a.min;
  let deepestNear: number = LANES.b.min;
  for (const snap of result.snapshots) {
    if (snap.round !== round) continue;
    spreads.push(Math.abs(snap.opponent.x - snap.challenger.x));
    deepestFar = Math.max(deepestFar, snap.challenger.y);
    deepestNear = Math.max(deepestNear, snap.opponent.y);
  }
  spreads.sort((a, b) => a - b);
  const typical = spreads[Math.floor(spreads.length / 2)] ?? 0.25;

  // Horizontal: only the outer halves have to fit. The inner sides may cross —
  // the pair is staged in depth, the near fighter is drawn over the far one,
  // and that is how the reference reads at these sizes.
  const spanPx = typical * ARENA.inner.w;
  const outer = -far.motion.left * depthScale(deepestFar) + near.motion.right * depthScale(deepestNear);
  const byWidth = (ARENA.inner.w - PAD * 2 - spanPx) / outer;

  // Vertical: crown under the roof, collapse above the floor, on both lines.
  const limit = (side: typeof far, y: number): number => {
    const ground = groundAt(y);
    const scale = depthScale(y);
    const roof = (ground - ARENA.inner.y - VERTICAL_PAD) / ((side.rest.bottom - side.motion.top) * scale);
    const slump = side.motion.bottom - side.rest.bottom;
    const floor =
      slump > 0
        ? (ARENA.inner.y + ARENA.inner.h - ground - VERTICAL_PAD) / (slump * scale)
        : Number.POSITIVE_INFINITY;
    return Math.min(roof, floor);
  };
  // Checked at both ends of each lane: depth changes both the scale and the line.
  const byHeight = Math.min(
    limit(far, LANES.a.min),
    limit(far, LANES.a.max),
    limit(near, LANES.b.min),
    limit(near, LANES.b.max),
  );

  // The vertical solve has to survive the zoom pushing in: the camera can make
  // a fighter 12% taller than the base size after this is decided.
  const ceiling = byHeight / MAX_ZOOM;
  const fitted = Math.min(byWidth, ceiling);

  // ...and the height floor has to survive the zoom pulling *out*. Sizing off
  // the median spread alone let the widest moments drop a fighter to 21.3%.
  const shortest = Math.min(far.rest.height, near.rest.height);
  const shallowest = Math.min(depthScale(LANES.a.min), depthScale(LANES.b.min));
  const floorNeed =
    (HEIGHT * MIN_HEIGHT_SHARE * 1.04) / (shortest * minZoom * shallowest);
  return Math.max(1, Math.min(ceiling, Math.max(fitted, floorNeed)));
}

/** One pass of the lag, for a given set of base sizes. */
function walk(result: GauntletResult, baseSize: number[]): CameraFrame[] {
  const frames: CameraFrame[] = [];
  let camX = 0.5;
  let zoom = 1;
  for (const snap of result.snapshots) {
    const midpoint = (snap.challenger.x + snap.opponent.x) / 2;
    const size = baseSize[snap.round] ?? baseSize[0]!;
    const opponent = result.team.members[snap.round] ?? result.team.members[0]!;

    // Union of everything both fighters can draw, in world units at zoom 1.
    const sides = [
      { at: snap.challenger, sprite: result.challenger.spriteId },
      { at: snap.opponent, sprite: opponent.spriteId },
    ].map(({ at, sprite }) => {
      const box = spriteMotionBounds(sprite, true);
      const scaled = (depthScale(at.y) * size) / ARENA.inner.w;
      return { left: at.x + box.left * scaled, right: at.x + box.right * scaled };
    });
    const left = Math.min(...sides.map((s2) => s2.left));
    const right = Math.max(...sides.map((s2) => s2.right));
    const available = ARENA.inner.w - PAD * 2;

    // The zoom that exactly fits the union. Lagged on the way in, immediate on
    // the way out: a camera may take its time closing on the action, but it
    // must never let anything cross the wall while it catches up.
    const fit = available / Math.max(1, (right - left) * ARENA.inner.w);
    zoom += (Math.min(MAX_ZOOM, fit) - zoom) * ZOOM_LERP;
    // `fit` is absolute — it is the wall guarantee. MIN_ZOOM is only a
    // preference for how far back the shot sits, so it may never override it.
    zoom = Math.max(Math.min(MIN_ZOOM, fit), Math.min(zoom, fit));

    camX += (midpoint - camX) * PAN_LERP;
    // Centre the union when it is wider than the arena, otherwise nudge it in.
    const halfSpan = ((right - left) * ARENA.inner.w * zoom) / 2;
    const centre = (left + right) / 2;
    if (halfSpan >= available / 2) camX = centre;
    else {
      const slack = available / 2 - halfSpan;
      const offset = (centre - camX) * ARENA.inner.w * zoom;
      if (offset > slack) camX += (offset - slack) / (ARENA.inner.w * zoom);
      else if (offset < -slack) camX += (offset + slack) / (ARENA.inner.w * zoom);
    }

    frames.push({ x: camX, zoom });
  }
  return frames;
}

/**
 * Two passes, because the height floor and the zoom depend on each other: the
 * base size sets how wide the pair draws, which sets how far the camera has to
 * pull back, which sets how short the fighters end up. The first pass measures
 * how far back the shot actually goes; the second sizes the fighters so the
 * floor holds even there.
 */
export function cameraTrack(result: GauntletResult): CameraTrack {
  const cached = cache.get(result);
  if (cached) return cached;

  const rounds = result.team.members.map((_, round) => round);
  let baseSize = rounds.map((round) => solveBaseSize(result, round));
  let frames = walk(result, baseSize);

  // Three passes: raising the base widens the pair, which pulls the camera
  // back, which lowers the floor again. It settles quickly, but one pass lands
  // a hair short and leaves a handful of frames under the floor.
  for (let pass = 0; pass < 2; pass += 1) {
    const lowest = rounds.map(() => 1);
    result.snapshots.forEach((snap, i) => {
      const z = frames[i]?.zoom ?? 1;
      if (z < (lowest[snap.round] ?? 1)) lowest[snap.round] = z;
    });
    baseSize = rounds.map((round) => solveBaseSize(result, round, lowest[round] ?? MIN_ZOOM));
    frames = walk(result, baseSize);
  }

  const track: CameraTrack = { frames, baseSize };
  cache.set(result, track);
  return track;
}

/** Band the damage numbers may occupy: under the HP widgets, inside the arena. */
export const NUMBER_CEILING =
  HP_WIDGET_SLOTS.y + HP_WIDGET.height + Math.round(HEIGHT * 0.008);
