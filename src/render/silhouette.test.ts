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
  /** Opaque pixels touching the PNG's own border. */
  edgeTouch: number;
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
  let edge = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      if (px[i + 3]! < 128) continue;
      opaque += 1;
      sum += 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge += 1;
    }
  }
  return {
    id: spriteId,
    width: w,
    height: h,
    fill: opaque / (w * h),
    lightness: sum / Math.max(1, opaque),
    edgeTouch: edge,
  };
}

const cuts = await Promise.all(roster.map((f) => measure(f.spriteId)));

describe("fighter cut-outs", () => {
  it("prints what each cut-out measures", () => {
    for (const c of cuts) {
      console.log(
        `${c.id.padEnd(16)} ${c.width}x${c.height}  fill ${(c.fill * 100).toFixed(0)}%  ` +
          `lightness ${c.lightness.toFixed(0)}  aspect ${photoAspect(c.id).toFixed(3)}`,
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

  it("keeps the two people on screen apart by lightness", () => {
    // Two dark figures on the flat blue field read as one blob however different
    // their outlines are. This was a rule for the drawn roster and it survives
    // the move to photographs unchanged, because the reason for it does.
    const MIN_GAP = 40;
    const failures: string[] = [];
    for (let i = 0; i < cuts.length; i += 1) {
      for (let j = i + 1; j < cuts.length; j += 1) {
        const a = cuts[i]!;
        const b = cuts[j]!;
        const gap = Math.abs(a.lightness - b.lightness);
        if (gap < MIN_GAP) {
          failures.push(
            `${a.id} (${a.lightness.toFixed(0)}) × ${b.id} (${b.lightness.toFixed(0)}): gap ${gap.toFixed(0)}`,
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
