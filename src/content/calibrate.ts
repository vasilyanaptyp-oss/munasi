import { writeFileSync } from "node:fs";
import { simulate, SIGNATURE_PULSE_SHARE } from "../sim/simulate.js";
import type { Fighter } from "../sim/types.js";
import { isMain } from "../util/main.js";
import { ROSTER, type FighterSpec } from "./roster.js";
import { ROSTER_PATH } from "./index.js";
import { GAUNTLET_RULES } from "./teams.js";
import { spriteAspect } from "./cutout.js";

/**
 * Turns the hand-authored specs in `roster.ts` into `fighters.json` by solving
 * for each fighter's `attack`.
 *
 * A fighter wins when the product of its damage per second and its effective HP
 * is larger, so balance means holding that product equal across the roster —
 * *not* holding time-to-kill equal, which just makes the biggest HP pool
 * unbeatable.
 *
 * Two stages, because the closed-form model is close but not exact:
 *   1. analytic — solve `attack` so every fighter hits the same power product
 *   2. calibration — bisect a per-fighter scalar until the fighter is a coin
 *      flip against one fixed reference dummy. This absorbs what the formula
 *      cannot model: abilities ramping up behind their first cooldown, minions
 *      dying to aoe, healing wasted at full HP.
 *
 * Deterministic: same specs in, same numbers out. Re-run with `pnpm calibrate`
 * after editing `roster.ts`, then check the result with `pnpm balance`.
 */

/** HP of the reference dummy, and the mirror-match length the roster targets. */
const MID_HP = 1200;
const MIRROR_TTK = 27;
/** The power product every fighter is built to hit. */
const POWER = (MID_HP * MID_HP) / MIRROR_TTK;

const REFERENCE_CRIT_CHANCE = 0.3;
const REFERENCE_CRIT_MULT = 2.6;

/** Matches per probe while bisecting, and how many halvings to run. */
const CALIBRATION_SAMPLE = 200;
const BISECTION_STEPS = 15;
/**
 * Bracket the bisection searches.
 *
 * **Wide, and checked.** A fighter whose style multipliers push the answer
 * outside this range does not fail loudly — bisection just walks to the nearest
 * bound and reports it as the answer. That has now happened twice: most recently
 * `meleeShare 1.9` plus `hitShare 2.8` on Boxer Guy put his answer under 0.4, so
 * he pinned to the bound and calibrated to an 83.5% winrate against a dummy he
 * is supposed to split with. `assertBracketed` below turns that into an error
 * instead of a silently wrong roster.
 */
const SCALE_RANGE: [number, number] = [0.08, 3.0];

/** Abilities that deal their damage through signature pulses. */
const SIGNATURE_ABILITIES = new Set<string>([
  "magnetic_north",
  "nobody_moves",
  "thrown_out",
  "haymaker",
  "glasses_throw",
  "four_eyes",
]);

/** Fallback minion stats when an ability declares no explicit block. */
const DERIVED_MINION_ATTACK_RATIO = 0.28;
const DERIVED_MINION_ATTACK_SPEED = 0.9;
const DERIVED_MINION_LIFETIME = 8;

const REFERENCE: Fighter = {
  id: "reference",
  name: "REFERENCE",
  spriteId: "knight",
  // The dummy is never drawn, so its shape is arbitrary; a square keeps it from
  // implying anything about the roster it calibrates.
  aspect: 1,
  maxHp: MID_HP,
  hp: MID_HP,
  attack: MID_HP / MIRROR_TTK / (1 + REFERENCE_CRIT_CHANCE * (REFERENCE_CRIT_MULT - 1)),
  attackSpeed: 1,
  critChance: REFERENCE_CRIT_CHANCE,
  critMult: REFERENCE_CRIT_MULT,
  abilities: [],
};

/** Closed-form `attack` that puts this spec on the roster's power product. */
export function analyticAttack(spec: FighterSpec): number {
  let abilityDps = 0;
  let buffFactor = 1;
  let healPerSecond = 0;

  for (const ability of spec.abilities) {
    switch (ability.type) {
      case "aoe":
        abilityDps += ability.power / ability.cooldown;
        break;
      case "spawn_minion": {
        const m = ability.minion;
        const perCast = m
          ? m.attack * m.attackSpeed * m.lifetime
          : ability.power *
            DERIVED_MINION_ATTACK_RATIO *
            DERIVED_MINION_ATTACK_SPEED *
            DERIVED_MINION_LIFETIME;
        abilityDps += perCast / ability.cooldown;
        break;
      }
      case "heal":
        healPerSecond += ability.power / ability.cooldown;
        break;
      case "buff_attack":
        buffFactor *= 1 + (ability.power * (ability.duration ?? 5)) / ability.cooldown;
        break;
    }
  }

  /**
   * Everything that scales with `attack`, per second.
   *
   * Two routes, and both of them matter now that fighters have a style:
   * running into the other man (`meleeShare`, gated by `attackSpeed`) and the
   * signature (`hitShare` and how many pulses it lands, gated by its cooldown).
   *
   * Leaving these out is what put Boxer Guy's answer outside the bisection
   * bracket and left Glasses Guy needing a `fieldScale` of 0.72 to be even —
   * a correction four times larger than the "few percent" this knob is for.
   * The closed form is not expected to be exact; it is expected to land close
   * enough that the bisection converges inside its bracket and `fieldScale` is
   * left with a nudge rather than the whole job.
   */
  let perAttack = (spec.meleeShare ?? 1) * spec.attackSpeed;
  for (const ability of spec.abilities) {
    if (!SIGNATURE_ABILITIES.has(ability.type)) continue;
    const pulses = ability.pulses ? (ability.pulses[0] + ability.pulses[1]) / 2 : 1;
    perAttack += (SIGNATURE_PULSE_SHARE * (ability.hitShare ?? 1) * pulses) / ability.cooldown;
  }

  const effectiveHp = spec.maxHp + healPerSecond * MIRROR_TTK;
  const critFactor = 1 + spec.critChance * (spec.critMult - 1);
  return Math.max(1, (POWER / effectiveHp - abilityDps) / (perAttack * critFactor * buffFactor));
}

/**
 * Applies a power scalar. Damage scales; HP, healing and buff strength do not —
 * minion HP in particular has to stay put, since it is what decides whether a
 * minion survives an incoming aoe.
 */
export function scaleSpec(spec: FighterSpec, attack: number, scale: number): Fighter {
  return {
    id: spec.id,
    name: spec.name,
    spriteId: spec.spriteId,
    aspect: spriteAspect(spec.spriteId),
    maxHp: spec.maxHp,
    hp: spec.maxHp,
    attack: attack * scale,
    attackSpeed: spec.attackSpeed,
    critChance: spec.critChance,
    critMult: spec.critMult,
    // Style, not power: carried through untouched so the calibrator's search on
    // `attack` cannot flatten it back out.
    ...(spec.meleeShare === undefined ? {} : { meleeShare: spec.meleeShare }),
    abilities: spec.abilities.map((ability) => {
      if (ability.minion) {
        return { ...ability, minion: { ...ability.minion, attack: ability.minion.attack * scale } };
      }
      if (ability.type === "heal" || ability.type === "buff_attack") return { ...ability };
      return { ...ability, power: ability.power * scale };
    }),
  };
}

/**
 * Winrate against the reference dummy, sides alternated so position cancels.
 *
 * **Measured under the rules the videos are actually shot with.** It used to run
 * a bare duel — no `attackRate`, no shortened opening — and that is a different
 * game: pacing the basic attack down to a third of its rate leaves contact
 * damage a third as frequent while abilities stay on their own clock, so the
 * mix a fighter's damage arrives in shifts completely. A fighter who mostly
 * punches measured strong there and shipped weak; one who mostly throws
 * measured weak and shipped strong.
 *
 * The symptom was `fieldScale` — the "keep it within a few percent of 1" knob —
 * being dragged to 1.19 and 0.75 to undo a calibration that had evened the
 * wrong game. `pnpm balance` was moved onto the shipped rules for exactly this
 * reason a while back; the calibrator was left behind.
 */
export function winRateVsReference(fighter: Fighter, sample = CALIBRATION_SAMPLE): number {
  let wins = 0;
  for (let seed = 0; seed < sample; seed += 1) {
    const swap = seed % 2 === 1;
    const result = simulate(
      swap ? { a: REFERENCE, b: fighter } : { a: fighter, b: REFERENCE },
      seed,
      GAUNTLET_RULES,
    );
    if (result.winner === "draw") wins += 0.5;
    else if (swap ? result.winner === "b" : result.winner === "a") wins += 1;
  }
  return wins / sample;
}

export interface CalibratedFighter {
  fighter: Fighter;
  /** Power scalar the bisection settled on. */
  scale: number;
  /** Measured winrate against the reference dummy. */
  winRate: number;
}

/**
 * Fails loudly when the bisection ended against a bound rather than on an
 * answer. See `SCALE_RANGE` — a pinned search reports the bound as the result
 * and the fighter ships wildly mis-tuned, which is silent until someone plays
 * the videos.
 */
function assertBracketed(id: string, scale: number): void {
  const [lo, hi] = SCALE_RANGE;
  const margin = (hi - lo) * 0.02;
  if (scale <= lo + margin || scale >= hi - margin) {
    throw new Error(
      `calibrate: ${id} solved to ${scale.toFixed(3)}, against the edge of the ` +
        `[${lo}, ${hi}] bracket — the answer is outside it, so this is a bound, not a solution.`,
    );
  }
}

export function calibrate(specs: FighterSpec[] = ROSTER): CalibratedFighter[] {
  return specs.map((spec) => {
    const attack = analyticAttack(spec);
    let [lo, hi] = SCALE_RANGE;
    for (let i = 0; i < BISECTION_STEPS; i += 1) {
      const mid = (lo + hi) / 2;
      if (winRateVsReference(scaleSpec(spec, attack, mid)) < 0.5) lo = mid;
      else hi = mid;
    }
    const solved = (lo + hi) / 2;
    assertBracketed(spec.id, solved);
    const scale = solved * (spec.fieldScale ?? 1);
    const fighter = scaleSpec(spec, attack, scale);
    return { fighter, scale, winRate: winRateVsReference(fighter, 400) };
  });
}

/** Rounds to the precision that actually lands in fighters.json. */
function serialise(fighter: Fighter): unknown {
  return {
    id: fighter.id,
    name: fighter.name,
    spriteId: fighter.spriteId,
    // Four places is enough to reproduce the bounce box exactly; the aspect
    // comes from the PNG's own pixel dimensions, so it is already exact.
    aspect: Math.round(fighter.aspect * 10000) / 10000,
    maxHp: fighter.maxHp,
    attack: Math.round(fighter.attack * 10) / 10,
    attackSpeed: fighter.attackSpeed,
    critChance: fighter.critChance,
    critMult: fighter.critMult,
    ...(fighter.meleeShare === undefined ? {} : { meleeShare: fighter.meleeShare }),
    abilities: fighter.abilities.map((ability) =>
      ability.minion
        ? { ...ability, minion: { ...ability.minion, attack: Math.round(ability.minion.attack * 10) / 10 } }
        : { ...ability, power: Math.round(ability.power * 100) / 100 },
    ),
  };
}

function main(): void {
  const outPath = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? ROSTER_PATH;
  console.log(`Calibrating ${ROSTER.length} fighters against the reference dummy...\n`);
  const calibrated = calibrate();
  for (const { fighter, scale, winRate } of calibrated) {
    console.log(
      `${fighter.id.padEnd(14)} scale ${scale.toFixed(3)}  attack ${fighter.attack.toFixed(1).padStart(6)}` +
        `  vs reference ${(winRate * 100).toFixed(1)}%`,
    );
  }
  writeFileSync(outPath, `${JSON.stringify(calibrated.map((c) => serialise(c.fighter)), null, 2)}\n`);
  console.log(`\nwrote ${outPath}`);
}

if (isMain(import.meta.url)) main();
