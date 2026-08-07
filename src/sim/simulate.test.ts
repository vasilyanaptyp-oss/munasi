import { describe, expect, it } from "vitest";
import { simulate } from "./simulate.js";
import { abilityMatch, lopsidedMatch, makeFighter, mirrorMatch } from "./testFixtures.js";
import { FPS, MAX_FRAMES } from "./types.js";

describe("optional comeback rules", () => {
  it("hits harder the more HP a fighter has lost", () => {
    const config = mirrorMatch();
    const plain = simulate(config, 3);
    const banded = simulate(config, 3, { rubberBand: 1 });

    const damageOf = (result: ReturnType<typeof simulate>): number =>
      result.events
        .filter((e) => e.type === "hit" || e.type === "crit")
        .reduce((sum, e) => sum + e.value, 0);

    // Same seed, same swings — but each one lands for more once HP is down.
    expect(damageOf(banded) / banded.durationFrames).toBeGreaterThan(
      damageOf(plain) / plain.durationFrames,
    );
    // And the fight ends sooner because both sides are hitting harder.
    expect(banded.durationFrames).toBeLessThan(plain.durationFrames);
  });

  it("does not change damage while both fighters are at full HP", () => {
    const config = mirrorMatch();
    const plain = simulate(config, 3);
    const banded = simulate(config, 3, { rubberBand: 1 });
    const firstHit = (result: ReturnType<typeof simulate>) =>
      result.events.find((e) => e.type === "hit" || e.type === "crit")!;
    expect(banded.snapshots[0]).toEqual(plain.snapshots[0]);
    expect(firstHit(banded).value).toBe(firstHit(plain).value);
  });

  it("spawns a wave at each threshold, once each", () => {
    const config = mirrorMatch();
    const waves = simulate(config, 3, { comebackWaves: [0.5, 0.25], comebackWaveSize: 2 });
    const spawnsBy = (id: string): number =>
      waves.events.filter((e) => e.type === "spawn" && e.actorId === id).length;

    // Neither mirror fighter has a summon ability, so every spawn is a wave.
    expect(mirrorMatch().a.abilities).toEqual([]);
    const loser = waves.winner === "a" ? config.b.id : config.a.id;
    // The loser crosses both thresholds; two minions each time.
    expect(spawnsBy(loser)).toBe(4);
  });

  it("is still deterministic with rules on", () => {
    const config = abilityMatch();
    const rules = { rubberBand: 0.5, comebackWaves: [0.5, 0.25] };
    expect(JSON.stringify(simulate(config, 11, rules))).toBe(
      JSON.stringify(simulate(config, 11, rules)),
    );
  });
});

describe("simulate", () => {
  it("is deterministic: the same seed twice gives identical JSON", () => {
    const config = abilityMatch();
    const first = JSON.stringify(simulate(config, 4242));
    const second = JSON.stringify(simulate(config, 4242));
    expect(first).toBe(second);
  });

  it("stays deterministic across many seeds", () => {
    const config = mirrorMatch();
    for (const seed of [0, 1, 17, 999, 123456, -8]) {
      expect(JSON.stringify(simulate(config, seed))).toBe(
        JSON.stringify(simulate(config, seed)),
      );
    }
  });

  it("different seeds produce different matches", () => {
    const config = mirrorMatch();
    const results = [1, 2, 3, 4, 5].map((s) => JSON.stringify(simulate(config, s)));
    expect(new Set(results).size).toBe(results.length);
  });

  it("does not mutate the config it was given", () => {
    const config = abilityMatch();
    const before = JSON.stringify(config);
    simulate(config, 77);
    expect(JSON.stringify(config)).toBe(before);
  });

  it("starts both fighters at full HP regardless of the config's hp field", () => {
    const config = mirrorMatch();
    config.a.hp = 3;
    const result = simulate(config, 5);
    const first = result.snapshots[0]!;
    expect(first.a.hp).toBe(config.a.maxHp);
    expect(first.b.hp).toBe(config.b.maxHp);
  });

  it("emits one snapshot per video frame, numbered consecutively", () => {
    const result = simulate(mirrorMatch(), 11);
    expect(result.snapshots.length).toBe(result.durationFrames);
    result.snapshots.forEach((snap, i) => expect(snap.frame).toBe(i));
  });

  it("keeps every event inside the rendered frame range", () => {
    const result = simulate(abilityMatch(), 31);
    for (const event of result.events) {
      expect(event.frame).toBeGreaterThanOrEqual(0);
      expect(event.frame).toBeLessThan(result.durationFrames);
    }
  });

  it("never reports negative HP", () => {
    const result = simulate(lopsidedMatch(), 13);
    for (const snap of result.snapshots) {
      expect(snap.a.hp).toBeGreaterThanOrEqual(0);
      expect(snap.b.hp).toBeGreaterThanOrEqual(0);
    }
  });

  it("ends with the loser at zero HP and marks the winner", () => {
    const result = simulate(lopsidedMatch(), 21);
    expect(result.winner).toBe("a");
    expect(result.winnerId).toBe("titan");
    expect(result.timedOut).toBe(false);
    const last = result.snapshots[result.snapshots.length - 1]!;
    expect(last.b.hp).toBe(0);
    expect(last.b.alive).toBe(false);
    expect(result.events.at(-1)!.type).toBe("victory");
  });

  it("times out at 60 seconds when nobody can finish the job", () => {
    const stalemate = {
      a: makeFighter({ id: "wall_a", maxHp: 5000, hp: 5000, attack: 1, attackSpeed: 0.5 }),
      b: makeFighter({ id: "wall_b", maxHp: 5000, hp: 5000, attack: 1, attackSpeed: 0.5 }),
    };
    const result = simulate(stalemate, 9);
    expect(result.timedOut).toBe(true);
    expect(result.durationFrames).toBe(MAX_FRAMES);
    expect(result.durationFrames / FPS).toBe(60);
  });

  it("spawns minions, and they expire on their lifetime", () => {
    const config = abilityMatch();
    const result = simulate(config, 3);
    const spawns = result.events.filter((e) => e.type === "spawn");
    expect(spawns.length).toBeGreaterThan(0);
    expect(result.events.some((e) => e.type === "minion_hit")).toBe(true);
    // The first minion has an 8s lifetime, so it must be gone 9s after spawning.
    const firstSpawn = spawns[0]!;
    const later = result.snapshots[firstSpawn.frame + 9 * FPS];
    if (later) {
      expect(later.minions.some((m) => m.id === firstSpawn.targetId)).toBe(false);
    }
  });

  it("applies heal, buff and aoe abilities", () => {
    const result = simulate(abilityMatch(), 6);
    const types = new Set(result.events.map((e) => e.type));
    expect(types.has("heal")).toBe(true);
    expect(types.has("buff")).toBe(true);
    expect(types.has("aoe")).toBe(true);
    const buffed = result.snapshots.find((s) => s.b.buffed);
    expect(buffed).toBeDefined();
    expect(buffed!.b.attack).toBeGreaterThan(result.fighters.b.attack);
  });

  it("never heals a fighter above max HP", () => {
    const config = {
      a: makeFighter({
        id: "medic",
        attack: 5,
        abilities: [{ type: "heal" as const, cooldown: 1, power: 900 }],
      }),
      b: makeFighter({ id: "poker", attack: 6, attackSpeed: 0.5 }),
    };
    const result = simulate(config, 2);
    for (const snap of result.snapshots) {
      expect(snap.a.hp).toBeLessThanOrEqual(snap.a.maxHp);
    }
  });

  it("attacks at roughly the configured attack speed", () => {
    const config = {
      a: makeFighter({ id: "fast", attackSpeed: 3, attack: 1 }),
      b: makeFighter({ id: "slow", attackSpeed: 1, attack: 1, maxHp: 100000, hp: 100000 }),
    };
    const result = simulate({ ...config, a: { ...config.a, maxHp: 100000, hp: 100000 } }, 4);
    const seconds = result.durationFrames / FPS;
    const fastHits = result.events.filter(
      (e) => e.actorId === "fast" && (e.type === "hit" || e.type === "crit"),
    ).length;
    expect(fastHits / seconds).toBeCloseTo(3, 0);
  });

  it("rolls crits at roughly the configured rate", () => {
    const config = {
      a: makeFighter({ id: "critter", critChance: 0.3, attack: 1, maxHp: 100000, hp: 100000 }),
      b: makeFighter({ id: "dummy", attack: 1, maxHp: 100000, hp: 100000 }),
    };
    const result = simulate(config, 8);
    const swings = result.events.filter(
      (e) => e.actorId === "critter" && (e.type === "hit" || e.type === "crit"),
    );
    const crits = swings.filter((e) => e.type === "crit").length;
    expect(crits / swings.length).toBeGreaterThan(0.15);
    expect(crits / swings.length).toBeLessThan(0.5);
  });

  it("leaves the default path byte-identical when rules are passed empty", () => {
    const config = abilityMatch();
    const bare = JSON.stringify(simulate(config, 77));
    expect(JSON.stringify(simulate(config, 77, {}))).toBe(bare);
    expect(JSON.stringify(simulate(config, 77, { rubberBand: 0 }))).toBe(bare);
    expect(JSON.stringify(simulate(config, 77, { comebackWaves: [] }))).toBe(bare);
  });

  it("runs 500 matches in well under a second", () => {
    const config = abilityMatch();
    const start = performance.now();
    for (let seed = 0; seed < 500; seed += 1) simulate(config, seed);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
