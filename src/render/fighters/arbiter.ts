import { box, circle, eyes, poly } from "../shapes.js";
import type { FighterArt } from "./types.js";

const ROBE = "#2b2f3a";
const ROBE_SHADE = "#1b1e26";
const GOLD = "#b8912f";
const SKIN = "#a98d6c";

/**
 * ВЕРХОВНЫЙ АРБИТР — a tall pale triangle under a floating ring. Stands
 * absolutely still, which reads as authority next to the fidgeting workers.
 */
export const arbiter: FighterArt = {
  id: "arbiter",
  note: "robe triangle, floating halo, gavel",

  draw(ctx, pose) {
    const f = pose.facing;
    const dying = pose.death > 0;
    const collapse = dying ? Math.min(1, pose.death * 1.3) : 0;

    // Robe: a wide, clean triangle. No legs visible at all.
    poly(
      ctx,
      [
        [-0.52 - collapse * 0.2, 0.96],
        [-0.16, -0.3],
        [0.16, -0.3],
        [0.52 + collapse * 0.2, 0.96],
      ],
      ROBE,
    );
    poly(ctx, [[-0.16, -0.3], [0.16, -0.3], [0.1, 0.5], [-0.1, 0.5]], ROBE_SHADE);
    box(ctx, 0, 0.3, 0.7, 0.06, GOLD);

    // Gavel, held high.
    ctx.save();
    ctx.translate(0.44, -0.2 + f * 0.06);
    ctx.rotate(f * 0.2);
    box(ctx, 0, 0.16, 0.07, 0.44, "#8a6a3a");
    box(ctx, 0, -0.14, 0.3, 0.2, "#a9793f");
    box(ctx, 0, -0.14, 0.3, 0.05, GOLD);
    ctx.restore();

    circle(ctx, 0, -0.44, 0.23, SKIN);
    eyes(ctx, -0.48, 0.09, 0.038, "#1a2030", dying ? 0.1 : 1);
    box(ctx, 0, -0.32, 0.16, 0.04, "#7a6a52");

    // Halo: a ring, not a disc, so it stays legible in silhouette.
    ctx.save();
    ctx.translate(0, -0.78 + collapse * 0.9);
    ctx.rotate(collapse * 1.4);
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.3, 0.09, 0, 0, Math.PI * 2);
    ctx.lineWidth = 0.05;
    ctx.strokeStyle = GOLD;
    ctx.stroke();
    ctx.restore();
  },

  /**
   * The only fighter who does not move: the halo turns, the body does not.
   * Stillness is the character.
   */
  idle() {
    return {};
  },

  /** Settles, then drives the gavel forward. No tilt: it read as toppling. */
  strike(t) {
    if (t < 0) return { dy: -0.07 * -t, lunge: -0.06 * -t };
    return { lunge: 0.2 * (1 - t), dy: 0.04 * (1 - t) };
  },

  /** The robe deflates; the halo has already dropped. */
  death(t) {
    return { dy: t * 0.36, scaleY: 1 - t * 0.5, scaleX: 1 + t * 0.12 };
  },
};
