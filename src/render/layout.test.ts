import { describe, expect, it } from "vitest";
import { getFighter, loadFighters } from "../content/index.js";
import { buildGauntlet, GAUNTLET_RULES } from "../content/teams.js";
import { findBestGauntlet, type GauntletResult } from "../sim/gauntlet.js";
import { DEATH_FRAMES } from "./drawFighter.js";
import { buildRenderIndex } from "./frame.js";
import { coldOpenPlan, defaultPlan } from "./framePlan.js";
import { COLD_OPEN_FRAMES, findGauntletColdOpen } from "../sim/coldOpen.js";
import { byFaction } from "../content/teams.js";
import {
  ARENA_INNER,
  ARENA_RECT,
  gauntletFrameLayout,
  hudLayout,
  intersects,
  MIN_FIGHTER_HEIGHT_SHARE,
  roundPlacement,
  RELAXED_FIGHTER_HEIGHT_SHARE,
  type Rect,
} from "./gauntletLayout.js";
import { ARENA } from "./gauntletTheme.js";
import { meanLightness, spriteBounds } from "./silhouette.js";
import { HEIGHT, WIDTH } from "./theme.js";

/**
 * Composition gate.
 *
 * Runs every frame of a generated video and checks the rules a viewer would
 * notice being broken: nothing in the HUD overlapping, nobody crossing the
 * arena wall, fighters big enough to read, and damage numbers clear of the HP
 * widgets. Failures name the frame and the elements involved, because "the
 * composition is dead" is not something you can act on.
 *
 * Before this gate existed, a 977-frame run failed on all 977 frames: fighters
 * were 13.5% and 15.7% of frame height against a 22% floor, their feet floated
 * at 71% instead of the 62% ground line, and 58 frames clipped a fighter.
 */

const roster = loadFighters();

/** A run that reaches all three rounds, so every opponent gets checked. */
function longRun(): GauntletResult {
  const config = buildGauntlet(
    getFighter("plumber", roster),
    ["chairman", "silencer", "arbiter"].map((id) => getFighter(id, roster)),
  );
  return findBestGauntlet(config, { count: 60, rules: GAUNTLET_RULES }).result;
}

interface Violation {
  frame: number;
  rule: string;
  detail: string;
}

function auditFrames(result: GauntletResult, frames: number[]): Violation[] {
  const index = buildRenderIndex(result);
  const hud = hudLayout(result);
  const violations: Violation[] = [];
  const minHeight = HEIGHT * MIN_FIGHTER_HEIGHT_SHARE;

  const contains = (outer: Rect, r: Rect): boolean =>
    r.x >= outer.x &&
    r.y >= outer.y &&
    r.x + r.w <= outer.x + outer.w &&
    r.y + r.h <= outer.y + outer.h;

  for (const frame of frames) {
    const layout = gauntletFrameLayout(result, frame, index, hud);

    // 1. HUD boxes never overlap each other.
    for (let i = 0; i < layout.hud.length; i += 1) {
      for (let j = i + 1; j < layout.hud.length; j += 1) {
        const a = layout.hud[i]!;
        const b = layout.hud[j]!;
        if (intersects(a, b)) {
          violations.push({
            frame,
            rule: "hud overlap",
            detail: `${a.name} overlaps ${b.name}`,
          });
        }
      }
    }

    // 2. Both fighters fully inside the ARENA, and 3. tall enough to read.
    for (const side of [layout.challenger, layout.opponent]) {
      // Checked against the motion box: a fighter mid-death must stay inside
      // the wall of the square it is being fought in, not merely inside the
      // frame — the frame is 1080 wide and the arena only 924.
      if (!contains(ARENA_INNER, side.reach)) {
        violations.push({
          frame,
          rule: "fighter crosses the arena wall",
          detail:
            `${side.reach.name} box x ${side.reach.x.toFixed(0)}..` +
            `${(side.reach.x + side.reach.w).toFixed(0)}, y ${side.reach.y.toFixed(0)}..` +
            `${(side.reach.y + side.reach.h).toFixed(0)} ` +
            `(arena x ${ARENA_INNER.x}..${ARENA_INNER.x + ARENA_INNER.w}, ` +
            `y ${ARENA_INNER.y}..${ARENA_INNER.y + ARENA_INNER.h})`,
        });
      }
      if (side.sprite.h < minHeight) {
        violations.push({
          frame,
          rule: "fighter too short",
          detail:
            `${side.sprite.name} is ${side.sprite.h.toFixed(0)}px = ` +
            `${((side.sprite.h / HEIGHT) * 100).toFixed(1)}% (floor ${minHeight.toFixed(0)}px)`,
        });
      }
      if (!contains(ARENA_INNER, side.hp)) {
        violations.push({
          frame,
          rule: "hp widget outside the arena",
          detail: `${side.hp.name} x ${side.hp.x.toFixed(0)}, y ${side.hp.y.toFixed(0)}`,
        });
      }
    }
    if (intersects(layout.challenger.hp, layout.opponent.hp)) {
      violations.push({ frame, rule: "hp widgets overlap", detail: "the two plus signs collide" });
    }
    // The band is fixed; only the horizontal position tracks the fighter.
    if (layout.challenger.hp.y !== layout.opponent.hp.y) {
      violations.push({ frame, rule: "hp widgets off their band", detail: "widgets at different heights" });
    }

    // 4. Damage numbers stay off the HP widgets, and inside the arena.
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
      if (!contains(ARENA_RECT, number)) {
        violations.push({
          frame,
          rule: "damage number outside the arena",
          detail:
            `${number.name} at x ${number.x.toFixed(0)}..${(number.x + number.w).toFixed(0)}, ` +
            `y ${number.y.toFixed(0)}..${(number.y + number.h).toFixed(0)} ` +
            `(arena x ${ARENA_RECT.x}..${ARENA_RECT.x + ARENA_RECT.w}, ` +
            `y ${ARENA_RECT.y}..${ARENA_RECT.y + ARENA_RECT.h})`,
        });
      }
    }

    // 5. The arena is a constant. If it ever gets solved for again, this fires.
    if (
      layout.arena.x !== ARENA_RECT.x ||
      layout.arena.y !== ARENA_RECT.y ||
      layout.arena.w !== ARENA_RECT.w ||
      layout.arena.h !== ARENA_RECT.h ||
      layout.arena.w !== layout.arena.h ||
      layout.groundY !== ARENA.groundY
    ) {
      violations.push({
        frame,
        rule: "arena moved",
        detail:
          `got ${layout.arena.x},${layout.arena.y} ${layout.arena.w}x${layout.arena.h} ` +
          `ground ${layout.groundY}; expected ${ARENA_RECT.x},${ARENA_RECT.y} ` +
          `${ARENA_RECT.w}x${ARENA_RECT.h} ground ${ARENA.groundY}`,
      });
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

describe("gauntlet composition", () => {
  const result = longRun();
  const plan = defaultPlan(result, 0);
  const allFrames = plan.map((p) => p.source);

  it("reaches the last round, so every opponent is checked", () => {
    expect(result.rounds).toHaveLength(3);
    expect(result.durationFrames).toBeGreaterThan(600);
  });

  it("holds every frame of the video to the composition rules", () => {
    const violations = auditFrames(result, allFrames);
    expect(summarise(violations)).toBe("");
    expect(violations).toHaveLength(0);
  }, 120_000);

  it("keeps the HUD boxes apart", () => {
    const hud = hudLayout(result);
    const names = hud.rects.map((r) => r.name);
    expect(names).toContain("challengerName");
    expect(names).toContain("teamPanel");
    for (let i = 0; i < hud.rects.length; i += 1) {
      for (let j = i + 1; j < hud.rects.length; j += 1) {
        const a = hud.rects[i]!;
        const b = hud.rects[j]!;
        expect(intersects(a, b), `${a.name} overlaps ${b.name}`).toBe(false);
      }
    }
  });

  it("stands fighters on the arena's fixed ground line", () => {
    const index = buildRenderIndex(result);
    const hud = hudLayout(result);
    for (const frame of [0, 200, 500, result.durationFrames - 1]) {
      const layout = gauntletFrameLayout(result, frame, index, hud);
      for (const side of [layout.challenger, layout.opponent]) {
        const feet = side.sprite.y + side.sprite.h;
        // Only the camera's vertical pan may move them off it, and barely.
        expect(Math.abs(feet - ARENA.groundY)).toBeLessThan(HEIGHT * 0.006);
      }
    }
  });

  it("keeps the arena a fixed square and moves the camera instead", () => {
    const index = buildRenderIndex(result);
    const hud = hudLayout(result);
    expect(ARENA_RECT.w).toBe(ARENA_RECT.h);
    expect(ARENA_RECT.w).toBe(Math.round(WIDTH * 0.92));
    expect(ARENA_RECT.x).toBe(Math.round((WIDTH - ARENA_RECT.w) / 2));

    const frames = [0, 120, 400, 700, result.durationFrames - 1];
    const cameras = frames.map((f) => gauntletFrameLayout(result, f, index, hud).camera);
    for (const f of frames) {
      expect(gauntletFrameLayout(result, f, index, hud).arena).toEqual(ARENA_RECT);
    }
    // The camera is the moving part: it does not sit still across the run.
    expect(new Set(cameras.map((c) => c.x.toFixed(3))).size).toBeGreaterThan(1);
    // Zoom is what buys the height floor, so it is above 1 on this matchup.
    for (const camera of cameras) expect(camera.zoom).toBeGreaterThan(1);
  });

  it("tells the two active fighters apart by lightness, not just by shape", () => {
    // Two dark figures on the flat blue field read as one blob however
    // different their outlines are. Only worker-versus-boss pairs ever share a
    // round, so those are the pairs that have to be told apart.
    const MIN_GAP = 60;
    const failures: string[] = [];
    for (const worker of byFaction("workers", roster)) {
      for (const boss of byFaction("bosses", roster)) {
        const light = meanLightness(worker.spriteId);
        const dark = meanLightness(boss.spriteId);
        const gap = Math.abs(light - dark);
        if (gap < MIN_GAP) {
          failures.push(
            `${worker.id} (${light.toFixed(0)}) × ${boss.id} (${dark.toFixed(0)}): ` +
              `gap ${gap.toFixed(0)} < ${MIN_GAP}`,
          );
        }
      }
    }
    expect(failures.join("\n")).toBe("");
  });

  it("keeps the HUD fixed — it is chrome, not scene", () => {
    const index = buildRenderIndex(result);
    const hud = hudLayout(result);
    const first = gauntletFrameLayout(result, 0, index, hud).hud;
    const later = gauntletFrameLayout(result, 400, index, hud).hud;
    expect(later).toEqual(first);
  });

  it("gives the HP widget room for four digits", () => {
    const index = buildRenderIndex(result);
    const hud = hudLayout(result);
    const layout = gauntletFrameLayout(result, 0, index, hud);
    // The challenger opens at full HP, which is the widest number it shows.
    expect(String(result.challenger.maxHp).length).toBeGreaterThanOrEqual(4);
    expect(layout.challenger.hp.w).toBeGreaterThan(WIDTH * 0.1);
  });

  it("holds the rules for every worker-versus-boss pair, not just this one", () => {
    // Placement is solved per round from the two fighters' measured extents,
    // so every pairing has to be checked, not the one this video happens to use.
    const failures: string[] = [];
    const relaxedPairs: string[] = [];
    for (const worker of byFaction("workers", roster)) {
      for (const boss of byFaction("bosses", roster)) {
        const placement = roundPlacement(worker.spriteId, boss.spriteId);
        const restA = spriteBounds(worker.spriteId);
        const restB = spriteBounds(boss.spriteId);

        const heightA = restA.height * placement.size;
        const heightB = restB.height * placement.size;
        const share = placement.relaxed
          ? RELAXED_FIGHTER_HEIGHT_SHARE
          : MIN_FIGHTER_HEIGHT_SHARE;
        const floor = HEIGHT * share;
        if (placement.relaxed) {
          relaxedPairs.push(
            `${worker.id} × ${boss.id} (${(placement.overlap * 100).toFixed(0)}% overlap)`,
          );
        }
        if (heightA < floor || heightB < floor) {
          failures.push(
            `${worker.id} × ${boss.id}: heights ${heightA.toFixed(0)}/${heightB.toFixed(0)}px ` +
              `below the ${floor.toFixed(0)}px floor`,
          );
        }

        // Everything either fighter ever draws has to fit inside the arena.
        const span = placement.separation + (placement.reachRight - placement.reachLeft);
        if (span > ARENA_INNER.w) {
          failures.push(
            `${worker.id} × ${boss.id}: needs ${span.toFixed(0)}px, arena is ${ARENA_INNER.w}px`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
    // Not an assertion — the exception list, printed so it cannot go unnoticed.
    if (relaxedPairs.length > 0) {
      console.warn(`height floor relaxed to 21% for: ${relaxedPairs.join(", ")}`);
    }
    expect(relaxedPairs.length).toBeLessThanOrEqual(2);
  });

  it("works as a feed thumbnail on frame 0", () => {
    // Frame 0 is the still image the feed shows before anyone presses play, so
    // it has to carry the joke on its own: both names legible, both fighters
    // present, and the team panel clear of the challenger's name.
    const index = buildRenderIndex(result);
    const hud = hudLayout(result);
    const layout = gauntletFrameLayout(result, 0, index, hud);

    const named = (n: string): Rect => layout.hud.find((r) => r.name === n)!;
    const name = named("challengerName");
    const panel = named("teamPanel");
    expect(intersects(name, panel), "the panel sits on the challenger's name").toBe(false);
    expect(intersects(named("vs"), panel)).toBe(false);

    // Legible means a real cap height, not merely "it fitted".
    expect(hud.metrics.challengerNameSize).toBeGreaterThanOrEqual(HEIGHT * 0.022);
    expect(hud.metrics.panelSize).toBeGreaterThanOrEqual(HEIGHT * 0.019);
    // Every team member is named, not just the first.
    expect(result.team.members.length).toBeGreaterThan(1);
    expect(panel.h).toBeGreaterThan(hud.metrics.panelLineHeight * result.team.members.length);

    // Both fighters are on screen, at full size, neither dead nor mid-swing.
    for (const side of [layout.challenger, layout.opponent]) {
      expect(side.sprite.h).toBeGreaterThanOrEqual(HEIGHT * MIN_FIGHTER_HEIGHT_SHARE);
      expect(side.sprite.x).toBeGreaterThanOrEqual(ARENA_INNER.x);
      expect(side.sprite.x + side.sprite.w).toBeLessThanOrEqual(ARENA_INNER.x + ARENA_INNER.w);
    }
    const snap = result.snapshots[0]!;
    expect(snap.challenger.hp).toBe(result.challenger.maxHp);
    expect(snap.round).toBe(0);
  });

  it("holds the composition rules on the cold-open frames too", () => {
    // With the hook on, output frame 0 is a mid-fight frame rather than the
    // fight's own frame 0, so the thumbnail rules have to survive there.
    const window = findGauntletColdOpen(result);
    expect(window).not.toBeNull();
    const plan = coldOpenPlan(result, window!, 0);
    const violations = auditFrames(
      result,
      plan.slice(0, COLD_OPEN_FRAMES + 20).map((p) => p.source),
    );
    expect(summarise(violations)).toBe("");
  });

  it("plays a death animation instead of leaving the loser standing", () => {
    // The round holds after the kill, so the death has frames to play in.
    const firstRound = result.rounds[0]!;
    const deathFrame = result.events.find(
      (e) => e.type === "death" && e.frame < firstRound.endFrame,
    );
    expect(deathFrame).toBeDefined();
    // The hold has to outlast the animation, or the loser swaps out mid-fall.
    const framesAfterDeath = firstRound.endFrame - deathFrame!.frame;
    expect(framesAfterDeath).toBeGreaterThan(DEATH_FRAMES);
  });
});
