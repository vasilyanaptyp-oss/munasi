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
/**
 * Is there a picture for this prop?
 *
 * An ability whose PNG has not been supplied yet draws nothing at all — see the
 * note at the top of `signatures.ts`. That is a shippable state, so a missing
 * file must be a quiet no, not the throw `propImage` gives.
 */
export function hasProp(id: string): boolean {
  return props.has(id);
}

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
  /**
   * **The ability treatments — all of them done to the photograph itself.**
   *
   * There is no illustration anywhere in this format, so an ability that wants
   * to be seen has to be seen *on the cut-outs*, which are the only material
   * there is. A boxer who is charging grows and smears; a man who has just been
   * hit by one is knocked crooked; a man being dragged leaves copies of himself
   * behind him; a man who has been stopped goes pale and still.
   *
   * - `scale` — multiplier about the centre. Bigger reads as coming at you.
   * - `rotation` — radians about the centre. A figure knocked off true.
   * - `smear` — how far back to trail copies of the photo, in pixels, along
   *   `smearAngle`. This is the picture repeated, not a drawn motion line.
   * - `wash` — 0..1 toward a flat white silhouette. Held short of 1 it reads as
   *   bleached and frozen rather than as the full hit flash.
   */
  scale?: number;
  rotation?: number;
  smear?: number;
  smearAngle?: number;
  wash?: number;
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

  const alive = options.fade !== undefined ? 1 - options.fade : 1;
  const scale = options.scale ?? 1;
  const rotation = options.rotation ?? 0;
  const smear = options.smear ?? 0;

  ctx.save();
  // Everything below is drawn in the figure's own frame, so scale and rotation
  // happen about its centre rather than about the arena's origin.
  ctx.translate(x, y);
  if (rotation !== 0) ctx.rotate(rotation);
  if (scale !== 1) ctx.scale(scale, scale);

  const drawKeyed = (ox: number, oy: number, alpha: number): void => {
    ctx.globalAlpha = alpha;
    for (const [dx, dy] of OFFSETS) {
      ctx.drawImage(
        layer,
        0,
        0,
        bw,
        bh,
        ox - w / 2 - pad + dx * PHOTO_OUTLINE,
        oy - h / 2 - pad + dy * PHOTO_OUTLINE,
        bw,
        bh,
      );
    }
    ctx.drawImage(image, ox - w / 2, oy - h / 2, w, h);
  };

  // The smear: the photograph itself, repeated back along where it came from.
  if (smear > 0) {
    const angle = options.smearAngle ?? 0;
    for (let i = 3; i >= 1; i -= 1) {
      const back = (i / 3) * smear;
      drawKeyed(-Math.cos(angle) * back, -Math.sin(angle) * back, alive * (0.26 / i));
    }
  }

  drawKeyed(0, 0, alive);

  // A hit turns the figure into a solid white silhouette, exactly as in the
  // reference — it reads at thumbnail size where a tint does not. `wash` is the
  // same stamp held part-way, for a figure that has been stopped rather than hit.
  const white = Math.max(options.flash ?? 0, options.wash ?? 0);
  if (white > 0) {
    ctx.globalAlpha = alive * white;
    ctx.drawImage(layer, pad, pad, w, h, -w / 2, -h / 2, w, h);
  }
  ctx.restore();
}
