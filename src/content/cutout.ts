import { createCanvas, loadImage } from "@napi-rs/canvas";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join } from "node:path";
import { isMain } from "../util/main.js";
import { inProject } from "../util/paths.js";

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

/**
 * How white the background has to be before the fill stops.
 *
 * The fighters' photos are cut on a hard studio white, so the default pair is
 * tuned tight enough to keep a white shirt. A product shot of a **prop** is
 * usually lit with a soft drop shadow underneath it, and that shadow is grey —
 * well under 236 — so the default fill stops at its edge and leaves a smudge
 * around the object. On the arena's black square that smudge is the most
 * visible thing in the picture. Props therefore cut on a looser threshold.
 */
export interface CutoutOptions {
  white?: number;
  feather?: number;
  /**
   * Cap on the output's width.
   *
   * A prop is drawn at a fraction of a fighter's height — the compass lands
   * around 250px on a 1080-wide frame — so carrying the 900px cut-out of a
   * product shot is most of a megabyte for pixels nothing ever samples.
   */
  maxWidth?: number;
}

export interface Cutout {
  png: Buffer;
  width: number;
  height: number;
  /** Share of the source area the figure occupies, for a sanity check. */
  coverage: number;
}

export async function cutout(sourcePath: string, options: CutoutOptions = {}): Promise<Cutout> {
  const white = options.white ?? WHITE;
  const feather = options.feather ?? FEATHER;
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
    if (!near(p * 4, white)) return;
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
      if (!near(seed * 4, white)) {
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
          if (!near(n * 4, white)) {
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
      if (touchesBackground && near(i, feather)) {
        const level = Math.max(px[i]!, px[i + 1]!, px[i + 2]!);
        const t = (level - feather) / (255 - feather);
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
  const cap = options.maxWidth ?? Infinity;
  const ow = Math.min(tw, cap);
  const oh = Math.max(1, Math.round((th * ow) / tw));
  const out = createCanvas(ow, oh);
  out.getContext("2d").drawImage(canvas, minX, minY, tw, th, 0, 0, ow, oh);

  return { png: out.toBuffer("image/png"), width: ow, height: oh, coverage: kept / (w * h) };
}

export const FIGHTER_DIR = inProject("assets", "fighters");
export const PROP_DIR = inProject("assets", "props");

/**
 * Props cut looser than fighters.
 *
 * A product shot is lit with a soft drop shadow under the object, and that
 * shadow is grey — far under the 236 the studio paper behind a person sits at.
 * Cut at the fighters' threshold, a compass keeps a grey wisp along its bottom
 * edge, and on the arena's black square that wisp is the thing you notice.
 * Measured on `compass.jpg`: 236 leaves it, 200 takes it, and the only thing
 * 200 costs is a sliver of the transparent plastic lid, which is transparent.
 */
const PROP_WHITE = 200;
/** See `maxWidth` — a prop draws at a quarter of this and no one samples the rest. */
const PROP_MAX_WIDTH = 512;

/**
 * What a cut that went wrong looks like, in one number.
 *
 * The background is flood-filled inward from the border, so a photograph that
 * is not on studio white does not fail — it **succeeds at keeping everything**,
 * and you get a rectangle of somebody's living room on the arena. The shipped
 * cast runs 36-61% coverage. Well above that band means the fill never got in;
 * well below means it ate the figure.
 *
 * This is a warning rather than an error because the bands are advisory: a very
 * tightly cropped photograph can legitimately sit high. But a new user's first
 * run is exactly where a silently wrong cut costs an hour, and until now the
 * only signal was a percentage with nothing to compare it to.
 */
export function cutoutWarning(coverage: number): string | null {
  if (coverage > 0.85) {
    return "the background is still there — the photo needs a white studio backdrop, " +
      "not a room or a grey sweep";
  }
  if (coverage < 0.12) {
    return "almost nothing survived — a very light subject on white can be eaten by the fill";
  }
  return null;
}

async function cutDir(dir: string, options: CutoutOptions = {}): Promise<number> {
  const sourceDir = join(dir, "source");
  if (!existsSync(sourceDir)) return 0;
  const files = readdirSync(sourceDir).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
  for (const file of files) {
    const result = await cutout(join(sourceDir, file), options);
    const name = `${file.replace(/\.[^.]+$/, "")}.png`;
    writeFileSync(join(dir, name), result.png);
    console.log(
      `${file.padEnd(24)} -> ${name.padEnd(24)} ${result.width}x${result.height}  ` +
        `figure is ${(result.coverage * 100).toFixed(0)}% of the source`,
    );
    const warning = cutoutWarning(result.coverage);
    if (warning !== null) console.log(`${" ".repeat(24)}    ! ${warning}`);
  }
  return files.length;
}

async function main(): Promise<void> {
  const fighters = await cutDir(FIGHTER_DIR);
  const props = await cutDir(PROP_DIR, { white: PROP_WHITE, feather: PROP_WHITE - 28, maxWidth: PROP_MAX_WIDTH });
  if (fighters + props === 0) console.log("no source images under assets/*/source");
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

/**
 * Alpha channel of a cut-out, decoded from the PNG itself.
 *
 * Hand-rolled rather than run through a canvas, for the same reason
 * `spriteAspect` is: what comes out of here ends up in `fighters.json` and gets
 * collided against by `src/sim`, which must never reach into the render stack.
 * `zlib` is in Node; the rest is the filter table from the PNG spec.
 *
 * Only what `pnpm cutout` writes is accepted — 8-bit RGBA, not interlaced — and
 * anything else throws rather than being guessed at.
 */
function spriteAlpha(spriteId: string): { width: number; height: number; alpha: Uint8Array } {
  const png = readFileSync(join(FIGHTER_DIR, `${spriteId}.png`));
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const depth = png[24];
  const colourType = png[25];
  const interlace = png[28];
  if (depth !== 8 || colourType !== 6 || interlace !== 0) {
    throw new Error(
      `${spriteId}.png: expected 8-bit RGBA, not interlaced; got depth ${depth}, ` +
        `colour type ${colourType}, interlace ${interlace}`,
    );
  }

  const parts: Buffer[] = [];
  for (let at = 8; at + 8 <= png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    if (type === "IDAT") parts.push(png.subarray(at + 8, at + 8 + length));
    if (type === "IEND") break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));

  // Undo the per-scanline filters. `bpp` is 4 because the colour type is RGBA8,
  // and each row is one filter byte followed by the pixels.
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i += 1) {
      const x = raw[src + i]!;
      const a = i >= bpp ? out[dst + i - bpp]! : 0;
      const b = y > 0 ? out[dst - stride + i]! : 0;
      const c = i >= bpp && y > 0 ? out[dst - stride + i - bpp]! : 0;
      let value: number;
      switch (filter) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`${spriteId}.png: unknown row filter ${filter}`);
      }
      out[dst + i] = value & 0xff;
    }
  }

  const alpha = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p += 1) alpha[p] = out[p * bpp + 3]!;
  return { width, height, alpha };
}

/**
 * How many horizontal slices a silhouette is cut into.
 *
 * Twenty-four over a figure that stands 30% of the arena tall puts a band at
 * roughly the height of a head, which is the finest distinction that matters:
 * a raised arm, a guitar neck and a pair of shoulders all land in different
 * bands, and nothing smaller than a head changes whether two photographs look
 * like they touched.
 */
export const SILHOUETTE_BANDS = 24;

/** Alpha above this counts as the figure. Same threshold `cutout` trims on. */
const SOLID_ALPHA = 8;

/**
 * The figure's outline, as the left and right edge of each horizontal band.
 *
 * **This is what the fighters collide on.** It used to be the bounding box
 * scaled by a hand-set share — 0.5, then 0.75, tuned by how the fights felt —
 * and a share is the wrong shape twice over: at the shoulders it is narrower
 * than the man, and beside his head it is wider than the air. Two photographs
 * would stop dead with a hand's width of blue between them, or slide through
 * each other at the ankles.
 *
 * Both numbers are fractions of the sprite's own width, so the profile scales
 * with whatever size the renderer draws the figure at and cannot drift from it.
 * A band with nothing in it reads `[0, 0]` and never collides.
 */
export function spriteProfile(
  spriteId: string,
  bands = SILHOUETTE_BANDS,
): [number, number][] {
  const { width, height, alpha } = spriteAlpha(spriteId);
  const profile: [number, number][] = [];
  for (let band = 0; band < bands; band += 1) {
    // Rounded rather than floored so the last band ends exactly on the last row
    // and no row is counted twice or dropped.
    const y0 = Math.round((band * height) / bands);
    const y1 = Math.max(y0 + 1, Math.round(((band + 1) * height) / bands));
    let left = width;
    let right = -1;
    for (let y = y0; y < y1; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (alpha[y * width + x]! <= SOLID_ALPHA) continue;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
    profile.push(right < 0 ? [0, 0] : [left / width, (right + 1) / width]);
  }
  return profile;
}
