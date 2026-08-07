import { box, circle, eyes, line, poly, roundedBox } from "../shapes.js";
import type { FighterArt } from "./types.js";

const OVERALL = "#2f6fb5";
const OVERALL_DARK = "#22518a";
const SHIRT = "#c8d3e2";
const SKIN = "#e8c9a0";
const STEEL = "#b9c4d4";
const TAPE = "#f2f6ff";

/**
 * САНТЕХНИК ЖЭКА — the widest silhouette on the roster: a barrel with no neck
 * and a wrench the size of his own torso. Heals by wrapping himself in tape.
 */
export const plumber: FighterArt = {
  id: "plumber",
  note: "barrel body, no neck, oversized pipe wrench",

  draw(ctx, pose) {
    const f = pose.facing;
    const dying = pose.death > 0;

    // Wrench, held out toward the opponent. Read this first at thumbnail size.
    const wrenchAngle = f * 0.25;
    ctx.save();
    ctx.translate(0.62, 0.1);
    ctx.rotate(wrenchAngle);
    box(ctx, 0, 0, 0.14, 1.05, STEEL);
    poly(
      ctx,
      [
        [-0.22, -0.52],
        [0.22, -0.52],
        [0.22, -0.3],
        [0.08, -0.3],
        [0.08, -0.4],
        [-0.08, -0.4],
        [-0.08, -0.3],
        [-0.22, -0.3],
      ],
      STEEL,
    );
    box(ctx, 0, 0.34, 0.18, 0.3, "#8b96a6");
    ctx.restore();

    // Barrel torso — deliberately wider than anything else in the roster.
    roundedBox(ctx, 0, 0.3, 1.02, 0.96, 0.18, OVERALL);
    box(ctx, 0, 0.02, 1.02, 0.2, SHIRT);
    // Bib straps.
    box(ctx, -0.24, -0.06, 0.13, 0.34, OVERALL);
    box(ctx, 0.24, -0.06, 0.13, 0.34, OVERALL);
    box(ctx, -0.2, 0.36, 0.16, 0.16, "#f5c542");

    // Arms, stubby.
    roundedBox(ctx, -0.6, 0.24, 0.24, 0.5, 0.1, OVERALL_DARK);
    roundedBox(ctx, 0.56, 0.24, 0.24, 0.5, 0.1, OVERALL_DARK);
    // Boots.
    box(ctx, -0.26, 0.86, 0.34, 0.16, "#2a2f3a");
    box(ctx, 0.26, 0.86, 0.34, 0.16, "#2a2f3a");

    // Head sits straight on the shoulders: no neck at all.
    circle(ctx, 0, -0.32, 0.29, SKIN);
    // Flat cap.
    poly(ctx, [[-0.34, -0.44], [0.34, -0.44], [0.28, -0.66], [-0.28, -0.66]], OVERALL_DARK);
    box(ctx, 0.06, -0.44, 0.62, 0.09, OVERALL_DARK);
    // Moustache.
    box(ctx, 0, -0.2, 0.3, 0.07, "#5a3a22");
    eyes(ctx, -0.34, 0.11, 0.045, "#1a2030", dying ? 0.1 : 1);

    if (pose.buffed) {
      // Tape wrapped round the middle after a repair.
      box(ctx, 0, 0.24, 1.06, 0.1, TAPE);
      box(ctx, 0, 0.42, 1.06, 0.07, TAPE);
    }
    if (dying) {
      // Water sprays out of him.
      for (let i = 0; i < 3; i += 1) {
        line(ctx, [0.1 * i - 0.1, 0.0], [0.3 * i - 0.3, -0.5 - 0.2 * i], 0.05, "#6fd0ff");
      }
    }
  },

  /** Heavy, slow sway — a man who has been standing all day. */
  idle(frame) {
    return { rot: Math.sin(frame * 0.055) * 0.035, dy: Math.sin(frame * 0.11) * 0.012 };
  },

  /** Winds the wrench back over the shoulder, then swings the whole body. */
  strike(t, facing) {
    if (t < 0) return { rot: -facing * 0.34 * -t, dy: -0.05 * -t };
    return { rot: facing * 0.26 * (1 - t), dy: facing * 0.1 * (1 - t) };
  },

  /** Falls backwards stiff as a plank. */
  death(t) {
    return { rot: -t * 1.45, dy: t * 0.32 };
  },
};
