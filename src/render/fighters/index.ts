import { arbiter } from "./arbiter.js";
import { baker } from "./baker.js";
import { chairman } from "./chairman.js";
import { councillor } from "./councillor.js";
import { courier } from "./courier.js";
import { gatekeeper } from "./gatekeeper.js";
import { inspector } from "./inspector.js";
import { loader } from "./loader.js";
import { nailmaster } from "./nailmaster.js";
import { plumber } from "./plumber.js";
import { silencer } from "./silencer.js";
import { viceroy } from "./viceroy.js";
import type { FighterArt } from "./types.js";

export * from "./types.js";

/**
 * Every fighter's art, keyed by `spriteId`. One entry, one drawing function —
 * there is deliberately no shared "archetype with a colour parameter" here,
 * because a hue is not a character.
 */
export const FIGHTER_ART: readonly FighterArt[] = [
  plumber,
  baker,
  courier,
  loader,
  nailmaster,
  arbiter,
  councillor,
  inspector,
  chairman,
  viceroy,
  silencer,
  gatekeeper,
];

const BY_ID = new Map(FIGHTER_ART.map((art) => [art.id, art]));

export function artFor(spriteId: string): FighterArt | undefined {
  return BY_ID.get(spriteId);
}

export function hasArt(spriteId: string): boolean {
  return BY_ID.has(spriteId);
}
