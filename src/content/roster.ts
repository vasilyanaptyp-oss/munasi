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
    fieldScale: 1.0416,
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
    abilities: [{ type: "thrown_out", cooldown: 5, power: 0, hitShare: 1.5 }],
    fieldScale: 0.9871,
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
    abilities: [{ type: "haymaker", cooldown: 6, power: 0, hitShare: 3.2 }],
    fieldScale: 0.9518,
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
     * **A bump, not a punch.** He does not fight with his hands: nearly
     * everything he takes off the other man is thrown, and this is a fifth of
     * what an ordinary fighter's contact is worth — around 20 on screen against
     * the boxer's 85.
     *
     * It was a flat zero, and zero turned out to be unplayable. A collision is
     * a *shared* event: it damages both. A fighter who converts his half to
     * nothing is handing his opponent free damage on every meeting, and the
     * more of an opponent's output arrives as contact the bigger the gift — so
     * Boxer Guy, who is all contact, took 65-69% of this pairing however the
     * knobs were turned, while losing the two he could not do that to. That is
     * not "stronger", it is rock-paper-scissors, and `fieldScale` is one number
     * per fighter so it cannot reach a single pair.
     *
     * Measured: at 0.55 the same six pairings sat inside 38-62%, spread 1.4pp,
     * and no pair was outside the band for the first time since the outline
     * collision went in.
     *
     * **Then the white keyline went, and 0.55 stopped being enough.** The
     * keyline was drawn pixels, so the bounce box carried a margin for it, and
     * taking the margin away shrank every fighter's box by 0.012 in each
     * direction — around a sixth of the area a pair sweeps past each other.
     * Contacts got rarer, and rarer contacts are worth *more* to the fighter
     * whose damage is mostly contact: boxer vs glasses went to 69/31. Swept it
     * with the calibrator in the loop, at 500 matches a pair: 0.55 -> 69%,
     * 0.85 -> 66%, 1.15 -> 66%, **1.5 -> 62%**, 1.9 -> 56% but Bodyguard Guy
     * drops to 38% against him. 1.5 is the one that puts all six pairs inside
     * the band at once — 42-62%.
     *
     * He is still the man who does not punch: 1.5 against Boxer Guy's 4.0.
     */
    meleeShare: 1.5,
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
    fieldScale: 1.0615,
  },
  /*
   * **The ten that arrived together**, one per ability implemented in the batch
   * before them. The pairing is not decoration: a character in this format is a
   * gag with an effect, so the effect has to be the thing the photograph is
   * already about. A magician swaps places, a fisherman reels you in, a sumo
   * plants himself, a mime walks through you.
   *
   * `meleeShare` is where the style lives, and it is set from the picture: the
   * sumo and the luchador are the heavy end because they are built to collide,
   * the vacuum salesman and the mime the light end because their whole trick is
   * that they do not punch. `attack` is never written here — the calibrator
   * solves it and would erase anything typed in.
   */
  {
    // Top hat, wand, and the smuggest expression in the roster. What he does to
    // the fight is put the two of you somewhere else entirely.
    id: "magician",
    faction: "left",
    name: "Magician Guy",
    spriteId: "magician",
    maxHp: 1000,
    attackSpeed: 0.9,
    critChance: 0.18,
    critMult: 1.5,
    meleeShare: 1.0,
    abilities: [{ type: "switcheroo", cooldown: 5, power: 0, hitShare: 1.6 }],
    fieldScale: 1.0819,
  },
  {
    // Waders, rod, and the patience of a man who has waited all morning.
    id: "fisherman",
    faction: "right",
    name: "Fisherman Guy",
    spriteId: "fisherman",
    maxHp: 1000,
    attackSpeed: 0.85,
    critChance: 0.16,
    critMult: 1.5,
    meleeShare: 1.1,
    abilities: [{ type: "magnet_pull", cooldown: 5, power: 0, duration: 1.4, hitShare: 1.4 }],
    fieldScale: 0.9765,
  },
  {
    // Red tracksuit, gold chain, one hand thrown out — the only asymmetric
    // outline in the roster, which the collision profile actually reads.
    id: "rapper",
    faction: "left",
    name: "Rapper Guy",
    spriteId: "rapper",
    maxHp: 1000,
    attackSpeed: 1.0,
    critChance: 0.2,
    critMult: 1.45,
    meleeShare: 1.3,
    abilities: [{ type: "spin_cycle", cooldown: 6, power: 0, duration: 1.2, hitShare: 1.2 }],
    fieldScale: 0.9022,
  },
  {
    // Two cups and the eyes of a man on his ninth. Fastest hands in the roster.
    id: "barista",
    faction: "right",
    name: "Barista Guy",
    spriteId: "barista",
    maxHp: 1000,
    attackSpeed: 1.15,
    critChance: 0.22,
    critMult: 1.45,
    meleeShare: 1.2,
    abilities: [{ type: "overclock", cooldown: 6, power: 0, duration: 2, hitShare: 1.3 }],
    fieldScale: 0.9701,
  },
  {
    // The heaviest thing on the field. Slow, and everything that touches him
    // regrets the arithmetic.
    id: "sumo",
    faction: "left",
    name: "Sumo Guy",
    spriteId: "sumo",
    maxHp: 1000,
    attackSpeed: 0.6,
    critChance: 0.14,
    critMult: 1.6,
    meleeShare: 2.2,
    abilities: [{ type: "dead_weight", cooldown: 6, power: 0, duration: 1.6, hitShare: 1.5 }],
    fieldScale: 0.9908,
  },
  {
    // **Kept in turquoise on purpose.** 9.3% of him is within 60 RGB of the
    // arena's own blue and his singlet dissolves into it — measured, and every
    // other fighter reads 0.0%. The owner looked at it and chose to ship him
    // anyway; `content.test.ts` carries the exemption by name so the gate stays
    // live for everybody else.
    id: "luchador",
    faction: "right",
    name: "Luchador Guy",
    spriteId: "luchador",
    maxHp: 1000,
    attackSpeed: 0.8,
    critChance: 0.18,
    critMult: 1.5,
    meleeShare: 1.8,
    abilities: [{ type: "wall_slam", cooldown: 6, power: 0, hitShare: 1.8 }],
    fieldScale: 0.9226,
  },
  {
    // Brown suit, forced smile, hose in hand. He takes what he takes off you
    // and keeps it.
    id: "vacuum",
    faction: "left",
    name: "Vacuum Guy",
    spriteId: "vacuum-salesman",
    maxHp: 1000,
    attackSpeed: 0.9,
    critChance: 0.16,
    critMult: 1.5,
    // **Raised from 0.9 after measuring.** A collision is a shared event, so a
    // fighter who is cheap in one hands the other man free damage every meeting
    // — the trap Glasses Guy fell into at 0. At 0.9 the vacuum salesman beat
    // every light opponent and lost 84-86% of his pairs against Fisherman Guy
    // and Rapper Guy.
    meleeShare: 1.4,
    abilities: [{ type: "siphon", cooldown: 5, power: 0, hitShare: 2.0 }],
    fieldScale: 1.0844,
  },
  {
    // Hard hat, hi-vis, and a detonator held against his chest. Nothing happens
    // for two and a half seconds.
    id: "demolition",
    faction: "right",
    name: "Demolition Guy",
    spriteId: "demolition",
    maxHp: 1000,
    attackSpeed: 0.75,
    critChance: 0.2,
    critMult: 1.55,
    meleeShare: 1.0,
    abilities: [{ type: "countdown", cooldown: 6, power: 0, hitShare: 2.4 }],
    fieldScale: 1.0143,
  },
  {
    // White jacket, sabre, mask under one arm. Hit him and it comes back.
    id: "fencer",
    faction: "left",
    name: "Fencer Guy",
    spriteId: "fencer",
    maxHp: 1000,
    attackSpeed: 1.2,
    critChance: 0.24,
    critMult: 1.4,
    meleeShare: 1.4,
    // **The window covers the cooldown, and that is deliberate.** A parry that
    // is open 2.5 seconds in every 5 makes its worth a coin flip on *when* the
    // other man swings, and against a fighter who drops one heavy blow every
    // six seconds half of them fell in the gap: the fencer took 17% of that
    // pair while taking 85% of the pair against a man throwing a stream of
    // small ones. Measured at 2.5s and 4.0s the two simply traded places —
    // demolition 83% to 73% while glasses went 15% to 0%. With no gap, and the
    // return proportional rather than a strike of his own, his five sampled
    // pairs came in at 26-40% — still an offset, but a *uniform* one, and a
    // uniform offset is exactly what `fieldScale` exists to remove.
    //
    // He still casts: the cast is the lunge. The parry is simply always live.
    abilities: [{ type: "riposte", cooldown: 5, power: 0, duration: 5, hitShare: 1.6 }],
    fieldScale: 0.9398,
  },
  {
    // Stripes, gloves, and an expression of total surprise. Walks through you.
    id: "mime",
    faction: "right",
    name: "Mime Guy",
    spriteId: "mime",
    maxHp: 1000,
    attackSpeed: 1.0,
    critChance: 0.18,
    critMult: 1.5,
    // Same correction as the vacuum salesman, milder: he phases through contact
    // for a second and a half, so he already avoids some of what he is cheap in.
    meleeShare: 1.3,
    abilities: [{ type: "slipstream", cooldown: 5, power: 0, duration: 1.5, hitShare: 1.9 }],
    fieldScale: 1.0706,
  },
];
