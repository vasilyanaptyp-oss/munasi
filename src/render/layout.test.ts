import { describe, expect, it } from "vitest";
import { getFighter, loadFighters } from "../content/index.js";
import { buildGauntlet, GAUNTLET_RULES } from "../content/teams.js";
import { findBestGauntlet, type GauntletResult } from "../sim/gauntlet.js";
import { buildRenderIndex } from "./frame.js";
import { defaultPlan } from "./framePlan.js";
import { byFaction } from "../content/teams.js";
import {
  gauntletFrameLayout,
  hudLayout,
  intersects,
  MIN_FIGHTER_HEIGHT_SHARE,
  roundPlacement,
  type Rect,
} from "./gauntletLayout.js";
import { spriteBounds } from "./silhouette.js";
import { HEIGHT, WIDTH } from "./theme.js";

/**
 * Composition gate.
 *
 * Runs every frame of a generated video and checks the rules a viewer would
 * notice being broken: nothing in the HUD overlapping, nobody clipped by the
 * frame edge, fighters big enough to read, and damage numbers clear of the HP
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

  const inside = (r: Rect): boolean =>
    r.x >= 0 && r.y >= 0 && r.x + r.w <= WIDTH && r.y + r.h <= HEIGHT;

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

    // 2. Both fighters fully inside the frame, and 3. tall enough to read.
    for (const side of [layout.challenger, layout.opponent]) {
      // Checked against the motion box: a fighter mid-death must stay in frame.
      if (!inside(side.reach)) {
        violations.push({
          frame,
          rule: "fighter clipped",
          detail:
            `${side.reach.name} box x ${side.reach.x.toFixed(0)}..` +
            `${(side.reach.x + side.reach.w).toFixed(0)}, y ${side.reach.y.toFixed(0)}..` +
            `${(side.reach.y + side.reach.h).toFixed(0)}`,
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
      if (!inside(side.hp)) {
        violations.push({
          frame,
          rule: "hp widget clipped",
          detail: `${side.hp.name} y ${side.hp.y.toFixed(0)}..${(side.hp.y + side.hp.h).toFixed(0)}`,
        });
      }
    }

    // 4. Damage numbers stay off the HP widgets.
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

  it("stands fighters on the ground line rather than floating them", () => {
    const index = buildRenderIndex(result);
    const hud = hudLayout(result);
    for (const frame of [0, 200, 500, result.durationFrames - 1]) {
      const layout = gauntletFrameLayout(result, frame, index, hud);
      for (const side of [layout.challenger, layout.opponent]) {
        const feet = side.sprite.y + side.sprite.h;
        // Within a small drift of the 62% line.
        expect(Math.abs(feet - HEIGHT * 0.62)).toBeLessThan(HEIGHT * 0.02);
      }
    }
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
    for (const worker of byFaction("workers", roster)) {
      for (const boss of byFaction("bosses", roster)) {
        const placement = roundPlacement(worker.spriteId, boss.spriteId);
        const restA = spriteBounds(worker.spriteId);
        const restB = spriteBounds(boss.spriteId);

        const heightA = restA.height * placement.size;
        const heightB = restB.height * placement.size;
        const floor = HEIGHT * MIN_FIGHTER_HEIGHT_SHARE;
        if (heightA < floor || heightB < floor) {
          failures.push(
            `${worker.id} × ${boss.id}: heights ${heightA.toFixed(0)}/${heightB.toFixed(0)}px ` +
              `below the ${floor.toFixed(0)}px floor`,
          );
        }

        // Everything either fighter ever draws has to fit between the edges.
        const span = placement.separation + (placement.reachRight - placement.reachLeft);
        if (span > WIDTH) {
          failures.push(
            `${worker.id} × ${boss.id}: needs ${span.toFixed(0)}px of width, frame is ${WIDTH}px`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("plays a death animation instead of leaving the loser standing", () => {
    // The round holds after the kill, so the death has frames to play in.
    const firstRound = result.rounds[0]!;
    const deathFrame = result.events.find(
      (e) => e.type === "death" && e.frame < firstRound.endFrame,
    );
    expect(deathFrame).toBeDefined();
    const framesAfterDeath = firstRound.endFrame - deathFrame!.frame;
    expect(framesAfterDeath).toBeGreaterThanOrEqual(20);
  });
});
