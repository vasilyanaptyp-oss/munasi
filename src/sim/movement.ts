import type { Rng } from "./rng.js";
import { TICKS_PER_SECOND } from "./types.js";

/**
 * Where the fighters are, tick by tick.
 *
 * Until this existed the simulation was a race between two numbers and the
 * renderer stood the figures in fixed slots, so a finished video changed 3% of
 * its pixels per frame against the reference channel's 12.7% and held a fifth
 * of its frames completely still. No composition rule catches that: the frame
 * is laid out correctly, it simply is not moving.
 *
 * The arena here is an abstract unit square — `x` runs left to right, `y` runs
 * from the far side to the near one. Nothing in this file knows how big the
 * arena is on screen or where it sits; the renderer maps these into the two
 * ground lines it already draws.
 *
 * **Position does not decide damage, so it follows the schedule instead.** The
 * attack cadence is driven by the cooldown alone, exactly as before, and the
 * lunge is locked to it: a fighter's distance to its opponent bottoms out on
 * the frame its own blow lands. That keeps a calibrated roster calibrated — an
 * outcome cannot depend on whether someone walked fast enough — and it also
 * makes a swing readable, because the step and the hit are the same event.
 *
 * The two sides run on their own periods, so the gap widens whenever either
 * one is between swings. What they share is the anchor: the engagement drifts
 * across the arena as one thing. Giving each fighter its own drift was the
 * first version and it let the two wander half an arena apart — 8.9% of damage
 * events landed with the pair further than 1.4 mean widths from each other.
 */

/** Lateral gap at which a blow lands. */
const STRIKE_GAP = 0.11;
/** Lateral gap a fighter falls back to right after swinging. */
const BACK_GAP = 0.30;
/** Units per tick, for the parts that are rate-limited rather than exact. */
const SPEED = 0.0095;
/** Depth is a slower drift than the lateral dance. */
const DEPTH_SPEED = 0.0032;
/** Ticks a fighter holds one sideways offset before drawing another. */
const STRAFE_TICKS = 46;
/** Sideways offset a fighter may hold. Small: it must not undo the lunge. */
const STRAFE_RANGE = 0.035;
/**
 * How far, and how often, the engagement as a whole wanders across the arena.
 *
 * Shared by both fighters — see the note at the top. This is also what the
 * camera follows: the pair swings in and out on its own periods, which mostly
 * cancels at the midpoint, so without a drift the shot has nothing to track.
 */
const DRIFT_RANGE = 0.24;
const DRIFT_TICKS = 150;

/** Depth band each side lives in. They never trade places. */
export const LANES = {
  a: { min: 0.14, max: 0.4 },
  b: { min: 0.6, max: 0.86 },
} as const;

/** Where the fight as a whole is standing. One of these per match. */
export interface EngagementState {
  anchor: number;
  target: number;
  repickAtTick: number;
}

export function initialEngagement(): EngagementState {
  return { anchor: 0.5, target: 0.5, repickAtTick: 0 };
}

export function stepEngagement(state: EngagementState, tick: number, rng: Rng): void {
  if (tick >= state.repickAtTick) {
    state.target = 0.5 + rng.range(-DRIFT_RANGE / 2, DRIFT_RANGE / 2);
    state.repickAtTick = tick + DRIFT_TICKS;
  }
  state.anchor = approach(state.anchor, state.target, SPEED * 0.7);
}

export interface MovementState {
  x: number;
  y: number;
  /** Sideways offset this fighter is holding this beat. */
  strafe: number;
  targetY: number;
  repickAtTick: number;
}

export function initialMovement(side: "a" | "b"): MovementState {
  const lane = LANES[side];
  const y = (lane.min + lane.max) / 2;
  const x = side === "a" ? 0.5 - BACK_GAP / 2 : 0.5 + BACK_GAP / 2;
  return { x, y, strafe: 0, targetY: y, repickAtTick: 0 };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function approach(current: number, target: number, speed: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= speed) return target;
  return current + Math.sign(delta) * speed;
}

export interface MovementInput {
  side: "a" | "b";
  /** Ticks until this fighter's next basic attack. */
  attackCooldown: number;
  /** Ticks between this fighter's attacks. */
  attackInterval: number;
  /** Where the engagement is standing, shared by both sides. */
  anchor: number;
  tick: number;
  rng: Rng;
}

/**
 * Advances one fighter by a tick.
 *
 * The gap to the centre closes linearly as the cooldown runs down and snaps
 * back the moment the blow lands, so the closest point of the whole cycle is
 * the frame of the hit. It is set rather than eased toward: easing caps the
 * speed, and a capped fighter arrives late, which is exactly the fault this
 * replaces. There is no branch where the fighter holds position.
 */
export function stepMovement(state: MovementState, input: MovementInput): void {
  const lane = LANES[input.side];
  const home = input.side === "a" ? -1 : 1;

  if (input.tick >= state.repickAtTick) {
    state.strafe = input.rng.range(-STRAFE_RANGE, STRAFE_RANGE);
    state.targetY = input.rng.range(lane.min, lane.max);
    state.repickAtTick = input.tick + STRAFE_TICKS;
  }

  // 0 on the frame the blow lands, 1 just after the previous one.
  const interval = Math.max(1, input.attackInterval);
  const untilSwing = clamp(Math.max(0, input.attackCooldown - 1) / interval, 0, 1);
  const gap = STRIKE_GAP + (BACK_GAP - STRIKE_GAP) * untilSwing;

  state.x = clamp(input.anchor + home * (gap / 2) + state.strafe, 0.06, 0.94);
  state.y = clamp(approach(state.y, state.targetY, DEPTH_SPEED), lane.min, lane.max);
}

/** Longest a fighter may hold still, in video frames. */
export const MAX_STILL_FRAMES = 10;
/** Same, in ticks. */
export const MAX_STILL_TICKS = MAX_STILL_FRAMES * (TICKS_PER_SECOND / 30);
