import type { Ctx } from "../shapes.js";

/**
 * One fighter, one drawing function.
 *
 * The previous system had eight archetypes tinted by hue, which reads as a
 * palette swap rather than a character. Here each roster fighter owns its
 * silhouette, its signature prop, and its own idle / wind-up / death motion —
 * a viewer should recognise the fighter from the shape alone, which is what
 * `silhouette.test.ts` measures.
 */

export interface Pose {
  /** Video frame, for idle cycles. */
  frame: number;
  /**
   * Attack phase, -1..1:
   *   -1  start of the wind-up
   *    0  the frame the blow lands
   *   +1  end of the recovery
   * Null when the fighter is not swinging.
   */
  strike: number | null;
  /** 0 while alive, then 0..1 across the death animation. */
  death: number;
  /** True while an attack buff is up. */
  buffed: boolean;
  /** +1 when the opponent is below, -1 when above. */
  facing: 1 | -1;
}

/**
 * Applied by the renderer around `draw`. Rotation is in radians.
 *
 * `lunge` is a step toward the opponent — positive forward, negative back —
 * kept separate from `dx`/`dy` because which screen axis "forward" means
 * depends on the format: the gauntlet stands the pair side by side, the duel
 * stacks them. The renderer resolves it against `facing`.
 */
export interface Transform {
  dx: number;
  dy: number;
  lunge: number;
  rot: number;
  scaleX: number;
  scaleY: number;
}

export const IDENTITY: Transform = { dx: 0, dy: 0, lunge: 0, rot: 0, scaleX: 1, scaleY: 1 };

export function compose(...transforms: Partial<Transform>[]): Transform {
  const out: Transform = { ...IDENTITY };
  for (const t of transforms) {
    out.dx += t.dx ?? 0;
    out.dy += t.dy ?? 0;
    out.lunge += t.lunge ?? 0;
    out.rot += t.rot ?? 0;
    out.scaleX *= t.scaleX ?? 1;
    out.scaleY *= t.scaleY ?? 1;
  }
  return out;
}

export interface FighterArt {
  /** Matches the fighter's `spriteId`. */
  id: string;
  /** One line on what the viewer should read from the silhouette. */
  readonly note: string;
  /** Draws the fighter in unit space, centred on the origin. */
  draw(ctx: Ctx, pose: Pose): void;
  /** Resting motion. This is the fighter's tell — no two should share one. */
  idle(frame: number): Partial<Transform>;
  /** Wind-up and follow-through, driven by `pose.strike` in -1..1. */
  strike?(t: number, facing: number): Partial<Transform>;
  /** Collapse, driven by `pose.death` in 0..1. */
  death?(t: number): Partial<Transform>;
  /** Art for this fighter's summons. Defaults to a shrunken copy. */
  minion?(ctx: Ctx, pose: Pose): void;
}
