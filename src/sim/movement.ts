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
 * inside, and the renderer draws it at exactly this size. Measured off the
 * reference, a fighter is a bit over a third of the arena tall.
 */
export const FIGHTER_HALF_HEIGHT = 0.18;

/**
 * Margin the bounce box carries beyond the figure itself.
 *
 * The renderer traces every fighter with a white keyline, and a keyline is drawn
 * pixels like any other. Without this the figure stayed inside the wall and its
 * outline did not — 22 frames of one video, which is exactly the class of defect
 * the wall guarantee exists to prevent.
 */
const KEYLINE_MARGIN = 0.012;

/** Units per tick. The reference crosses its arena in roughly four seconds. */
const SPEED_MIN = 0.0026;
const SPEED_MAX = 0.0042;

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

  state.x += state.vx;
  state.y += state.vy;

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

/** Stops a fighter dead — Bodyguard Guy's `NOBODY MOVES`, and his own stance. */
export function halt(state: MovementState): void {
  state.vx = 0;
  state.vy = 0;
}

/** Longest a fighter may hold still, in video frames. */
export const MAX_STILL_FRAMES = 10;
