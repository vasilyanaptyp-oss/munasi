import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { simulate } from "../sim/simulate.js";
import { GAUNTLET_RULES } from "./teams.js";
import { FPS } from "../sim/types.js";
import { BALANCE_MAX, BALANCE_MIN, evaluatePair, evaluateRoster } from "./balance.js";
import { analyticAttack, scaleSpec, winRateVsReference } from "./calibrate.js";
import { generateMatchups } from "./generateMatchups.js";
import { allPairs, getFighter, loadFighters } from "./index.js";
import { ROSTER } from "./roster.js";

const roster = loadFighters();

function writeRoster(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "munasi-roster-"));
  const path = join(dir, "fighters.json");
  writeFileSync(path, JSON.stringify(content));
  return path;
}

describe("roster loading", () => {
  it("loads the roster with unique ids", () => {
    expect(roster.length).toBeGreaterThanOrEqual(2);
    expect(new Set(roster.map((f) => f.id)).size).toBe(roster.length);
    expect(new Set(roster.map((f) => f.name)).size).toBe(roster.length);
  });

  it("starts everyone at full HP", () => {
    for (const fighter of roster) expect(fighter.hp).toBe(fighter.maxHp);
  });

  it("keeps fighters.json in step with roster.ts", () => {
    expect(roster.map((f) => f.id)).toEqual(ROSTER.map((s) => s.id));
    for (const spec of ROSTER) {
      const fighter = getFighter(spec.id, roster);
      expect(fighter.maxHp).toBe(spec.maxHp);
      expect(fighter.attackSpeed).toBe(spec.attackSpeed);
      expect(fighter.critChance).toBe(spec.critChance);
      expect(fighter.abilities.map((a) => a.type)).toEqual(spec.abilities.map((a) => a.type));
    }
  });

  it("gives every fighter its own cut-out photo", () => {
    // Fighters are photographs now, not drawings: what has to exist is a PNG in
    // assets/fighters/, produced by `pnpm cutout`.
    for (const fighter of roster) {
      expect(existsSync(join("assets", "fighters", `${fighter.spriteId}.png`)), fighter.id).toBe(true);
      expect(fighter.aspect).toBeGreaterThan(0.1);
      expect(fighter.aspect).toBeLessThan(4);
    }
  });

  it("keeps stats inside the ranges the design rules call for", () => {
    for (const fighter of roster) {
      expect(fighter.maxHp).toBeGreaterThanOrEqual(1000);
      expect(fighter.maxHp).toBeLessThanOrEqual(1400);
      expect(fighter.attackSpeed).toBeGreaterThanOrEqual(0.45);
      expect(fighter.attackSpeed).toBeLessThanOrEqual(1.45);
      expect(fighter.critChance).toBeGreaterThanOrEqual(0.2);
      expect(fighter.critChance).toBeLessThanOrEqual(0.4);
      expect(fighter.attack).toBeGreaterThan(0);
    }
  });

  it("rejects a malformed roster instead of loading garbage", () => {
    expect(() => loadFighters(writeRoster({ nope: true }))).toThrow(/expected an array/);
    expect(() => loadFighters(writeRoster([{ name: "X" }]))).toThrow(/missing id/);
    expect(() => loadFighters(writeRoster([{ id: "x", aspect: 0.8, maxHp: "lots" }]))).toThrow(/finite number/);
    expect(() =>
      loadFighters(
        writeRoster([
          { id: "x", aspect: 0.8, maxHp: 1, attack: 1, attackSpeed: 1, critChance: 0, critMult: 1, abilities: [{ type: "explode", cooldown: 1, power: 1 }] },
        ]),
      ),
    ).toThrow(/unknown ability type/);
  });

  it("rejects duplicate ids", () => {
    const one = { id: "x", aspect: 0.8, maxHp: 1, attack: 1, attackSpeed: 1, critChance: 0, critMult: 1, abilities: [] };
    expect(() => loadFighters(writeRoster([one, one]))).toThrow(/duplicate/);
  });

  it("looks fighters up by id", () => {
    expect(getFighter("compass", roster).name).toBe("Compass Guy");
    expect(() => getFighter("nobody", roster)).toThrow(/unknown fighter/);
  });
});

describe("balance", () => {
  it("enumerates every unordered pair once", () => {
    expect(allPairs(roster)).toHaveLength((roster.length * (roster.length - 1)) / 2);
  });

  it("measures a pair deterministically", () => {
    const [a, b] = [roster[0]!, roster[1]!];
    expect(evaluatePair(a, b, { sample: 40 })).toEqual(evaluatePair(a, b, { sample: 40 }));
  });

  it("keeps every matchup inside the balance band", () => {
    // Measured under the rules that ship. `evaluateRoster` defaults to the bare
    // duel rules, and the pair is not balanced under those — it is balanced
    // under `GAUNTLET_RULES`, which is what every video is rendered from.
    //
    // 150 matches per pair leaves roughly +/-4 points of sampling noise, so the
    // assertion allows that much slack around the published 35-65% band.
    const report = evaluateRoster(roster, { sample: 150, rules: GAUNTLET_RULES });
    const noise = 0.04;
    const bad = report.pairs.filter(
      (p) => p.winRateA < BALANCE_MIN - noise || p.winRateA > BALANCE_MAX + noise,
    );
    expect(bad.map((p) => `${p.aId} vs ${p.bId}: ${(p.winRateA * 100).toFixed(0)}%`)).toEqual([]);
  }, 60_000);

  it("lands matches near the drama window on average", () => {
    const report = evaluateRoster(roster, { sample: 30, rules: GAUNTLET_RULES });
    const mean =
      report.pairs.reduce((sum, p) => sum + p.meanSeconds, 0) / report.pairs.length;
    // The reference's own videos run 19-30 seconds.
    expect(mean).toBeGreaterThan(16);
    expect(mean).toBeLessThan(34);
  }, 60_000);

  it("rarely times out", () => {
    let timeouts = 0;
    const total = 200;
    for (let seed = 0; seed < total; seed += 1) {
      const a = roster[seed % roster.length]!;
      const b = roster[(seed + 1) % roster.length]!;
      if (a.id === b.id) continue;
      const result = simulate({ a, b }, seed, GAUNTLET_RULES);
      if (result.timedOut) timeouts += 1;
      expect(result.durationFrames / FPS).toBeLessThanOrEqual(60);
    }
    expect(timeouts / total).toBeLessThan(0.1);
  });
});

describe("calibrate", () => {
  it("derives a positive attack for every spec", () => {
    for (const spec of ROSTER) expect(analyticAttack(spec)).toBeGreaterThan(0);
  });

  it("scales damage but never HP", () => {
    // Written against a synthetic spec rather than a roster entry: the shipped
    // roster's abilities are signatures that carry no power at all, and a test
    // that reaches for whoever happens to have a minion breaks whenever the
    // roster changes — which is exactly what it just did.
    const spec = {
      ...ROSTER[0]!,
      abilities: [
        {
          type: "spawn_minion" as const,
          cooldown: 8,
          power: 100,
          minion: { hp: 120, attack: 9, attackSpeed: 1, lifetime: 8 },
        },
      ],
    };
    const base = scaleSpec(spec, 20, 1);
    const doubled = scaleSpec(spec, 20, 2);
    expect(doubled.attack).toBe(base.attack * 2);
    expect(doubled.maxHp).toBe(base.maxHp);
    expect(doubled.abilities[0]!.minion!.hp).toBe(base.abilities[0]!.minion!.hp);
    expect(doubled.abilities[0]!.minion!.attack).toBe(base.abilities[0]!.minion!.attack * 2);
  });

  it("leaves healing alone when scaling power", () => {
    const spec = {
      ...ROSTER[0]!,
      abilities: [{ type: "heal" as const, cooldown: 10, power: 70 }],
    };
    const scaled = scaleSpec(spec, 20, 3);
    expect(scaled.abilities[0]!.power).toBe(spec.abilities[0]!.power);
  });

  it("puts each shipped fighter near a coin flip against the reference", () => {
    for (const fighter of roster) {
      const rate = winRateVsReference(fighter, 120);
      // `fieldScale` deliberately pulls a fighter off the dummy to even the
      // *pair*, which is the number that matters, so the band is wider here.
      expect(rate).toBeGreaterThan(0.22);
      expect(rate).toBeLessThan(0.78);
    }
  }, 60_000);
});

describe("generateMatchups", () => {
  const report = evaluateRoster(roster, { sample: 30 });

  it("returns every pair, most even first", () => {
    const matchups = generateMatchups({ roster, report });
    expect(matchups).toHaveLength((roster.length * (roster.length - 1)) / 2);
    for (let i = 1; i < matchups.length; i += 1) {
      expect(matchups[i]!.imbalance).toBeGreaterThanOrEqual(matchups[i - 1]!.imbalance);
    }
  });

  it("is stable across runs given the same report", () => {
    const first = generateMatchups({ roster, report }).map((m) => `${m.a.id}|${m.b.id}`);
    const second = generateMatchups({ roster, report }).map((m) => `${m.a.id}|${m.b.id}`);
    expect(first).toEqual(second);
  });

  it("honours the limit", () => {
    // A two-fighter roster has one pair, so the limit can only cap it.
    const limited = generateMatchups({ roster, report, limit: 5 });
    expect(limited.length).toBeLessThanOrEqual(5);
    expect(limited.length).toBe(Math.min(5, (roster.length * (roster.length - 1)) / 2));
  });

  it("never pairs a fighter with itself", () => {
    for (const m of generateMatchups({ roster, report })) expect(m.a.id).not.toBe(m.b.id);
  });
});
