import type { Fighter, MatchConfig } from "./types.js";

/** Fighters used by the tests. Kept out of the content pack so balance tuning
 * there can never break the simulation tests. */
export function makeFighter(overrides: Partial<Fighter> & { id: string }): Fighter {
  const base: Fighter = {
    id: overrides.id,
    name: overrides.id.toUpperCase(),
    spriteId: "default",
    maxHp: 1000,
    hp: 1000,
    attack: 40,
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
    a: makeFighter({ id: "alpha", name: "ALPHA" }),
    b: makeFighter({ id: "beta", name: "BETA" }),
  };
}

/** A fighter that should steamroll `weakling`. Used to prove the drama score
 * punishes one-sided beatdowns. */
export function lopsidedMatch(): MatchConfig {
  return {
    a: makeFighter({
      id: "titan",
      name: "TITAN",
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
      attack: 26,
      abilities: [
        { type: "spawn_minion", cooldown: 6, power: 90 },
        { type: "heal", cooldown: 9, power: 70 },
      ],
    }),
    b: makeFighter({
      id: "berserker",
      name: "BERSERKER",
      attack: 30,
      abilities: [
        { type: "buff_attack", cooldown: 8, power: 0.5, duration: 4 },
        { type: "aoe", cooldown: 7, power: 55 },
      ],
    }),
  };
}
