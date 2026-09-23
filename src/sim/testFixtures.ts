import type { Fighter, MatchConfig } from "./types.js";

/**
 * Fighters used by the tests. Kept out of the content pack so balance tuning
 * there can never break the simulation tests.
 *
 * **These numbers have to produce a fight that ends.** Damage lands on
 * collisions, so how much a fighter puts out per second is set by how often the
 * bouncing brings the pair together — not by `attackSpeed`, which no longer
 * gates contact at all. When `COLLISION_SHARE` came down the pair started
 * meeting about half as often, every fixture match ran to the 60-second
 * timeout, and two tests failed for it: the rubber-band one because both sides
 * timed out identically, and the performance one because 500 matches that never
 * end are 500 matches at full length.
 */
export function makeFighter(overrides: Partial<Fighter> & { id: string }): Fighter {
  const base: Fighter = {
    id: overrides.id,
    name: overrides.id.toUpperCase(),
    aspect: 0.8,
    spriteId: "default",
    maxHp: 1000,
    hp: 1000,
    attack: 95,
    attackSpeed: 1,
    critChance: 0.15,
    critMult: 2,
    abilities: [],
  };
  return { ...base, ...overrides };
}

/** Two identical fighters — the fairest possible match. */
export function mirrorMatch(): MatchConfig {
  return {
    a: makeFighter({ id: "alpha", name: "ALPHA", spriteId: "knight:210" }),
    b: makeFighter({ id: "beta", name: "BETA", spriteId: "reaper:340" }),
  };
}

/** A fighter that should steamroll `weakling`. Used to prove the drama score
 * punishes one-sided beatdowns. */
export function lopsidedMatch(): MatchConfig {
  return {
    a: makeFighter({
      id: "titan",
      name: "TITAN",
      spriteId: "golem:35",
      maxHp: 2400,
      hp: 2400,
      attack: 130,
      attackSpeed: 2.2,
      critChance: 0.35,
      critMult: 2.5,
    }),
    b: makeFighter({
      id: "weakling",
      name: "WEAKLING",
      spriteId: "wisp:190",
      maxHp: 500,
      hp: 500,
      attack: 12,
      attackSpeed: 0.6,
      critChance: 0.02,
      critMult: 1.4,
    }),
  };
}

/** Exercises every ability type in one match. */
export function abilityMatch(): MatchConfig {
  return {
    a: makeFighter({
      id: "summoner",
      name: "SUMMONER",
      spriteId: "mage:265",
      attack: 62,
      abilities: [
        { type: "spawn_minion", cooldown: 6, power: 90 },
        { type: "heal", cooldown: 9, power: 70 },
      ],
    }),
    b: makeFighter({
      id: "berserker",
      name: "BERSERKER",
      spriteId: "beast:15",
      attack: 70,
      abilities: [
        { type: "buff_attack", cooldown: 8, power: 0.5, duration: 4 },
        { type: "aoe", cooldown: 7, power: 55 },
      ],
    }),
  };
}
