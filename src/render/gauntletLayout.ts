import type { GauntletResult } from "../sim/gauntlet.js";
import { eventsAt, type RenderIndex } from "./frame.js";
import { ARENA, GAUNTLET_LAYOUT as L, HP_WIDGET } from "./gauntletTheme.js";
import { spriteBounds, spriteMotionBounds } from "./silhouette.js";
import { font, HEIGHT, WIDTH, ensureFonts } from "./theme.js";
import type { Canvas } from "@napi-rs/canvas";
import { createCanvas } from "@napi-rs/canvas";

/**
 * Where everything goes, computed before anything is drawn.
 *
 * The renderer draws from this and `layout.test.ts` asserts on it, so
 * composition rules — nothing overlapping, nobody clipped, fighters big enough
 * to read — are checked directly rather than inferred from pixels.
 */

export interface Rect {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GauntletFrameLayout {
  /** Pixels per unit of `drawFighter`'s `size`. */
  fighterSize: number;
  /** Screen y the fighters stand on. */
  groundY: number;
  arena: Rect;
  /** `sprite` is the resting box; `reach` includes room for motion. */
  challenger: { sprite: Rect; reach: Rect; centre: { x: number; y: number }; hp: Rect };
  opponent: { sprite: Rect; reach: Rect; centre: { x: number; y: number }; hp: Rect };
  /** Fixed overlay boxes: challenger name, VS, roster panel, caption. */
  hud: Rect[];
  /** Floating damage numbers currently on screen. */
  damageNumbers: Rect[];
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Frames a damage number stays up, matching the renderer. */
export const DAMAGE_NUMBER_FRAMES = 15;

/** Margins the composition keeps clear of the frame edge. */
const SAFE_X = Math.round(WIDTH * 0.03);
const GROUND_SHARE = 0.62;
/** Hard floor: a fighter is never shorter than this share of the frame. */
export const MIN_FIGHTER_HEIGHT_SHARE = 0.22;
/** Gap kept between the two fighters' boxes. */
const FIGHTER_GAP = Math.round(WIDTH * 0.03);
/**
 * How far the two resting boxes may overlap, as a share of fighter size.
 *
 * The height floor and "never clipped" genuinely conflict for the widest pair
 * (gatekeeper against councillor, by 25px of size): the councillor's death
 * scatters its files across 1.30 of its box against 0.83 at rest. Standing the
 * pair a little closer buys back the room without shrinking anyone below the
 * floor or touching a character's animation.
 */
const MAX_OVERLAP = 0.16;
/**
 * How far past its resting box a fighter is guaranteed to stay in frame.
 *
 * A death animation throws loose matter well beyond the body — the
 * councillor's files scatter to 1.30 of its box against 0.83 at rest. Holding
 * every last flying page inside the frame would mean drawing every fighter
 * ~25% smaller, which is the deadness this layout exists to fix. So the
 * guarantee covers the body and its immediate motion; debris past this may
 * cross the edge, and the gate is written against the same bound.
 */
export const REACH_CAP = 0.24;
/** Keep this clear of the frame edge. */
const EDGE = Math.round(WIDTH * 0.012);

let measure: Canvas | null = null;
function textWidth(text: string, size: number): number {
  ensureFonts();
  const canvas = (measure ??= createCanvas(8, 8));
  const ctx = canvas.getContext("2d");
  ctx.font = font(size);
  return ctx.measureText(text).width;
}

/** Shrinks a font until the text fits, mirroring what the renderer does. */
export function fitText(text: string, startSize: number, maxWidth: number, minSize: number): number {
  let size = startSize;
  while (size > minSize && textWidth(text, size) > maxWidth) size -= 1;
  return size;
}

export interface HudMetrics {
  challengerNameSize: number;
  vsSize: number;
  panelSize: number;
  panelLineHeight: number;
  captionSize: number;
}

/**
 * The overlay is laid out once per run, not per frame: it is a fixed HUD, and
 * anything that moves under it is scene, not chrome.
 */
export function hudLayout(result: GauntletResult): { rects: Rect[]; metrics: HudMetrics } {
  const nameSize = fitText(result.challenger.name, Math.round(HEIGHT * 0.03), WIDTH * 0.36, 18);
  const vsSize = Math.round(HEIGHT * 0.038);
  const longest = result.team.members.reduce((a, b) => (a.name.length >= b.name.length ? a : b)).name;
  const panelSize = fitText(longest, Math.round(HEIGHT * 0.028), WIDTH * 0.47, 18);
  const panelLineHeight = Math.round(panelSize * 1.34);
  const captionSize = L.captionSize;

  const nameY = L.panelTop + Math.round(HEIGHT * 0.052);
  const left: Rect[] = [
    {
      name: "challengerName",
      x: SAFE_X,
      y: nameY - nameSize,
      w: textWidth(result.challenger.name, nameSize),
      h: nameSize * 1.15,
    },
    {
      name: "vs",
      x: SAFE_X,
      y: nameY + vsSize * 1.15 - vsSize,
      w: textWidth("VS", vsSize),
      h: vsSize * 1.15,
    },
  ];

  // Panel is right-aligned; its box spans the widest line it holds.
  const panelWidth = Math.max(
    textWidth(result.team.name, Math.round(panelSize * 1.1)),
    ...result.team.members.map((m) => textWidth(m.name, panelSize)),
  );
  const panelTop = L.panelTop;
  const panelHeight = panelLineHeight * (result.team.members.length + 1) + panelSize * 0.4;
  const panel: Rect = {
    name: "teamPanel",
    x: L.panelRight - panelWidth,
    y: panelTop,
    w: panelWidth,
    h: panelHeight,
  };

  const caption: Rect = {
    name: "caption",
    x: WIDTH / 2 - textWidth("РАУНД 3/3", captionSize) / 2,
    y: L.captionBaseline - captionSize,
    w: textWidth("РАУНД 3/3", captionSize),
    h: captionSize * 1.15,
  };

  return {
    rects: [...left, panel, caption],
    metrics: { challengerNameSize: nameSize, vsSize, panelSize, panelLineHeight, captionSize },
  };
}

/**
 * Fighter scale for a round: large enough that the shorter of the two clears
 * the height floor, small enough that both fit side by side inside the safe
 * area. The floor wins if they ever disagree.
 */
export function fighterSizeFor(challengerSprite: string, opponentSprite: string): number {
  const a = spriteBounds(challengerSprite);
  const b = spriteBounds(opponentSprite);
  // Aim a whisker over the floor: solving for exactly 22% leaves the result
  // sitting on the boundary, where rounding can push it under.
  const floor = (HEIGHT * MIN_FIGHTER_HEIGHT_SHARE * 1.01) / Math.min(a.height, b.height);
  const roomy = (WIDTH - SAFE_X * 2 - FIGHTER_GAP) / (a.width + b.width);
  // The floor is a floor; a pair that fits comfortably may go a little larger.
  return Math.max(floor, Math.min(roomy, floor * 1.3));
}

/**
 * Stable per-round geometry: the scale and how far apart the pair stands.
 *
 * Computed once per round rather than per frame, because the reach depends on
 * who is mid-death and the fighters must not slide sideways when someone dies.
 * Only one fighter is ever dying, so the worst case is one full death envelope
 * against one living fighter — not two.
 */
export function roundPlacement(
  challengerSprite: string,
  opponentSprite: string,
): { size: number; separation: number; reachLeft: number; reachRight: number } {
  const size = fighterSizeFor(challengerSprite, opponentSprite);
  const restA = spriteBounds(challengerSprite);
  const restB = spriteBounds(opponentSprite);
  const deadA = spriteMotionBounds(challengerSprite, true);
  const deadB = spriteMotionBounds(opponentSprite, true);
  const liveA = spriteMotionBounds(challengerSprite, false);
  const liveB = spriteMotionBounds(opponentSprite, false);

  // Widest the pair ever reaches: whichever side is dying, the other is alive,
  // and each capped to the body-plus-motion bound.
  const reachLeft = Math.max(Math.min(deadA.left, liveA.left), restA.left - REACH_CAP) * size;
  const reachRight = Math.min(Math.max(deadB.right, liveB.right), restB.right + REACH_CAP) * size;

  const desired = (restA.right - restB.left) * size + FIGHTER_GAP;
  const minimum = (restA.right - restB.left) * size - MAX_OVERLAP * size;
  const maximum = WIDTH - EDGE * 2 - (reachRight - reachLeft);
  const separation = Math.max(minimum, Math.min(desired, Math.max(minimum, maximum)));
  return { size, separation, reachLeft, reachRight };
}

/**
 * Camera drift. Small, bounded and derived only from the event list, so the
 * shot breathes without any risk of pushing a fighter off frame.
 */
function drift(index: RenderIndex, frame: number): { x: number; y: number } {
  let x = Math.sin(frame * 0.013) * (WIDTH * 0.012);
  let y = Math.cos(frame * 0.0171) * (HEIGHT * 0.006);
  for (let back = 0; back <= 8; back += 1) {
    const f = frame - back;
    if (f < 0) break;
    const punch = eventsAt(index, f).find((e) => e.type === "crit" || e.type === "death");
    if (!punch) continue;
    const amp = (punch.type === "death" ? 18 : 12) * (1 - back / 9);
    x += Math.sin(frame * 2.7) * amp;
    y += Math.cos(frame * 3.1) * amp * 0.6;
    break;
  }
  return { x, y };
}

/** Full layout for one frame. Pure in `(result, frame)`. */
export function gauntletFrameLayout(
  result: GauntletResult,
  frame: number,
  index: RenderIndex,
  hud: { rects: Rect[]; metrics: HudMetrics },
): GauntletFrameLayout {
  const snap = result.snapshots[frame]!;
  const opponent = result.team.members[snap.round] ?? result.team.members[0]!;
  const placement = roundPlacement(result.challenger.spriteId, opponent.spriteId);
  const size = placement.size;
  const boundsA = spriteBounds(result.challenger.spriteId);
  const boundsB = spriteBounds(opponent.spriteId);

  const groundY = Math.round(HEIGHT * GROUND_SHARE);
  const wobble = drift(index, frame);

  // Centre the pair on the reach they actually occupy, nudge, then clamp so
  // nothing can leave the frame however the drift lands.
  const reachWidth = placement.reachRight - placement.reachLeft;
  let originAx = (WIDTH - reachWidth) / 2 - placement.reachLeft + wobble.x;
  const lowest = EDGE - placement.reachLeft;
  const highest = WIDTH - EDGE - placement.separation - placement.reachRight;
  originAx = Math.max(lowest, Math.min(originAx, Math.max(lowest, highest)));
  const originBx = originAx + placement.separation;

  const originAy = groundY - boundsA.bottom * size + wobble.y;
  const originBy = groundY - boundsB.bottom * size + wobble.y;

  const spriteA: Rect = {
    name: "challengerSprite",
    x: originAx + boundsA.left * size,
    y: originAy + boundsA.top * size,
    w: boundsA.width * size,
    h: boundsA.height * size,
  };
  const spriteB: Rect = {
    name: "opponentSprite",
    x: originBx + boundsB.left * size,
    y: originBy + boundsB.top * size,
    w: boundsB.width * size,
    h: boundsB.height * size,
  };

  const hpFor = (name: string, originX: number, spriteTop: number): Rect => ({
    name,
    x: originX - HP_WIDGET.width / 2,
    y: spriteTop - HP_WIDGET.height - Math.round(HEIGHT * 0.012),
    w: HP_WIDGET.width,
    h: HP_WIDGET.height,
  });
  const hpA = hpFor("challengerHp", originAx, spriteA.y);
  const hpB = hpFor("opponentHp", originBx, spriteB.y);

  // Reach boxes use the true measured envelope, per side.
  const reachOf = (name: string, spriteId: string, originX: number, originY: number): Rect => {
    const dead = spriteMotionBounds(spriteId, true);
    const rest = spriteBounds(spriteId);
    // Capped to the body bound; see REACH_CAP.
    const left = Math.max(dead.left, rest.left - REACH_CAP);
    const right = Math.min(dead.right, rest.right + REACH_CAP);
    const top = Math.max(dead.top, rest.top - REACH_CAP);
    const bottom = Math.min(dead.bottom, rest.bottom + REACH_CAP);
    return {
      name: `${name}Reach`,
      x: originX + left * size,
      y: originY + top * size,
      w: (right - left) * size,
      h: (bottom - top) * size,
    };
  };

  const marginX = Math.round(WIDTH * 0.02);
  const arenaLeft = Math.min(spriteA.x, spriteB.x) - marginX;
  const arenaRight = Math.max(spriteA.x + spriteA.w, spriteB.x + spriteB.w) + marginX;
  const arenaTop = Math.min(hpA.y, hpB.y) - Math.round(HEIGHT * 0.03);
  const arenaBottom = groundY + Math.round(HEIGHT * 0.16);
  const arena: Rect = {
    name: "arena",
    x: arenaLeft,
    y: arenaTop,
    w: arenaRight - arenaLeft,
    h: arenaBottom - arenaTop,
  };

  const damageNumbers = damageNumberRects(result, frame, index, {
    challenger: { origin: originAx, top: spriteA.y },
    opponent: { origin: originBx, top: spriteB.y },
  });

  return {
    fighterSize: size,
    groundY,
    arena,
    challenger: {
      sprite: spriteA,
      reach: reachOf("challengerSprite", result.challenger.spriteId, originAx, originAy),
      centre: { x: originAx, y: originAy },
      hp: hpA,
    },
    opponent: {
      sprite: spriteB,
      reach: reachOf("opponentSprite", opponent.spriteId, originBx, originBy),
      centre: { x: originBx, y: originBy },
      hp: hpB,
    },
    hud: hud.rects,
    damageNumbers,
  };
}

export interface DamageNumberAnchors {
  challenger: { origin: number; top: number };
  opponent: { origin: number; top: number };
}

/** Rects for the numbers floating this frame, matching what the renderer draws. */
export function damageNumberRects(
  result: GauntletResult,
  frame: number,
  index: RenderIndex,
  anchors: DamageNumberAnchors,
): Rect[] {
  const out: Rect[] = [];
  for (let back = 0; back <= DAMAGE_NUMBER_FRAMES; back += 1) {
    const f = frame - back;
    if (f < 0) break;
    for (const event of eventsAt(index, f)) {
      let text: string;
      let size: number;
      switch (event.type) {
        case "crit":
          text = `-${event.value}!`;
          size = Math.round(WIDTH * 0.085);
          break;
        case "hit":
          text = `-${event.value}`;
          size = Math.round(WIDTH * 0.058);
          break;
        case "minion_hit":
        case "aoe":
          text = `-${event.value}`;
          size = Math.round(WIDTH * 0.045);
          break;
        case "heal":
          text = `+${event.value}`;
          size = Math.round(WIDTH * 0.055);
          break;
        case "pickup_claim":
          text = "+БАФ";
          size = Math.round(WIDTH * 0.05);
          break;
        default:
          continue;
      }
      const onChallenger =
        event.type === "pickup_claim" || event.type === "heal"
          ? event.actorId === result.challenger.id
          : event.targetId === result.challenger.id;
      const anchor = onChallenger ? anchors.challenger : anchors.opponent;
      const age = back / DAMAGE_NUMBER_FRAMES;
      const scale = 1 + 0.12 * (1 - age);
      const w = textWidth(text, size * scale);
      const x = anchor.origin + numberJitter(`${event.frame}:${event.actorId}:${event.type}`, WIDTH * 0.06);
      // Numbers rise from just above the HP widget, never across it.
      const y = anchor.top - HP_WIDGET.height - Math.round(HEIGHT * 0.05) - age * (HEIGHT * 0.07);
      out.push({
        name: `damage:${event.type}@${event.frame}`,
        x: x - w / 2,
        y: y - size * scale * 0.62,
        w,
        h: size * scale * 1.05,
      });
    }
  }
  return out;
}

/** Same deterministic jitter the renderer uses. */
export function numberJitter(seed: string, spread: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (((h >>> 0) % 1000) / 1000 - 0.5) * 2 * spread;
}

export { ARENA };
