import type { Ability } from "../sim/types.js";
import { PRIVATE_ROSTER } from "./roster.private.js";

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

/**
 * The cast that ships with the product: ten generated characters, owned
 * outright. The four stock photographs are in `roster.private.ts` and do not
 * ship — see there.
 */
export const SHIPPED_ROSTER: FighterSpec[] = [
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

/**
 * Everything this project fights with. The private cast goes first, so the
 * order — and every seed in a manifest that depends on it — is unchanged; in
 * the bundle it is empty and this is the shipped ten.
 */
export const ROSTER: FighterSpec[] = [...PRIVATE_ROSTER, ...SHIPPED_ROSTER];
