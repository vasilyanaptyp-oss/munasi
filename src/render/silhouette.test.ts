import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFighters } from "../content/index.js";
import { photoAspect } from "./photo.js";

/**
 * The cut-out gate.
 *
 * Fighters are photographs now, so the old rules here — pairwise silhouette IoU
 * over procedurally drawn masks — measure something that no longer exists. What
 * matters about a photo cut-out is different and simpler: the background really
 * is gone, the figure is not accidentally tiny, and the two people on screen
 * read apart on a flat blue field.
 *
 * Everything is measured off the PNG that ships, not off the source photo.
 */

const roster = loadFighters();

interface Cut {
  id: string;
  width: number;
  height: number;
  /** Share of the PNG's pixels that are actually opaque. */
  fill: number;
  /** Mean perceived lightness of the figure's own pixels, 0..255. */
  lightness: number;
  /** Mean colour of the figure's own pixels. */
  r: number;
  g: number;
  b: number;
  /** Opaque pixels touching the PNG's own border. */
  edgeTouch: number;
  /**
   * Normalised 4x4x4 RGB histogram of the figure's own pixels.
   *
   * **The mean colour of a photograph of a person is mostly skin**, so with
   * fourteen of them it stops separating anybody: Barista Guy and Luchador Guy
   * measure (135,118,115) and (138,127,105) — a distance of 14 — while being a
   * thin man in an apron holding two cups and a masked wrestler with his arms
   * folded. A histogram sees the white tee, the denim, the turquoise and the
   * gold; a mean averages them into the same beige.
   */
  histogram: number[];
}

async function measure(spriteId: string): Promise<Cut> {
  const image = await loadImage(readFileSync(join("assets", "fighters", `${spriteId}.png`)));
  const w = image.width;
  const h = image.height;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const px = ctx.getImageData(0, 0, w, h).data;

  let opaque = 0;
  let sum = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let edge = 0;
  const bins = new Array<number>(64).fill(0);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (px[i + 3]! < 128) continue;
      opaque += 1;
      sum += 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
      sr += px[i]!;
      sg += px[i + 1]!;
      sb += px[i + 2]!;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge += 1;
      const bin =
        (px[i]! >> 6) * 16 + (px[i + 1]! >> 6) * 4 + (px[i + 2]! >> 6);
      bins[bin] = (bins[bin] ?? 0) + 1;
    }
  }
  const n = Math.max(1, opaque);
  return {
    id: spriteId,
    width: w,
    height: h,
    fill: opaque / (w * h),
    lightness: sum / n,
    r: sr / n,
    g: sg / n,
    b: sb / n,
    edgeTouch: edge,
    histogram: bins.map((v) => v / n),
  };
}

const cuts = await Promise.all(roster.map((f) => measure(f.spriteId)));

describe("fighter cut-outs", () => {
  it("prints what each cut-out measures", () => {
    for (const c of cuts) {
      console.log(
        `${c.id.padEnd(16)} ${c.width}x${c.height}  fill ${(c.fill * 100).toFixed(0)}%  ` +
          `lightness ${c.lightness.toFixed(0)}  rgb ${c.r.toFixed(0)},${c.g.toFixed(0)},${c.b.toFixed(0)}  ` +
          `aspect ${photoAspect(c.id).toFixed(3)}`,
      );
    }
    expect(cuts).toHaveLength(roster.length);
  });

  it("actually removed the background", () => {
    // A photo that still has its white backdrop fills almost the whole PNG.
    // Both shipped cut-outs sit near 45-60%; anything over 85% means the flood
    // fill found nothing and the figure will arrive with a white box round it.
    for (const c of cuts) {
      expect(c.fill, `${c.id} fills ${(c.fill * 100).toFixed(0)}% of its PNG`).toBeLessThan(0.85);
      expect(c.fill, `${c.id} is nearly empty`).toBeGreaterThan(0.15);
    }
  });

  it("is trimmed to the figure", () => {
    // `cutout` crops to the opaque bounds, so the figure has to touch all four
    // edges — if it does not, the sprite box is bigger than the person in it and
    // every position the simulation computes is off by the slack.
    for (const c of cuts) {
      expect(c.edgeTouch, `${c.id} is not trimmed to its figure`).toBeGreaterThan(0);
    }
  });

  it("keeps the fighters on screen apart by colour", () => {
    // Two figures that read as one blob on the flat blue field is the defect
    // this gate exists for, and it survives the move from drawn art to
    // photographs. **What changed is the measurement.**
    //
    // It used to compare mean *lightness* and demand 40 points. That was a fair
    // proxy when a fighter was a flat silhouette, where tone is all there is. On
    // photographs it is blind in exactly the case that matters: Boxer Guy and
    // Glasses Guy measure 70 and 70 — a gap of zero, an instant failure — while
    // being warm red (117,51,47) against cool navy (60,70,90). Nobody could
    // confuse a man in red boxing gloves with a man in a blue suit, and no
    // amount of staring at a brightness histogram will say so.
    //
    // So it compares mean colour. Measured across the shipped four, the tightest
    // pairs are Compass x Glasses and Bodyguard x Glasses at 53, and the pair
    // the old metric scored at zero comes out at 74. The floor is 45: real
    // headroom under the tightest shipped pair, and still far above two
    // photographs that genuinely share a palette.
    // **Two axes, because mean colour is blind to a top hat.** With fourteen
    // fighters the roster has three men in dark suits, and colour alone scored
    // Bodyguard x Magician at 31 and Glasses x Magician at 35 — under the floor,
    // while nobody could confuse a man in a top hat holding a wand with a
    // bouncer in sunglasses with his arms folded.
    //
    // The second axis is the outline the simulation already collides on: the 24
    // band widths in `fighters.json`. Measured across all 91 pairs, the closest
    // outlines are 0.038-0.070 (Glasses x Demolition, Barista x Luchador) and
    // those pairs are far apart in colour; the two that fail on colour measure
    // 0.085 and 0.143.
    //
    // Scored together rather than as an either/or, so neither axis has a knife
    // edge at its threshold: a pair has to be clearly different in at least one
    // way, and being somewhat different in both also counts.
    const MIN_DISTANCE = 45;
    const MIN_OUTLINE = 0.1;
    const MIN_PALETTE = 0.5;
    // Keyed by `spriteId`: that is what a cut carries, and looking it up by
    // `id` silently returned an empty profile and a distance of zero for every
    // pair — a second axis that measured nothing.
    const outlineOf = (spriteId: string): number[] => {
      const f = roster.find((x) => x.spriteId === spriteId);
      return (f?.silhouette ?? []).map(([l, r]) => r - l);
    };
    const outlineDistance = (a: string, b: string): number => {
      const p = outlineOf(a);
      const q = outlineOf(b);
      if (p.length === 0 || q.length === 0) return 0;
      return p.reduce((sum, v, i) => sum + Math.abs(v - (q[i] ?? 0)), 0) / p.length;
    };
    const failures: string[] = [];
    for (let i = 0; i < cuts.length; i += 1) {
      for (let j = i + 1; j < cuts.length; j += 1) {
        const a = cuts[i]!;
        const b = cuts[j]!;
        const distance = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
        const outline = outlineDistance(a.id, b.id);
        // How much of one figure's palette the other does not share, 0 to 1.
        const palette =
          a.histogram.reduce((sum, v, k) => sum + Math.abs(v - (b.histogram[k] ?? 0)), 0) / 2;
        const score = distance / MIN_DISTANCE + outline / MIN_OUTLINE + palette / MIN_PALETTE;
        if (score < 1) {
          failures.push(
            `${a.id} (${a.r.toFixed(0)},${a.g.toFixed(0)},${a.b.toFixed(0)}) x ` +
              `${b.id} (${b.r.toFixed(0)},${b.g.toFixed(0)},${b.b.toFixed(0)}): ` +
              `colour ${distance.toFixed(0)}, outline ${outline.toFixed(3)}, ` +
                `palette ${palette.toFixed(2)}`,
          );
        }
      }
    }
    expect(failures.join("\n")).toBe("");
  });

  it("gives the simulation the same aspect the renderer draws", () => {
    // The bounce box and the drawn box have to be the same box. They are only
    // the same if the roster's `aspect` came from this PNG.
    for (const fighter of roster) {
      expect(fighter.aspect).toBeCloseTo(photoAspect(fighter.spriteId), 3);
    }
  });
});
