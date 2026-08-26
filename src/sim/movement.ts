import type { Rng } from "./rng.js";

/**
 * Where the fighters are, tick by tick. **They bounce.**
 *
 * Each fighter carries a position and a velocity in the arena's unit square,
 * travels in a straight line, and reflects off the walls. Nothing pulls the two
 * together and nothing ties movement to the attack schedule: they cross the
 * whole arena, pass over each other, and end up on opposite sides from where
 * they started. Traced frame by frame in the reference, the two fighters swap
 * sides completely over a fight.
 *
 * The previous model had them approach each other and lunge on the beat of
 * their own cooldown. That was wrong, and wrong in a way no measurement caught,
 * because it produced motion — just not this motion.
 *
 * **Movement decides nothing.** Damage comes from the attack schedule alone, at
 * whatever distance the pair happens to be. So the roster stays calibrated no
 * matter how the bouncing goes, and a fighter is never punished for its speed.
 *
 * The arena here is an abstract unit square. Nothing in this file knows how big
 * it is on screen; the renderer projects it.
 */

/**
 * Half the height a fighter occupies, as a share of the arena.
 *
 * This is a contract with the renderer, not a hint: the simulation keeps a
 * fighter's centre far enough from the wall that a figure of this size stays
 * inside, and the renderer draws it at exactly this size.
 *
 * **Measured by `pnpm compare`, and the hand measurement it replaces was
 * wrong.** The note here used to say the reference stands its fighters at
 * 20-35% of the arena's height, read off a still, and 0.14 (28%) was picked to
 * sit inside that. The tool now finds a fighter under his own HP plus and
 * measures him in both files with the same code; checked against a known answer
 * first, it reports 0.281 on our own videos for a coded 0.28. On the reference
 * it reports **0.351-0.375**, in two different videos. Its figures are a
 * quarter to a third *bigger* relative to the arena than ours were.
 *
 * 0.18 puts us at 0.36, and it lands three separate measurements at once
 * without touching anything else: the fight runs 19.6s against the reference's
 * 18.5-19.0 (it was 22.9), and the median damage number goes 63 -> 71 with a
 * p90 of 120 against the reference's 75-120. That is the conservation law
 * working for us for once — a fighter's whole output is pinned to the other
 * man's 1000 HP, so a shorter fight is a bigger number on screen.
 *
 * This is also the answer to "может даже карту побольше". The arena is already
 * the reference's to within two pixels; what was off was the man standing in it.
 */
export const FIGHTER_HALF_HEIGHT = 0.18;

/**
 * Units per tick. Two ticks to a video frame.
 *
 * **Measured against the reference by `pnpm compare`, which tracks each
 * fighter's own HP plus across the frames.** The reference's fighters travel a
 * median 0.0095-0.0103 of the arena per video frame; ours were doing
 * 0.0118-0.0135, a fifth to a third faster, and the owner's word for it was
 * that they move too fast — which they did.
 *
 * The earlier number in this comment said the reference ran at 0.0146 and was
 * wrong in the same way the arena's resting height was wrong: measured by hand,
 * once, off one video. Both fell to the same tool.
 *
 * Speed is not only a look. Two figures crossing faster meet more often, and
 * since every meeting lands a blow, how often they meet is how many numbers a
 * fight has — and a fight's damage is fixed by the other man's thousand health,
 * so more numbers is smaller numbers. Slowing them down buys number size back;
 * `GAUNTLET_TUNING.tempo` then holds the length where it was.
 */
const SPEED_MIN = 0.00472;
const SPEED_MAX = 0.00762;

export interface MovementState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Half-width as a share of the arena, from the sprite's aspect ratio. */
  halfW: number;
  halfH: number;
  /**
   * The figure's outline: `[left, right]` per band, top to bottom, as fractions
   * of the sprite's width. This is what the pair collide on — see
   * `outlineOverlap`. A fighter with no profile gets one solid band, which is
   * the old bounding box.
   */
  silhouette: readonly (readonly [number, number])[];
  /** Tick until which this fighter is held still — see `NOBODY MOVES`. */
  frozenUntilTick: number;
  /** Tick until which this fighter travels at `dashMul` speed — see `HAYMAKER`. */
  dashUntilTick: number;
  dashMul: number;
  /** Does this dash steer itself at the other fighter? A charge does; a throw does not. */
  dashHoming: boolean;
}

export interface MovementInput {
  /** Ticks since the round began, for the drift that keeps a fight from looping. */
  tick: number;
  rng: Rng;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Sub-pixel guard between a fighter's box and the wall.
 *
 * The sprite is drawn at exactly the box the simulation bounces, so a fighter
 * resting against a wall sits at *precisely* the inner edge, and the layout gate
 * — which rounds to screen pixels — then catches him a few ten-thousandths of a
 * pixel outside it. This is one pixel of a 1080-wide frame, expressed in arena
 * units: enough that "touching the wall" is unambiguously inside it, small
 * enough to be invisible.
 *
 * It replaces a 0.012 margin that existed for a real reason — the white keyline
 * was drawn pixels and stuck out past the figure — which stopped being a reason
 * when the keyline turned out not to be in the reference at all.
 */
const WALL_GUARD = 1 / 1149;

/** Holds a fighter's box inside the arena walls. */
function keepInside(state: MovementState): void {
  state.x = clamp(state.x, state.halfW + WALL_GUARD, 1 - state.halfW - WALL_GUARD);
  state.y = clamp(state.y, state.halfH + WALL_GUARD, 1 - state.halfH - WALL_GUARD);
}

/**
 * How far a heading must stay from the axes, as a share of a quarter turn.
 *
 * A fighter travelling nearly horizontally only ever reaches the side walls, and
 * a side wall reflects `vx` and leaves `vy` alone — so once a heading is flat it
 * has no way back. The wobble on each bounce is a random walk with a wall at
 * neither end, and flat is where it ends up: **measured on a shipped video, our
 * fighters were moving at |vx| 0.0147 against |vy| 0.0016 per frame, which is a
 * figure sliding left and right along one line.** The reference's are the other
 * way round, 0.0082 against 0.0114 — more vertical than horizontal, because the
 * arena is wider than the frame and up-and-down is the travel you can see.
 *
 * `initialMovement` already refused to *start* on a flat heading. The band has
 * to hold for the whole fight, not just the first tick.
 */
const HEADING_MIN = 0.22;
const HEADING_MAX = 0.78;

/**
 * Nearest heading to `heading` that is not within the flat or vertical band.
 *
 * Works on the angle inside its own quadrant, so all four are treated alike and
 * a reflection off any wall keeps its direction.
 */
function steerHeading(heading: number): number {
  const quarter = Math.PI / 2;
  const inQuadrant = ((heading % quarter) + quarter) % quarter;
  const clamped = clamp(inQuadrant, HEADING_MIN * quarter, HEADING_MAX * quarter);
  return heading + (clamped - inQuadrant);
}

/**
 * Starting corner, heading and speed.
 *
 * `aspect` is width over height of the fighter's cut-out, so a wide figure gets
 * a wide box and bounces off the side walls sooner — which is the correct
 * behaviour and free, since the box is what is drawn.
 */
export function initialMovement(
  side: "a" | "b",
  aspect: number,
  rng: Rng,
  silhouette: readonly (readonly [number, number])[] = [[0, 1]],
): MovementState {
  const halfH = FIGHTER_HALF_HEIGHT;
  const halfW = FIGHTER_HALF_HEIGHT * aspect;
  // The two start on opposite sides, so frame 0 reads as a face-off.
  const x = side === "a" ? halfW + 0.08 : 1 - halfW - 0.08;
  const y = rng.range(halfH, 1 - halfH);

  // A heading that is never near-vertical or near-horizontal: a fighter that
  // only slides up and down never crosses the arena, and the crossing is the
  // whole point. `steerHeading` holds this for the rest of the fight.
  const quarter = rng.range(HEADING_MIN, HEADING_MAX) * (Math.PI / 2);
  const speed = rng.range(SPEED_MIN, SPEED_MAX);
  const towards = side === "a" ? 1 : -1;
  return {
    x,
    y,
    vx: Math.cos(quarter) * speed * towards,
    vy: Math.sin(quarter) * speed * (rng.chance(0.5) ? 1 : -1),
    halfW,
    halfH,
    silhouette,
    frozenUntilTick: 0,
    dashUntilTick: 0,
    dashMul: 1,
    dashHoming: false,
  };
}

/**
 * One tick of travel, reflecting off the arena walls.
 *
 * The reflection is a mirror, not a random redirect: it has to look like a ball,
 * and a viewer notices immediately when it does not. The position is clamped as
 * well as reflected so a fighter cannot tunnel through a wall on a slow frame.
 */
export function stepMovement(state: MovementState, input: MovementInput): void {
  // Held in place by `NOBODY MOVES`. Kept here rather than in the caller so the
  // freeze cannot be forgotten by one of them.
  if (input.tick < state.frozenUntilTick) return;

  // A dash multiplies travel for a short window without changing the stored
  // velocity, so the fighter carries on at his own speed once it expires.
  const dash = input.tick < state.dashUntilTick ? state.dashMul : 1;
  state.x += state.vx * dash;
  state.y += state.vy * dash;

  const left = state.halfW + WALL_GUARD;
  const right = 1 - state.halfW - WALL_GUARD;
  const top = state.halfH + WALL_GUARD;
  const bottom = 1 - state.halfH - WALL_GUARD;

  if (state.x <= left) {
    state.x = left;
    state.vx = Math.abs(state.vx);
  } else if (state.x >= right) {
    state.x = right;
    state.vx = -Math.abs(state.vx);
  }
  if (state.y <= top) {
    state.y = top;
    state.vy = Math.abs(state.vy);
  } else if (state.y >= bottom) {
    state.y = bottom;
    state.vy = -Math.abs(state.vy);
  }

  // A hair of drift on every bounce, so a fight never settles into a loop that
  // retraces the same diagonal for thirty seconds — steered back out of the
  // flat and vertical bands afterwards, because the drift on its own is a random
  // walk that ends against a wall it cannot leave. See `steerHeading`.
  if (state.x === left || state.x === right || state.y === top || state.y === bottom) {
    const wobble = input.rng.range(-0.06, 0.06);
    const speed = Math.hypot(state.vx, state.vy);
    const heading = steerHeading(Math.atan2(state.vy, state.vx) + wobble);
    state.vx = Math.cos(heading) * speed;
    state.vy = Math.sin(heading) * speed;
  }

  state.x = clamp(state.x, left, right);
  state.y = clamp(state.y, top, bottom);
}

/**
 * The band of a fighter's outline that a given height falls in, as world
 * coordinates: the left and right edge of the figure at that height.
 *
 * Returns `null` for a band with nothing in it — above a head, beside a pair of
 * ankles — which is exactly the air that a bounding box used to treat as solid.
 */
function bandSpan(
  state: MovementState,
  band: number,
): { left: number; right: number } | null {
  const rows = state.silhouette;
  const row = rows[band];
  if (!row || row[1] <= row[0]) return null;
  // The profile spans the sprite, and since the white keyline went, the sprite
  // is everything the renderer puts on screen — no margin to add.
  const originX = state.x - state.halfW;
  return {
    left: originX + 2 * state.halfW * row[0],
    right: originX + 2 * state.halfW * row[1],
  };
}

/** World y of the top and bottom edge of one band of a fighter's outline. */
function bandEdges(state: MovementState, band: number): { top: number; bottom: number } {
  const originY = state.y - state.halfH;
  const step = (2 * state.halfH) / state.silhouette.length;
  return {
    top: originY + step * band,
    bottom: originY + step * (band + 1),
  };
}

/**
 * How deep two fighters are into each other, measured on their outlines.
 *
 * Returns the horizontal overlap of the *widest* pair of bands that actually
 * meet, together with the vertical overlap of the two figures. Separating by
 * the first clears the widest place they touch; separating by the second lifts
 * one clear of the other entirely. Nothing meeting means `null`.
 *
 * This replaces a bounding box scaled by a hand-set share (0.75, then 0.5,
 * chosen by how the fights felt). A single share is the wrong shape in both
 * directions at once — narrower than a man across his shoulders, wider than him
 * beside his head — so two photographs would either stop with a visible strip of
 * blue between them or slide through each other at the ankles. It was also
 * carrying a second job it had no business having: how often the pair meet, and
 * therefore, since every meeting lands a blow, how big a number can be.
 */
function outlineOverlap(
  a: MovementState,
  b: MovementState,
): { x: number; y: number } | null {
  // Cheap rejection on the full boxes first: most ticks are not a collision.
  const spanY = Math.min(a.y + a.halfH, b.y + b.halfH) - Math.max(a.y - a.halfH, b.y - b.halfH);
  if (spanY <= 0) return null;
  if (Math.min(a.x + a.halfW, b.x + b.halfW) - Math.max(a.x - a.halfW, b.x - b.halfW) <= 0) {
    return null;
  }

  let deepest = 0;
  for (let i = 0; i < a.silhouette.length; i += 1) {
    const aSpan = bandSpan(a, i);
    if (!aSpan) continue;
    const aEdges = bandEdges(a, i);
    for (let j = 0; j < b.silhouette.length; j += 1) {
      const bEdges = bandEdges(b, j);
      // Bands are stacked top to bottom, so once b's band starts below a's
      // ends, every later one does too.
      if (bEdges.top >= aEdges.bottom) break;
      if (bEdges.bottom <= aEdges.top) continue;
      const bSpan = bandSpan(b, j);
      if (!bSpan) continue;
      const overlap = Math.min(aSpan.right, bSpan.right) - Math.max(aSpan.left, bSpan.left);
      if (overlap > deepest) deepest = overlap;
    }
  }
  return deepest > 0 ? { x: deepest, y: spanY } : null;
}

/**
 * Half-extents of the widest band of a fighter's outline, for callers that need
 * one number instead of a profile — the gates, and the measuring scripts.
 */
export function widestHalfWidth(state: MovementState): number {
  let widest = 0;
  for (const [left, right] of state.silhouette) {
    if (right - left > widest) widest = right - left;
  }
  return state.halfW * widest;
}

/**
 * Two fighters cannot occupy the same place: they push off each other.
 *
 * An equal-mass elastic bounce along whichever axis they are least deep into
 * each other, which is what a box collision looks like when it looks right —
 * meeting head on sends them back the way they came, clipping a corner sends
 * them past each other. They are then separated by exactly the overlap, so the
 * next tick starts clear and the pair cannot weld together and drift as one.
 *
 * A frozen fighter (`NOBODY MOVES`) is an immovable object: it neither moves nor
 * trades velocity, and the other one takes the whole bounce. Anything else makes
 * a freeze cancellable by walking into it.
 */
export function resolveCollision(
  a: MovementState,
  b: MovementState,
  tick: number,
): Contact | null {
  const aFrozen = tick < a.frozenUntilTick;
  const bFrozen = tick < b.frozenUntilTick;
  if (aFrozen && bFrozen) return null;

  const overlap = outlineOverlap(a, b);
  if (overlap === null) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const overlapX = overlap.x;
  const overlapY = overlap.y;

  // Push apart along the shallower axis: that is the face they actually met on.
  const horizontal = overlapX < overlapY;
  const push = horizontal ? overlapX : overlapY;
  // `dx === 0` on a dead-centre overlap; pick a side rather than divide by zero.
  const sign = horizontal ? (dx < 0 ? -1 : 1) : dy < 0 ? -1 : 1;

  // Separation. An immovable fighter donates its share of the push to the other.
  const aShare = aFrozen ? 0 : bFrozen ? 1 : 0.5;
  const bShare = bFrozen ? 0 : aFrozen ? 1 : 0.5;
  if (horizontal) {
    a.x -= sign * push * aShare;
    b.x += sign * push * bShare;
  } else {
    a.y -= sign * push * aShare;
    b.y += sign * push * bShare;
  }

  // The push runs after `stepMovement` has already clamped, so it can shove a
  // fighter that was against a wall straight through it. Clamp again. Being
  // pressed back into the other one for a tick is fine — the wall wins, and the
  // pair separates on the next tick once the velocities have been exchanged.
  keepInside(a);
  keepInside(b);

  // Where they actually met, halfway between the two centres along the axis they
  // met on. The renderer draws the impact here, so a viewer sees the blow land
  // between the two figures rather than a number appearing out of nowhere.
  const contact: Contact = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, closing: false };

  // Equal masses exchange the component along the axis of contact. Only if they
  // are closing: two figures already separating must not be flung back together.
  if (horizontal) {
    if ((b.vx - a.vx) * sign >= 0) return contact;
    contact.closing = true;
    if (aFrozen) b.vx = -b.vx;
    else if (bFrozen) a.vx = -a.vx;
    else {
      const swap = a.vx;
      a.vx = b.vx;
      b.vx = swap;
    }
  } else {
    if ((b.vy - a.vy) * sign >= 0) return contact;
    contact.closing = true;
    if (aFrozen) b.vy = -b.vy;
    else if (bFrozen) a.vy = -a.vy;
    else {
      const swap = a.vy;
      a.vy = b.vy;
      b.vy = swap;
    }
  }
  // An exchange trades one component and leaves the other, so two fighters who
  // meet often can hand each other a flat heading the same way the wall wobble
  // used to. Same band, same reason.
  steer(a);
  steer(b);
  return contact;
}

/** Re-aims a velocity out of the flat and vertical bands, keeping its speed. */
function steer(state: MovementState): void {
  const speed = Math.hypot(state.vx, state.vy);
  if (speed === 0) return;
  const heading = steerHeading(Math.atan2(state.vy, state.vx));
  state.vx = Math.cos(heading) * speed;
  state.vy = Math.sin(heading) * speed;
}

/**
 * A meeting between the two fighters.
 *
 * `closing` marks the tick they actually ran into each other, as opposed to the
 * ticks afterwards where they are still overlapping but already moving apart.
 * That first tick is the blow; the rest are follow-through.
 */
export interface Contact {
  x: number;
  y: number;
  closing: boolean;
}

/**
 * Do these two overlap on their outlines right now?
 *
 * Exported so the gates and the measuring scripts ask the simulation itself
 * rather than keeping their own copy of the rule. Both have been wrong that way
 * before — a gate asserting on a box nobody collided with any more, and a
 * measuring script that counted near-misses as touches and reported the
 * registration rate too low because of it.
 */
export function outlinesOverlap(a: MovementState, b: MovementState): boolean {
  return outlineOverlap(a, b) !== null;
}

/**
 * Rewrites everyone's heading to one direction — Compass Guy's `MAGNETIC NORTH`.
 *
 * Lives here because it is a movement effect and movement is this file's job.
 * The speed is kept and only the heading changes, so nobody is sped up by being
 * pointed at a wall.
 */
export function setHeading(state: MovementState, heading: number): void {
  const speed = Math.hypot(state.vx, state.vy);
  state.vx = Math.cos(heading) * speed;
  state.vy = Math.sin(heading) * speed;
}

/**
 * Sends a fighter at something, fast, for a moment — Boxer Guy closing the
 * distance for `HAYMAKER`.
 *
 * He is a boxer: he does not throw his gloves across the arena, he gets in
 * range and hits you. So the ability moves *him*, and the punch lands when he
 * arrives.
 */
export function dash(
  state: MovementState,
  heading: number,
  mul: number,
  untilTick: number,
  homing = false,
): void {
  setHeading(state, heading);
  state.dashMul = mul;
  state.dashUntilTick = untilTick;
  state.dashHoming = homing;
}

/** Stops a fighter dead — Bodyguard Guy's `NOBODY MOVES`, and his own stance. */
export function halt(state: MovementState): void {
  state.vx = 0;
  state.vy = 0;
}

/** Longest a fighter may hold still, in video frames. */
export const MAX_STILL_FRAMES = 10;
