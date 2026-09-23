import { box, circle, ellipse, eyes, poly, roundedBox } from "../shapes.js";
import type { FighterArt } from "./types.js";

const SMOCK = "#f8b8d0";
const SMOCK_DARK = "#d987a8";
const HAIR = "#a294a8";
const SKIN = "#f6ddc6";
const FILE_BODY = "#fdf3f8";

/**
 * МАСТЕР МАНИКЮРА — the tallest, thinnest silhouette, topped with a bun.
 * Never looks at the opponent; the nail file does the work.
 */
export const nailmaster: FighterArt = {
  id: "nailmaster",
  note: "tall bun, thin frame, nail file held like a blade",

  draw(ctx, pose) {
    const dying = pose.death > 0;

    // Very narrow body.
    poly(ctx, [[-0.16, 0.94], [-0.2, -0.1], [0.2, -0.1], [0.16, 0.94]], SMOCK);
    box(ctx, 0, 0.3, 0.4, 0.07, SMOCK_DARK);
    box(ctx, -0.09, 0.96, 0.18, 0.1, "#2a2230");
    box(ctx, 0.09, 0.96, 0.18, 0.1, "#2a2230");

    // One arm folded, one extended with the file.
    roundedBox(ctx, -0.26, 0.1, 0.14, 0.4, 0.06, SMOCK_DARK);
    ctx.save();
    ctx.translate(0.3, 0.02);
    ctx.rotate(-0.5);
    roundedBox(ctx, 0, 0, 0.13, 0.44, 0.06, SMOCK_DARK);
    // The file: long, thin, unmistakable.
    roundedBox(ctx, 0.02, -0.42, 0.09, 0.62, 0.03, FILE_BODY);
    box(ctx, 0.02, -0.16, 0.09, 0.1, "#b9a2ad");
    ctx.restore();

    circle(ctx, 0, -0.32, 0.22, SKIN);
    // Hair: swept up into a bun that adds a third of his height.
    poly(ctx, [[-0.24, -0.3], [0.24, -0.3], [0.16, -0.56], [-0.16, -0.56]], HAIR);
    ellipse(ctx, 0, -0.66, 0.19, 0.17, HAIR);
    ellipse(ctx, 0, -0.82, 0.13, 0.12, HAIR);
    // Eyes downcast at the nails, not at the enemy.
    eyes(ctx, -0.28, 0.09, 0.038, "#1a2030", dying ? 0.1 : 0.45);
    box(ctx, 0, -0.18, 0.1, 0.04, SMOCK_DARK);

    if (pose.buffed) {
      for (let i = 0; i < 3; i += 1) {
        circle(ctx, 0.42 + i * 0.09, -0.5 - i * 0.12, 0.035, "#ffd9ea");
      }
    }
  },

  /** Files her nails on a slow cycle, indifferent to the fight. */
  idle(frame) {
    return {
      dx: Math.sin(frame * 0.16) * 0.02,
      rot: Math.sin(frame * 0.08) * 0.02,
    };
  },

  /** A flick: almost no wind-up, all snap forward. */
  strike(t) {
    if (t < 0) return { lunge: -0.14 * -t };
    return { lunge: 0.32 * (1 - t) * (1 - t) };
  },

  /** Swoons backwards, theatrically. */
  death(t) {
    return { rot: -t * 1.5, dy: t * 0.3, dx: -t * 0.1 };
  },
};
