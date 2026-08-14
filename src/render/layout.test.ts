import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { getFighter, loadFighters } from "../content/index.js";
import { buildGauntlet, GAUNTLET_RULES, gauntletMatchups } from "../content/teams.js";
import { findBestGauntlet, simulateGauntlet, type GauntletResult } from "../sim/gauntlet.js";
import { DEATH_FRAMES } from "./drawFighter.js";
import { buildRenderIndex } from "./frame.js";
import { coldOpenPlan, defaultPlan, VICTORY_CARD_FRAMES, type FramePlan } from "./framePlan.js";
import { COLD_OPEN_FRAMES, findGauntletColdOpen } from "../sim/coldOpen.js";
import { byFaction } from "../content/teams.js";
import {
  ARENA_INNER,
  ARENA_RECT,
  gauntletFrameLayout,
  hudLayout,
  intersects,
  victoryCardLayout,
  type Rect,
} from "./gauntletLayout.js";
import { drawHpWidgetForTest } from "./gauntletFrame.js";
import { ARENA, GAUNTLET_COLORS, MIN_FIGHTER_HEIGHT_SHARE } from "./gauntletTheme.js";
import { meanLightness } from "./silhouette.js";
import { HEIGHT, WIDTH } from "./theme.js";
import { FPS } from "../sim/types.js";

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

/**
 * Walks the *output* frames, not the simulation's.
 *
 * These are not the same list. A shipped video is a `FramePlan`: the cold open
 * replays a stretch of the fight before it starts, and the closing card is
 * `VICTORY_CARD_FRAMES` output frames all pointing at the last simulation frame
 * and carrying `victoryOverlay`. Auditing `plan.map(p => p.source)` threw those
 * flags away, so every rule below was only ever checked on a plain frame — and
 * the closing card is exactly where the last round of defects lived.
 */
function auditFrames(result: GauntletResult, plan: FramePlan): Violation[] {
  const index = buildRenderIndex(result);
  const hud = hudLayout(result);
  const violations: Violation[] = [];
  const minHeight = HEIGHT * MIN_FIGHTER_HEIGHT_SHARE;
  const card = victoryCardLayout(result);
  const FRAME_RECT: Rect = { name: "frame", x: 0, y: 0, w: WIDTH, h: HEIGHT };

  /**
   * Frames where somebody is mid-collapse.
   *
   * The height floor is not checked on these. A death throws debris wider than
   * anything else in the fight, the camera pulls back to keep it inside the
   * arena wall, and everything on screen shrinks for those two seconds. That is
   * the wall guarantee working, not a fighter drawn too small — and the figure
   * it applies to is falling over.
   */
  const dying = new Set<number>();
  for (const round of result.rounds) {
    const death = result.events
      .filter((e) => e.type === "death" && e.frame >= round.startFrame && e.frame < round.endFrame)
      .at(-1);
    if (!death) continue;
    for (let f = death.frame - DEATH_FRAMES; f < round.endFrame; f += 1) dying.add(f);
  }

  const contains = (outer: Rect, r: Rect): boolean =>
    r.x >= outer.x &&
    r.y >= outer.y &&
    r.x + r.w <= outer.x + outer.w &&
    r.y + r.h <= outer.y + outer.h;

  for (const [output, planned] of plan.entries()) {
    const frame = planned.source;
    const layout = gauntletFrameLayout(result, frame, index, hud);

    // The closing card is drawn on these frames and on no others, so this is
    // the only place its rules can be checked against what is on screen.
    if (planned.victoryOverlay === true) {
      if (!contains(FRAME_RECT, card.plate)) {
        violations.push({
          frame: output,
          rule: "victory card leaves the frame",
          detail: `plate x ${card.plate.x}..${card.plate.x + card.plate.w}, y ${card.plate.y}..${card.plate.y + card.plate.h}`,
        });
      }
      if (intersects(card.plate, ARENA_RECT)) {
        violations.push({
          frame: output,
          rule: "victory card covers the arena",
          detail: `plate y ${card.plate.y}..${card.plate.y + card.plate.h}, arena ends at ${ARENA_RECT.y + ARENA_RECT.h}`,
        });
      }
      for (const line of card.lines) {
        if (!contains(card.plate, line.rect)) {
          violations.push({
            frame: output,
            rule: "victory card line leaves the plate",
            detail: `${line.name} "${line.text}"`,
          });
        }
      }
    }

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
      if (!dying.has(frame) && side.sprite.h < minHeight) {
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
    // 2b. Summons are held to the same wall guarantee as bodies.
    for (const minion of layout.minions) {
      if (!contains(ARENA_INNER, minion.reach)) {
        violations.push({
          frame,
          rule: "minion crosses the arena wall",
          detail:
            `${minion.reach.name} x ${minion.reach.x.toFixed(0)}..` +
            `${(minion.reach.x + minion.reach.w).toFixed(0)} ` +
            `(arena x ${ARENA_INNER.x}..${ARENA_INNER.x + ARENA_INNER.w})`,
        });
      }
      if (!contains(minion.reach, minion.bar)) {
        violations.push({
          frame,
          rule: "minion health bar outside its own box",
          detail: minion.bar.name,
        });
      }
    }

    // The pair may cross now that both of them move — they are staged at two
    // depths and the near one is drawn over the far one, which is how the
    // reference reads it. What must hold is the depth, checked below.
    // Staged in depth: the far fighter stands higher and is drawn smaller.
    if (layout.sizeFar >= layout.sizeNear) {
      violations.push({ frame, rule: "depth lost", detail: "far fighter is not the smaller one" });
    }
    if (layout.groundFarY >= layout.groundY) {
      violations.push({ frame, rule: "depth lost", detail: "far ground line is not above the near one" });
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
      // Against the inner box, not the outer square: the outer one includes the
      // 35px border, so the looser check passed numbers sitting on the wall —
      // and "inside the arena" is the rule, the wall is not part of the inside.
      if (!contains(ARENA_INNER, number)) {
        violations.push({
          frame,
          rule: "damage number outside the arena",
          detail:
            `${number.name} at x ${number.x.toFixed(0)}..${(number.x + number.w).toFixed(0)}, ` +
            `y ${number.y.toFixed(0)}..${(number.y + number.h).toFixed(0)} ` +
            `(arena x ${ARENA_INNER.x}..${ARENA_INNER.x + ARENA_INNER.w}, ` +
            `y ${ARENA_INNER.y}..${ARENA_INNER.y + ARENA_INNER.h})`,
        });
      }
    }

    // 5. The arena is a constant. If it ever gets solved for again, this fires.
    if (
      layout.arena.x !== ARENA_RECT.x ||
      layout.arena.y !== ARENA_RECT.y ||
      layout.arena.w !== ARENA_RECT.w ||
      layout.arena.h !== ARENA_RECT.h ||
      layout.arena.w !== layout.arena.h
    ) {
      violations.push({
        frame,
        rule: "arena moved",
        detail:
          `got ${layout.arena.x},${layout.arena.y} ${layout.arena.w}x${layout.arena.h} ` +
          `expected ${ARENA_RECT.x},${ARENA_RECT.y} ${ARENA_RECT.w}x${ARENA_RECT.h}`,
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
  // The plan `generate` builds, closing card and all — not a bare walk of the
  // simulation. Those last 34 frames are output frames of the shipped video.
  const plan = defaultPlan(result, VICTORY_CARD_FRAMES);

  it("reaches the last round, so every opponent is checked", () => {
    expect(result.rounds).toHaveLength(3);
    expect(result.durationFrames).toBeGreaterThan(600);
  });

  it("holds every frame of the video to the composition rules", () => {
    const violations = auditFrames(result, plan);
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

  it("stands the pair on two ground lines, staged in depth", () => {
    const index = buildRenderIndex(result);
    const hud = hudLayout(result);
    for (const frame of [0, 200, 500, result.durationFrames - 1]) {
      const layout = gauntletFrameLayout(result, frame, index, hud);
      // The challenger is the far side: higher up the arena and smaller.
      const farFeet = layout.challenger.sprite.y + layout.challenger.sprite.h;
      const nearFeet = layout.opponent.sprite.y + layout.opponent.sprite.h;
      // Each fighter stands on its own depth, between the two constant lines.
      expect(farFeet).toBeGreaterThanOrEqual(ARENA.groundFarY - HEIGHT * 0.05);
      expect(nearFeet).toBeLessThanOrEqual(ARENA.groundY + HEIGHT * 0.02);
      expect(nearFeet).toBeGreaterThan(farFeet + HEIGHT * 0.04);
      expect(layout.sizeNear).toBeGreaterThan(layout.sizeFar);
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
    // Zoom breathes around 1: in as the pair closes, out as it breaks apart.
    expect(new Set(cameras.map((c) => c.zoom.toFixed(3))).size).toBeGreaterThan(1);
    for (const camera of cameras) {
      expect(camera.zoom).toBeGreaterThan(0.8);
      expect(camera.zoom).toBeLessThan(1.2);
    }
  });

  it("tells the two active fighters apart by lightness, not just by shape", () => {
    // Two dark figures on the flat blue field read as one blob however
    // different their outlines are. Only worker-versus-boss pairs ever share a
    // round, so those are the pairs that have to be told apart.
    const MIN_GAP = 60;
    const failures: string[] = [];
    for (const worker of byFaction("left", roster)) {
      for (const boss of byFaction("right", roster)) {
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

  it("holds the composition rules for every worker-versus-boss pair", () => {
    // Feasibility used to be argued by a separate solver that the renderer did
    // not call, against a static worst case. It is argued here instead: every
    // one of the 36 pairings is simulated and walked through the same layout the
    // renderer draws from, on a spread of frames per pairing.
    const failures: string[] = [];
    for (const worker of byFaction("left", roster)) {
      for (const boss of byFaction("right", roster)) {
        const run = simulateGauntlet(buildGauntlet(worker, [boss]), 3, GAUNTLET_RULES);
        const plan = defaultPlan(run, VICTORY_CARD_FRAMES).filter((_, i) => i % 7 === 0);
        const violations = auditFrames(run, plan);
        if (violations.length > 0) {
          failures.push(`${worker.id} × ${boss.id}: ${summarise(violations)}`);
        }
      }
    }
    expect(failures.join("\n")).toBe("");
  }, 300_000);

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
    const opened = coldOpenPlan(result, window!, VICTORY_CARD_FRAMES);
    // The opener and the cut, plus the closing card the same plan ends on.
    const violations = auditFrames(result, [
      ...opened.slice(0, COLD_OPEN_FRAMES + 20),
      ...opened.slice(-VICTORY_CARD_FRAMES),
    ]);
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

describe("reach", () => {
  it("lands its blows in reach, not across the arena", () => {
    // The lunge is locked to the fighter's own cooldown, so the gap bottoms
    // out on the frame the blow lands. Before that it was a free-running wave
    // and each side drifted on its own anchor: 8.9% of damage events fired
    // with the pair more than 1.4 mean widths apart.
    const damage = new Set(["hit", "crit"]);
    let total = 0;
    let far = 0;
    let widest = 0;
    for (const matchup of gauntletMatchups(roster).filter((_, i) => i % 14 === 0)) {
      for (let seed = 0; seed < 2; seed += 1) {
        const result = simulateGauntlet(buildGauntlet(matchup.challenger, matchup.members), seed, GAUNTLET_RULES);
        const index = buildRenderIndex(result);
        const hud = hudLayout(result);
        for (const event of result.events) {
          if (!damage.has(event.type) || event.frame >= result.durationFrames) continue;
          const layout = gauntletFrameLayout(result, event.frame, index, hud);
          const a = layout.challenger.sprite;
          const b = layout.opponent.sprite;
          const ratio =
            Math.abs(b.x + b.w / 2 - (a.x + a.w / 2)) / ((a.w + b.w) / 2);
          total += 1;
          if (ratio > 1.4) far += 1;
          widest = Math.max(widest, ratio);
        }
      }
    }
    expect(total).toBeGreaterThan(500);
    expect(
      far / total,
      `${far} of ${total} events beyond 1.4x mean width, widest ${widest.toFixed(2)}x`,
    ).toBeLessThan(0.01);
  }, 120_000);

});

describe("victory card", () => {
  it("never covers the arena", () => {
    const run = findBestGauntlet(
      buildGauntlet(
        getFighter("plumber", roster),
        ["chairman", "silencer", "arbiter"].map((id) => getFighter(id, roster)),
      ),
      { count: 40, rules: GAUNTLET_RULES },
    ).result;
    const card = victoryCardLayout(run);
    // It used to sit on the arena floor, over the winner from the chest down.
    expect(intersects(card.plate, ARENA_RECT), "the card covers the arena").toBe(false);
    for (const line of card.lines) {
      expect(intersects(line.rect, ARENA_RECT), `${line.name} covers the arena`).toBe(false);
      expect(line.rect.x).toBeGreaterThanOrEqual(0);
      expect(line.rect.x + line.rect.w).toBeLessThanOrEqual(WIDTH);
    }
  }, 60_000);

  /**
   * The card the video ends on. It used to dim the whole frame to a third
   * brightness, run the winner's name off both edges of the frame, hold for two
   * seconds, and show two HP widgets that both read as zero — losing the one
   * number that carries a gauntlet: what the winner had left.
   */
  function runFor(cleared: boolean): GauntletResult {
    // Asked for outright rather than searched for: the drama score now aims at
    // a 2-12% finishing margin, and for several matchups the best run of a
    // block is a loss, so hunting for a clear by luck no longer works.
    const config = buildGauntlet(
      getFighter("plumber", roster),
      ["chairman", "silencer", "arbiter"].map((id) => getFighter(id, roster)),
    );
    return findBestGauntlet(config, {
      count: 200,
      rules: GAUNTLET_RULES,
      outcome: cleared ? "cleared" : "stopped",
    }).result;
  }

  const FRAME: Rect = { name: "frame", x: 0, y: 0, w: WIDTH, h: HEIGHT };
  const contains = (outer: Rect, r: Rect): boolean =>
    r.x >= outer.x &&
    r.y >= outer.y &&
    r.x + r.w <= outer.x + outer.w &&
    r.y + r.h <= outer.y + outer.h;

  for (const cleared of [true, false]) {
    it(`keeps every line inside the card when cleared=${cleared}`, () => {
      const run = runFor(cleared);
      const card = victoryCardLayout(run);
      expect(contains(FRAME, card.plate), "plate leaves the frame").toBe(true);
      for (const line of card.lines) {
        expect(contains(card.plate, line.rect), `${line.name} "${line.text}" leaves the plate`)
          .toBe(true);
      }
    }, 60_000);
  }

  it("shows the winner's remaining HP, not a zero", () => {
    const run = runFor(true);
    const card = victoryCardLayout(run);
    expect(card.winner).toBe("challenger");
    // The whole point: a challenger who cleared the run is alive on the card.
    expect(card.hpLeft).toBeGreaterThan(0);
    const index = buildRenderIndex(run);
    const hud = hudLayout(run);
    const layout = gauntletFrameLayout(run, run.durationFrames - 1, index, hud);
    expect(layout.challenger.hp.w).toBeGreaterThan(0);
    const last = run.snapshots[run.durationFrames - 1]!;
    expect(Math.round(last.challenger.hp)).toBe(card.hpLeft);
  }, 60_000);

  it("never prints a zero as the winner's remaining HP", () => {
    // A mutual kill really does leave the winner on zero. The card says so in
    // words rather than showing a number that reads like a bug.
    for (const cleared of [true, false]) {
      const card = victoryCardLayout(runFor(cleared));
      for (const line of card.lines) {
        expect(line.text).not.toContain("ОСТАЛОСЬ 0");
      }
    }
  }, 60_000);

  it("is held for no more than 1.2 seconds", () => {
    expect(VICTORY_CARD_FRAMES / FPS).toBeLessThanOrEqual(1.2);
  });
});

describe("hp widget readability", () => {
  /**
   * The digits used to take their colour from how full the widget was, which
   * only works if the fill is uniform behind them — and it never is, because
   * the fill line crosses the crossbar somewhere around half HP. At ~50% the
   * number was dark ink half on white and half on the empty grey.
   */
  const CANVAS = 400;

  /**
   * Pixels of the digit plate alone.
   *
   * Reading the whole canvas was the hole: the brightest pixel anywhere stood in
   * for the digits, and above half HP that is the widget's own white fill.
   * Measured by repainting `hpDigits` a mid grey (#6b6f76), whose true contrast
   * against the plate is 3.01:1 — a clear failure. The old measurement returned
   * 6.61 / 6.37 / 17.08 at 25 / 50 / 75% and passed all three.
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
      // Inside the plate the digits are the light pixels; the plate itself is
      // whatever colour most of the rectangle is. Measure what actually got
      // drawn, not what the palette says.
      const lums: number[] = [];
      const histogram = new Map<number, number>();
      for (let i = 0; i < pixels.length; i += 4) {
        lums.push(luminance(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!));
        const key = (pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!;
        histogram.set(key, (histogram.get(key) ?? 0) + 1);
      }
      const sorted = [...lums].sort((a, b) => a - b);
      const ink = sorted[Math.floor(sorted.length * 0.995)]!;
      // The modal colour, not the darkest: the darkest pixel is the black
      // keyline around each digit, which flatters the reading by 5 points.
      const [r, g, b] = (() => {
        let bestKey = 0;
        let bestCount = -1;
        for (const [key, count] of histogram) {
          if (count > bestCount) {
            bestCount = count;
            bestKey = key;
          }
        }
        return [(bestKey >> 16) & 0xff, (bestKey >> 8) & 0xff, bestKey & 0xff];
      })();
      const plate = luminance(r!, g!, b!);
      const contrast = (ink + 0.05) / (plate + 0.05);
      expect(contrast, `contrast ${contrast.toFixed(2)}:1 at ${share * 100}% HP`)
        .toBeGreaterThanOrEqual(4.5);
    });
  }
});
