import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { simulate } from "../sim/simulate.js";
import { GAUNTLET_RULES } from "./teams.js";
import { FPS } from "../sim/types.js";
import { BALANCE_MAX, BALANCE_MIN, evaluatePair, evaluateRoster } from "./balance.js";
import { analyticAttack, scaleSpec, winRateVsReference } from "./calibrate.js";
import { cutout, cutoutWarning, spriteAspect, FIELD_BLEND_LIMIT } from "./cutout.js";
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
      // A crit is a *wider* number, not a different one. The reference keeps
      // every damage number it shows inside 75-120, which no roster with a
      // 2.6x crit can do: one blow in three would land at 250 and the ordinary
      // blow has to be shrunk to pay for it. See the note in `roster.ts`.
      expect(fighter.critChance).toBeGreaterThanOrEqual(0.12);
      expect(fighter.critChance).toBeLessThanOrEqual(0.28);
      expect(fighter.critMult).toBeGreaterThanOrEqual(1.3);
      expect(fighter.critMult).toBeLessThanOrEqual(1.8);
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
    // **This is not the length of a shipped video, and the floor used to be set
    // as though it were.** `evaluateRoster` plays random seeds; `pnpm generate`
    // searches hundreds and keeps the dramatic ones, which are the long ones.
    // Measured on the same build: 15.5s here against 22.0-25.7s in the four
    // videos actually written. The reference's own two run 18.5-19.0s.
    //
    // So the band here is on the raw mean, with the shipped offset allowed for:
    // below 13 the shipped videos would be under the reference, above 30 they
    // would run past the channel's longest.
    expect(mean).toBeGreaterThan(13);
    expect(mean).toBeLessThan(30);
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

  it("keeps every field correction small, and nobody wildly off the dummy", () => {
    // **Two things, because one of them was measuring the wrong quantity.**
    //
    // `fieldScale` is the hand correction that evens a *pair*, and the design
    // rule for it is that it stays within a few percent of 1 — a big one means
    // the calibrator and the shipped game disagree about something, which has
    // happened twice and both times was a real bug. That is what this asserts
    // first, and it is the invariant that matters.
    //
    // The winrate against the dummy is only a sanity net now. It used to be
    // held inside 0.22-0.78, which sounds generous and is not: with the crits
    // flat the outcome is close to deterministic in power, so **eleven percent
    // of strength is worth twenty-seven points of winrate** — Boxer Guy sits at
    // 22.5% off a `fieldScale` of 0.89. A tighter band here does not catch a
    // mis-calibrated fighter, it catches a correctly corrected one.
    for (const spec of ROSTER) {
      const scale = spec.fieldScale ?? 1;
      expect(Math.abs(scale - 1), `${spec.id} fieldScale ${scale}`).toBeLessThan(0.2);
    }
    for (const fighter of roster) {
      const rate = winRateVsReference(fighter, 120);
      expect(rate, `${fighter.id} vs the dummy`).toBeGreaterThan(0.1);
      expect(rate, `${fighter.id} vs the dummy`).toBeLessThan(0.9);
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

describe("cutout quality", () => {
  it("says so when the background survived the cut", () => {
    // The failure mode that matters for somebody's first run: a flood fill from
    // the border does not fail on a photo taken in a room, it succeeds at
    // keeping all of it.
    expect(cutoutWarning(0.95)).toMatch(/background is still there/);
    expect(cutoutWarning(0.02)).toMatch(/almost nothing survived/);
  });

  it("stays quiet across the band the shipped cast actually occupies", () => {
    // Measured on the four that ship: 36-61%. The band has room either side of
    // that, so a tighter or looser crop than ours does not cry wolf.
    for (const coverage of [0.15, 0.36, 0.45, 0.61, 0.8]) {
      expect(cutoutWarning(coverage), `${coverage}`).toBeNull();
    }
    // And every shipped fighter is a real PNG with a sane aspect.
    for (const fighter of roster) {
      expect(spriteAspect(fighter.spriteId)).toBeCloseTo(fighter.aspect, 2);
    }
  });
});

describe("nobody wears the arena", () => {
  it("keeps every shipped fighter distinguishable from the field", async () => {
    // A cut-out can be flawless and the character still invisible. The luchador
    // came in a turquoise singlet: 54% coverage, no holes, no warning, and a
    // tenth of him the exact colour of the square he stands on. Every other
    // photograph measures 0.0%, so this gate has no judgement in it.
    for (const fighter of roster) {
      const source = ["jpg", "jpeg", "png"]
        .map((ext) => join("assets", "fighters", "source", `${fighter.spriteId}.${ext}`))
        .find((path) => existsSync(path));
      expect(source, `no source for ${fighter.spriteId}`).toBeDefined();
      const cut = await cutout(source!);
      expect(cut.fieldBlend, `${fighter.id} blends into the arena`).toBeLessThan(FIELD_BLEND_LIMIT);
    }
  }, 60_000);

  it("says so plainly when a costume is the wrong colour", () => {
    expect(cutoutWarning(0.5, 0, 0.093)).toMatch(/colour of the arena/);
    expect(cutoutWarning(0.5, 0, 0.0)).toBeNull();
  });
});
