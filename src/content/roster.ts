import type { Ability } from "../sim/types.js";

/**
 * The hand-authored half of the roster: identity, role and feel. Every fighter's
 * `attack` is *derived* from these by `calibrate.ts` — see the notes there for
 * why it is solved for rather than written by hand.
 *
 * Design rules for adding a fighter:
 * - `maxHp` between 1000 and 1400. A wider spread pushes match length out of
 *   the 22-38s drama window, because a match runs roughly hp_a * hp_b / P.
 * - `attackSpeed` between 0.75 and 1.45, so swings stay frequent enough to
 *   watch but the match is still decided by ~25 rolls rather than ~60.
 * - `critChance` 0.22-0.38 with `critMult` 2.3-3.0. This is load-bearing: fat
 *   crits are most of what makes the outcome uncertain, and without that
 *   uncertainty a 3% stat edge turns into a 100% winrate.
 * - Give at most two abilities, and remember an `aoe` opponent is the natural
 *   counter to `spawn_minion`.
 */
export interface FighterSpec {
  id: string;
  name: string;
  spriteId: string;
  maxHp: number;
  attackSpeed: number;
  critChance: number;
  critMult: number;
  abilities: Ability[];
  /**
   * Manual correction applied on top of the automatic calibration, for a
   * fighter that measures fine against the reference dummy but drifts against
   * the actual field. Keep within a few percent of 1.
   */
  fieldScale?: number;
}

export const ROSTER: FighterSpec[] = [
  {
    id: "plumber",
    name: "САНТЕХНИК ЖЭКА",
    spriteId: "plumber",
    maxHp: 1400,
    attackSpeed: 0.8,
    critChance: 0.26,
    critMult: 2.4,
    abilities: [{ type: "heal", cooldown: 10, power: 70 }],
    fieldScale: 1.03,
  },
  {
    id: "baker",
    name: "НОЧНОЙ ПЕКАРЬ",
    spriteId: "baker",
    maxHp: 1050,
    attackSpeed: 1.05,
    critChance: 0.3,
    critMult: 2.6,
    abilities: [{ type: "aoe", cooldown: 8, power: 85 }],
  },
  {
    id: "courier",
    name: "КУРЬЕР НА СМЕНЕ",
    spriteId: "courier",
    maxHp: 1000,
    attackSpeed: 1.45,
    critChance: 0.28,
    critMult: 2.3,
    abilities: [{ type: "buff_attack", cooldown: 9, power: 0.35, duration: 4 }],
  },
  {
    id: "loader",
    name: "ГРУЗЧИК С РЫНКА",
    spriteId: "loader",
    maxHp: 1400,
    attackSpeed: 0.75,
    critChance: 0.22,
    critMult: 3.0,
    abilities: [],
  },
  {
    id: "nailmaster",
    name: "МАСТЕР МАНИКЮРА",
    spriteId: "nailmaster",
    maxHp: 1000,
    attackSpeed: 1.35,
    critChance: 0.38,
    critMult: 2.8,
    abilities: [],
  },
  {
    id: "chairman",
    name: "ПРЕДСЕДАТЕЛЬ КОМИССИИ",
    spriteId: "chairman",
    maxHp: 1150,
    attackSpeed: 0.95,
    critChance: 0.3,
    critMult: 2.5,
    abilities: [
      {
        type: "spawn_minion",
        cooldown: 9,
        power: 190,
        minion: { hp: 190, attack: 17, attackSpeed: 0.9, lifetime: 9 },
      },
    ],
  },
  {
    id: "silencer",
    name: "ГЛАВНЫЙ ПО ТИШИНЕ",
    spriteId: "silencer",
    maxHp: 1200,
    attackSpeed: 1.4,
    critChance: 0.24,
    critMult: 2.3,
    abilities: [],
  },
  {
    id: "arbiter",
    name: "ВЕРХОВНЫЙ АРБИТР",
    spriteId: "arbiter",
    maxHp: 1300,
    attackSpeed: 1.0,
    critChance: 0.28,
    critMult: 2.5,
    abilities: [{ type: "heal", cooldown: 9, power: 55 }],
  },
  {
    id: "councillor",
    name: "ТАЙНЫЙ СОВЕТНИК",
    spriteId: "councillor",
    maxHp: 1100,
    attackSpeed: 0.9,
    critChance: 0.26,
    critMult: 2.6,
    abilities: [
      {
        type: "spawn_minion",
        cooldown: 7,
        power: 200,
        minion: { hp: 200, attack: 18, attackSpeed: 0.9, lifetime: 8 },
      },
    ],
  },
  {
    id: "viceroy",
    name: "НАМЕСТНИК ОКРУГА",
    spriteId: "viceroy",
    maxHp: 1100,
    attackSpeed: 1.2,
    critChance: 0.32,
    critMult: 2.7,
    abilities: [{ type: "buff_attack", cooldown: 10, power: 0.5, duration: 5 }],
  },
  {
    id: "gatekeeper",
    name: "СТАРШИЙ ПО ШЛАГБАУМУ",
    spriteId: "gatekeeper",
    maxHp: 1250,
    attackSpeed: 1.15,
    critChance: 0.3,
    critMult: 2.4,
    abilities: [],
  },
  {
    id: "inspector",
    name: "ВЕЧНЫЙ ИНСПЕКТОР",
    spriteId: "inspector",
    maxHp: 1250,
    attackSpeed: 0.95,
    critChance: 0.26,
    critMult: 2.5,
    abilities: [{ type: "aoe", cooldown: 7, power: 70 }],
  },
];
