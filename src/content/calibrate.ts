import { writeFileSync } from "node:fs";
import { simulate } from "../sim/simulate.js";
import type { Fighter } from "../sim/types.js";
import { isMain } from "../util/main.js";
import { ROSTER, type FighterSpec } from "./roster.js";
import { ROSTER_PATH } from "./index.js";

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
const BISECTION_STEPS = 13;
const SCALE_RANGE: [number, number] = [0.4, 2.2];

/** Fallback minion stats when an ability declares no explicit block. */
const DERIVED_MINION_ATTACK_RATIO = 0.28;
const DERIVED_MINION_ATTACK_SPEED = 0.9;
const DERIVED_MINION_LIFETIME = 8;

const REFERENCE: Fighter = {
  id: "reference",
  name: "REFERENCE",
  spriteId: "knight",
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

  const effectiveHp = spec.maxHp + healPerSecond * MIRROR_TTK;
  const critFactor = 1 + spec.critChance * (spec.critMult - 1);
  return Math.max(1, (POWER / effectiveHp - abilityDps) / (spec.attackSpeed * critFactor * buffFactor));
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
    maxHp: spec.maxHp,
    hp: spec.maxHp,
    attack: attack * scale,
    attackSpeed: spec.attackSpeed,
    critChance: spec.critChance,
    critMult: spec.critMult,
    abilities: spec.abilities.map((ability) => {
      if (ability.minion) {
        return { ...ability, minion: { ...ability.minion, attack: ability.minion.attack * scale } };
      }
      if (ability.type === "heal" || ability.type === "buff_attack") return { ...ability };
      return { ...ability, power: ability.power * scale };
    }),
  };
}

/** Winrate against the reference dummy, sides alternated so position cancels. */
export function winRateVsReference(fighter: Fighter, sample = CALIBRATION_SAMPLE): number {
  let wins = 0;
  for (let seed = 0; seed < sample; seed += 1) {
    const swap = seed % 2 === 1;
    const result = simulate(swap ? { a: REFERENCE, b: fighter } : { a: fighter, b: REFERENCE }, seed);
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

export function calibrate(specs: FighterSpec[] = ROSTER): CalibratedFighter[] {
  return specs.map((spec) => {
    const attack = analyticAttack(spec);
    let [lo, hi] = SCALE_RANGE;
    for (let i = 0; i < BISECTION_STEPS; i += 1) {
      const mid = (lo + hi) / 2;
      if (winRateVsReference(scaleSpec(spec, attack, mid)) < 0.5) lo = mid;
      else hi = mid;
    }
    const scale = ((lo + hi) / 2) * (spec.fieldScale ?? 1);
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
    maxHp: fighter.maxHp,
    attack: Math.round(fighter.attack * 10) / 10,
    attackSpeed: fighter.attackSpeed,
    critChance: fighter.critChance,
    critMult: fighter.critMult,
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
