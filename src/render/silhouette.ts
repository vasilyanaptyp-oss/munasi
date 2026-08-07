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
