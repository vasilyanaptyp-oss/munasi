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
    maxHp: 1020,
    attackSpeed: 1.15,
    critChance: 0.32,
    critMult: 2.6,
    abilities: [{ type: "magnetic_north", cooldown: 5, power: 0 }],
    // Solved, not guessed. The calibrator evens each fighter against a reference
    // dummy, which does not make a *pair* even: without this Compass Guy took
    // 66% of the fights. Bisected through the real calibration — change the
    // scale, re-run the whole calibrator, play 300 gauntlets, read the winrate —
    // until the pair sits on 50. Lands at 50.0% over 400 gauntlets.
    //
    // Re-bisected on every change to how damage happens or how often it can,
    // because every one of them moved the pair: `attackRate` 3 -> 0.35 (26/74),
    // pickups off (43/57), damage landing on contact instead of on a clock
    // (39/61), and the tempo pass — slower fighters, one pulse per cast, shorter
    // cooldowns, less HP — which moved it again.
    //
    // **The calibrator plays matches, so it moves too.** Anything touching
    // movement or combat shifts the calibration *and* the pair, and the bracket
    // has to be re-found from scratch rather than nudged: twice now the search
    // has converged onto its own lower bound because the answer had walked out
    // from under it.
    fieldScale: 0.9043,
  },
  {
    // Arms crossed, sunglasses on, does not move. Everything else bounces off
    // him; his ability stops the arena dead for a beat.
    id: "bodyguard",
    faction: "right",
    name: "BODYGUARD GUY",
    spriteId: "bodyguard-guy",
    maxHp: 1148,
    attackSpeed: 0.85,
    critChance: 0.24,
    critMult: 2.9,
    abilities: [{ type: "nobody_moves", cooldown: 6, power: 0, duration: 1.4 }],
  },

  /*
   * BOXER GUY and GLASSES GUY are built and waiting on their photographs.
   *
   * Both signatures exist and are drawn — `haymaker` and `four_eyes` in
   * `src/sim/simulate.ts` and `src/render/signatures.ts` — on the same shape as
   * the other two: the effect starts on its owner, crosses the arena, and
   * arrives on the frame the damage lands.
   *
   * What is missing is the only thing that cannot be written: the cut-outs. Put
   * the two photographs in `assets/fighters/source/` as `boxer-guy.jpg` and
   * `glasses-guy.jpg`, then:
   *
   *     pnpm cutout          # background off, keyline on, aspect measured
   *     # uncomment the two entries below
   *     pnpm calibrate       # solves `attack` for all four
   *     pnpm balance         # check the six pairings
   *
   * `aspect` is filled in by `pnpm cutout`, so leave whatever is here — it is
   * overwritten. `fieldScale` will need bisecting per fighter once the pairs
   * can actually be played; see the note on Compass Guy above for why it cannot
   * be guessed.
   *
   * A warning worth having in writing: Glasses Guy is a dark suit on a dark
   * background, and so is Bodyguard Guy. `silhouette.test.ts` requires the two
   * to differ by 40 points of mean lightness so they do not read as one blob on
   * the blue field. If that gate fails, the fix is a different photograph, not a
   * lower threshold.
   *
  {
    // Gloves up, scowling. The one who actually throws a punch.
    id: "boxer",
    faction: "left",
    name: "BOXER GUY",
    spriteId: "boxer-guy",
    maxHp: 1080,
    attackSpeed: 1.05,
    critChance: 0.34,
    critMult: 2.7,
    // The glove crosses the arena and knocks whatever it hits along its own
    // line, so the punch moves the fight as well as damaging it.
    abilities: [{ type: "haymaker", cooldown: 5, power: 0 }],
  },
  {
    // Reads the room, then throws his glasses at it.
    id: "glasses",
    faction: "right",
    name: "GLASSES GUY",
    spriteId: "glasses-guy",
    maxHp: 1120,
    attackSpeed: 0.95,
    critChance: 0.28,
    critMult: 2.8,
    abilities: [{ type: "four_eyes", cooldown: 6, power: 0 }],
  },
  */
];
