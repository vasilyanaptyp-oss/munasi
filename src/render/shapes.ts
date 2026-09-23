import type { SKRSContext2D } from "@napi-rs/canvas";

/**
 * Drawing primitives shared by the fighter art.
 *
 * Everything is authored in unit space: x and y run -1..1 with the origin at
 * the fighter's centre and +y pointing down. The renderer scales that to
 * whatever pixel size it needs, which is why the same code draws a 400px
 * fighter and a 120px minion.
 */
export type Ctx = SKRSContext2D;

export type Point = readonly [number, number];

export function poly(ctx: Ctx, points: readonly Point[], fill: string): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

export function circle(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function ellipse(
  ctx: Ctx,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string,
  rotation = 0,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Axis-aligned box centred on (x, y). */
export function box(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
}

export function roundedBox(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
): void {
  const left = x - w / 2;
  const top = y - h / 2;
  ctx.beginPath();
  ctx.moveTo(left + r, top);
  ctx.arcTo(left + w, top, left + w, top + h, r);
  ctx.arcTo(left + w, top + h, left, top + h, r);
  ctx.arcTo(left, top + h, left, top, r);
  ctx.arcTo(left, top, left + w, top, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

export function line(
  ctx: Ctx,
  from: Point,
  to: Point,
  width: number,
  stroke: string,
): void {
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(to[0], to[1]);
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke;
  ctx.lineCap = "round";
  ctx.stroke();
}

/** Two dots. `open` 0..1 squashes them into blinks. */
export function eyes(
  ctx: Ctx,
  y: number,
  spread: number,
  r: number,
  color: string,
  open = 1,
): void {
  const h = Math.max(0.006, r * open);
  ellipse(ctx, -spread, y, r, h, color);
  ellipse(ctx, spread, y, r, h, color);
}

/** Deterministic blink pattern; `period` and `offset` are in frames. */
export function blink(frame: number, period: number, offset = 0): number {
  const phase = (frame + offset) % period;
  return phase < 3 ? phase / 3 : 1;
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
