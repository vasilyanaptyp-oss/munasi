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
 * **Position does not decide damage.** The attack schedule is still driven by
 * the cooldown alone, exactly as before, and the movement is choreographed
 * *to* that schedule: a fighter times its approach so it arrives at striking
 * distance as the cooldown comes up. That keeps a calibrated roster calibrated
 * — a fight's outcome cannot depend on whether someone walked fast enough —
 * while putting real travel on screen.
 */

/** Lateral gap at which a blow lands. */
const STRIKE_GAP = 0.12;
/** Lateral gap a fighter falls back to between swings. */
const BACK_GAP = 0.26;
/** Units per tick. About 17px a frame across a 924px arena. */
const SPEED = 0.0095;
/** Depth is a slower drift than the lateral dance. */
const DEPTH_SPEED = 0.0032;
/** Ticks a fighter holds one strafe choice before picking another. */
const STRAFE_TICKS = 46;
/**
 * Ticks in one close-and-break cycle.
 *
 * Deliberately independent of the attack cadence. Tying it to the cooldown was
 * the first attempt and it degenerated the moment the attack rate went up:
 * "about to swing" became permanently true, both fighters parked at striking
 * distance, and the picture froze — which is the exact fault this file exists
 * to fix.
 */
const CYCLE_TICKS = 84;
/** The two sides run half a cycle apart, so one advances as the other gives. */
const PHASE_OFFSET = { a: 0, b: 0.5 } as const;
/**
 * How far, and how often, the whole engagement wanders across the arena.
 *
 * This is what the camera actually follows. The two fighters swing in
 * antiphase — one closes as the other gives — so the midpoint between them
 * barely moves, and a camera locked to it sits still however busy the pair is.
 * Drifting the engagement itself is what puts the background in motion.
 */
const DRIFT_RANGE = 0.26;
const DRIFT_TICKS = 150;

/** Depth band each side lives in. They never trade places. */
export const LANES = {
  a: { min: 0.14, max: 0.4 },
  b: { min: 0.6, max: 0.86 },
} as const;

export interface MovementState {
  x: number;
  y: number;
  /** Lateral offset this fighter is holding this beat. */
  strafe: number;
  targetY: number;
  repickAtTick: number;
  /** Where the engagement as a whole is standing. */
  anchor: number;
  anchorTarget: number;
  anchorAtTick: number;
}

export function initialMovement(side: "a" | "b"): MovementState {
  const lane = LANES[side];
  const y = (lane.min + lane.max) / 2;
  const x = side === "a" ? 0.5 - BACK_GAP / 2 : 0.5 + BACK_GAP / 2;
  return {
    x,
    y,
    strafe: 0,
    targetY: y,
    repickAtTick: 0,
    anchor: 0.5,
    anchorTarget: 0.5,
    anchorAtTick: 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function approach(current: number, target: number, speed: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= speed) return target;
  return current + Math.sign(delta) * speed;
}

/** Triangle wave in 0..1. Constant speed, so the fighter is never still. */
function triangle(phase: number): number {
  const t = phase - Math.floor(phase);
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

export interface MovementInput {
  side: "a" | "b";
  /** Ticks until this fighter's next basic attack. */
  attackCooldown: number;
  /** Ticks between this fighter's attacks, for pacing the approach. */
  attackInterval: number;
  /** Lateral position of the opponent. */
  opponentX: number;
  tick: number;
  rng: Rng;
}

/**
 * Advances one fighter by a tick.
 *
 * The cycle is: close in, land the blow, fall back, slide sideways, close in
 * again — a triangle wave on the gap, so there is no branch where the fighter
 * stands still. The whole engagement also drifts across the arena so the camera
 * has something to follow.
 */
export function stepMovement(state: MovementState, input: MovementInput): void {
  const lane = LANES[input.side];
  const home = input.side === "a" ? -1 : 1;

  if (input.tick >= state.repickAtTick) {
    state.strafe = input.rng.range(-0.07, 0.07);
    state.targetY = input.rng.range(lane.min, lane.max);
    state.repickAtTick = input.tick + STRAFE_TICKS;
  }
  if (input.tick >= state.anchorAtTick) {
    state.anchorTarget = 0.5 + input.rng.range(-DRIFT_RANGE, DRIFT_RANGE);
    state.anchorAtTick = input.tick + DRIFT_TICKS;
  }
  state.anchor = approach(state.anchor, state.anchorTarget, SPEED * 0.7);

  const phase = input.tick / CYCLE_TICKS + PHASE_OFFSET[input.side];
  const gap = STRIKE_GAP + (BACK_GAP - STRIKE_GAP) * triangle(phase);
  const targetX = clamp(state.anchor + home * (gap / 2) + state.strafe, 0.08, 0.92);

  state.x = clamp(approach(state.x, targetX, SPEED), 0.06, 0.94);
  state.y = clamp(approach(state.y, state.targetY, DEPTH_SPEED), lane.min, lane.max);
}

/** Longest a fighter may hold still, in video frames. */
export const MAX_STILL_FRAMES = 10;
/** Same, in ticks. */
export const MAX_STILL_TICKS = MAX_STILL_FRAMES * (TICKS_PER_SECOND / 30);
