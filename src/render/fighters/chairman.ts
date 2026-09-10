import { box, circle, eyes, poly, roundedBox } from "../shapes.js";
import type { FighterArt } from "./types.js";

const PODIUM = "#7a4f33";
const PODIUM_DARK = "#5c3a25";
const SUIT = "#2b3242";
const SKIN = "#e2bd93";
const PAPER = "#f3eee0";

/**
 * ПРЕДСЕДАТЕЛЬ КОМИССИИ — the only fighter who brought furniture. A torso
 * above a trapezoid: unmistakable in silhouette, and he never leaves it.
 */
export const chairman: FighterArt = {
  id: "chairman",
  note: "torso above a broad desk slab — the only horizontal bar besides the barrier",

  draw(ctx, pose) {
    const dying = pose.death > 0;
    const topple = dying ? Math.min(1, pose.death * 1.4) : 0;

    // Upper body, visible above the podium only.
    roundedBox(ctx, 0, -0.18, 0.66, 0.6, 0.1, SUIT);
    poly(ctx, [[-0.1, -0.4], [0.1, -0.4], [0.06, -0.02], [-0.06, -0.02]], PAPER);
    box(ctx, 0, -0.34, 0.16, 0.06, "#b23b3b");
    roundedBox(ctx, -0.4, -0.1, 0.16, 0.36, 0.06, SUIT);
    roundedBox(ctx, 0.4, -0.1, 0.16, 0.36, 0.06, SUIT);

    circle(ctx, 0, -0.56, 0.23, SKIN);
    eyes(ctx, -0.6, 0.09, 0.036, "#1a2030", dying ? 0.1 : 1);
    // Comb-over and heavy brow.
    poly(ctx, [[-0.24, -0.66], [0.24, -0.66], [0.2, -0.76], [-0.2, -0.74]], "#8c8b86");
    box(ctx, 0, -0.62, 0.34, 0.04, "#8c8b86");

    // The podium, tipping over on death.
    ctx.save();
    ctx.translate(topple * 0.35, topple * 0.2);
    ctx.rotate(topple * 0.8);
    poly(ctx, [[-0.44, 0.98], [-0.34, 0.26], [0.34, 0.26], [0.44, 0.98]], PODIUM);
    box(ctx, 0, 0.26, 1.34, 0.15, PODIUM_DARK);
    box(ctx, 0, 0.36, 1.18, 0.06, PODIUM);
    box(ctx, 0, 0.64, 0.26, 0.24, PODIUM_DARK);
    // Microphone.
    box(ctx, -0.2, 0.1, 0.03, 0.3, "#3a3f4a");
    circle(ctx, -0.2, -0.08, 0.07, "#3a3f4a");
    ctx.restore();
  },

  /** Shuffles papers: a small, self-important side-to-side. */
  idle(frame) {
    return { dx: Math.sin(frame * 0.13) * 0.014, rot: Math.sin(frame * 0.065) * 0.018 };
  },

  /** Sinks, then drives forward into the podium. */
  strike(t) {
    if (t < 0) return { dy: -0.06 * -t, lunge: -0.07 * -t };
    return { lunge: 0.22 * (1 - t), dy: 0.05 * (1 - t) };
  },

  /** Goes down with the furniture on top of him. */
  death(t) {
    return { rot: -t * 0.9, dy: t * 0.3 };
  },

  /** Committee members: smaller suits with the same comb-over. */
  minion(ctx, pose) {
    roundedBox(ctx, 0, 0.3, 0.66, 0.7, 0.1, SUIT);
    poly(ctx, [[-0.1, 0.06], [0.1, 0.06], [0.06, 0.5], [-0.06, 0.5]], PAPER);
    circle(ctx, 0, -0.24, 0.28, SKIN);
    eyes(ctx, -0.28, 0.11, 0.045, "#1a2030", pose.death > 0 ? 0.1 : 1);
    poly(ctx, [[-0.28, -0.36], [0.28, -0.36], [0.22, -0.48], [-0.22, -0.46]], "#8c8b86");
  },
};
