import type { FigureBox, FrameMeasure } from "./measure.js";

/**
 * Reads a finished video frame the way a viewer reads it, and nothing else.
 *
 * **The point of this file is what it does not import.** Every gate in this
 * project so far has measured the simulation — the event list, the positions,
 * the damage numbers — and the simulation is exactly the thing under suspicion
 * when the owner says a hit did not register. A gate that reads
 * `result.events` can only ever confirm that the simulation agrees with
 * itself; it cannot see two photographs plainly colliding with no number on
 * screen, because from inside the simulation that frame looks identical to one
 * where they missed.
 *
 * So the detectors here take pixels and give back what is *visible*: where the
 * fighters are, whether they are touching, whether a damage number just
 * appeared, whether somebody flashed white. The comparison against the
 * simulation happens elsewhere, on purpose, and disagreement between the two
 * is the finding.
 */

/** Damage numbers are #c6f16e — green above red, which is what separates them
 * from anything a person on a photograph is wearing. Measured, not guessed:
 * the previous threshold (`g > 150`) passed the boxer's ochre trousers and
 * reported a number present in 850 frames of 852. */
export function isDamageInk(r: number, g: number, b: number): boolean {
  return g > 200 && g > r + 15 && b < 170 && g - b > 70;
}

/**
 * A hit flash: the victim is drawn as a solid white silhouette for a frame or
 * two. Read inside his own box, so the caption and the HP plus cannot cause it.
 *
 * **The level is 200, not 255, and that is arithmetic rather than taste.** The
 * renderer paints white over the photograph at 0.8 alpha, so a black pixel of
 * the photo comes out at 204 and a mid-grey at 229 — a threshold of 232 sees
 * almost none of it. Measured on a shipped video with 232: the whitest any
 * figure ever got was 0.20 of his own box, and the audit reported zero flashes
 * in a fight with 25 hits in it.
 */
const FLASH_LEVEL = 200;
const FLASH_SHARE = 0.5;

export interface NumberBlob {
  x: number;
  y: number;
  pixels: number;
}

/**
 * Damage numbers on this frame, as blobs.
 *
 * Clustered by proximity rather than flood-filled: a number is several separate
 * glyphs and a flood fill would report "-118" as four findings.
 */
export function findNumbers(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): NumberBlob[] {
  const gap = Math.max(4, Math.round(width * 0.035));
  const blobs: { sx: number; sy: number; n: number; minX: number; maxX: number; minY: number; maxY: number }[] = [];
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const p = (y * width + x) * 4;
      if (!isDamageInk(data[p]!, data[p + 1]!, data[p + 2]!)) continue;
      const near = blobs.find(
        (b) => x >= b.minX - gap && x <= b.maxX + gap && y >= b.minY - gap && y <= b.maxY + gap,
      );
      if (near) {
        near.sx += x;
        near.sy += y;
        near.n += 1;
        near.minX = Math.min(near.minX, x);
        near.maxX = Math.max(near.maxX, x);
        near.minY = Math.min(near.minY, y);
        near.maxY = Math.max(near.maxY, y);
      } else {
        blobs.push({ sx: x, sy: y, n: 1, minX: x, maxX: x, minY: y, maxY: y });
      }
    }
  }
  // Under a dozen sampled pixels is codec noise on the edge of a costume, not
  // a four-digit number set at 26% of a 78px plus.
  return blobs
    .filter((b) => b.n >= 12)
    .map((b) => ({ x: b.sx / b.n, y: b.sy / b.n, pixels: b.n }));
}

/** Share of a figure's own box that is drawn near-white. */
export function flashShare(
  data: Uint8ClampedArray,
  width: number,
  box: FigureBox,
): number {
  let white = 0;
  let total = 0;
  for (let y = box.y; y < box.y + box.h; y += 2) {
    for (let x = box.x; x < box.x + box.w; x += 2) {
      const p = (y * width + x) * 4;
      total += 1;
      if (data[p]! > FLASH_LEVEL && data[p + 1]! > FLASH_LEVEL && data[p + 2]! > FLASH_LEVEL) {
        white += 1;
      }
    }
  }
  return total === 0 ? 0 : white / total;
}

/** Do the two figures' boxes intersect, and by how much of the smaller one. */
export function boxOverlap(a: FigureBox, b: FigureBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.w * a.h, b.w * b.h);
}

/**
 * The fighters, found inside the arena rather than under their HP plus.
 *
 * **The plus cannot carry this.** `measure.ts` finds a fighter by walking down
 * from his plus, which is fine for a median speed but useless here: the plus
 * drains dark grey from the top, so once a fighter is under about half health
 * the white blob stops being plus-shaped and the detector loses him. Measured
 * on a shipped 615-frame video — no plus found at all on **426 frames**, and
 * both fighters readable on 80. An audit standing on that would have been
 * reporting the first four seconds of every fight.
 *
 * Inside the arena there is only one kind of thing that is neither the field's
 * blue nor the arena's black, and that is a photograph. So: flood-fill
 * everything that is neither, throw out the blobs that are damage ink or an HP
 * plus, and keep the two biggest.
 */
export function findFigures(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  arena: { top: number; bottom: number } | null,
): FigureBox[] {
  const top = arena ? Math.max(0, arena.top) : 0;
  const bottom = arena ? Math.min(height - 1, arena.bottom) : height - 1;
  const isField = (p: number): boolean =>
    Math.abs(data[p]! - 24) < 26 && Math.abs(data[p + 1]! - 162) < 26 && Math.abs(data[p + 2]! - 211) < 26;
  const isWall = (p: number): boolean => data[p]! < 60 && data[p + 1]! < 60 && data[p + 2]! < 60;

  const seen = new Uint8Array(width * height);
  const boxes: (FigureBox & { area: number; ink: number; white: number })[] = [];
  const minArea = Math.round(width * height * 0.002);
  const maxArea = Math.round(width * height * 0.12);

  for (let y = top; y <= bottom; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (seen[start]) continue;
      const sp = start * 4;
      if (isField(sp) || isWall(sp)) {
        seen[start] = 1;
        continue;
      }
      let area = 0;
      let ink = 0;
      let white = 0;
      let minX = width;
      let maxX = -1;
      let minY = height;
      let maxY = -1;
      const stack = [start];
      seen[start] = 1;
      while (stack.length > 0) {
        const q = stack.pop()!;
        const qx = q % width;
        const qy = (q - qx) / width;
        const qp = q * 4;
        area += 1;
        if (isDamageInk(data[qp]!, data[qp + 1]!, data[qp + 2]!)) ink += 1;
        if (data[qp]! > FLASH_LEVEL && data[qp + 1]! > FLASH_LEVEL && data[qp + 2]! > FLASH_LEVEL) white += 1;
        if (qx < minX) minX = qx;
        if (qx > maxX) maxX = qx;
        if (qy < minY) minY = qy;
        if (qy > maxY) maxY = qy;
        if (area > maxArea) break;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = qx + dx;
          const ny = qy + dy;
          if (nx < 0 || ny < top || nx >= width || ny > bottom) continue;
          const n = ny * width + nx;
          if (seen[n]) continue;
          const np = n * 4;
          if (isField(np) || isWall(np)) {
            seen[n] = 1;
            continue;
          }
          seen[n] = 1;
          stack.push(n);
        }
      }
      if (area < minArea || area > maxArea) continue;
      boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area, ink, white });
    }
  }

  // A person is 0.35-0.375 of the arena's height — measured off the reference,
  // and the one proportion of this format that is nailed down. Half of the
  // smallest of that is a floor no prop, number or plus reaches, and no fighter
  // falls under.
  const arenaHeight = arena ? arena.bottom - arena.top : height;
  const personFloor = arenaHeight * 0.18;

  return boxes
    // A blob that is mostly damage ink is the number, and one that is a small
    // solid white square is the HP plus. Neither is a person.
    .filter((b) => b.ink / b.area < 0.4)
    .filter((b) => !(b.white / b.area > 0.6 && b.w < width * 0.2 && Math.abs(b.w - b.h) < b.w * 0.35))
    // **Without this, the detector always returns exactly two boxes**, because
    // it took the two largest blobs whatever they were: measured on a shipped
    // video it reported two figures on all 615 frames, with the fifth-percentile
    // "fighter" 75px tall against a median of 204. A flying pair of glasses was
    // being collided with.
    .filter((b) => b.h >= personFloor)
    .sort((p, q) => q.area - p.area)
    .slice(0, 2)
    .map(({ x, y, w, h }) => ({ x, y, w, h }));
}

export interface FrameRead extends Omit<FrameMeasure, "figures"> {
  figures: FigureBox[];
  numbers: NumberBlob[];
  /** Per figure, how much of him is drawn white this frame. */
  flashes: number[];
  /** Overlap between the two figures, 0 when there are not two of them. */
  overlap: number;
}

export function readFrame(
  measure: FrameMeasure,
  data: Uint8ClampedArray,
  width: number,
  height: number,
): FrameRead {
  const figures = findFigures(data, width, height, measure.arena);
  const a = figures[0];
  const b = figures[1];
  return {
    ...measure,
    figures,
    numbers: findNumbers(data, width, height),
    flashes: figures.map((f) => flashShare(data, width, f)),
    overlap: a && b ? boxOverlap(a, b) : 0,
  };
}

export { FLASH_SHARE };
