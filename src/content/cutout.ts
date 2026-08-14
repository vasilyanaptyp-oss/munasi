import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMain } from "../util/main.js";

/**
 * Turns a photo on a white background into a cut-out PNG:
 *
 *   pnpm cutout
 *
 * Reads `assets/fighters/source/*.jpg` and writes `assets/fighters/*.png`,
 * trimmed to the figure with a transparent background. Run once when a
 * character is added; the results are committed, so rendering never depends on
 * this and a batch never pays for it.
 *
 * **Flood-filled from the border, not thresholded.** A threshold would eat the
 * white shirt and the white cuffs out of the middle of a figure in a dark suit.
 * The background is whatever white is reachable from the edge of the frame.
 */

/** A pixel this close to white, reachable from the border, is background. */
const WHITE = 236;
/** Pixels this close to background-white get their alpha ramped down instead of
 * cut hard, which is what kills the grey JPEG fringe around a cut edge. */
const FEATHER = 208;

export interface Cutout {
  png: Buffer;
  width: number;
  height: number;
  /** Share of the source area the figure occupies, for a sanity check. */
  coverage: number;
}

export async function cutout(sourcePath: string): Promise<Cutout> {
  const image = await loadImage(sourcePath);
  const w = image.width;
  const h = image.height;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;

  const near = (i: number, level: number): boolean =>
    px[i]! >= level && px[i + 1]! >= level && px[i + 2]! >= level;

  // Flood fill the background inward from every border pixel.
  const background = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = y * w + x;
    if (background[p]) return;
    if (!near(p * 4, WHITE)) return;
    background[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < w; x += 1) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length > 0) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  // Holes the border fill cannot reach: the gap between a raised arm and a head
  // is background too, but it is walled in by the figure.
  //
  // Told apart from a genuinely white garment by texture, because that is what
  // actually differs. Measured on these two photos: the studio paper runs mean
  // luma 251-254 at a standard deviation of 1.5-2.4, while the bodyguard's shirt
  // and cuffs run 244-247 at 4.5-5.2. Cloth has folds and shading; paper has
  // none. The rule below sits in the gap with room on both sides.
  const HOLE_LUMA = 249;
  const HOLE_SPREAD = 3.5;
  const visited = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const seed = y * w + x;
      if (visited[seed] || background[seed]) continue;
      if (!near(seed * 4, WHITE)) {
        visited[seed] = 1;
        continue;
      }
      const region: number[] = [];
      const queue = [seed];
      visited[seed] = 1;
      let sum = 0;
      let sumSq = 0;
      while (queue.length > 0) {
        const p = queue.pop()!;
        region.push(p);
        const i = p * 4;
        const luma = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
        sum += luma;
        sumSq += luma * luma;
        const cx = p % w;
        const cy = (p - cx) / w;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (visited[n] || background[n]) continue;
          if (!near(n * 4, WHITE)) {
            visited[n] = 1;
            continue;
          }
          visited[n] = 1;
          queue.push(n);
        }
      }
      const mean = sum / region.length;
      const spread = Math.sqrt(Math.max(0, sumSq / region.length - mean * mean));
      if (region.length > 150 && mean >= HOLE_LUMA && spread < HOLE_SPREAD) {
        for (const p of region) background[p] = 1;
      }
    }
  }

  // Cut, and soften the boundary: a pixel next to the background that is nearly
  // white is part of the photo's own halo, so it fades rather than stays.
  let kept = 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      const i = p * 4;
      if (background[p]) {
        px[i + 3] = 0;
        continue;
      }
      const touchesBackground =
        (x > 0 && background[p - 1] === 1) ||
        (x < w - 1 && background[p + 1] === 1) ||
        (y > 0 && background[p - w] === 1) ||
        (y < h - 1 && background[p + w] === 1);
      if (touchesBackground && near(i, FEATHER)) {
        const level = Math.max(px[i]!, px[i + 1]!, px[i + 2]!);
        const t = (level - FEATHER) / (255 - FEATHER);
        px[i + 3] = Math.round(255 * (1 - Math.min(1, Math.max(0, t))));
      }
      if (px[i + 3]! > 8) {
        kept += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error(`${sourcePath}: nothing left after cutting the background`);
  ctx.putImageData(data, 0, 0);

  // Trim to the figure, so the sprite's box is the figure and the renderer does
  // not have to guess where inside a photo the person actually is.
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  const out = createCanvas(tw, th);
  out.getContext("2d").drawImage(canvas, minX, minY, tw, th, 0, 0, tw, th);

  return { png: out.toBuffer("image/png"), width: tw, height: th, coverage: kept / (w * h) };
}

export const FIGHTER_DIR = join(process.cwd(), "assets", "fighters");

async function main(): Promise<void> {
  const sourceDir = join(FIGHTER_DIR, "source");
  const files = readdirSync(sourceDir).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
  if (files.length === 0) {
    console.log(`no source images in ${sourceDir}`);
    return;
  }
  for (const file of files) {
    const result = await cutout(join(sourceDir, file));
    const name = `${file.replace(/\.[^.]+$/, "")}.png`;
    writeFileSync(join(FIGHTER_DIR, name), result.png);
    console.log(
      `${file.padEnd(24)} -> ${name.padEnd(24)} ${result.width}x${result.height}  ` +
        `figure is ${(result.coverage * 100).toFixed(0)}% of the source`,
    );
  }
}

if (isMain(import.meta.url)) await main();

/**
 * Width over height of a cut-out, read straight from the PNG header.
 *
 * Deliberately not via a canvas: the simulation's roster needs this number, and
 * `src/sim` must never end up depending on the render stack to know how wide a
 * fighter is. Sixteen bytes of IHDR is enough.
 */
export function spriteAspect(spriteId: string): number {
  const png = readFileSync(join(FIGHTER_DIR, `${spriteId}.png`));
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width <= 0 || height <= 0) throw new Error(`${spriteId}.png: bad dimensions`);
  return width / height;
}
