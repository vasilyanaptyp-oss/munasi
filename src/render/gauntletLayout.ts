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

/** The arena's inner box — the wall nothing may cross. */
export const ARENA_INNER: Rect = {
  name: "arenaInner",
  x: ARENA.inner.x,
  y: ARENA.inner.y,
  w: ARENA.inner.w,
  h: ARENA.inner.h,
};

/** Frames a damage number stays up, matching the renderer. */
export const DAMAGE_NUMBER_FRAMES = 15;

/**
 * Height the shorter fighter of a pair is aimed at, as a share of the frame.
 *
 * Raised from 22% because the arena was visibly empty — a 22% fighter standing
 * on a ground line 813px below the arena's roof left a quarter of the square as
 * bare blue. 26 of the 36 pairs reach it.
 */
export const TARGET_FIGHTER_HEIGHT_SHARE = 0.3;
/**
 * Hard floor. A pair that cannot reach the target — because everything the two
 * of them ever draw has to fit between the arena walls — still clears this, and
 * the gate prints the shortfall with its cause.
 */
export const MIN_FIGHTER_HEIGHT_SHARE = 0.22;
/** Gap kept between the two fighters' boxes when there is room for one. */
const FIGHTER_GAP = Math.round(WIDTH * 0.03);
/**
 * How far the two resting boxes may overlap, as a share of fighter size.
 *
 * Standing the pair closer is the first lever for fitting a wide pair inside
 * the arena, and partial overlap is fine — the keyline keeps the two figures
 * apart where they cross. Solved per pair: a pair takes exactly as much overlap
 * as it needs and no more.
 */
export const OVERLAP_CAP = 0.4;
/** Breathing room inside the arena walls, where the pair has to stay. */
const ARENA_PAD = Math.round(WIDTH * 0.01);
/** Width the pair, and everything it ever draws, must fit into. */
const ARENA_BUDGET = ARENA.inner.w - ARENA_PAD * 2;
/** Gap kept between the two HP widgets. */
const HP_WIDGET_GAP = Math.round(WIDTH * 0.02);
/** Clearance kept under the arena's roof. */
const HEAD_PAD = Math.round(HEIGHT * 0.006);
/**
 * Vertical clearance the size solve reserves: the camera's vertical pan plus
 * the keyline, both of which move drawn pixels after the size is chosen.
 */
const VERTICAL_PAD = HEAD_PAD + FIGHTER_OUTLINE + 2;
/**
 * Vertical room a fighter has: the arena's roof down to the ground line.
 *
 * A tall fighter may reach up behind the HP widgets. They are chrome drawn over
 * the scene, as in the reference, and holding fighters below them cost 9% of
 * frame height for nothing.
 */
const HEAD_ROOM = ARENA.groundY - ARENA.inner.y - VERTICAL_PAD;

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
  /** Baselines and top edge, so the renderer draws exactly where the gate looks. */
  nameBaseline: number;
  vsBaseline: number;
  panelTop: number;
}

/**
 * The overlay is laid out once per run, not per frame: it is a fixed HUD, and
 * anything that moves under it is scene, not chrome.
 */
export function hudLayout(result: GauntletResult): { rects: Rect[]; metrics: HudMetrics } {
  const left = Math.round(WIDTH * 0.03);
  const top = L.panelTop;

  // The challenger's name gets its own full-width line.
  //
  // It used to share the band with the roster panel, which left it 36% of the
  // frame and shrank "САНТЕХНИК ЖЭКА" to 35px — 1.8% of frame height, unreadable
  // at thumbnail size, and frame 0 is the thumbnail. Stacking the three blocks
  // costs vertical room the header had spare.
  const nameSize = fitText(
    result.challenger.name,
    Math.round(HEIGHT * 0.034),
    WIDTH - left * 2,
    Math.round(HEIGHT * 0.022),
  );
  const vsSize = Math.round(HEIGHT * 0.034);
  const longest = result.team.members.reduce((a, b) => (a.name.length >= b.name.length ? a : b)).name;
  const panelSize = fitText(
    longest,
    Math.round(HEIGHT * 0.025),
    WIDTH - left * 2,
    Math.round(HEIGHT * 0.019),
  );
  const panelLineHeight = Math.round(panelSize * 1.34);
  const captionSize = L.captionSize;

  const nameBaseline = top + nameSize;
  const vsBaseline = nameBaseline + Math.round(vsSize * 1.2);
  const panelTop = vsBaseline + Math.round(HEIGHT * 0.014);

  const header: Rect[] = [
    {
      name: "challengerName",
      x: left,
      y: nameBaseline - nameSize,
      w: textWidth(result.challenger.name, nameSize),
      h: nameSize * 1.15,
    },
    {
      name: "vs",
      x: left,
      y: vsBaseline - vsSize,
      w: textWidth("VS", vsSize),
      h: vsSize * 1.15,
    },
  ];

  // Panel is right-aligned; its box spans the widest line it holds.
  const panelWidth = Math.max(
    textWidth(result.team.name, Math.round(panelSize * 1.1)),
    ...result.team.members.map((m) => textWidth(m.name, panelSize)),
  );
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
    rects: [...header, panel, caption],
    metrics: {
      challengerNameSize: nameSize,
      vsSize,
      panelSize,
      panelLineHeight,
      captionSize,
      nameBaseline,
      vsBaseline,
      panelTop,
    },
  };
}

export interface RoundPlacement {
  size: number;
  separation: number;
  /** Leftmost and rightmost pixel the pair ever draws, relative to origin A. */
  reachLeft: number;
  reachRight: number;
  /** Resting-box overlap actually granted, in fighter-size units. */
  overlap: number;
  /** Height the shorter of the two ends up at, as a share of the frame. */
  heightShare: number;
  /** Which constraint decided the size. "target" means the pair got what it asked for. */
  limitedBy: "target" | "width" | "roof";
}

/**
 * Stable per-round geometry: the scale, how far apart the pair stands, and how
 * much the two are allowed to overlap.
 *
 * **The guarantee is the arena wall.** Everything either fighter ever draws —
 * body, prop, the debris of its death — stays inside the arena's inner box.
 * Not the frame edge: the frame is 1080 wide and the arena only 924, so the old
 * frame guarantee let a death spray across the wall of the very square it was
 * supposed to be fought inside.
 *
 * Three levers, applied in this order:
 *   1. Scale down to `noOverlap`, the size at which the pair fits with the
 *      bodies just touching.
 *   2. Below the 22% height floor, stop scaling and start overlapping instead,
 *      taking exactly as much overlap as the pair needs, up to `OVERLAP_CAP`.
 *   3. Only if that is not enough, drop that one pair to the relaxed 21% floor
 *      and flag it. Nothing on the current roster reaches step 3.
 *
 * Computed once per round rather than per frame, because the reach depends on
 * who is mid-death and the fighters must not slide sideways when someone dies.
 * Only one fighter is ever dying, so the worst case is one full death envelope
 * against one living fighter — not two.
 */
export function roundPlacement(
  challengerSprite: string,
  opponentSprite: string,
): RoundPlacement {
  const restA = spriteBounds(challengerSprite);
  const restB = spriteBounds(opponentSprite);
  const deadA = spriteMotionBounds(challengerSprite, true);
  const deadB = spriteMotionBounds(opponentSprite, true);
  const liveA = spriteMotionBounds(challengerSprite, false);
  const liveB = spriteMotionBounds(opponentSprite, false);

  // Widest the pair ever reaches, in fighter-size units. Only one fighter is
  // ever dying, so the worst case is one death envelope against one live one.
  const reachLeftUnits = Math.min(deadA.left, liveA.left);
  const reachRightUnits = Math.max(deadB.right, liveB.right);
  const bodies = restA.right - restB.left;
  // Total width the pair needs at scale 1 with the bodies exactly touching.
  const span = bodies + (reachRightUnits - reachLeftUnits);

  // Aim a whisker over the target: solving for exactly 30% leaves the result
  // sitting on the boundary, where rounding can push it under.
  const target = (HEIGHT * TARGET_FIGHTER_HEIGHT_SHARE * 1.01) / Math.min(restA.height, restB.height);
  // Nobody's crown pokes through the arena's roof, and nobody's collapse goes
  // through its floor. Measured from the *motion* envelope, not the resting
  // box: an idle bob or the recoil lifts the crown above where the fighter
  // stands, and sizing off the resting height let that through by a few pixels.
  const crown = Math.max(restA.bottom - deadA.top, restB.bottom - deadB.top);
  const slump = Math.max(deadA.bottom - restA.bottom, deadB.bottom - restB.bottom);
  const byRoof = HEAD_ROOM / crown;
  const byFloor =
    slump > 0
      ? (ARENA.inner.y + ARENA.inner.h - ARENA.groundY - VERTICAL_PAD) / slump
      : Number.POSITIVE_INFINITY;
  // Widest the pair may be drawn and still fit between the walls once it has
  // spent its whole overlap budget.
  const byWidth = ARENA_BUDGET / (span - OVERLAP_CAP);

  // As big as the target asks for, but never past what the arena allows on
  // either axis. Whichever of the three binds, the arena wall is never crossed.
  const size = Math.min(target, byRoof, byFloor, byWidth);
  const overlap = Math.max(0, span - ARENA_BUDGET / size);
  const reachedTarget = size >= target - 1e-6;
  const limit: RoundPlacement["limitedBy"] = reachedTarget
    ? "target"
    : byWidth <= Math.min(byRoof, byFloor)
      ? "width"
      : "roof";

  const reachLeft = reachLeftUnits * size;
  const reachRight = reachRightUnits * size;
  const desired = bodies * size + FIGHTER_GAP;
  const minimum = (bodies - overlap) * size;
  const maximum = ARENA_BUDGET - (reachRight - reachLeft);
  const separation = Math.max(minimum, Math.min(desired, Math.max(minimum, maximum)));
  return {
    size,
    separation,
    reachLeft,
    reachRight,
    overlap,
    heightShare: (Math.min(restA.height, restB.height) * size) / HEIGHT,
    limitedBy: limit,
  };
}

/** On-screen fighter scale for a round. */
export function fighterSizeFor(challengerSprite: string, opponentSprite: string): number {
  return roundPlacement(challengerSprite, opponentSprite).size;
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
  const centred =
    ARENA.inner.x + (ARENA.inner.w - (restRight - restLeft)) / 2 - restLeft;
  // The pan is clamped against the arena wall, not the frame edge.
  const lowest = ARENA.inner.x + ARENA_PAD - camera.reachLeft;
  const highest =
    ARENA.inner.x + ARENA.inner.w - ARENA_PAD - separation - camera.reachRight;
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

  // Pinned vertically to the arena's top band — that is what stopped the
  // widget riding up off the arena on a tall fighter — but tracking its own
  // fighter horizontally, so it stays readable as *whose* health it is.
  // Clamped inside the arena, and kept apart from each other.
  const hpFor = (name: string, centreX: number): Rect => ({
    name,
    x: Math.max(
      ARENA.inner.x + ARENA_PAD,
      Math.min(
        centreX - HP_WIDGET.width / 2,
        ARENA.inner.x + ARENA.inner.w - ARENA_PAD - HP_WIDGET.width,
      ),
    ),
    y: HP_WIDGET_SLOTS.y,
    w: HP_WIDGET.width,
    h: HP_WIDGET.height,
  });
  let hpA = hpFor("challengerHp", originAx);
  let hpB = hpFor("opponentHp", originBx);
  // A heavily overlapped pair would stack its widgets; push them apart evenly.
  const overlapPx = hpA.x + HP_WIDGET.width + HP_WIDGET_GAP - hpB.x;
  if (overlapPx > 0) {
    hpA = hpFor("challengerHp", originAx - overlapPx / 2);
    hpB = hpFor("opponentHp", originBx + overlapPx / 2);
  }

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

/** Frames the victory card is held. Capped so the video does not end on a wall. */
export const VICTORY_CARD_FRAMES = 34;

export interface VictoryCard {
  /** Plate behind the text. */
  plate: Rect;
  lines: { name: string; text: string; rect: Rect; size: number; accent: boolean }[];
  /** Which side won, so the renderer can mark the right widget. */
  winner: "challenger" | "opponent";
  /** HP the winner finished on. The whole point of the card. */
  hpLeft: number;
}

/**
 * The closing card.
 *
 * It replaced a full-frame dark scrim with an unfitted name that ran off both
 * edges of a 1080px frame, held for two seconds, over two HP widgets that both
 * looked like zero. The number that matters is what the winner had left —
 * "cleared it on 8 HP" is the entire drama of a gauntlet — so it gets its own
 * line, and the card is a plate inside the arena rather than a blackout.
 */
export function victoryCardLayout(result: GauntletResult): VictoryCard {
  const won = result.challengerWon;
  const last = result.snapshots[result.durationFrames - 1]!;
  const hpLeft = Math.max(0, Math.round(won ? last.challenger.hp : last.opponent.hp));
  const name = won ? result.challenger.name : (result.rounds.at(-1)?.opponentName ?? "");

  const pad = Math.round(WIDTH * 0.03);
  const room = ARENA.inner.w - ARENA_PAD * 2 - pad * 2;

  // Both sides can hit zero on the same tick — damage is applied after every
  // actor has swung, so a mutual kill is a real outcome, not a rounding
  // artefact. "ОСТАЛОСЬ 0 HP" is true there and reads as a broken card, so that
  // case gets its own line.
  const trade = hpLeft <= 0;
  const headlineSize = Math.round(WIDTH * 0.042);
  const nameSize = fitText(name, Math.round(WIDTH * 0.075), room, Math.round(WIDTH * 0.036));
  const hpText = trade ? "РАЗМЕН — УПАЛИ ОБА" : `ОСТАЛОСЬ ${hpLeft} HP`;
  const hpSize = fitText(hpText, Math.round(WIDTH * 0.055), room, Math.round(WIDTH * 0.03));

  const headline = trade ? "ДОБИЛ И УПАЛ" : won ? "ПРОШЁЛ ВСЕХ" : "НЕ СПРАВИЛСЯ";
  const sizes = [headlineSize, nameSize, hpSize];
  const texts = [headline, name, hpText];
  const names = ["victoryHeadline", "victoryName", "victoryHp"];
  const gap = Math.round(HEIGHT * 0.008);
  const bodyHeight = sizes.reduce((sum, size) => sum + size * 1.2, 0) + gap * (sizes.length - 1);

  // Anchored to the arena floor, not to its middle. Centred, the plate lay
  // across both fighters' chests and the winner was not really *in* the shot —
  // which was the complaint about the old blackout in the first place.
  const plateHeight = bodyHeight + pad * 2;
  const plate: Rect = {
    name: "victoryPlate",
    x: ARENA.inner.x + ARENA_PAD,
    y: ARENA.inner.y + ARENA.inner.h - ARENA_PAD - plateHeight,
    w: ARENA.inner.w - ARENA_PAD * 2,
    h: plateHeight,
  };

  let y = plate.y + pad;
  const lines = texts.map((text, i) => {
    const size = sizes[i]!;
    const w = textWidth(text, size);
    const rect: Rect = {
      name: names[i]!,
      x: WIDTH / 2 - w / 2,
      y,
      w,
      h: size * 1.2,
    };
    y += size * 1.2 + gap;
    return { name: names[i]!, text, rect, size, accent: i === 2 };
  });

  return { plate, lines, winner: won ? "challenger" : "opponent", hpLeft };
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
