import type { GauntletConfig, Team } from "../sim/gauntlet.js";
import type { Fighter } from "../sim/types.js";
import { loadFighters } from "./index.js";
import { ROSTER, type Faction } from "./roster.js";

/**
 * Gauntlet matchups, built from `faction` rather than listed by hand: one
 * worker against three bosses. Six workers times the twenty ways to pick three
 * of six bosses is 120 runs without drawing a single new character.
 */

const FACTION_BY_ID = new Map<string, Faction>(ROSTER.map((spec) => [spec.id, spec.faction]));

export function factionOf(id: string): Faction {
  const faction = FACTION_BY_ID.get(id);
  if (!faction) throw new Error(`unknown fighter id: ${id}`);
  return faction;
}

export function byFaction(faction: Faction, roster = loadFighters()): Fighter[] {
  return roster.filter((f) => factionOf(f.id) === faction);
}

/**
 * How the two sides are scaled for the gauntlet.
 *
 * Both sides carry their own roster HP — 1000 to 1400, and workers and bosses
 * are drawn from the same range — so the challenger's edge has to be damage.
 * `pnpm calibrate:gauntlet --solve` solves for both numbers; see CLAUDE.md for
 * the targets they are solved against.
 */
export interface GauntletTuning {
  /** Multiplies everyone's damage. Sets how long a round takes. */
  tempo: number;
  /** Extra damage for the challenger. Sets how often the run is cleared. */
  challengerPower: number;
}

/** Solved by `calibrateGauntlet`; kept here so the pipeline can just use it. */
/**
 * `challengerPower` is 1 now, and that is not a tuning choice — it is the format
 * changing. It existed to let one worker survive three bosses in a row; a fight
 * is one against one, both at full health, so an edge handed to one side is just
 * a thumb on the scale. With it still at 2.74 a fight lasted 11 seconds and was
 * over before it started.
 */
export const GAUNTLET_TUNING: GauntletTuning = { tempo: 1.05, challengerPower: 1 };

/**
 * Rules the shipped gauntlet runs under.
 *
 * The damage spread is *narrower* here than in 1v1, which looks like a
 * contradiction and is not. A 1v1 needs the wide spread or a 3% stat edge
 * becomes a 100% winrate; the gauntlet manufactures its close finish
 * structurally instead — the challenger arrives at the last round already worn
 * down — so it does not need luck to create tension. Measured at 500 runs:
 * mean drama 88.1 at +/-35% against 88.7 at +/-15%, with clear rate and length
 * unchanged. Narrower wins, and randomness on screen reads as unfairness.
 */
export const GAUNTLET_RULES = {
  damageVariance: 0.15,
  // No pickups. `MatchRules.pickups` is "omit to disable", and `{}` is truthy —
  // so this line used to read as "off" and run them on their defaults. It was
  // putting four pickups and a floating green "+BUFF" into every video, which is
  // one of the things this format explicitly does not have: there is no pickup
  // anywhere in any of the four references.
  /**
   * A round opens on a short fuse. Measured: every gap over 1.2s in a finished
   * video sat at a round change, and it was 27 frames of death animation plus
   * 20-33 frames waiting for the newcomer's first swing. Both sides get the
   * same head start, so it costs the race nothing.
   */
  openingCooldown: 0.22,
  /**
   * **Fewer, bigger swings** — the multiplier runs below 1 now.
   *
   * `attack / rate` and `attackSpeed * rate` leave damage per second exactly
   * unchanged (`ticksPerAttack` does not round), so this moves nothing but the
   * picture. It was 3, which was a mistake made without measuring: it put a hit
   * on screen every 0.29s for eight damage a time, and the owner's verdict on
   * that video was that it was unwatchable.
   *
   * 0.35 is set from the reference, measured at full resolution over 721 frames
   * by tracking the white hit-flash: a hit lands every 1.20s (median) or 1.48s
   * (mean), for 75-120 damage. This puts our two on 2.48s and 3.36s each, which
   * is a hit every ~1.43s between them, for 67 and 91 damage. The shipped video
   * before this change measured 0.43s between numbers.
   */
  attackRate: 0.35,
} as const;

function scaled(fighter: Fighter, damageMultiplier: number): Fighter {
  return {
    ...fighter,
    attack: fighter.attack * damageMultiplier,
    abilities: fighter.abilities.map((ability) => {
      if (ability.minion) {
        return { ...ability, minion: { ...ability.minion, attack: ability.minion.attack * damageMultiplier } };
      }
      if (ability.type === "heal" || ability.type === "buff_attack") return { ...ability };
      return { ...ability, power: ability.power * damageMultiplier };
    }),
  };
}

export function buildTeam(members: Fighter[], tuning: GauntletTuning, name?: string): Team {
  return {
    id: members.map((m) => m.id).join("+"),
    name: name ?? "OPPONENT",
    members: members.map((m) => scaled(m, tuning.tempo)),
  };
}

export function buildGauntlet(
  challenger: Fighter,
  members: Fighter[],
  tuning: GauntletTuning = GAUNTLET_TUNING,
  teamName?: string,
): GauntletConfig {
  return {
    challenger: scaled(challenger, tuning.tempo * tuning.challengerPower),
    team: buildTeam(members, tuning, teamName),
  };
}

/** Every way to choose `size` items, in a stable order. */
export function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i <= items.length - size; i += 1) {
    for (const rest of combinations(items.slice(i + 1), size - 1)) {
      out.push([items[i]!, ...rest]);
    }
  }
  return out;
}

export interface GauntletMatchup {
  challenger: Fighter;
  members: Fighter[];
}

/**
 * Every worker against every trio of bosses, in a stable order so a batch can
 * resume where the last one stopped.
 */
export function gauntletMatchups(roster = loadFighters(), teamSize = 1): GauntletMatchup[] {
  const workers = byFaction("left", roster);
  const bosses = byFaction("right", roster);
  const out: GauntletMatchup[] = [];
  for (const challenger of workers) {
    for (const members of combinations(bosses, teamSize)) out.push({ challenger, members });
  }
  return out;
}
