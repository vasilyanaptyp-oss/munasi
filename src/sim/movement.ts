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
 * Measured off the reference: a fighter stands 20-35% of the arena's height,
 * so 0.15 here (30% of the arena) sits in the middle of that. It was 0.18 — 36%
 * of the arena, above the reference's whole range — and since the arena has
 * just grown to its measured size, keeping it there would have scaled the
 * fighters up with it and left the map looking exactly as small as before. A
 * bigger map is a bigger *gap between the figures*, not a bigger everything.
 */
export const FIGHTER_HALF_HEIGHT = 0.15;

/**
 * Margin the bounce box carries beyond the figure itself.
 *
 * The renderer traces every fighter with a white keyline, and a keyline is drawn
 * pixels like any other. Without this the figure stayed inside the wall and its
 * outline did not — 22 frames of one video, which is exactly the class of defect
 * the wall guarantee exists to prevent.
 */
const KEYLINE_MARGIN = 0.012;

/**
 * Units per tick.
 *
 * Set by sweeping speed against how often the two actually meet, because
 * meeting is what deals damage now. Too slow and the video has dead stretches
 * with nobody touching; the reference never goes longer than 4.87s without a
 * blow, and at the old speed ours ran to 7.6s.
 */
const SPEED_MIN = 0.00663;
const SPEED_MAX = 0.01071;

export interface MovementState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Half-width as a share of the arena, from the sprite's aspect ratio. */
  halfW: number;
  halfH: number;
  /** Tick until which this fighter is held still — see `NOBODY MOVES`. */
  frozenUntilTick: number;
  /** Tick until which this fighter travels at `dashMul` speed — see `HAYMAKER`. */
  dashUntilTick: number;
  dashMul: number;
}

export interface MovementInput {
  /** Ticks since the round began, for the drift that keeps a fight from looping. */
  tick: number;
  rng: Rng;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Holds a fighter's box inside the arena walls. */
function keepInside(state: MovementState): void {
  state.x = clamp(state.x, state.halfW, 1 - state.halfW);
  state.y = clamp(state.y, state.halfH, 1 - state.halfH);
}

/**
 * Starting corner, heading and speed.
 *
 * `aspect` is width over height of the fighter's cut-out, so a wide figure gets
 * a wide box and bounces off the side walls sooner — which is the correct
 * behaviour and free, since the box is what is drawn.
 */
export function initialMovement(side: "a" | "b", aspect: number, rng: Rng): MovementState {
  const halfH = FIGHTER_HALF_HEIGHT + KEYLINE_MARGIN;
  const halfW = FIGHTER_HALF_HEIGHT * aspect + KEYLINE_MARGIN;
  // The two start on opposite sides, so frame 0 reads as a face-off.
  const x = side === "a" ? halfW + 0.08 : 1 - halfW - 0.08;
  const y = rng.range(halfH, 1 - halfH);

  // A heading that is never near-vertical or near-horizontal: a fighter that
  // only slides up and down never crosses the arena, and the crossing is the
  // whole point.
  const quarter = rng.range(0.22, 0.78) * (Math.PI / 2);
  const speed = rng.range(SPEED_MIN, SPEED_MAX);
  const towards = side === "a" ? 1 : -1;
  return {
    x,
    y,
    vx: Math.cos(quarter) * speed * towards,
    vy: Math.sin(quarter) * speed * (rng.chance(0.5) ? 1 : -1),
    halfW,
    halfH,
    frozenUntilTick: 0,
    dashUntilTick: 0,
    dashMul: 1,
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

  const left = state.halfW;
  const right = 1 - state.halfW;
  const top = state.halfH;
  const bottom = 1 - state.halfH;

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
  // retraces the same diagonal for thirty seconds.
  if (state.x === left || state.x === right || state.y === top || state.y === bottom) {
    const wobble = input.rng.range(-0.06, 0.06);
    const speed = Math.hypot(state.vx, state.vy);
    const heading = Math.atan2(state.vy, state.vx) + wobble;
    state.vx = Math.cos(heading) * speed;
    state.vy = Math.sin(heading) * speed;
  }

  state.x = clamp(state.x, left, right);
  state.y = clamp(state.y, top, bottom);
}

/**
 * Share of the drawn box that is solid.
 *
 * The bounce box is the whole photograph, and a photograph is mostly air at its
 * corners: an outstretched arm, a guitar neck, the gap under a raised elbow.
 * Colliding on the full box keeps two figures a visible margin apart at all
 * times and reads as an invisible wall between them. Colliding on the core lets
 * the edges overlap the way they do in the reference — traced frame by frame,
 * the guitarist's neck crosses the other man's jacket repeatedly — while the two
 * bodies never sit on top of each other, which is the thing that looked broken.
 */
const COLLISION_SHARE = 0.75;

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

  const halfWs = (a.halfW + b.halfW) * COLLISION_SHARE;
  const halfHs = (a.halfH + b.halfH) * COLLISION_SHARE;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const overlapX = halfWs - Math.abs(dx);
  const overlapY = halfHs - Math.abs(dy);
  if (overlapX <= 0 || overlapY <= 0) return null;

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
  return contact;
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

/** Half-extents the collision actually uses, for the gate to assert against. */
export function collisionHalfExtents(
  a: MovementState,
  b: MovementState,
): { halfW: number; halfH: number } {
  return {
    halfW: (a.halfW + b.halfW) * COLLISION_SHARE,
    halfH: (a.halfH + b.halfH) * COLLISION_SHARE,
  };
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
export function dash(state: MovementState, heading: number, mul: number, untilTick: number): void {
  setHeading(state, heading);
  state.dashMul = mul;
  state.dashUntilTick = untilTick;
}

/** Stops a fighter dead — Bodyguard Guy's `NOBODY MOVES`, and his own stance. */
export function halt(state: MovementState): void {
  state.vx = 0;
  state.vy = 0;
}

/** Longest a fighter may hold still, in video frames. */
export const MAX_STILL_FRAMES = 10;
