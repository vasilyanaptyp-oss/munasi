import type { Canvas } from "@napi-rs/canvas";
import { createCanvas } from "@napi-rs/canvas";
import { artFor, compose, type FighterArt, type Pose, type Transform } from "./fighters/index.js";
import type { Ctx } from "./shapes.js";
import { minionSpriteFor, paintArchetype, spriteFor } from "./sprites.js";

/**
 * Draws a fighter onto the frame: resolves its art, applies the idle / strike /
 * death motion that art defines, and composites the damage flash.
 *
 * Roster fighters each have their own drawing function (`fighters/`). Anything
 * else — test fixtures, ad-hoc configs — falls back to the generic archetype
 * sprites with the generic motion below, so the renderer still works for a
 * fighter that has no art of its own.
 */

/** Frames of wind-up before a blow lands, and of recovery after. */
export const WINDUP_FRAMES = 6;
export const RECOVERY_FRAMES = 8;
/** Frames a death animation takes to play out. */
export const DEATH_FRAMES = 24;

/**
 * Dark keyline traced around every fighter, in screen pixels.
 *
 * It is what makes the reference readable, and it solves two problems at once:
 * a figure stops dissolving into the flat blue field, and the two figures stop
 * dissolving into each other where they overlap.
 */
export const FIGHTER_OUTLINE = 4;
const OUTLINE_COLOUR = "#0b1116";
/**
 * The keyline is four stamps of the figure's own alpha, offset up/down/left/
 * right. A ring of twelve gives a rounder line and costs 685ms a frame; four
 * costs a fifth of that and differs only on 45-degree edges, which come out
 * 2.8px instead of 4px. Nobody sees that at 30fps; everybody notices a render
 * that takes six times as long.
 */
const OUTLINE_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/** Motion used for fighters with no art of their own. */
const DEFAULT_MOTION = {
  idle: (frame: number): Partial<Transform> => ({ dy: Math.sin(frame * 0.14) * 0.06 }),
  strike: (t: number, facing: number): Partial<Transform> => {
    void facing;
    return t < 0 ? { lunge: -0.05 * -t } : { lunge: 0.24 * (1 - t) };
  },
  death: (t: number): Partial<Transform> => ({ rot: t * 1.35, dy: t * 0.2 }),
};

const scratch = new Map<number, Canvas>();
const outlineScratch = new Map<number, Canvas>();

function scratchCanvas(size: number): Canvas {
  let canvas = scratch.get(size);
  if (!canvas) {
    canvas = createCanvas(size, size);
    scratch.set(size, canvas);
  }
  return canvas;
}

function outlineCanvas(size: number): Canvas {
  let canvas = outlineScratch.get(size);
  if (!canvas) {
    canvas = createCanvas(size, size);
    outlineScratch.set(size, canvas);
  }
  return canvas;
}

export interface DrawFighterOptions {
  /** Pixel width/height of the sprite box. */
  size: number;
  /** +1 when the opponent is below, -1 when above. */
  facing: 1 | -1;
  /** Video frame, drives the idle cycle. */
  frame: number;
  /** -1..1 attack phase, or null when not swinging. */
  strike?: number | null;
  /** 0..1 death progress. */
  death?: number;
  /** 0..1 white damage flash. */
  flash?: number;
  /** True while an attack buff is up. */
  buffed?: boolean;
  /** Draw this fighter's summon rather than the fighter. */
  asMinion?: boolean;
  /** Skip motion and colour — used by the silhouette test. */
  silhouette?: boolean;
  /**
   * Which screen axis a lunge travels along. The gauntlet stands the pair side
   * by side ("x"); the duel stacks them ("y").
   */
  lungeAxis?: "x" | "y";
  /** Keyline width in pixels. 0 disables it. */
  outline?: number;
  /**
   * Everything this sprite ever draws, in unit space, so the keyline only
   * stamps the part of the layer the figure can occupy instead of the whole
   * 1.9x box. Halves the cost. Omit and the whole box is stamped.
   */
  outlineBounds?: { left: number; top: number; right: number; bottom: number };
}

function poseOf(options: DrawFighterOptions): Pose {
  return {
    frame: options.frame,
    strike: options.strike ?? null,
    death: options.death ?? 0,
    buffed: options.buffed ?? false,
    facing: options.facing,
  };
}

function transformFor(art: FighterArt | undefined, pose: Pose, still: boolean): Transform {
  if (still) return compose();
  const idle = art?.idle ?? DEFAULT_MOTION.idle;
  const strikeFn = art?.strike ?? DEFAULT_MOTION.strike;
  const deathFn = art?.death ?? DEFAULT_MOTION.death;
  return compose(
    idle(pose.frame),
    pose.strike !== null ? strikeFn(pose.strike, pose.facing) : {},
    pose.death > 0 ? deathFn(pose.death) : {},
  );
}

/** Paints the fighter into the current context, in unit space. */
function paint(ctx: Ctx, spriteId: string, pose: Pose, options: DrawFighterOptions): void {
  const art = artFor(spriteId);
  if (art) {
    if (options.asMinion) {
      if (art.minion) art.minion(ctx, pose);
      else {
        // No dedicated summon art: a shrunken copy of the summoner reads fine.
        ctx.save();
        ctx.scale(0.9, 0.9);
        art.draw(ctx, pose);
        ctx.restore();
      }
      return;
    }
    art.draw(ctx, pose);
    return;
  }
  const def = options.asMinion ? minionSpriteFor(spriteId) : spriteFor(spriteId);
  paintArchetype(ctx, def, pose.facing);
}

/**
 * Draws a fighter centred on the current origin. The figure is composed on its
 * own layer so the damage flash can be masked to the silhouette instead of
 * washing out the whole frame.
 */
export function drawFighter(ctx: Ctx, spriteId: string, options: DrawFighterOptions): void {
  const { size } = options;
  const pose = poseOf(options);
  const flash = options.flash ?? 0;
  // 1.9x box: props reach well past the body on several fighters.
  const boxSize = Math.round(size * 1.9);
  const layer = scratchCanvas(boxSize);
  const lc = layer.getContext("2d");

  lc.clearRect(0, 0, boxSize, boxSize);
  lc.save();
  lc.translate(boxSize / 2, boxSize / 2);
  lc.scale(size / 2, size / 2);
  lc.lineJoin = "round";

  const t = transformFor(artFor(spriteId), pose, options.silhouette === true);
  // "Forward" is whichever axis the format stands the fighters on.
  const axis = options.lungeAxis ?? "x";
  lc.translate(
    t.dx + (axis === "x" ? t.lunge * options.facing : 0),
    t.dy + (axis === "y" ? t.lunge * options.facing : 0),
  );
  lc.rotate(t.rot);
  lc.scale(t.scaleX, t.scaleY);
  paint(lc, spriteId, pose, options);
  lc.restore();

  if (options.silhouette) {
    // Flatten to a solid mask: shape only, no palette.
    lc.save();
    lc.globalCompositeOperation = "source-in";
    lc.fillStyle = "#000000";
    lc.fillRect(0, 0, boxSize, boxSize);
    lc.restore();
  } else if (flash > 0) {
    lc.save();
    lc.globalCompositeOperation = "source-atop";
    lc.fillStyle = `rgba(255,255,255,${Math.min(1, flash).toFixed(3)})`;
    lc.fillRect(0, 0, boxSize, boxSize);
    lc.restore();
  }

  ctx.save();
  const keyline = options.silhouette ? 0 : (options.outline ?? 0);
  if (!options.silhouette && pose.death > 0) ctx.globalAlpha = 1 - pose.death * 0.45;

  if (keyline > 0) {
    // The keyline is the figure's own alpha, flooded dark and stamped around a
    // circle. Stroking paths instead would need every fighter's art to know
    // about it; this needs nothing from them.
    const mask = outlineCanvas(boxSize);
    const mc = mask.getContext("2d");
    mc.clearRect(0, 0, boxSize, boxSize);
    mc.drawImage(layer, 0, 0);
    mc.save();
    mc.globalCompositeOperation = "source-in";
    mc.fillStyle = OUTLINE_COLOUR;
    mc.fillRect(0, 0, boxSize, boxSize);
    mc.restore();

    // Only the slice of the layer the figure can reach, padded for the offset.
    const half = boxSize / 2;
    const unit = size / 2;
    const b = options.outlineBounds;
    const pad = keyline + 2;
    const sx = b ? Math.max(0, Math.floor(half + b.left * unit - pad)) : 0;
    const sy = b ? Math.max(0, Math.floor(half + b.top * unit - pad)) : 0;
    const sw = b ? Math.min(boxSize - sx, Math.ceil((b.right - b.left) * unit + pad * 2)) : boxSize;
    const sh = b ? Math.min(boxSize - sy, Math.ceil((b.bottom - b.top) * unit + pad * 2)) : boxSize;

    for (const [ox, oy] of OUTLINE_OFFSETS) {
      ctx.drawImage(
        mask,
        sx,
        sy,
        sw,
        sh,
        sx - half + ox * keyline,
        sy - half + oy * keyline,
        sw,
        sh,
      );
    }
  }

  if (!options.silhouette && options.buffed) {
    ctx.shadowColor = "#ffd23f";
    ctx.shadowBlur = 34;
  }
  ctx.drawImage(layer, -boxSize / 2, -boxSize / 2);
  ctx.restore();
}
