import type { Ability } from "../sim/types.js";

/**
 * The hand-authored half of the roster: identity, feel and gimmick. Every
 * fighter's `attack` is *derived* from these by `calibrate.ts` — see the notes
 * there for why it is solved for rather than written by hand.
 *
 * **A fighter is a photo and one big ability.** That is the whole design, taken
 * from the reference channel: a cut-out on a flat blue field, outlined in white,
 * bouncing around the arena, and one signature effect that takes over the
 * screen. Names are English and plain — "<thing> Guy" — because the title has to
 * be read in half a second in a feed.
 *
 * The previous roster was twelve Russian job titles. A job gives you a
 * silhouette and a prop; it does not give you anything to *watch*. That is why
 * those fights were inert, and it is why they are gone.
 *
 * Design rules for adding a fighter:
 * - drop a photo on a white background into `assets/fighters/source/` and run
 *   `pnpm cutout`; the name of the file is the sprite id;
 * - `maxHp` between 1000 and 1400, `attackSpeed` 0.75-1.45;
 * - `critChance` 0.22-0.38 with `critMult` 2.3-3.0. Fat crits are most of what
 *   keeps the outcome uncertain;
 * - and the part that matters: give it **one ability you can draw across the
 *   whole arena**. If you cannot describe the effect in one sentence, the
 *   character does not work.
 */

/** Which side of the card a fighter is on. Kept so titles read "A vs B". */
export type Faction = "left" | "right";

export interface FighterSpec {
  id: string;
  faction: Faction;
  /** English, and short. It goes in the title over the arena. */
  name: string;
  /** File name in `assets/fighters/`, without the extension. */
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
    // Holding a compass and still lost. He is the one who never travels in a
    // straight line for long — see `signature` in the render layer — and his
    // ability points everyone else somewhere they did not want to go.
    id: "compass",
    faction: "left",
    name: "COMPASS GUY",
    spriteId: "compass-guy",
    maxHp: 1200,
    attackSpeed: 1.15,
    critChance: 0.32,
    critMult: 2.6,
    abilities: [{ type: "magnetic_north", cooldown: 7, power: 0 }],
    // Solved, not guessed. The calibrator evens each fighter against a reference
    // dummy, which does not make a *pair* even: without this Compass Guy took
    // 66% of the fights. Bisected through the real calibration over 200 fights
    // per step until the pair sits on 50.
    fieldScale: 0.918,
    // Solved, not guessed: the calibrator balances each fighter against a
    // reference dummy, which does not make a *pair* even. Bisected over 300
    // fights until Compass Guy takes exactly half of them.
  },
  {
    // Arms crossed, sunglasses on, does not move. Everything else bounces off
    // him; his ability stops the arena dead for a beat.
    id: "bodyguard",
    faction: "right",
    name: "BODYGUARD GUY",
    spriteId: "bodyguard-guy",
    maxHp: 1350,
    attackSpeed: 0.85,
    critChance: 0.24,
    critMult: 2.9,
    abilities: [{ type: "nobody_moves", cooldown: 9, power: 0, duration: 1.4 }],
  },
];
