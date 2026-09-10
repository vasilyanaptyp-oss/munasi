import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { getFighter, loadFighters } from "../content/index.js";
import { buildGauntlet, GAUNTLET_RULES } from "../content/teams.js";
import { findBestGauntlet, simulateGauntlet, type GauntletResult } from "../sim/gauntlet.js";
import { buildRenderIndex } from "./frame.js";
import { coldOpenPlan, defaultPlan, VICTORY_CARD_FRAMES, type FramePlan } from "./framePlan.js";
import { COLD_OPEN_FRAMES, findGauntletColdOpen } from "../sim/coldOpen.js";
import {
  CAPTION,
  CAPTIONS,
  captionFor,
  gauntletFrameLayout,
  hudLayout,
  intersects,
  type Rect,
} from "./gauntletLayout.js";
import { drawHpWidgetForTest } from "./gauntletFrame.js";
import { ARENA, CAPTION_CAP, GAUNTLET_COLORS, MIN_FIGHTER_HEIGHT_SHARE } from "./gauntletTheme.js";
import { font, HEIGHT, WIDTH } from "./theme.js";
import { FPS } from "../sim/types.js";

/**
 * Composition gate.
 *
 * Rewritten for the format the reference actually uses: photo cut-outs bouncing
 * inside a square that itself slides and scales under a camera, with two title
 * lines above it and a caption below.
 *
 * Several old rules are gone because the thing they protected is gone — there
 * are no depth lanes, no ground lines, no fixed arena and no procedural art to
 * keep distinct by silhouette. What survives is what a viewer would still
 * notice: a figure crossing the wall, a name running off the frame, a number
 * you cannot read.
 */

const roster = loadFighters();

function run(seeds = 40): GauntletResult {
  const config = buildGauntlet(getFighter("compass", roster), [getFighter("bodyguard", roster)]);
  return findBestGauntlet(config, { count: seeds, rules: GAUNTLET_RULES }).result;
}

interface Violation {
  frame: number;
  rule: string;
  detail: string;
}

const contains = (outer: Rect, r: Rect): boolean =>
  r.x >= outer.x &&
  r.y >= outer.y &&
  r.x + r.w <= outer.x + outer.w &&
  r.y + r.h <= outer.y + outer.h;

const FRAME_RECT: Rect = { name: "frame", x: 0, y: 0, w: WIDTH, h: HEIGHT };

/** Walks the *output* frames, flags and all — not a bare walk of the simulation. */
function auditFrames(result: GauntletResult, plan: FramePlan): Violation[] {
  const index = buildRenderIndex(result);
  const hud = hudLayout(result);
  const violations: Violation[] = [];
  const minHeight = HEIGHT * MIN_FIGHTER_HEIGHT_SHARE;

  for (const planned of plan) {
    const frame = planned.source;
    const layout = gauntletFrameLayout(result, frame, index, hud);

    // The arena moves now, so "inside the arena" is measured against where the
    // arena is on *this* frame, not against a constant.
    const border = layout.arena.w * (ARENA.border / ARENA.side);
    const inner: Rect = {
      name: "arenaInner",
      x: layout.arena.x + border,
      y: layout.arena.y + border,
      w: layout.arena.w - border * 2,
      h: layout.arena.h - border * 2,
    };

    // 1. The HUD never collides with itself.
    for (let i = 0; i < layout.hud.length; i += 1) {
      for (let j = i + 1; j < layout.hud.length; j += 1) {
        const a = layout.hud[i]!;
        const b = layout.hud[j]!;
        if (intersects(a, b)) {
          violations.push({ frame, rule: "hud overlap", detail: `${a.name} overlaps ${b.name}` });
        }
      }
    }

    // 2. The arena never climbs into the title or drops onto the caption. This
    //    is the whole reason the camera is fenced vertically.
    for (const chrome of layout.hud) {
      if (intersects(chrome, layout.arena)) {
        violations.push({
          frame,
          rule: "arena covers the overlay",
          detail: `${chrome.name} is under the arena (arena y ${layout.arena.y.toFixed(0)})`,
        });
      }
    }

    // 3. Every fighter, and its keyline, stays inside the arena wall; and stays
    //    big enough to read.
    for (const side of [layout.challenger, layout.opponent]) {
      if (!contains(inner, side.reach)) {
        violations.push({
          frame,
          rule: "fighter crosses the arena wall",
          detail:
            `${side.reach.name} x ${side.reach.x.toFixed(0)}..${(side.reach.x + side.reach.w).toFixed(0)} ` +
            `(arena x ${inner.x.toFixed(0)}..${(inner.x + inner.w).toFixed(0)})`,
        });
      }
      if (side.sprite.h < minHeight) {
        violations.push({
          frame,
          rule: "fighter too short",
          detail: `${side.sprite.name} is ${((side.sprite.h / HEIGHT) * 100).toFixed(1)}%`,
        });
      }
      // 4. The HP cross belongs to its fighter: directly above it, and on screen.
      const centreGap = Math.abs(
        side.hp.x + side.hp.w / 2 - (side.sprite.x + side.sprite.w / 2),
      );
      if (centreGap > 1) {
        violations.push({
          frame,
          rule: "hp widget adrift from its fighter",
          detail: `${side.hp.name} is ${centreGap.toFixed(0)}px off centre`,
        });
      }
      if (side.hp.y + side.hp.h > side.sprite.y + 1) {
        violations.push({ frame, rule: "hp widget over its fighter", detail: side.hp.name });
      }
      if (!contains(FRAME_RECT, side.hp)) {
        violations.push({ frame, rule: "hp widget off screen", detail: side.hp.name });
      }
    }

    // 5. Damage numbers stay inside the arena and off the HP widgets.
    for (const number of layout.damageNumbers) {
      for (const widget of [layout.challenger.hp, layout.opponent.hp]) {
        if (intersects(number, widget)) {
          violations.push({
            frame,
            rule: "damage number over hp widget",
            detail: `${number.name} overlaps ${widget.name}`,
          });
        }
      }
    }
  }
  return violations;
}

function summarise(violations: Violation[]): string {
  const byRule = new Map<string, Violation[]>();
  for (const v of violations) {
    const list = byRule.get(v.rule);
    if (list) list.push(v);
    else byRule.set(v.rule, [v]);
  }
  return [...byRule.entries()]
    .map(([rule, list]) => `${rule}: ${list.length} (e.g. frame ${list[0]!.frame} — ${list[0]!.detail})`)
    .join("\n");
}

describe("composition", () => {
  const result = run();
  const plan = defaultPlan(result, VICTORY_CARD_FRAMES);

  it("holds every frame of the video to the composition rules", () => {
    const violations = auditFrames(result, plan);
    expect(summarise(violations)).toBe("");
  }, 120_000);

  it("holds them on the cold-open frames too", () => {
    const window = findGauntletColdOpen(result);
    expect(window).not.toBeNull();
    const opened = coldOpenPlan(result, window!, VICTORY_CARD_FRAMES);
    const violations = auditFrames(result, [
      ...opened.slice(0, COLD_OPEN_FRAMES + 20),
      ...opened.slice(-VICTORY_CARD_FRAMES),
    ]);
    expect(summarise(violations)).toBe("");
  }, 120_000);

  it("holds them for every pairing in the roster", () => {
    const failures: string[] = [];
    for (const a of roster) {
      for (const b of roster) {
        if (a.id === b.id) continue;
        const one = simulateGauntlet(buildGauntlet(a, [b]), 3, GAUNTLET_RULES);
        const sampled = defaultPlan(one, VICTORY_CARD_FRAMES).filter((_, i) => i % 5 === 0);
        const violations = auditFrames(one, sampled);
        if (violations.length > 0) failures.push(`${a.id} × ${b.id}: ${summarise(violations)}`);
      }
    }
    expect(failures.join("\n")).toBe("");
  }, 180_000);

  it("moves the arena — it is scene, not chrome", () => {
    // The opposite of the old rule. The reference's arena never holds still for
    // a single frame; ours used to be nailed to a constant.
    const index = buildRenderIndex(result);
    const hud = hudLayout(result);
    const boxes = [0, 90, 180, 260].map((f) => gauntletFrameLayout(result, f, index, hud).arena);
    expect(new Set(boxes.map((b) => `${b.x.toFixed(1)},${b.y.toFixed(1)},${b.w.toFixed(1)}`)).size)
      .toBeGreaterThan(1);
  });

  it("welds the overlay to the arena — one scene, never sliding apart", () => {
    // The owner's second complaint about the last cut, and the one this gate
    // exists to make impossible: the arena panned while the title stayed nailed
    // to the screen, so the two visibly slid against each other.
    //
    // The reference is unambiguous. Measured over its 721 frames at full
    // resolution, the caption's top edge holds 30-32px under the arena's bottom
    // border and the title's top edge holds 76-77px above the arena's top, while
    // the pair of them travels 200-250px around the frame. It is one rigid
    // scene under a camera.
    //
    // So: the offset from the arena to every overlay box must be *identical* in
    // every frame, to the pixel.
    const index = buildRenderIndex(result);
    const hud = hudLayout(result);
    const frames = [0, 45, 120, 240, 360, result.durationFrames - 1];
    const offsets = new Map<string, Set<string>>();
    for (const f of frames) {
      const layout = gauntletFrameLayout(result, f, index, hud);
      for (const rect of layout.hud) {
        const key = `${(rect.x - layout.arena.x).toFixed(3)},${(rect.y - layout.arena.y).toFixed(3)}`;
        if (!offsets.has(rect.name)) offsets.set(rect.name, new Set());
        offsets.get(rect.name)!.add(key);
      }
    }
    const drifting = [...offsets]
      .filter(([, seen]) => seen.size > 1)
      .map(([name, seen]) => `${name} sat at ${seen.size} different offsets: ${[...seen].join(" | ")}`);
    expect(drifting.join("\n")).toBe("");

    // ...and the arena must not scale, or "one rigid scene" is a half-truth.
    // The reference's arena measures 612-613px tall in all 721 frames.
    const sides = frames.map((f) => gauntletFrameLayout(result, f, index, hud).arena.w);
    expect(new Set(sides).size, `arena scaled: ${[...new Set(sides)].join(", ")}`).toBe(1);
  });

  it("keeps the title and the caption on screen and apart", () => {
    const hud = hudLayout(result);
    const named = (n: string): Rect => hud.rects.find((r) => r.name === n)!;
    for (const name of ["titleFirst", "titleSecond", "caption"]) {
      expect(contains(FRAME_RECT, named(name)), `${name} leaves the frame`).toBe(true);
    }
    expect(hud.metrics.titleSize).toBeGreaterThanOrEqual(HEIGHT * 0.022);
    expect(hud.metrics.first).toContain("vs");
    expect(named("caption").w).toBeGreaterThan(0);
    expect(CAPTION).toBe("Like and Subscribe!");
  });

  it("works as a feed thumbnail on frame 0", () => {
    const index = buildRenderIndex(result);
    const hud = hudLayout(result);
    const layout = gauntletFrameLayout(result, 0, index, hud);
    for (const side of [layout.challenger, layout.opponent]) {
      expect(side.sprite.h).toBeGreaterThanOrEqual(HEIGHT * MIN_FIGHTER_HEIGHT_SHARE);
      expect(contains(FRAME_RECT, side.sprite)).toBe(true);
    }
    // Both at full health, and on opposite sides so the face-off reads.
    const snap = result.snapshots[0]!;
    expect(snap.challenger.hp).toBe(result.challenger.maxHp);
    expect(Math.abs(snap.challenger.x - snap.opponent.x)).toBeGreaterThan(0.3);
  });

  it("is held for no more than 1.2 seconds on the closing card", () => {
    expect(VICTORY_CARD_FRAMES / FPS).toBeLessThanOrEqual(1.2);
  });
});

describe("hp widget readability", () => {
  const CANVAS = 400;

  /**
   * Pixels of the digit plate alone.
   *
   * Reading the whole canvas was the hole: above half HP the widget's fill is
   * white, so the brightest pixel was the fill rather than a digit. Measured by
   * repainting `hpDigits` a mid grey (#6b6f76), whose true contrast against the
   * plate is 3.01:1 — a clear failure. The old measurement returned 6.61 / 6.37
   * / 17.08 at 25 / 50 / 75% and passed all three.
   */
  function renderWidget(share: number): Uint8ClampedArray {
    const canvas = createCanvas(CANVAS, CANVAS);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = GAUNTLET_COLORS.background;
    ctx.fillRect(0, 0, CANVAS, CANVAS);
    const plate = drawHpWidgetForTest(ctx, share);
    return ctx.getImageData(
      Math.round(plate.x),
      Math.round(plate.y),
      Math.round(plate.w),
      Math.round(plate.h),
    ).data;
  }

  function luminance(r: number, g: number, b: number): number {
    const f = (c: number): number => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  for (const share of [0.25, 0.5, 0.75]) {
    it(`keeps the digits at 4.5:1 or better at ${share * 100}% HP`, () => {
      const pixels = renderWidget(share);
      const lums: number[] = [];
      const histogram = new Map<number, number>();
      for (let i = 0; i < pixels.length; i += 4) {
        lums.push(luminance(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!));
        const key = (pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!;
        histogram.set(key, (histogram.get(key) ?? 0) + 1);
      }
      const sorted = [...lums].sort((a, b) => a - b);
      // The modal colour is the plate: it is most of the rectangle either way.
      let bestKey = 0;
      let bestCount = -1;
      for (const [key, count] of histogram) {
        if (count > bestCount) {
          bestCount = count;
          bestKey = key;
        }
      }
      const plate = luminance((bestKey >> 16) & 0xff, (bestKey >> 8) & 0xff, bestKey & 0xff);

      // The ink is whichever tail is on the far side of the plate. This used to
      // assume light digits on a dark plate and read the brightest pixel; the
      // digits are dark on white now — the reference's way round — and that
      // assumption scored a perfectly legible widget at 1.00:1, because the
      // brightest pixel *was* the plate. The rule was always "4.5:1 between the
      // digits and what they sit on", which has no preferred polarity.
      const ink = plate > 0.5
        ? sorted[Math.floor(sorted.length * 0.02)]!
        : sorted[Math.floor(sorted.length * 0.98)]!;
      const contrast = plate > ink ? (plate + 0.05) / (ink + 0.05) : (ink + 0.05) / (plate + 0.05);
      expect(contrast, `contrast ${contrast.toFixed(2)}:1 at ${share * 100}% HP`)
        .toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("caption", () => {
  it("picks one deterministically from the seed", () => {
    for (const seed of [0, 1, 7, 42, 105, 141, 307, 357, 9999]) {
      expect(captionFor(seed)).toBe(captionFor(seed));
      expect(CAPTIONS).toContain(captionFor(seed));
    }
  });

  it("actually alternates across a batch instead of settling on one", () => {
    const seen = new Set(Array.from({ length: 200 }, (_, i) => captionFor(i)));
    expect(seen.size).toBe(CAPTIONS.length);
  });

  it("keeps every caption at the reference's ink height and inside the frame", () => {
    // The reference's caption is 22px of ink on a 1024-tall frame and takes 53%
    // of the width. A longer call to action is sized to that same ink, so what
    // has to be checked is that it still fits: the camera slides the whole
    // scene sideways, and a caption already at the edge would be pushed off it.
    const ctx = createCanvas(8, 8).getContext("2d");
    const inkHeight = (text: string, size: number): number => {
      ctx.font = font(size, "bold");
      const m = ctx.measureText(text);
      return m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    };
    // How far the scene can slide sideways: the arena overhangs the frame.
    const pan = (ARENA.side - WIDTH) / 2;
    for (const text of CAPTIONS) {
      let size = HEIGHT * 0.03;
      for (let i = 0; i < 40; i += 1) size *= (HEIGHT * CAPTION_CAP) / inkHeight(text, size);
      // Within a pixel or two: the face reports integer metrics, so the solve
      // lands on whichever size gets closest rather than exactly on the target.
      expect(Math.abs(inkHeight(text, size) - HEIGHT * CAPTION_CAP), text).toBeLessThanOrEqual(2);
      ctx.font = font(size, "bold");
      const width = ctx.measureText(text).width;
      expect(width + 2 * pan + 18, `${text} is ${width.toFixed(0)}px wide`).toBeLessThan(WIDTH);
    }
  });

  it("puts the chosen caption in the metrics the renderer draws from", () => {
    const result = simulateGauntlet(buildGauntlet(roster[0]!, [roster[1]!]), 105, GAUNTLET_RULES);
    expect(hudLayout(result).metrics.caption).toBe(captionFor(result.seed));
  });
});
