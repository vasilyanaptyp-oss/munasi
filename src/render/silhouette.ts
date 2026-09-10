import { createCanvas } from "@napi-rs/canvas";
import { drawFighter } from "./drawFighter.js";

/**
 * Silhouette extraction, used to check that fighters are told apart by shape
 * rather than by colour.
 *
 * A fighter is rendered as a solid mask with its motion frozen, cropped to its
 * bounding box, and scaled to a common height — so the comparison is about
 * proportion and outline, not about how big the drawing happens to be.
 */

export interface Mask {
  width: number;
  height: number;
  /** 1 where the fighter is, 0 where it is not. */
  bits: Uint8Array;
  /** Filled pixels, i.e. the silhouette's area. */
  area: number;
  /** Width-to-height ratio of the fighter's bounding box before scaling. */
  aspect: number;
}

const RENDER_SIZE = 900;
const SPRITE_SIZE = 420;

export const MASK_HEIGHT = 256;
export const MASK_WIDTH = 448;

export function silhouetteMask(
  spriteId: string,
  height = MASK_HEIGHT,
  width = MASK_WIDTH,
): Mask {
  const render = createCanvas(RENDER_SIZE, RENDER_SIZE);
  const ctx = render.getContext("2d");
  ctx.save();
  ctx.translate(RENDER_SIZE / 2, RENDER_SIZE / 2);
  drawFighter(ctx, spriteId, {
    size: SPRITE_SIZE,
    facing: 1,
    frame: 0,
    silhouette: true,
  });
  ctx.restore();

  const pixels = ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE).data;
  let minX = RENDER_SIZE;
  let minY = RENDER_SIZE;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < RENDER_SIZE; y += 1) {
    for (let x = 0; x < RENDER_SIZE; x += 1) {
      if (pixels[(y * RENDER_SIZE + x) * 4 + 3]! < 128) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error(`silhouetteMask: ${spriteId} drew nothing`);

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  const scaled = createCanvas(width, height);
  const sctx = scaled.getContext("2d");
  const drawW = Math.min(width, (boxW / boxH) * height);
  sctx.drawImage(render, minX, minY, boxW, boxH, (width - drawW) / 2, 0, drawW, height);

  const out = sctx.getImageData(0, 0, width, height).data;
  const bits = new Uint8Array(width * height);
  let area = 0;
  for (let i = 0; i < bits.length; i += 1) {
    const on = out[i * 4 + 3]! >= 128 ? 1 : 0;
    bits[i] = on;
    area += on;
  }
  return { width, height, bits, area, aspect: boxW / boxH };
}

/** Drawn extent of a sprite, in multiples of `drawFighter`'s `size`. */
export interface SpriteBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

const boundsCache = new Map<string, SpriteBounds>();

/**
 * Measures how much of its box a sprite actually fills, so layout code can
 * reason about where a fighter really is rather than about its nominal size.
 * Cached: the measurement renders the sprite once.
 */
export function spriteBounds(spriteId: string): SpriteBounds {
  const cached = boundsCache.get(spriteId);
  if (cached) return cached;

  const render = createCanvas(RENDER_SIZE, RENDER_SIZE);
  const ctx = render.getContext("2d");
  ctx.save();
  ctx.translate(RENDER_SIZE / 2, RENDER_SIZE / 2);
  drawFighter(ctx, spriteId, { size: SPRITE_SIZE, facing: 1, frame: 0, silhouette: true });
  ctx.restore();

  const pixels = ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE).data;
  let minX = RENDER_SIZE;
  let minY = RENDER_SIZE;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < RENDER_SIZE; y += 1) {
    for (let x = 0; x < RENDER_SIZE; x += 1) {
      if (pixels[(y * RENDER_SIZE + x) * 4 + 3]! < 128) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error(`spriteBounds: ${spriteId} drew nothing`);

  const centre = RENDER_SIZE / 2;
  const bounds: SpriteBounds = {
    left: (minX - centre) / SPRITE_SIZE,
    right: (maxX + 1 - centre) / SPRITE_SIZE,
    top: (minY - centre) / SPRITE_SIZE,
    bottom: (maxY + 1 - centre) / SPRITE_SIZE,
    width: (maxX + 1 - minX) / SPRITE_SIZE,
    height: (maxY + 1 - minY) / SPRITE_SIZE,
  };
  boundsCache.set(spriteId, bounds);
  return bounds;
}

const motionCache = new Map<string, SpriteBounds>();

/**
 * The full extent a sprite reaches once its motion is applied — idle, the
 * wind-up and follow-through of a strike, and the death animation, which
 * rotates a fighter by well over a radian.
 *
 * Sampled rather than estimated: a guessed margin is either too tight (and a
 * dying fighter clips the frame) or too loose (and every fighter is drawn
 * smaller than it needs to be).
 */
export function spriteMotionBounds(spriteId: string, includeDeath = true): SpriteBounds {
  return sampleMotion(spriteId, includeDeath, false);
}

/**
 * The same measurement for a fighter's summon.
 *
 * A minion is `drawFighter` with `asMinion`, which is a different shape at a
 * different size, so it needs its own envelope rather than a share of the box it
 * is drawn in. The difference is not small: a councillor's summon draws 77px
 * across inside a 119px box, and guessing at the box instead of measuring the
 * figure is how this project has got its geometry wrong every previous time.
 */
export function minionMotionBounds(spriteId: string): SpriteBounds {
  return sampleMotion(spriteId, false, true);
}

function sampleMotion(spriteId: string, includeDeath: boolean, asMinion: boolean): SpriteBounds {
  const key = `${spriteId}${asMinion ? ":minion" : ""}${includeDeath ? "" : ":alive"}`;
  const cached = motionCache.get(key);
  if (cached) return cached;

  const alive: { frame: number; strike?: number; death?: number; hurt?: number }[] = [
    { frame: 0 },
    { frame: 11 },
    { frame: 23 },
    { frame: 0, strike: -1 },
    { frame: 0, strike: -0.5 },
    { frame: 0, strike: 0 },
    { frame: 0, strike: 0.5 },
    // The recoil throws a fighter backwards, so it widens the envelope too.
    { frame: 0, hurt: 1 },
    { frame: 0, strike: 0, hurt: 1 },
  ];
  const poses: { frame: number; strike?: number; death?: number; hurt?: number }[] = includeDeath
    ? [
      ...alive,
    { frame: 0, death: 0.25 },
    { frame: 0, death: 0.5 },
    { frame: 0, death: 0.75 },
    { frame: 0, death: 1 },
      ]
    : alive;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const pose of poses) {
    for (const facing of [1, -1] as const) {
      const render = createCanvas(RENDER_SIZE, RENDER_SIZE);
      const ctx = render.getContext("2d");
      ctx.save();
      ctx.translate(RENDER_SIZE / 2, RENDER_SIZE / 2);
      drawFighter(ctx, spriteId, {
        size: SPRITE_SIZE,
        facing,
        frame: pose.frame,
        ...(pose.strike === undefined ? {} : { strike: pose.strike }),
        ...(pose.death === undefined ? {} : { death: pose.death }),
        ...(pose.hurt === undefined ? {} : { hurt: pose.hurt }),
        ...(asMinion ? { asMinion: true } : {}),
      });
      ctx.restore();
      const pixels = ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE).data;
      for (let y = 0; y < RENDER_SIZE; y += 1) {
        for (let x = 0; x < RENDER_SIZE; x += 1) {
          if (pixels[(y * RENDER_SIZE + x) * 4 + 3]! < 40) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  if (maxX === Number.NEGATIVE_INFINITY) throw new Error(`sampleMotion: ${spriteId} drew nothing`);

  const centre = RENDER_SIZE / 2;
  const bounds: SpriteBounds = {
    left: (minX - centre) / SPRITE_SIZE,
    right: (maxX + 1 - centre) / SPRITE_SIZE,
    top: (minY - centre) / SPRITE_SIZE,
    bottom: (maxY + 1 - centre) / SPRITE_SIZE,
    width: (maxX + 1 - minX) / SPRITE_SIZE,
    height: (maxY + 1 - minY) / SPRITE_SIZE,
  };
  motionCache.set(key, bounds);
  return bounds;
}

const lightnessCache = new Map<string, number>();

/**
 * Mean perceived lightness of a fighter's own pixels, 0..255.
 *
 * Shape is not the only thing that keeps two fighters apart on a phone screen:
 * two dark figures on the blue field read as one blob however different their
 * outlines are. This measures the figure only — background pixels are excluded
 * — so the roster can be held to a minimum contrast between the two fighters
 * that share a round.
 */
export function meanLightness(spriteId: string): number {
  const cached = lightnessCache.get(spriteId);
  if (cached !== undefined) return cached;

  const render = createCanvas(RENDER_SIZE, RENDER_SIZE);
  const ctx = render.getContext("2d");
  ctx.save();
  ctx.translate(RENDER_SIZE / 2, RENDER_SIZE / 2);
  drawFighter(ctx, spriteId, { size: SPRITE_SIZE, facing: 1, frame: 0 });
  ctx.restore();

  const pixels = ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE).data;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3]! < 128) continue;
    // Rec. 601 luma: matches how a viewer weighs the channels.
    sum += 0.299 * pixels[i]! + 0.587 * pixels[i + 1]! + 0.114 * pixels[i + 2]!;
    count += 1;
  }
  if (count === 0) throw new Error(`meanLightness: ${spriteId} drew nothing`);
  const value = sum / count;
  lightnessCache.set(spriteId, value);
  return value;
}

/** Intersection over union of two masks of the same size. */
export function iou(a: Mask, b: Mask): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error("iou: masks must be the same size");
  }
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.bits.length; i += 1) {
    const x = a.bits[i]!;
    const y = b.bits[i]!;
    if (x & y) intersection += 1;
    if (x | y) union += 1;
  }
  return union === 0 ? 0 : intersection / union;
}
