import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { auditFrames, STUCK_FRAMES, type Finding } from "./audit.js";
import { findFigures, findNumbers, flashShare, isDamageInk } from "./frameAudit.js";
import type { FrameRead } from "./frameAudit.js";

/**
 * The audit's own gate.
 *
 * This project has shipped three measuring tools that were quietly wrong — a
 * yellow threshold that passed the boxer's trousers and reported a number in
 * 850 frames of 852, a collision box copied into a script and left behind, an
 * arena height eyeballed off a still. Every one of them was believed because it
 * printed a plausible number, and every one was caught only by being run
 * against a case whose answer was already known.
 *
 * So the detectors are driven here by frames drawn on purpose. If the audit
 * cannot find two rectangles it was handed, it has no business reporting on a
 * video.
 */

const W = 576;
const H = 1024;
const FIELD = "#18a2d3";
const WALL = "#000000";
const ARENA = { top: 200, bottom: 810 };

interface Figure {
  x: number;
  y: number;
  w: number;
  h: number;
  colour: string;
}

/** Draws the format: blue field, black arena, the figures given, ink given. */
function frame(figures: Figure[], numbers: { x: number; y: number }[] = []): {
  data: Uint8ClampedArray;
} {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = FIELD;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = WALL;
  ctx.fillRect(0, ARENA.top, W, ARENA.bottom - ARENA.top);
  for (const f of figures) {
    ctx.fillStyle = f.colour;
    ctx.fillRect(f.x, f.y, f.w, f.h);
  }
  ctx.fillStyle = "#c6f16e";
  for (const n of numbers) ctx.fillRect(n.x, n.y, 40, 20);
  return { data: ctx.getImageData(0, 0, W, H).data };
}

describe("frame detectors", () => {
  it("knows the damage ink from what a person wears", () => {
    // #c6f16e, and the ochre trousers that broke the previous threshold.
    expect(isDamageInk(198, 241, 110)).toBe(true);
    expect(isDamageInk(186, 160, 78)).toBe(false);
    expect(isDamageInk(255, 255, 255)).toBe(false);
    expect(isDamageInk(24, 162, 211)).toBe(false);
  });

  it("finds two figures drawn on the arena, and their boxes", () => {
    const { data } = frame([
      { x: 80, y: 420, w: 120, h: 220, colour: "#b0603a" },
      { x: 360, y: 400, w: 110, h: 230, colour: "#404a70" },
    ]);
    const found = findFigures(data, W, H, ARENA);
    expect(found).toHaveLength(2);
    const xs = found.map((f) => f.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(80, -1);
    expect(xs[1]).toBeCloseTo(360, -1);
  });

  it("does not mistake a flying prop for a fighter", () => {
    // A pair of glasses crossing the arena. Before the person-size floor, the
    // detector took the two largest blobs whatever they were and collided with
    // this.
    const { data } = frame([
      { x: 80, y: 420, w: 120, h: 220, colour: "#b0603a" },
      { x: 300, y: 500, w: 60, h: 24, colour: "#202020" },
    ]);
    expect(findFigures(data, W, H, ARENA)).toHaveLength(1);
  });

  it("finds a damage number as one blob, not one per digit", () => {
    const { data } = frame([{ x: 80, y: 420, w: 120, h: 220, colour: "#b0603a" }], [
      { x: 240, y: 300 },
      { x: 285, y: 300 },
    ]);
    expect(findNumbers(data, W, H)).toHaveLength(1);
  });

  it("reads the hit flash at the alpha the renderer actually uses", () => {
    // 0.8 white over a dark photograph, which is what `gauntletFrame` paints.
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#18a2d3";
    ctx.fillRect(0, 0, W, H);
    const box = { x: 100, y: 400, w: 120, h: 220 };
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(box.x, box.y, box.w, box.h);
    const plain = flashShare(ctx.getImageData(0, 0, W, H).data, W, box);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillRect(box.x, box.y, box.w, box.h);
    const lit = flashShare(ctx.getImageData(0, 0, W, H).data, W, box);
    expect(plain).toBeLessThan(0.05);
    expect(lit).toBeGreaterThan(0.9);
  });
});

/** A frame read with nothing happening in it. */
function quiet(figures: FrameRead["figures"]): FrameRead {
  return {
    arena: { ...ARENA, left: 0, right: W - 1 },
    border: 24,
    blueShare: 0.5,
    blackShare: 0.4,
    whiteShare: 0.01,
    yellowPixels: 0,
    changed: 0.1,
    plusses: [],
    figures,
    numbers: [],
    flashes: figures.map(() => 0),
    overlap: 0,
  };
}

const APART: FrameRead["figures"] = [
  { x: 80, y: 420, w: 120, h: 220 },
  { x: 360, y: 400, w: 110, h: 230 },
];
/** The frame before they touch: close enough that merging is believable. */
const NEAR: FrameRead["figures"] = [
  { x: 200, y: 420, w: 120, h: 220 },
  { x: 330, y: 400, w: 110, h: 230 },
];
const TOGETHER: FrameRead["figures"] = [{ x: 200, y: 400, w: 240, h: 230 }];
const ALONE: FrameRead["figures"] = [{ x: 200, y: 400, w: 120, h: 220 }];

const kinds = (findings: Finding[]): string[] => findings.map((f) => f.kind);

describe("audit", () => {
  it("calls a merge a contact, and reports it unanswered when no number follows", () => {
    const reads = [quiet(APART), quiet(NEAR), quiet(TOGETHER), quiet(APART), quiet(APART)];
    const result = auditFrames(reads, "synthetic.mp4");
    expect(result.contacts).toEqual([2]);
    expect(kinds(result.findings)).toContain("no_registration");
  });

  it("says nothing when the contact does produce a number", () => {
    const withNumber = quiet(APART);
    withNumber.numbers = [{ x: 260, y: 430, pixels: 80 }];
    const reads = [quiet(APART), quiet(NEAR), quiet(TOGETHER), withNumber, quiet(APART)];
    const result = auditFrames(reads, "synthetic.mp4");
    expect(result.contacts).toEqual([2]);
    expect(kinds(result.findings)).not.toContain("no_registration");
  });

  it("does not call a fighter merging with his own thrown prop a collision", () => {
    // Frame 227 of `boxer-vs-bodyguard-288`: a boxer with his glove beside him,
    // one blob bigger than he is, and the bodyguard at the far wall.
    const reads = [quiet(APART), quiet(TOGETHER), quiet(APART)];
    expect(auditFrames(reads, "synthetic.mp4").contacts).toEqual([]);
  });

  it("does not call the end of the fight a collision", () => {
    // Two figures going to one is also somebody dying. The survivor is his own
    // size, not the size of both — which is the whole test.
    const reads = [quiet(NEAR), quiet(ALONE), quiet(ALONE), quiet(ALONE)];
    const result = auditFrames(reads, "synthetic.mp4");
    expect(result.contacts).toEqual([]);
    expect(kinds(result.findings)).not.toContain("clipping");
  });

  it("reports a pair that stays merged as stuck", () => {
    const reads = [quiet(NEAR), ...Array.from({ length: STUCK_FRAMES + 2 }, () => quiet(TOGETHER))];
    const result = auditFrames(reads, "synthetic.mp4");
    expect(kinds(result.findings)).toContain("clipping");
  });

  it("counts one rising number once, not once per frame", () => {
    // A damage number rides up off its victim for the better part of a second.
    const rising = (y: number): FrameRead => {
      const read = quiet(APART);
      read.numbers = [{ x: 260, y, pixels: 80 }];
      return read;
    };
    const reads = [quiet(APART), rising(430), rising(424), rising(418), rising(412)];
    expect(auditFrames(reads, "synthetic.mp4").hits).toHaveLength(1);
  });

  it("flags a number that belongs to nobody on screen", () => {
    const orphan = quiet(APART);
    orphan.numbers = [{ x: 540, y: 780, pixels: 80 }];
    const result = auditFrames([quiet(APART), orphan], "synthetic.mp4");
    expect(kinds(result.findings)).toContain("number_without_contact");
  });

  it("flags a number drawn outside the arena walls", () => {
    const outside = quiet(APART);
    outside.numbers = [{ x: 120, y: 120, pixels: 80 }];
    const result = auditFrames([quiet(APART), outside], "synthetic.mp4");
    expect(kinds(result.findings)).toContain("number_outside_arena");
  });
});
