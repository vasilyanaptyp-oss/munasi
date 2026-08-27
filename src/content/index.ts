import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ABILITY_TYPES, type Ability, type Fighter } from "../sim/types.js";

export const ROSTER_PATH = join(import.meta.dirname, "fighters.json");

/**
 * Straight off the simulation's own list, never a copy of it. See the note on
 * `ABILITY_TYPES` in `types.ts` for what a second copy costs.
 */
const KNOWN_ABILITIES: ReadonlySet<string> = new Set(ABILITY_TYPES);

function assertNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}: expected a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function parseAbility(raw: unknown, label: string): Ability {
  if (typeof raw !== "object" || raw === null) throw new Error(`${label}: not an object`);
  const r = raw as Record<string, unknown>;
  if (typeof r["type"] !== "string" || !KNOWN_ABILITIES.has(r["type"])) {
    throw new Error(`${label}: unknown ability type ${JSON.stringify(r["type"])}`);
  }
  const ability: Ability = {
    type: r["type"] as Ability["type"],
    cooldown: assertNumber(r["cooldown"], `${label}.cooldown`),
    power: assertNumber(r["power"], `${label}.power`),
  };
  if (r["duration"] !== undefined) ability.duration = assertNumber(r["duration"], `${label}.duration`);
  if (r["hitShare"] !== undefined) ability.hitShare = assertNumber(r["hitShare"], `${label}.hitShare`);
  if (r["pulses"] !== undefined) {
    const p = r["pulses"];
    if (!Array.isArray(p) || p.length !== 2) throw new Error(`${label}.pulses: expected [min, max]`);
    const min = assertNumber(p[0], `${label}.pulses[0]`);
    const max = assertNumber(p[1], `${label}.pulses[1]`);
    if (min < 1 || max < min) throw new Error(`${label}.pulses: ${min}..${max} is not a range of at least one`);
    ability.pulses = [min, max];
  }
  if (r["minion"] !== undefined) {
    const m = r["minion"] as Record<string, unknown>;
    ability.minion = {
      hp: assertNumber(m["hp"], `${label}.minion.hp`),
      attack: assertNumber(m["attack"], `${label}.minion.attack`),
      attackSpeed: assertNumber(m["attackSpeed"], `${label}.minion.attackSpeed`),
      lifetime: assertNumber(m["lifetime"], `${label}.minion.lifetime`),
    };
  }
  return ability;
}

/**
 * The outline the fighters collide on, checked rather than trusted.
 *
 * A band out of order or outside 0..1 would not throw anywhere downstream — it
 * would just quietly make a fighter collide with air, or with nothing at all,
 * which is the sort of defect that only shows up as "he does not hit" three
 * rounds later.
 */
function parseSilhouette(raw: unknown, label: string): [number, number][] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${label}: expected a non-empty array of [left, right] bands`);
  }
  return raw.map((band, i) => {
    if (!Array.isArray(band) || band.length !== 2) {
      throw new Error(`${label}[${i}]: expected [left, right]`);
    }
    const left = assertNumber(band[0], `${label}[${i}][0]`);
    const right = assertNumber(band[1], `${label}[${i}][1]`);
    if (left < 0 || right > 1 || right < left) {
      throw new Error(`${label}[${i}]: ${left}..${right} is not a span inside 0..1`);
    }
    return [left, right] as [number, number];
  });
}

function parseFighter(raw: unknown, index: number): Fighter {
  if (typeof raw !== "object" || raw === null) throw new Error(`fighter[${index}]: not an object`);
  const r = raw as Record<string, unknown>;
  const id = r["id"];
  if (typeof id !== "string" || id === "") throw new Error(`fighter[${index}]: missing id`);
  const label = `fighter ${id}`;
  const maxHp = assertNumber(r["maxHp"], `${label}.maxHp`);
  const abilities = Array.isArray(r["abilities"])
    ? r["abilities"].map((a, i) => parseAbility(a, `${label}.abilities[${i}]`))
    : [];

  return {
    id,
    name: typeof r["name"] === "string" ? r["name"] : id.toUpperCase(),
    spriteId: typeof r["spriteId"] === "string" ? r["spriteId"] : id,
    aspect: assertNumber(r["aspect"], `${label}.aspect`),
    ...(r["silhouette"] === undefined
      ? {}
      : { silhouette: parseSilhouette(r["silhouette"], `${label}.silhouette`) }),
    maxHp,
    hp: maxHp,
    attack: assertNumber(r["attack"], `${label}.attack`),
    attackSpeed: assertNumber(r["attackSpeed"], `${label}.attackSpeed`),
    critChance: assertNumber(r["critChance"], `${label}.critChance`),
    critMult: assertNumber(r["critMult"], `${label}.critMult`),
    ...(r["meleeShare"] === undefined
      ? {}
      : { meleeShare: assertNumber(r["meleeShare"], `${label}.meleeShare`) }),
    abilities,
  };
}

/**
 * Reads and validates the roster. Throws on anything malformed.
 *
 * **Every field a fighter has must be listed in the parser above.** It builds
 * its objects field by field rather than spreading, which is the right call for
 * a file read off disk — but it means a new field is dropped in silence.
 * `meleeShare`, `pulses` and `hitShare` were all added to the roster, written
 * correctly into `fighters.json`, used by the calibrator (which reads the spec
 * directly) — and then thrown away here, so the shipped videos ran on none of
 * them while every number in the calibration assumed they were live. The boxer
 * came out of that *weaker* than the man who throws his glasses.
 */
export function loadFighters(path = ROSTER_PATH): Fighter[] {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw)) throw new Error(`${path}: expected an array of fighters`);
  const fighters = raw.map(parseFighter);

  const ids = new Set<string>();
  for (const fighter of fighters) {
    if (ids.has(fighter.id)) throw new Error(`${path}: duplicate fighter id ${fighter.id}`);
    ids.add(fighter.id);
  }
  return fighters;
}

export function getFighter(id: string, roster = loadFighters()): Fighter {
  const found = roster.find((f) => f.id === id);
  if (!found) throw new Error(`unknown fighter id: ${id}`);
  return found;
}

/** Every unordered pair in roster order. */
export function allPairs<T>(items: T[]): [T, T][] {
  const pairs: [T, T][] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) pairs.push([items[i]!, items[j]!]);
  }
  return pairs;
}

export * from "./balance.js";
export * from "./generateMatchups.js";
