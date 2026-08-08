import { box, circle, ellipse, eyes, poly, roundedBox } from "../shapes.js";
import type { FighterArt } from "./types.js";

const APRON = "#f4efe6";
const APRON_SHADE = "#d9d1c2";
const SKIN = "#e8c9a0";
const TRAY = "#8d949f";
const EMBER = "#ff8a3d";

/**
 * НОЧНОЙ ПЕКАРЬ — half his height is chef's hat. Fights with a baking tray and
 * opens the oven on everyone at once.
 */
export const baker: FighterArt = {
  id: "baker",
  note: "toque doubles his height, baking tray",

  draw(ctx, pose) {
    const f = pose.facing;
    const dying = pose.death > 0;
    // The hat comes off first when he goes down.
    const hatDrop = dying ? Math.min(1, pose.death * 2.2) : 0;

    // Tray, held toward the opponent like a bat.
    ctx.save();
    ctx.translate(0.5, 0.1 + f * 0.16);
    ctx.rotate(f * 0.4);
    box(ctx, 0, 0, 0.1, 0.62, "#6b7280");
    roundedBox(ctx, 0, -0.44, 0.52, 0.2, 0.05, TRAY);
    circle(ctx, -0.12, -0.44, 0.06, "#e8b76a");
    circle(ctx, 0.1, -0.44, 0.06, "#e8b76a");
    ctx.restore();

    // Narrow body: the hat should own the silhouette.
    poly(ctx, [[-0.26, 0.9], [-0.32, -0.16], [0.32, -0.16], [0.26, 0.9]], APRON);
    box(ctx, 0, 0.34, 0.66, 0.1, APRON_SHADE);
    // Rolled sleeves.
    roundedBox(ctx, -0.42, 0.02, 0.2, 0.42, 0.08, APRON_SHADE);
    roundedBox(ctx, 0.42, 0.02, 0.2, 0.42, 0.08, APRON_SHADE);
    box(ctx, -0.14, 0.94, 0.24, 0.12, "#3b4150");
    box(ctx, 0.14, 0.94, 0.24, 0.12, "#3b4150");

    circle(ctx, 0, -0.36, 0.25, SKIN);
    eyes(ctx, -0.4, 0.1, 0.042, "#1a2030", dying ? 0.12 : 1);
    box(ctx, 0, -0.26, 0.16, 0.05, "#8a5a3a");

    // The toque: three stacked puffs, taller than the head is wide.
    ctx.save();
    // Falls off him rather than across the arena: the wide version put the
    // toque 0.40 of a body width past his own outline and pushed the pair
    // apart for the whole fight to make room for two seconds of dying.
    ctx.translate(hatDrop * -0.1, hatDrop * 1.06);
    ctx.rotate(hatDrop * -0.7);
    box(ctx, 0, -0.58, 0.46, 0.14, APRON);
    ellipse(ctx, -0.16, -0.78, 0.19, 0.2, APRON);
    ellipse(ctx, 0.16, -0.78, 0.19, 0.2, APRON);
    ellipse(ctx, 0, -0.96, 0.22, 0.22, APRON);
    ctx.restore();

    if (pose.buffed || dying) {
      // Oven heat.
      for (let i = 0; i < 3; i += 1) {
        ellipse(ctx, -0.3 + i * 0.3, 0.62 - (dying ? 0.3 : 0), 0.07, 0.12, EMBER);
      }
    }
  },

  /** Kneading: a short two-beat bob, faster than a breathing idle. */
  idle(frame) {
    const knead = Math.sin(frame * 0.22);
    return { dy: Math.abs(knead) * 0.05, scaleY: 1 - Math.abs(knead) * 0.02 };
  },

  /** Cocks the tray back, then shoves it forward. */
  strike(t) {
    if (t < 0) return { lunge: -0.12 * -t, scaleY: 1 + 0.04 * -t };
    return { lunge: 0.34 * (1 - t), dy: 0.05 * (1 - t) };
  },

  /** Sags straight down, hat already gone. */
  death(t) {
    return { dy: t * 0.42, scaleY: 1 - t * 0.35, rot: t * 0.2 };
  },
};
