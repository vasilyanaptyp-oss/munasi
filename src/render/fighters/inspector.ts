import { box, circle, eyes, poly, roundedBox } from "../shapes.js";
import type { FighterArt } from "./types.js";

const COAT = "#4a5a4c";
const COAT_DARK = "#334135";
const SKIN = "#dcbb94";
const PAPER = "#f2eee2";
const INK = "#c2382f";

/**
 * ВЕЧНЫЙ ИНСПЕКТОР — a long narrow coat and a peaked cap, carrying a stamp
 * far too large for any real document.
 */
export const inspector: FighterArt = {
  id: "inspector",
  note: "long coat column, peaked cap, oversized stamp",

  draw(ctx, pose) {
    const f = pose.facing;
    const dying = pose.death > 0;

    // Coat: a tall, almost straight column down to the floor.
    poly(ctx, [[-0.3, 0.98], [-0.26, -0.2], [0.26, -0.2], [0.3, 0.98]], COAT);
    box(ctx, 0, 0.12, 0.54, 0.07, COAT_DARK);
    box(ctx, 0, 0.3, 0.54, 0.07, COAT_DARK);
    // Coat opening.
    box(ctx, 0, 0.5, 0.06, 0.9, COAT_DARK);
    box(ctx, -0.16, 0.94, 0.24, 0.1, "#20262c");
    box(ctx, 0.16, 0.94, 0.24, 0.1, "#20262c");

    // Clipboard in the off hand — the thing he taps.
    ctx.save();
    ctx.translate(-0.42, 0.18);
    ctx.rotate(-0.15);
    roundedBox(ctx, 0, 0, 0.3, 0.4, 0.03, PAPER);
    box(ctx, 0, -0.16, 0.16, 0.06, "#8a8f98");
    box(ctx, 0, 0.02, 0.2, 0.03, "#9aa1ab");
    box(ctx, 0, 0.1, 0.2, 0.03, "#9aa1ab");
    ctx.restore();

    // The stamp, raised.
    ctx.save();
    ctx.translate(0.44, -0.14 + f * 0.1);
    ctx.rotate(f * 0.12);
    box(ctx, 0, 0.1, 0.1, 0.34, "#6b4a2f");
    roundedBox(ctx, 0, -0.16, 0.34, 0.22, 0.04, "#3c2f24");
    box(ctx, 0, -0.04, 0.38, 0.06, INK);
    ctx.restore();

    circle(ctx, 0, -0.38, 0.22, SKIN);
    eyes(ctx, -0.42, 0.09, 0.036, "#1a2030", dying ? 0.1 : 1);
    // Peaked cap, worn low.
    poly(ctx, [[-0.28, -0.5], [0.28, -0.5], [0.22, -0.7], [-0.22, -0.7]], COAT_DARK);
    box(ctx, 0.06, -0.48, 0.52, 0.07, "#20262c");

    if (dying) box(ctx, 0, -0.38, 0.3, 0.1, INK);
  },

  /**
   * Taps the clipboard on a strict beat and never varies it — bureaucratic
   * patience, mechanically regular where the workers are loose.
   */
  idle(frame) {
    const tap = frame % 40 < 4 ? 1 : 0;
    return { dy: tap * 0.02, rot: tap * -0.03 };
  },

  /** Lifts the stamp, then punches it forward like a verdict. */
  strike(t) {
    if (t < 0) return { dy: -0.09 * -t };
    return { lunge: 0.26 * (1 - t) * (1 - t), dy: 0.04 * (1 - t) };
  },

  /** Face down, flat, like a filed document. */
  death(t) {
    return { rot: t * 1.5, dy: t * 0.34 };
  },
};
