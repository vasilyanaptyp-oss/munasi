import type { Ability } from "../sim/types.js";

/**
 * The hand-authored half of the roster: identity, feel and gimmick. Every
 * fighter's `attack` is *derived* from these by `calibrate.ts` — see the notes
 * there for why it is solved for rather than written by hand.
 *
 * **Names are Title Case, not caps.** All four references write the title as
 * "Guitar Guy vs / Blind Guy" — capitalised, not shouted. Ours were stored
 * uppercase and the title came out as a block of capitals, which is the loudest
 * possible reading of the one piece of text the format keeps quiet.
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
 * - **`maxHp` is 1000 for everyone.** The reference gives every fighter the same
 *   1000 and it is right to: two plusses over two heads are read against each
 *   other constantly, and if the numbers start from different places the viewer
 *   cannot tell who is ahead without doing arithmetic. Difference belongs in
 *   attack, speed and crits, which are legible as *behaviour*;
 * - `attackSpeed` 0.45-1.45. **It no longer gates contact at all** — a collision
 *   is a physical event and every one of them lands — so it survives only for
 *   minions, buffs and as an input the calibrator reads. How hard a fighter hits
 *   by running into someone is `meleeShare`;
 * - **how big a number gets is arithmetic, not a knob.** A fighter's total output
 *   over a match is the other one's thousand health, so the number on screen is
 *   that thousand divided by how many blows land. Blows land when the outlines
 *   meet, which is geometry — figure size, speed, arena — and all three are
 *   measured off the reference. The only real lever left is *which* of a
 *   fighter's own sources carries his total: `meleeShare` against `hitShare`;
 * - `critChance` 0.16-0.22 with `critMult` 1.45-1.55. **A crit is a wider
 *   number, not a different one.** These used to be 0.22-0.38 at 2.3-3.0, which
 *   is a whole extra reading of the format: the reference keeps every damage
 *   number it ever shows between 75 and 120, and no roster crediting one blow in
 *   three at 2.6x can stay inside that. The arithmetic is forced — a fighter's
 *   total output over a match is the other one's thousand health, so a fat crit
 *   is paid for by shrinking the ordinary blow. Boxer Guy's punch read 63 with
 *   a 210 every third time; flattening the crit put the ordinary punch at 95
 *   and the crit at 140, which is the reference's own spread. What that costs
 *   is noise, and noise was hiding an unbalanced roster rather than balancing
 *   one: with the crits flat, five of the six pairs came out lopsided and had
 *   to be fixed as design instead of drowned in variance;
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
  /**
   * How hard this one hits **by running into the other**, relative to everyone
   * else. See `Fighter.meleeShare` — this is where fighting style lives, and it
   * is kept out of `attack` because `attack` is solved by the calibrator and
   * would undo it on the next run.
   */
  meleeShare?: number;
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
    name: "Compass Guy",
    spriteId: "compass-guy",
    maxHp: 1000,
    attackSpeed: 1.15,
    critChance: 0.20,
    critMult: 1.45,
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
    //
    // **And bisection stops working past two fighters.** With four, each one's
    // record depends on the other three and moving any scale moves all of them,
    // so there is no single number to bisect. All four are solved together as a
    // fixed point instead — calibrate the roster, play every ordered pairing,
    // nudge each scale toward an even record, repeat. Three rounds from the old
    // pair values brought the spread from 10.1pp to 1.4pp.
    fieldScale: 0.9973,
  },
  {
    // Arms crossed, sunglasses on, does not move. Everything else bounces off
    // him; his ability stops the arena dead for a beat.
    id: "bodyguard",
    faction: "right",
    name: "Bodyguard Guy",
    spriteId: "bodyguard-guy",
    maxHp: 1000,
    attackSpeed: 0.85,
    critChance: 0.16,
    critMult: 1.55,
    // A bouncer throws you out. See `thrown_out` in `simulate.ts` for why the
    // freeze-and-tape he had before was a policeman's job, not his.
    abilities: [{ type: "thrown_out", cooldown: 6, power: 0, hitShare: 1.5 }],
    fieldScale: 0.9308,
  },

  /*
   * **Only one of these throws anything.** A boxer fights at range zero: he
   * closes the distance and hits you. `haymaker` dashes him at the other man
   * and lands the punch when he arrives — it used to send a glove flying across
   * the arena, which is a different character. The thrown weapon belongs to
   * Glasses Guy, and it is his actual spectacles: the image is in
   * `assets/props/glasses.png` and the effect draws that, not a sketch of one.
   */
  {
    // Gloves up, scowling. The one who actually throws a punch.
    id: "boxer",
    faction: "left",
    name: "Boxer Guy",
    spriteId: "boxer-guy",
    maxHp: 1000,
    // **Few, heavy punches.** He swung as often as everyone else and so his
    // numbers came out the same size as everyone else's — 36-45 against a man
    // who does not fight back with his hands at all. A boxer's blow has to be
    // the biggest number in the video, and the only way to buy that is to land
    // fewer of them: the total a fighter puts out over a match is fixed by the
    // other one's health.
    //
    // Note that `attackSpeed` no longer gates contact — a collision is a
    // physical event and every one of them lands. It survives because the
    // calibrator reads it and because it still paces minions and buffs.
    attackSpeed: 0.5,
    critChance: 0.22,
    critMult: 1.50,
    /**
     * **He is the one with the heavy hands.** Running into Boxer Guy costs more
     * than running into anyone else — that is what a boxer is, and it was not
     * true here: every fighter dealt the same contact damage and the boxer was
     * distinguishable only by an effect nobody could read.
     *
     * It was 3.0 and had to come down. At that weight nine tenths of everything
     * he did arrived as contact, and contact is the one thing Glasses Guy is
     * immune to — so the boxer took 92% of that pairing and 20-39% of the two
     * where the other man could hit back with his hands. Style has to survive
     * meeting a man with a different style.
     */
    meleeShare: 4.0,
    /**
     * **The charge is his signature and the charge is where the big number is.**
     *
     * He crosses the arena and arrives, and the punch that lands there is the
     * single largest number in the video — around 120, against an ordinary
     * contact of 50-60. `hitShare` used to be 0.55 on the theory that his weight
     * belonged in contact instead, which put the biggest swing in the fight at
     * 24: smaller than a bump into a man walking past.
     *
     * The charge does not also collect a contact number on arrival — see the
     * note on `charging` in `simulate.ts`. Homing at the other man manufactures
     * a collision every cast, and collisions pay both fighters, so a dash that
     * paid twice was quietly rewriting the whole roster's pacing around whoever
     * owned one.
     */
    abilities: [{ type: "haymaker", cooldown: 7, power: 0, hitShare: 3.2 }],
    fieldScale: 0.8996,
  },
  {
    // Reads the room, then throws his glasses at it.
    id: "glasses",
    faction: "right",
    name: "Glasses Guy",
    spriteId: "glasses-guy",
    maxHp: 1000,
    attackSpeed: 0.95,
    critChance: 0.18,
    critMult: 1.50,
    /**
     * **He does not fight with his hands at all.** Zero, not "a bit less":
     * running into Glasses Guy costs nothing and no number appears for it.
     * Every point he takes off the other man is thrown.
     */
    meleeShare: 0,
    /**
     * Two abilities, which is the whole character:
     *
     * - `glasses_throw` is his ordinary attack — **one pair, thrown hard**, four
     *   times a fight, which is what the five-second cooldown buys and what the
     *   owner asked for. `hitShare 2.2` is what makes it the heavy single number
     *   rather than a tap: it lands for 95-120, the reference's own band;
     * - `four_eyes` is the ult — **three or four pairs at once**, rolled per
     *   cast and carried on the event so exactly as many fly as land.
     */
    abilities: [
      { type: "glasses_throw", cooldown: 5, power: 0, hitShare: 2.2 },
      { type: "four_eyes", cooldown: 11, power: 0, pulses: [3, 4], hitShare: 1.0 },
    ],
    fieldScale: 1.1103,
  },
];
