import { box, circle, eyes, poly, roundedBox } from "../shapes.js";
import type { FighterArt } from "./types.js";

const CLOAK = "#3b3550";
const CLOAK_DARK = "#282338";
const PAPER = "#efe6d2";
const GLOW = "#9d8bff";

/**
 * ТАЙНЫЙ СОВЕТНИК — a hooded shape with no face and a ring of paperwork
 * orbiting it. Summons faceless clerks.
 */
export const councillor: FighterArt = {
  id: "councillor",
  note: "narrow column, faceless hood, wide fan of files on one side",

  draw(ctx, pose) {
    const dying = pose.death > 0;
    const scatter = dying ? Math.min(1, pose.death * 1.5) : 0;
    const spin = pose.frame * 0.05;

    // Orbiting folders. Drawn behind the body.
    for (let i = 0; i < 4; i += 1) {
      const angle = spin + (i * Math.PI) / 2;
      const radius = 0.62 + scatter * (0.6 + i * 0.2);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius * 0.42 - 0.1 - scatter * 0.4;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + scatter * 3);
      box(ctx, 0, 0, 0.2, 0.15, PAPER);
      box(ctx, 0, 0.04, 0.2, 0.03, "#c9bda0");
      ctx.restore();
    }

    // Narrow column, not a flared robe: the arbiter already owns the
    // triangle, and two triangles measured 0.71 IoU against each other.
    poly(ctx, [[-0.2, 0.98], [-0.26, -0.4], [0.18, -0.44], [0.14, 0.98]], CLOAK);
    poly(ctx, [[-0.26, -0.4], [0.18, -0.44], [0.1, 0.42], [-0.12, 0.44]], CLOAK_DARK);

    // A wide fan of files off one shoulder — the asymmetry is the whole point.
    for (let i = 0; i < 5; i += 1) {
      const angle = -0.9 + i * 0.28;
      ctx.save();
      ctx.translate(-0.3, -0.16);
      ctx.rotate(angle);
      box(ctx, -0.42, 0, 0.44, 0.13, i % 2 === 0 ? PAPER : "#d8ccb0");
      ctx.restore();
    }

    // Hood with nothing inside but two lights.
    poly(ctx, [[-0.28, -0.36], [0.22, -0.4], [-0.04, -0.88]], CLOAK);
    circle(ctx, -0.04, -0.5, 0.17, "#05060c");
    eyes(ctx, -0.52, 0.075, 0.036, GLOW, dying ? 0.15 : 1);

    // A single pointing hand.
    roundedBox(ctx, 0.34, -0.06, 0.13, 0.34, 0.05, CLOAK_DARK);
    circle(ctx, 0.36, 0.14, 0.07, PAPER);
  },

  /** Body still; the paperwork does the moving. */
  idle(frame) {
    return { dy: Math.sin(frame * 0.04) * 0.014 };
  },

  /** Points, and something happens elsewhere. Minimal body motion. */
  strike(t, facing) {
    if (t < 0) return { scaleY: 1 + 0.03 * -t };
    return { dy: facing * 0.06 * (1 - t), scaleY: 1 - 0.04 * (1 - t) };
  },

  /** Dissolves: the cloak empties out and the folders scatter. */
  death(t) {
    return { scaleY: 1 - t * 0.6, dy: t * 0.3, scaleX: 1 - t * 0.2 };
  },

  /** Clerks: a small stack of paper with the same two lights for a face. */
  minion(ctx, pose) {
    poly(ctx, [[-0.44, 0.9], [-0.3, -0.2], [0.3, -0.2], [0.44, 0.9]], CLOAK);
    box(ctx, 0, 0.2, 0.5, 0.5, PAPER);
    box(ctx, 0, 0.06, 0.5, 0.08, "#c9bda0");
    circle(ctx, 0, -0.38, 0.24, CLOAK_DARK);
    eyes(ctx, -0.4, 0.1, 0.05, GLOW, pose.death > 0 ? 0.1 : 1);
  },
};
