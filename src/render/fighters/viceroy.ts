import { box, circle, eyes, poly } from "../shapes.js";
import type { FighterArt } from "./types.js";

const COAT = "#6b2f4a";
const COAT_DARK = "#4c2035";
const GOLD = "#e8c06a";
const SKIN = "#e0b78e";
const BANNER = "#8f3a5c";

/**
 * НАМЕСТНИК ОКРУГА — enormous ceremonial shoulders and a banner on a pole.
 * The widest top-heavy silhouette on the roster.
 */
export const viceroy: FighterArt = {
  id: "viceroy",
  note: "huge epaulettes, tall banner, top-heavy",

  draw(ctx, pose) {
    const dying = pose.death > 0;
    const fall = dying ? Math.min(1, pose.death * 1.3) : 0;
    const ripple = Math.sin(pose.frame * 0.1) * 0.05;

    // Banner: tall, and it moves even when he does not.
    ctx.save();
    ctx.translate(-0.56, 0.0 + fall * 0.5);
    ctx.rotate(fall * 1.2);
    box(ctx, 0, 0.1, 0.05, 1.7, "#5a4632");
    poly(
      ctx,
      [
        [0.02, -0.72],
        [0.56 + ripple, -0.66],
        [0.5 + ripple, -0.16],
        [0.02, -0.22],
      ],
      BANNER,
    );
    box(ctx, 0.26, -0.44, 0.16, 0.16, GOLD);
    ctx.restore();

    // Body, narrow at the waist to exaggerate the shoulders.
    poly(ctx, [[-0.22, 0.96], [-0.3, -0.08], [0.3, -0.08], [0.22, 0.96]], COAT);
    box(ctx, 0, 0.34, 0.5, 0.08, GOLD);
    box(ctx, -0.12, 0.98, 0.22, 0.1, "#2a2030");
    box(ctx, 0.12, 0.98, 0.22, 0.1, "#2a2030");

    // Epaulettes: the signature. Wider than his hips by half again.
    poly(ctx, [[-0.66, -0.2], [-0.14, -0.28], [-0.16, 0.02], [-0.6, 0.06]], COAT_DARK);
    poly(ctx, [[0.66, -0.2], [0.14, -0.28], [0.16, 0.02], [0.6, 0.06]], COAT_DARK);
    for (let i = 0; i < 3; i += 1) {
      box(ctx, -0.6 + i * 0.14, -0.06, 0.06, 0.16, GOLD);
      box(ctx, 0.6 - i * 0.14, -0.06, 0.06, 0.16, GOLD);
    }
    // Medals.
    circle(ctx, -0.14, 0.06, 0.06, GOLD);
    circle(ctx, -0.02, 0.12, 0.05, "#c9d2dd");

    circle(ctx, 0, -0.44, 0.22, SKIN);
    eyes(ctx, -0.48, 0.09, 0.036, "#1a2030", dying ? 0.1 : 1);
    box(ctx, 0, -0.32, 0.2, 0.05, "#5a4632");
    // Bicorne hat.
    poly(ctx, [[-0.36, -0.6], [0.36, -0.6], [0.18, -0.78], [-0.18, -0.78]], COAT_DARK);
    box(ctx, 0, -0.6, 0.66, 0.06, GOLD);
  },

  /** Stands to attention; only the banner moves. Chin lifts on a slow cycle. */
  idle(frame) {
    return { rot: Math.sin(frame * 0.035) * 0.02 };
  },

  /** Swings the banner pole in a wide arc. */
  strike(t, facing) {
    if (t < 0) return { rot: -facing * 0.3 * -t, dx: 0.04 * -t };
    return { rot: facing * 0.34 * (1 - t), dx: -0.06 * (1 - t) };
  },

  /** Goes down under his own banner. */
  death(t) {
    return { rot: t * 1.2, dy: t * 0.32, scaleY: 1 - t * 0.15 };
  },
};
