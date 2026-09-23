import { box, circle, ellipse, eyes, poly, roundedBox } from "../shapes.js";
import type { FighterArt } from "./types.js";

const BOOTH = "#c9ced6";
const BOOTH_DARK = "#a3a9b3";
const BARRIER = "#ef8a70";
const BARRIER_LIGHT = "#f4f6fa";
const SKIN = "#f0cfa8";
const VEST = "#d8dee8";

/**
 * СТАРШИЙ ПО ШЛАГБАУМУ — a head in a booth window with a striped boom barrier
 * across the whole frame. The horizontal bar is unlike anything else here.
 */
export const gatekeeper: FighterArt = {
  id: "gatekeeper",
  note: "booth window plus a long horizontal striped barrier",

  draw(ctx, pose) {
    const f = pose.facing;
    const dying = pose.death > 0;
    // The barrier drops on death, from raised to fully down.
    const lift = dying ? Math.min(1, pose.death * 1.6) : 0;

    // Booth: a narrow upright kiosk.
    roundedBox(ctx, -0.02, 0.34, 0.78, 1.28, 0.06, BOOTH);
    box(ctx, -0.02, -0.28, 0.86, 0.1, BOOTH_DARK);
    box(ctx, -0.02, 0.62, 0.78, 0.06, BOOTH_DARK);
    // Window opening.
    box(ctx, -0.02, -0.02, 0.56, 0.42, "#20262e");

    // The boom barrier, hinged at the booth and reaching out of frame.
    ctx.save();
    ctx.translate(0.34, -0.18);
    ctx.rotate(f * (-0.32 + lift * 0.32));
    for (let i = 0; i < 5; i += 1) {
      box(ctx, 0.2 + i * 0.24, 0, 0.24, 0.11, i % 2 === 0 ? BARRIER : BARRIER_LIGHT);
    }
    circle(ctx, 0.02, 0, 0.1, BOOTH_DARK);
    ctx.restore();

    // Him, framed by the window.
    circle(ctx, -0.02, -0.06, 0.2, SKIN);
    eyes(ctx, -0.1, 0.08, 0.034, "#1a2030", dying ? 0.1 : 1);
    box(ctx, -0.02, 0.06, 0.14, 0.04, "#5a4632");
    roundedBox(ctx, -0.02, 0.2, 0.42, 0.18, 0.05, VEST);
    // Cap.
    poly(ctx, [[-0.22, -0.18], [0.18, -0.18], [0.14, -0.3], [-0.18, -0.3]], VEST);

    if (pose.buffed) ellipse(ctx, 0.34, -0.4, 0.08, 0.08, "#ffd23f");
  },

  /** The barrier idles with a slow hydraulic bob; the man does not move. */
  idle(frame) {
    return { dy: Math.sin(frame * 0.07) * 0.028, rot: Math.sin(frame * 0.035) * 0.012 };
  },

  /** Loads the boom back, then pushes it through. */
  strike(t) {
    if (t < 0) return { lunge: -0.04 * -t };
    return { lunge: 0.22 * (1 - t), dy: 0.05 * (1 - t) };
  },

  /** The booth tips; the barrier has already dropped. */
  death(t) {
    return { rot: -t * 0.7, dy: t * 0.3, scaleY: 1 - t * 0.1 };
  },
};
