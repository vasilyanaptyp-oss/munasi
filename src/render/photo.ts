import { createCanvas, loadImage, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Draws a fighter: a cut-out photo with a white keyline.
 *
 * This replaces the procedural art. A character in the reference is a PNG with
 * the background removed and a white outline traced round it, floating on the
 * flat blue field — nothing is drawn by hand, and the whole visual identity is
 * the photo. Anything drawn by code would have to be as recognisable as a
 * photograph is, and it never was.
 *
 * Loaded synchronously and cached: `renderGauntletFrame` is a pure synchronous
 * function of `(result, frame)` and every worker process renders its own stripe,
 * so an async load here would either break that contract or reload the same file
 * a thousand times.
 */

const FIGHTER_DIR = join(process.cwd(), "assets", "fighters");
const PROP_DIR = join(process.cwd(), "assets", "props");

/**
 * Every fighter's cut-out, decoded once when this module loads.
 *
 * Decoded up front rather than on demand because `renderGauntletFrame` is
 * synchronous and has to stay that way — the worker split depends on a frame
 * being a pure synchronous function of `(result, frame)`. And decoded with
 * `loadImage` rather than `new Image()` with a buffer: the latter reports the
 * right width and height and then draws nothing at all, which cost an hour of
 * looking at empty arenas.
 */
const images = new Map<string, Image>(
  await Promise.all(
    readdirSync(FIGHTER_DIR)
      .filter((f) => f.endsWith(".png"))
      .map(async (f): Promise<[string, Image]> => [
        f.replace(/\.png$/, ""),
        await loadImage(readFileSync(join(FIGHTER_DIR, f))),
      ]),
  ),
);

/**
 * Props an ability throws — decoded here for the same reason the fighters are:
 * the frame render is synchronous and every worker draws its own stripe.
 */
const props = new Map<string, Image>(
  await Promise.all(
    readdirSync(PROP_DIR)
      .filter((f) => f.endsWith(".png"))
      .map(async (f): Promise<[string, Image]> => [
        f.replace(/\.png$/, ""),
        await loadImage(readFileSync(join(PROP_DIR, f))),
      ]),
  ),
);

/** A thrown prop, e.g. the pair of spectacles `FOUR EYES` puts in the air. */
export function propImage(id: string): Image {
  const image = props.get(id);
  if (!image) throw new Error(`no prop ${id} — expected assets/props/${id}.png`);
  return image;
}

export function fighterImage(spriteId: string): Image {
  const image = images.get(spriteId);
  if (!image) {
    throw new Error(
      `no cut-out for ${spriteId} — put a photo in assets/fighters/source/ and run \`pnpm cutout\``,
    );
  }
  return image;
}

/** Width over height of a fighter's cut-out. */
export function photoAspect(spriteId: string): number {
  const image = fighterImage(spriteId);
  return image.width / image.height;
}

/** Thickness of the white keyline, in pixels at 1080 wide. */
export const PHOTO_OUTLINE = 7;

const OFFSETS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.7, 0.7],
  [-0.7, 0.7],
  [0.7, -0.7],
  [-0.7, -0.7],
];

export interface DrawPhotoOptions {
  /** Centre of the figure. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0..1 white damage flash, drawn as a solid white silhouette in the reference. */
  flash?: number;
  /** 0..1 death fade. */
  fade?: number;
}

/**
 * Scratch layers, keyed on the exact size and bounded.
 *
 * Exact, because an oversized canvas read back through a source rectangle does
 * not give the same pixels as one that fits — measured. A shared canvas that
 * grew as the camera zoomed made a frame depend on which frames had been drawn
 * before it, which breaks the one contract the whole render rests on.
 *
 * Bounded, because the camera's zoom lands on a different integer nearly every
 * frame, so an unbounded map is a leak wearing a cache's clothes. That one has
 * been paid for once already.
 */
const SCRATCH_LIMIT = 8;
const scratch = new Map<string, Canvas>();
function scratchCanvas(w: number, h: number): Canvas {
  const key = `${w}x${h}`;
  const existing = scratch.get(key);
  if (existing) return existing;
  const canvas = createCanvas(w, h);
  scratch.set(key, canvas);
  if (scratch.size > SCRATCH_LIMIT) {
    for (const k of scratch.keys()) {
      scratch.delete(k);
      break;
    }
  }
  return canvas;
}

export function drawPhoto(ctx: SKRSContext2D, spriteId: string, options: DrawPhotoOptions): void {
  const image = fighterImage(spriteId);
  const { x, y, w, h } = options;
  const pad = PHOTO_OUTLINE * 2 + 4;
  const bw = Math.ceil(w + pad * 2);
  const bh = Math.ceil(h + pad * 2);

  // The figure on its own layer, so the keyline can be stamped from its alpha.
  const layer = scratchCanvas(bw, bh);
  const lc = layer.getContext("2d");
  lc.clearRect(0, 0, bw, bh);
  lc.drawImage(image, pad, pad, w, h);

  // Keyline: the figure's alpha flooded white and stamped around a ring. Eight
  // offsets rather than four — a photo has diagonal edges everywhere, and four
  // leaves the outline visibly thin on them.
  lc.save();
  lc.globalCompositeOperation = "source-in";
  lc.fillStyle = "#ffffff";
  lc.fillRect(0, 0, bw, bh);
  lc.restore();

  const left = x - w / 2 - pad;
  const top = y - h / 2 - pad;
  ctx.save();
  if (options.fade !== undefined && options.fade > 0) ctx.globalAlpha = 1 - options.fade;
  for (const [dx, dy] of OFFSETS) {
    ctx.drawImage(layer, 0, 0, bw, bh, left + dx * PHOTO_OUTLINE, top + dy * PHOTO_OUTLINE, bw, bh);
  }

  // Then the photo itself over the keyline.
  ctx.drawImage(image, x - w / 2, y - h / 2, w, h);

  // A hit turns the figure into a solid white silhouette, exactly as in the
  // reference — it reads at thumbnail size where a tint does not.
  const flash = options.flash ?? 0;
  if (flash > 0) {
    ctx.globalAlpha = (options.fade !== undefined ? 1 - options.fade : 1) * flash;
    ctx.drawImage(layer, pad, pad, w, h, x - w / 2, y - h / 2, w, h);
  }
  ctx.restore();
}
