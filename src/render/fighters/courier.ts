import { box, circle, eyes, poly, roundedBox } from "../shapes.js";
import type { FighterArt } from "./types.js";

const BAG = "#6fe39a";
const BAG_DARK = "#46b874";
const JACKET = "#cfd8e4";
const SKIN = "#f0d5ae";
const SCREEN = "#ccf2ff";

/**
 * КУРЬЕР НА СМЕНЕ — a person carrying a cube. The thermal backpack is bigger
 * than he is and never leaves the silhouette.
 */
export const courier: FighterArt = {
  id: "courier",
  note: "giant cube backpack, permanently in a hurry",

  draw(ctx, pose) {
    const dying = pose.death > 0;
    const burst = dying ? Math.min(1, pose.death * 1.6) : 0;

    // The cube. Drawn behind him and offset, so it reads even at 96px.
    ctx.save();
    ctx.translate(-0.34 - burst * 0.5, -0.12 - burst * 0.35);
    ctx.rotate(-0.06 - burst * 0.6);
    roundedBox(ctx, 0, 0, 0.86, 0.9, 0.08, BAG);
    box(ctx, 0, -0.1, 0.86, 0.08, BAG_DARK);
    box(ctx, 0, 0, 0.1, 0.9, BAG_DARK);
    ctx.restore();

    if (burst > 0) {
      // Order contents flying out.
      for (let i = 0; i < 4; i += 1) {
        box(ctx, -0.7 + i * 0.22, -0.6 - burst * (0.3 + i * 0.1), 0.12, 0.12, "#f0d9a8");
      }
    }

    // Thin, forward-leaning body.
    poly(ctx, [[-0.18, 0.9], [-0.24, -0.1], [0.28, -0.14], [0.22, 0.9]], JACKET);
    roundedBox(ctx, 0.3, 0.16, 0.18, 0.44, 0.08, JACKET);
    box(ctx, -0.1, 0.94, 0.22, 0.12, "#1a2030");
    box(ctx, 0.16, 0.94, 0.22, 0.12, "#1a2030");
    // Strap across the chest.
    poly(ctx, [[-0.26, -0.06], [-0.16, -0.12], [0.2, 0.34], [0.1, 0.4]], BAG_DARK);

    circle(ctx, 0.04, -0.34, 0.24, SKIN);
    // Delivery helmet.
    poly(ctx, [[-0.22, -0.4], [0.3, -0.4], [0.26, -0.62], [-0.18, -0.62]], BAG);
    box(ctx, 0.12, -0.4, 0.42, 0.07, BAG_DARK);
    eyes(ctx, -0.34, 0.09, 0.04, "#1a2030", dying ? 0.1 : 1);

    // Phone, always in hand.
    ctx.save();
    ctx.translate(0.42, 0.06);
    ctx.rotate(-0.3);
    roundedBox(ctx, 0, 0, 0.16, 0.26, 0.03, "#11161f");
    box(ctx, 0, 0, 0.11, 0.2, SCREEN);
    ctx.restore();
  },

  /**
   * Jitter, not sway: a fast twitch with an occasional bigger flinch, so he
   * reads as anxious next to the statues on this roster.
   */
  idle(frame) {
    const twitch = Math.sin(frame * 0.9) * 0.008 + Math.sin(frame * 0.31) * 0.01;
    const glance = frame % 47 < 5 ? 0.05 : 0;
    return { dx: twitch * 2, dy: twitch, rot: glance * 0.3 };
  },

  /** Short, quick jab — barely winds up, he has no time. */
  strike(t) {
    if (t < 0) return { lunge: -0.1 * -t };
    return { lunge: 0.3 * (1 - t) };
  },

  /** Trips forward; the bag has already gone over his head. */
  death(t) {
    return { rot: t * 1.3, dy: t * 0.3, dx: t * 0.12 };
  },
};
