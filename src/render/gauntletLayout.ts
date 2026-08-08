import type { GauntletResult } from "../sim/gauntlet.js";
import { FIGHTER_OUTLINE } from "./drawFighter.js";
import { eventsAt, type RenderIndex } from "./frame.js";
import {
  ARENA,
  GAUNTLET_LAYOUT as L,
  HP_WIDGET,
  HP_WIDGET_SLOTS,
} from "./gauntletTheme.js";
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
 *
 * The arena is not part of that solve. It is a constant (`ARENA`): a fixed
 * square at a fixed place with a fixed border and a fixed ground line. The only
 * thing that changes between frames is the camera looking into it — a pan and a
 * zoom in the arena's own world coordinates. The 22% height floor is met by
 * zooming the camera in, never by growing the arena or moving its walls.
 */

export interface Rect {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Camera over arena world space.
 *
 * World origin is the arena's centre on the x axis and the ground line on the
 * y axis, so a fighter stands at world y 0. One world unit is one screen pixel
 * at zoom 1.
 */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface GauntletFrameLayout {
  /** Pixels per unit of `drawFighter`'s `size` — world size times zoom. */
  fighterSize: number;
  /** Screen y the fighters stand on. */
  groundY: number;
  /** Always the `ARENA` constant; the gate checks that it stays that way. */
  arena: Rect;
  camera: Camera;
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

/** The arena as a rect, for gate comparisons. */
export const ARENA_RECT: Rect = {
  name: "arena",
  x: ARENA.x,
  y: ARENA.y,
  w: ARENA.side,
  h: ARENA.side,
};

/** Frames a damage number stays up, matching the renderer. */
export const DAMAGE_NUMBER_FRAMES = 15;

/** Hard floor: a fighter is never shorter than this share of the frame. */
export const MIN_FIGHTER_HEIGHT_SHARE = 0.22;
/** Gap kept between the two fighters' boxes. */
const FIGHTER_GAP = Math.round(WIDTH * 0.03);
/**
 * How far the two resting boxes may overlap, as a share of fighter size.
 *
 * Standing the pair a little closer is what buys the room to keep everyone
 * inside the frame at the height floor.
 */
const MAX_OVERLAP = 0.16;
/** Keep this clear of the frame edge. Nothing a fighter draws may cross it. */
const EDGE = Math.round(WIDTH * 0.012);
/** Breathing room inside the arena walls, where the pair sits when it fits. */
const ARENA_PAD = Math.round(WIDTH * 0.01);
/** Headroom between a fighter's crown and the arena's inner top. */
const HEAD_PAD = Math.round(HEIGHT * 0.005);

/**
 * Floor of the band damage numbers may occupy: under the HP widgets, inside the
 * arena. Numbers are clamped into this band, crits included.
 */
export const NUMBER_CEILING = HP_WIDGET_SLOTS.y + HP_WIDGET.height + Math.round(HEIGHT * 0.008);

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
      x: Math.round(WIDTH * 0.03),
      y: nameY - nameSize,
      w: textWidth(result.challenger.name, nameSize),
      h: nameSize * 1.15,
    },
    {
      name: "vs",
      x: Math.round(WIDTH * 0.03),
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
 * On-screen fighter scale for a round: large enough that the shorter of the two
 * clears the height floor, small enough that the pair sits inside the arena and
 * that nothing either fighter ever draws crosses the frame edge.
 *
 * Order of authority, tightest last: the arena is where the pair *prefers* to
 * sit, the 22% floor overrides it, and the frame edge overrides everything —
 * that last one is the strict guarantee and `layout.test.ts` proves every pair
 * satisfies it.
 */
export function fighterSizeFor(challengerSprite: string, opponentSprite: string): number {
  const restA = spriteBounds(challengerSprite);
  const restB = spriteBounds(opponentSprite);
  const deadA = spriteMotionBounds(challengerSprite, true);
  const deadB = spriteMotionBounds(opponentSprite, true);
  const liveA = spriteMotionBounds(challengerSprite, false);
  const liveB = spriteMotionBounds(opponentSprite, false);

  // Aim a whisker over the floor: solving for exactly 22% leaves the result
  // sitting on the boundary, where rounding can push it under.
  const floor = (HEIGHT * MIN_FIGHTER_HEIGHT_SHARE * 1.01) / Math.min(restA.height, restB.height);

  // Largest scale at which everything both fighters ever draw still fits, with
  // the pair as close as the overlap budget allows. Every term scales with
  // size, so this solves directly.
  const span =
    restA.right - restB.left - MAX_OVERLAP +
    Math.max(deadB.right, liveB.right) -
    Math.min(deadA.left, liveA.left);
  const widestFrame = (WIDTH - EDGE * 2) / span;

  // Nobody's crown pokes out of the arena's roof.
  const tallest =
    (ARENA.groundY - ARENA.inner.y - HEAD_PAD) / Math.max(restA.height, restB.height);
  // Standing side by side, the pair fits between the arena walls. This is the
  // resting extent on purpose: a death scatter may cross the wall for a few
  // frames, and sizing everyone down to keep debris inside the square shrank
  // the fighters to a third of the arena.
  const roomy = (ARENA.inner.w - ARENA_PAD * 2 - FIGHTER_GAP) / (restA.width + restB.width);

  // `tallest` and `roomy` are preferences the floor is allowed to beat; only
  // `widestFrame` is absolute.
  return Math.min(widestFrame, Math.max(floor, Math.min(roomy, tallest)));
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

  // Widest the pair ever reaches. Only one fighter is ever mid-death, so the
  // worst case is one full death envelope against one living fighter.
  // Nothing is capped: everything a fighter draws stays inside the frame.
  const reachLeft = Math.min(deadA.left, liveA.left) * size;
  const reachRight = Math.max(deadB.right, liveB.right) * size;

  const desired = (restA.right - restB.left) * size + FIGHTER_GAP;
  const minimum = (restA.right - restB.left) * size - MAX_OVERLAP * size;
  const maximum = WIDTH - EDGE * 2 - (reachRight - reachLeft);
  const separation = Math.max(minimum, Math.min(desired, Math.max(minimum, maximum)));
  return { size, separation, reachLeft, reachRight };
}

/** The camera settings a round is fought at. Zoom is what meets the 22% floor. */
export function roundCamera(
  challengerSprite: string,
  opponentSprite: string,
): { zoom: number; worldSeparation: number; reachLeft: number; reachRight: number } {
  const placement = roundPlacement(challengerSprite, opponentSprite);
  const zoom = placement.size / L.fighterWorld;
  return {
    zoom,
    worldSeparation: placement.separation / zoom,
    reachLeft: placement.reachLeft,
    reachRight: placement.reachRight,
  };
}

/**
 * Camera drift, in screen pixels. Small, bounded and derived only from the
 * event list, so the shot breathes without any risk of pushing a fighter off
 * frame — the caller clamps it besides.
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
  const camera = roundCamera(result.challenger.spriteId, opponent.spriteId);
  const zoom = camera.zoom;
  const size = L.fighterWorld * zoom;
  const boundsA = spriteBounds(result.challenger.spriteId);
  const boundsB = spriteBounds(opponent.spriteId);

  const groundY = ARENA.groundY;
  const separation = camera.worldSeparation * zoom;
  const wobble = drift(index, frame);

  // Centre the pair on the bodies, not on the reach. Centring on the reach
  // shoves the pair off to one side whenever one fighter's death throws debris
  // much further than the other's — which is most rounds, and it reads as a
  // composition mistake for the whole fight to pay for two seconds of dying.
  const restLeft = boundsA.left * size;
  const restRight = separation + boundsB.right * size;
  const centred = (WIDTH - (restRight - restLeft)) / 2 - restLeft;
  const lowest = EDGE - camera.reachLeft;
  const highest = WIDTH - EDGE - separation - camera.reachRight;
  const originAx = Math.max(lowest, Math.min(centred + wobble.x, Math.max(lowest, highest)));
  const originBx = originAx + separation;

  // Vertical pan is bounded to a hair so the fixed ground line stays fixed.
  const panY = Math.max(-HEAD_PAD, Math.min(wobble.y, HEAD_PAD));
  const originAy = groundY - boundsA.bottom * size + panY;
  const originBy = groundY - boundsB.bottom * size + panY;

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

  // HP widgets are pinned to the arena, not to the fighters' heads.
  const hpFor = (name: string, centreX: number): Rect => ({
    name,
    x: centreX - HP_WIDGET.width / 2,
    y: HP_WIDGET_SLOTS.y,
    w: HP_WIDGET.width,
    h: HP_WIDGET.height,
  });
  const hpA = hpFor("challengerHp", HP_WIDGET_SLOTS.challengerX);
  const hpB = hpFor("opponentHp", HP_WIDGET_SLOTS.opponentX);

  // Reach boxes use the true measured envelope, per side.
  const reachOf = (name: string, spriteId: string, originX: number, originY: number): Rect => {
    // The full measured envelope, uncapped: if any part of a fighter would
    // leave the frame, the gate must see it.
    // Grown by the keyline, because the keyline is drawn pixels too.
    const dead = spriteMotionBounds(spriteId, true);
    return {
      name: `${name}Reach`,
      x: originX + dead.left * size - FIGHTER_OUTLINE,
      y: originY + dead.top * size - FIGHTER_OUTLINE,
      w: dead.width * size + FIGHTER_OUTLINE * 2,
      h: dead.height * size + FIGHTER_OUTLINE * 2,
    };
  };

  const damageNumbers = damageNumberRects(result, frame, index, {
    challenger: {
      origin: originAx,
      top: spriteA.y,
      height: spriteA.h,
      width: spriteA.w,
      outward: -1,
    },
    opponent: {
      origin: originBx,
      top: spriteB.y,
      height: spriteB.h,
      width: spriteB.w,
      outward: 1,
    },
  });

  return {
    fighterSize: size,
    groundY,
    arena: { ...ARENA_RECT },
    camera: {
      // Screen pan expressed back in world units, which is what it means.
      x: (centred - originAx) / zoom,
      y: -panY / zoom,
      zoom,
    },
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
  /** `outward` points away from the opponent, so numbers clear the faces. */
  challenger: { origin: number; top: number; height: number; width: number; outward: -1 };
  opponent: { origin: number; top: number; height: number; width: number; outward: 1 };
}

/** Font size per event type. A crit's weight is carried here, not by travel. */
function numberStyle(type: string): { size: number; heavy: boolean } | null {
  switch (type) {
    // Nearly twice the cap height of an ordinary hit — that is the whole tell.
    case "crit":
      return { size: Math.round(WIDTH * 0.1), heavy: true };
    case "hit":
      return { size: Math.round(WIDTH * 0.055), heavy: false };
    case "minion_hit":
    case "aoe":
      return { size: Math.round(WIDTH * 0.043), heavy: false };
    case "heal":
      return { size: Math.round(WIDTH * 0.052), heavy: false };
    case "pickup_claim":
      return { size: Math.round(WIDTH * 0.048), heavy: false };
    default:
      return null;
  }
}

/** Text per event type, shared by the layout and the renderer. */
export function numberText(type: string, value: number | undefined): string {
  if (type === "pickup_claim") return "+БАФ";
  if (type === "heal") return `+${value}`;
  if (type === "crit") return `-${value}!`;
  return `-${value}`;
}

/**
 * Rects for the numbers floating this frame, matching what the renderer draws.
 *
 * A number stays where the blow landed: it lifts by a few percent of the frame
 * and no more, and the whole rect is clamped into the band between the HP
 * widgets and the arena floor. A crit reads as a crit because it is far bigger
 * and brighter, not because it flies further — travelling further used to walk
 * it up over the arena wall and into the HUD.
 */
export function damageNumberRects(
  result: GauntletResult,
  frame: number,
  index: RenderIndex,
  anchors: DamageNumberAnchors,
): Rect[] {
  const out: Rect[] = [];
  const left = ARENA.inner.x;
  const right = ARENA.inner.x + ARENA.inner.w;
  const bottom = ARENA.inner.y + ARENA.inner.h;

  for (let back = 0; back <= DAMAGE_NUMBER_FRAMES; back += 1) {
    const f = frame - back;
    if (f < 0) break;
    for (const event of eventsAt(index, f)) {
      const style = numberStyle(event.type);
      if (!style) continue;
      const text = numberText(event.type, event.value);

      const onChallenger =
        event.type === "pickup_claim" || event.type === "heal"
          ? event.actorId === result.challenger.id
          : event.targetId === result.challenger.id;
      const anchor = onChallenger ? anchors.challenger : anchors.opponent;
      const age = back / DAMAGE_NUMBER_FRAMES;
      // Crits pop on the first frames and settle; ordinary hits barely move.
      const scale = 1 + (style.heavy ? 0.22 : 0.1) * (1 - age);
      const w = textWidth(text, style.size * scale);
      const h = style.size * scale * 1.05;

      const jitter = numberJitter(`${event.frame}:${event.actorId}:${event.type}`, WIDTH * 0.04);
      // Anchored on the upper body, where the blow landed. The lift is short.
      const rise = age * (HEIGHT * 0.022);
      // Shoulder height, pushed to the fighter's outer side: the number sits
      // on the blow without covering the face it landed on.
      let x = anchor.origin + anchor.outward * anchor.width * 0.34 + jitter - w / 2;
      let y = anchor.top + anchor.height * 0.16 - h / 2 - rise;

      x = Math.max(left, Math.min(x, right - w));
      y = Math.max(NUMBER_CEILING, Math.min(y, bottom - h));

      out.push({ name: `damage:${event.type}@${event.frame}`, x, y, w, h });
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
