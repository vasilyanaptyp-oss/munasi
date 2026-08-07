import { box, circle, eyes, poly, roundedBox } from "../shapes.js";
import type { FighterArt } from "./types.js";

const SUIT = "#4a4a55";
const SUIT_DARK = "#35353f";
const SKIN = "#dcbb94";
const MASK = "#e8ecf2";

/**
 * ГЛАВНЫЙ ПО ТИШИНЕ — one raised finger held above the head, and a mask over
 * the mouth. The finger is the whole silhouette; nothing else about him moves.
 */
export const silencer: FighterArt = {
  id: "silencer",
  note: "single raised finger above the head, masked mouth",

  draw(ctx, pose) {
    const dying = pose.death > 0;
    // The finger droops before he does.
    const droop = dying ? Math.min(1, pose.death * 2) : 0;

    // Narrow, upright body — deliberately unremarkable below the neck.
    poly(ctx, [[-0.2, 0.96], [-0.24, -0.14], [0.24, -0.14], [0.2, 0.96]], SUIT);
    box(ctx, 0, 0.1, 0.48, 0.06, SUIT_DARK);
    box(ctx, -0.1, 0.98, 0.2, 0.1, "#22222a");
    box(ctx, 0.1, 0.98, 0.2, 0.1, "#22222a");
    roundedBox(ctx, -0.3, 0.14, 0.14, 0.42, 0.06, SUIT_DARK);

    // The arm and finger: raised straight up past the head.
    ctx.save();
    ctx.translate(0.24, -0.2);
    ctx.rotate(droop * 1.5);
    roundedBox(ctx, 0, -0.18, 0.15, 0.48, 0.06, SUIT_DARK);
    circle(ctx, 0, -0.46, 0.11, SKIN);
    roundedBox(ctx, 0, -0.74, 0.11, 0.44, 0.05, SKIN);
    circle(ctx, 0, -0.94, 0.055, SKIN);
    ctx.restore();

    circle(ctx, -0.02, -0.38, 0.22, SKIN);
    eyes(ctx, -0.44, 0.09, 0.036, "#1a2030", dying ? 0.1 : 1);
    // Mask over the mouth.
    poly(ctx, [[-0.2, -0.32], [0.18, -0.32], [0.16, -0.16], [-0.18, -0.16]], MASK);
    box(ctx, -0.02, -0.3, 0.42, 0.03, MASK);
    // Flat, severe hair.
    poly(ctx, [[-0.24, -0.5], [0.22, -0.5], [0.2, -0.6], [-0.22, -0.6]], "#2a2a32");
  },

  /**
   * Completely still except the finger, which sways. Paired against the
   * courier's jitter this is the clearest contrast on the roster.
   */
  idle(frame) {
    return { rot: Math.sin(frame * 0.03) * 0.012 };
  },

  /** A short sharp jab of the finger — no body movement to speak of. */
  strike(t, facing) {
    if (t < 0) return { dy: -0.03 * -t };
    return { dy: facing * 0.1 * (1 - t) * (1 - t), dx: 0.03 * (1 - t) };
  },

  /** Folds quietly, without fuss. */
  death(t) {
    return { dy: t * 0.38, scaleY: 1 - t * 0.45, rot: t * 0.6 };
  },
};
