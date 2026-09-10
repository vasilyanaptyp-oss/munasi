import { box, circle, eyes, poly, roundedBox } from "../shapes.js";
import type { FighterArt } from "./types.js";

const FRIDGE = "#dfe4ec";
const FRIDGE_EDGE = "#a9b2c1";
const SHIRT = "#8a6a44";
const SKIN = "#d8ab7a";

/**
 * ГРУЗЧИК С РЫНКА — bent double under a fridge. The load is the silhouette:
 * a big rectangle sitting on a small hunched man.
 */
export const loader: FighterArt = {
  id: "loader",
  note: "hunched under a fridge, load wider than the man",

  draw(ctx, pose) {
    const dying = pose.death > 0;
    // On death the fridge slides off forward and lands on him.
    const slide = dying ? Math.min(1, pose.death * 1.5) : 0;

    // Fridge, riding high on his back.
    ctx.save();
    ctx.translate(slide * 0.55, -0.5 + slide * 1.25);
    ctx.rotate(slide * 0.9);
    roundedBox(ctx, 0, -0.06, 1.14, 0.78, 0.06, FRIDGE);
    box(ctx, 0, 0.02, 1.06, 0.05, FRIDGE_EDGE);
    box(ctx, 0.4, -0.16, 0.07, 0.24, FRIDGE_EDGE);
    box(ctx, 0.4, 0.22, 0.07, 0.24, FRIDGE_EDGE);
    ctx.restore();

    // Short, hunched body — almost square.
    poly(ctx, [[-0.24, 0.94], [-0.46, 0.2], [0.46, 0.2], [0.24, 0.94]], SHIRT);
    // Arms reaching up to hold the load.
    roundedBox(ctx, -0.46, 0.0, 0.18, 0.5, 0.08, SKIN);
    roundedBox(ctx, 0.46, 0.0, 0.18, 0.5, 0.08, SKIN);
    box(ctx, -0.13, 0.96, 0.22, 0.12, "#3a2f28");
    box(ctx, 0.13, 0.96, 0.22, 0.12, "#3a2f28");

    // Head pushed down between the shoulders.
    circle(ctx, 0, 0.06, 0.24, SKIN);
    eyes(ctx, 0.02, 0.1, 0.04, "#1a2030", dying ? 0.1 : 1);
    // Gritted teeth.
    box(ctx, 0, 0.16, 0.18, 0.05, "#f2f5ff");
    // Cloth cap.
    poly(ctx, [[-0.26, -0.06], [0.26, -0.06], [0.2, -0.2], [-0.2, -0.2]], "#5b4a34");
  },

  /**
   * Almost motionless: a slow squat under the weight, no sway. Standing still
   * next to a jittering courier is itself a character trait.
   */
  idle(frame) {
    // Amplitude tripled: at 1.8% of body height the heave was invisible on
    // video and the loader looked like a still image for the whole fight.
    const strain = (Math.sin(frame * 0.075) + 1) / 2;
    return { scaleY: 1 - strain * 0.055, dy: strain * 0.05, dx: strain * 0.018 };
  },

  /** Slow heave: loads up for a long time, then drops everything forward. */
  strike(t) {
    if (t < 0) return { dy: -0.06 * -t, scaleY: 1 + 0.03 * -t };
    return { lunge: 0.28 * (1 - t), scaleY: 1 - 0.05 * (1 - t) };
  },

  /** Buckles straight down under the load. */
  death(t) {
    return { dy: t * 0.4, scaleY: 1 - t * 0.55, rot: t * 0.25 };
  },
};
