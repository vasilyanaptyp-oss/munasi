import { describe, expect, it } from "vitest";
import { simulate } from "./simulate.js";
import { makeFighter } from "./testFixtures.js";
import { ABILITY_TYPES, FPS, type AbilityType, type MatchConfig, type MatchEvent } from "./types.js";
import { initialMovement, resolveCollision, stepMovement } from "./movement.js";
import { mulberry32 } from "./rng.js";

/**
 * The ten abilities added as a batch, each proved to do the thing it is for.
 *
 * The roster gates cannot cover these: `tempo.test.ts` and `content.test.ts`
 * walk the shipped roster, and the shipped roster is four fighters using six
 * abilities. An ability nobody has yet is an ability nothing checks — which is
 * the same shape of hole `parseFighter` had when `meleeShare` was added to the
 * roster and silently dropped on the way in, and every video shipped for weeks
 * without it.
 *
 * So each one gets a fighter of its own here, and the assertion is the
 * *mechanic*, not just that the cast happened: a swap moves both men, a pull
 * closes the gap, a riposte puts a second number on the same frame.
 */

/** The ten. Kept as its own list so the coverage test below can compare. */
const NEW_ABILITIES: AbilityType[] = [
  "switcheroo",
  "magnet_pull",
  "spin_cycle",
  "overclock",
  "dead_weight",
  "wall_slam",
  "siphon",
  "countdown",
  "riposte",
  "slipstream",
];

/** One caster with the ability under test, against a plain opponent. */
function duel(type: AbilityType, overrides: Record<string, unknown> = {}): MatchConfig {
  return {
    a: makeFighter({
      id: "caster",
      name: "CASTER",
      spriteId: "mage:265",
      abilities: [{ type, cooldown: 3, power: 0, hitShare: 2, ...overrides }],
    }),
    b: makeFighter({ id: "target", name: "TARGET", spriteId: "beast:15" }),
  };
}

const castsOf = (events: MatchEvent[], type: AbilityType): MatchEvent[] =>
  events.filter((e) => e.type === "signature" && e.ability === type);

const hitsOf = (events: MatchEvent[], type: AbilityType): MatchEvent[] =>
  events.filter((e) => (e.type === "hit" || e.type === "crit") && e.ability === type);

describe("the ten new abilities", () => {
  it("are all reachable from the roster parser", () => {
    // The parser used to keep its own copy of the type list. It now derives it,
    // and this is the gate that says so: a type the simulation knows and the
    // parser does not is a fighter that cannot be loaded.
    for (const type of NEW_ABILITIES) expect(ABILITY_TYPES).toContain(type);
  });

  it.each(NEW_ABILITIES)("casts and lands damage: %s", (type) => {
    // `riposte` is the one that schedules nothing — it answers a blow rather
    // than throwing one — so it is checked separately below.
    let cast = 0;
    let landed = 0;
    for (let seed = 0; seed < 12; seed += 1) {
      const result = simulate(duel(type), seed);
      cast += castsOf(result.events, type).length;
      landed += hitsOf(result.events, type).length;
    }
    expect(cast, `${type} never cast`).toBeGreaterThan(0);
    if (type !== "riposte") {
      expect(landed, `${type} cast but never took a point off anyone`).toBeGreaterThan(0);
    }
  });

  it("SWITCHEROO puts each man where the other was", () => {
    const result = simulate(duel("switcheroo"), 4);
    const cast = castsOf(result.events, "switcheroo")[0];
    expect(cast).toBeDefined();
    const before = result.snapshots[cast!.frame - 1];
    const after = result.snapshots[cast!.frame + 1];
    expect(before).toBeDefined();
    expect(after).toBeDefined();
    // Each ends up near where the other started — within the distance a fighter
    // covers in the two frames either side of the swap.
    const slack = 0.06;
    expect(Math.hypot(after!.a.x - before!.b.x, after!.a.y - before!.b.y)).toBeLessThan(slack);
    expect(Math.hypot(after!.b.x - before!.a.x, after!.b.y - before!.a.y)).toBeLessThan(slack);
  });

  it("REEL IN closes the gap while it runs", () => {
    // Measured over the window itself, not at a fixed frame: the first cast
    // comes after a full cooldown, and an earlier version of this test sampled
    // frame 62 of a fight whose first cast was at frame 90 — so it compared two
    // fights that had not diverged yet and read identical numbers.
    let closed = 0;
    let opened = 0;
    for (let seed = 0; seed < 24; seed += 1) {
      const result = simulate(duel("magnet_pull", { duration: 1.4 }), seed);
      for (const cast of castsOf(result.events, "magnet_pull")) {
        const start = result.snapshots[cast.frame];
        if (!start) continue;
        const before = Math.hypot(start.a.x - start.b.x, start.a.y - start.b.y);
        // **The closest they get during the window, not where they are at the
        // end of it.** The reel lets go the moment it lands its man — holding
        // on ground out a run of collisions, and a collision pays both fighters
        // — so by a fixed 1.2s later the pair has already bounced apart, and
        // this gate was reading the rebound as a failure to pull.
        let nearest = before;
        for (let ahead = 1; ahead <= Math.round(1.2 * FPS); ahead += 1) {
          const at = result.snapshots[cast.frame + ahead];
          if (!at) break;
          nearest = Math.min(nearest, Math.hypot(at.a.x - at.b.x, at.a.y - at.b.y));
        }
        if (nearest < before) closed += 1;
        else opened += 1;
      }
    }
    expect(closed + opened, "no pull was ever cast").toBeGreaterThan(20);
    // Not every one: a pair that is already touching cannot get closer, and the
    // victim keeps bouncing off walls on the way in. What has to be true is that
    // the pull dominates, which a fighter left alone would not do.
    expect(closed).toBeGreaterThan(opened * 2);
  });

  it("SPIN CYCLE holds him at arm's length from the other man", () => {
    const result = simulate(duel("spin_cycle", { duration: 1.2 }), 3);
    const cast = castsOf(result.events, "spin_cycle")[0];
    expect(cast).toBeDefined();
    // Sampled across the middle of the cast: he is close, and he stays close.
    const during: number[] = [];
    for (let f = cast!.frame + 2; f < cast!.frame + Math.round(1.0 * FPS); f += 1) {
      const s = result.snapshots[f];
      if (s) during.push(Math.hypot(s.a.x - s.b.x, s.a.y - s.b.y));
    }
    expect(during.length).toBeGreaterThan(10);
    expect(Math.max(...during)).toBeLessThan(0.45);
  });

  it("OVERCLOCK makes every blow inside the window a crit", () => {
    let crits = 0;
    let plain = 0;
    for (let seed = 0; seed < 20; seed += 1) {
      const result = simulate(duel("overclock", { duration: 2 }), seed);
      for (const cast of castsOf(result.events, "overclock")) {
        // The window is set in ticks and events carry frames, and there are two
        // ticks to a frame — so the frame the window ends on holds one tick
        // inside it and one outside. Assert on the interior and leave the
        // boundary frame alone rather than pretending the edge is sharp.
        const until = cast.frame + Math.round(2 * FPS) - 1;
        for (const e of result.events) {
          if (e.actorId !== "caster" || e.ability !== undefined) continue;
          if (e.frame <= cast.frame || e.frame >= until) continue;
          if (e.type === "crit") crits += 1;
          else if (e.type === "hit") plain += 1;
        }
      }
    }
    expect(crits + plain, "no contact landed inside any window").toBeGreaterThan(0);
    expect(plain, "a plain hit landed inside a crit window").toBe(0);
  });

  it("DEAD WEIGHT sends the other man off faster than he arrived", () => {
    // Straight at the physics rather than through a whole fight: two fighters
    // driven into each other, one of them planted.
    const rng = mulberry32(1);
    const wall = initialMovement("a", 0.8, rng);
    const runner = initialMovement("b", 0.8, rng);
    wall.x = 0.5;
    wall.y = 0.5;
    wall.vx = 0;
    wall.vy = 0;
    wall.frozenUntilTick = 100;
    wall.immovableUntilTick = 100;
    runner.x = 0.5 + wall.halfW + runner.halfW - 0.005;
    runner.y = 0.5;
    runner.vx = -0.008;
    runner.vy = 0;
    const before = Math.abs(runner.vx);
    const contact = resolveCollision(wall, runner, 0);
    expect(contact).not.toBeNull();
    expect(runner.vx).toBeGreaterThan(0);
    expect(Math.abs(runner.vx)).toBeGreaterThan(before);
    // And the planted man did not budge.
    expect(wall.x).toBe(0.5);
  });

  it("SLIPSTREAM passes through instead of bouncing", () => {
    const rng = mulberry32(2);
    const ghost = initialMovement("a", 0.8, rng);
    const solid = initialMovement("b", 0.8, rng);
    ghost.x = 0.5;
    ghost.y = 0.5;
    solid.x = 0.5;
    solid.y = 0.5;
    // Sitting inside each other: without the phase this is unambiguously contact.
    expect(resolveCollision(ghost, solid, 0)).not.toBeNull();
    ghost.phasingUntilTick = 10;
    expect(resolveCollision(ghost, solid, 0)).toBeNull();
  });

  it("SIPHON gives the caster back what it takes", () => {
    const config = duel("siphon", { hitShare: 3 });
    // Start him hurt, so there is room for the points to arrive.
    const result = simulate(config, 5, { startHpA: 400 });
    const heals = result.events.filter((e) => e.type === "heal" && e.actorId === "caster");
    const taken = hitsOf(result.events, "siphon");
    expect(taken.length).toBeGreaterThan(0);
    expect(heals.length).toBeGreaterThan(0);
    // Every heal lands on the same frame as the hit that paid for it.
    for (const heal of heals) {
      expect(taken.some((h) => h.frame === heal.frame), `heal at ${heal.frame}`).toBe(true);
    }
  });

  it("COUNTDOWN lands well after it is cast", () => {
    const result = simulate(duel("countdown"), 6);
    const cast = castsOf(result.events, "countdown")[0];
    const hit = hitsOf(result.events, "countdown")[0];
    expect(cast).toBeDefined();
    expect(hit).toBeDefined();
    const gapSeconds = (hit!.frame - cast!.frame) / FPS;
    expect(gapSeconds).toBeGreaterThan(2);
    expect(gapSeconds).toBeLessThan(3.5);
  });

  it("RIPOSTE answers any blow, not only a collision", () => {
    // The distinction is the whole balance of the ability. While it only
    // answered contact, its worth tracked how much of the *opponent's* game was
    // contact — the fencer took 98% of his pairs against melee fighters and 21%
    // against throwers. Answering everything makes it proportional to how often
    // he is hurt, which the calibrator already levels.
    let answeredAbility = 0;
    for (let seed = 0; seed < 30; seed += 1) {
      const config = duel("riposte", { duration: 3 });
      // Give the opponent something thrown, so there is a non-contact blow to
      // answer at all.
      config.b = makeFighter({
        id: "target",
        name: "TARGET",
        spriteId: "beast:15",
        abilities: [{ type: "glasses_throw", cooldown: 3, power: 0, hitShare: 2 }],
      });
      const result = simulate(config, seed);
      for (const back of hitsOf(result.events, "riposte")) {
        const cause = result.events.find(
          (e) =>
            e.frame === back.frame &&
            (e.type === "hit" || e.type === "crit") &&
            e.ability === "glasses_throw" &&
            e.actorId === back.targetId,
        );
        if (cause) answeredAbility += 1;
      }
    }
    expect(answeredAbility, "a thrown blow was never answered").toBeGreaterThan(0);
  });

  it("RIPOSTE answers on the frame the blow lands, and does not volley", () => {
    let answered = 0;
    for (let seed = 0; seed < 20; seed += 1) {
      const result = simulate(duel("riposte", { duration: 2.5 }), seed);
      for (const back of hitsOf(result.events, "riposte")) {
        // Somebody hit him on this frame, and it was the man being answered.
        const cause = result.events.find(
          (e) =>
            e.frame === back.frame &&
            (e.type === "hit" || e.type === "crit") &&
            e.ability !== "riposte" &&
            e.actorId === back.targetId,
        );
        // **Not every riposte hit is an answer any more.** The ability schedules
        // its own lunge as well, so `hitsOf(..., "riposte")` mixes the two; what
        // has to hold is that answers exist and that nothing volleys.
        if (cause) answered += 1;
        // And nobody answers his own answer. A lunge and a parry can share a
        // frame, so the count is not the test — the test is that no riposte hit
        // is credited to the man it just landed on.
        const selfAnswer = result.events.find(
          (e) =>
            e.frame === back.frame &&
            e.ability === "riposte" &&
            e.actorId === back.targetId &&
            e.targetId === back.actorId,
        );
        expect(selfAnswer, `riposte volleyed at frame ${back.frame}`).toBeUndefined();
      }
    }
    expect(answered, "riposte never fired in twenty fights").toBeGreaterThan(0);
  });

  it("leaves the fight deterministic", () => {
    for (const type of NEW_ABILITIES) {
      const one = simulate(duel(type), 11);
      const two = simulate(duel(type), 11);
      expect(JSON.stringify(one), type).toBe(JSON.stringify(two));
    }
  });

  it("never runs a fighter through a wall", () => {
    for (const type of NEW_ABILITIES) {
      for (let seed = 0; seed < 6; seed += 1) {
        const result = simulate(duel(type), seed);
        for (const snap of result.snapshots) {
          for (const who of [snap.a, snap.b]) {
            expect(who.x, `${type} seed ${seed}`).toBeGreaterThanOrEqual(-0.001);
            expect(who.x, `${type} seed ${seed}`).toBeLessThanOrEqual(1.001);
            expect(who.y, `${type} seed ${seed}`).toBeGreaterThanOrEqual(-0.001);
            expect(who.y, `${type} seed ${seed}`).toBeLessThanOrEqual(1.001);
          }
        }
      }
    }
  });

  it("keeps the fight finishing", () => {
    for (const type of NEW_ABILITIES) {
      const result = simulate(duel(type), 9);
      expect(result.durationFrames / FPS, type).toBeLessThanOrEqual(60);
    }
  });
});

describe("a rebound is a boost, not a ratchet", () => {
  it("never lets a pinned fighter compound his own speed", () => {
    // The bug this exists for: `DEAD_WEIGHT` makes the sumo immovable, a man
    // caught between him and a wall collides on every tick, and a 1.45x rebound
    // applied every tick is 1.45^n. Measured before the cap on Sumo Guy against
    // Luchador Guy: 113 frames out of 208 moving more than a tenth of the arena,
    // a median step of 0.246 against a normal 0.006 — a photograph strobing
    // across the square.
    const rng = mulberry32(4);
    const wall = initialMovement("a", 0.8, rng);
    const pinned = initialMovement("b", 0.8, rng);
    wall.x = 0.5;
    wall.y = 0.5;
    wall.vx = 0;
    wall.vy = 0;
    wall.frozenUntilTick = 10_000;
    wall.immovableUntilTick = 10_000;
    pinned.x = 0.5 + wall.halfW + pinned.halfW - 0.004;
    pinned.y = 0.5;
    pinned.vx = -0.007;
    pinned.vy = 0.001;

    let fastest = 0;
    for (let tick = 0; tick < 400; tick += 1) {
      stepMovement(pinned, { tick, rng });
      resolveCollision(wall, pinned, tick);
      fastest = Math.max(fastest, Math.hypot(pinned.vx, pinned.vy));
    }
    // A fighter's own top speed is 0.00762; the rebound may lift one bounce
    // above it, and nothing may lift a hundred.
    expect(fastest, `pinned fighter reached ${fastest.toFixed(4)} per tick`).toBeLessThan(0.012);
  });
});
