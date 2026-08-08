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
  /** Scale of the near fighter. Kept for callers that want one number. */
  fighterSize: number;
  /** Per-side scales: the far fighter is drawn smaller. */
  sizeFar: number;
  sizeNear: number;
  /** Screen y each fighter stands on — two lines, staged in depth. */
  groundY: number;
  groundFarY: number;
  /** Resting-box overlap this pair needed, 0 when they stand clear. */
  overlap: number;
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
 * Height the near fighter is aimed at, as a share of the frame. The far one
 * follows at 1 / `ARENA.nearScale` of it, which is what depth means.
 */
export const TARGET_FIGHTER_HEIGHT_SHARE = 0.3;
/**
 * Hard floor. A pair that cannot reach the target — because everything the two
 * of them ever draw has to fit between the arena walls — still clears this, and
 * the gate prints the shortfall with its cause.
 */
export const MIN_FIGHTER_HEIGHT_SHARE = 0.22;
/** Clear space kept between the two fighters' resting boxes. */
const BODY_GAP = Math.round(WIDTH * 0.016);
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
  /** Scale of the far fighter (the challenger) and the near one (the boss). */
  sizeFar: number;
  sizeNear: number;
  /** Distance between the two origins, far to near. */
  separation: number;
  /** Leftmost and rightmost pixel the pair ever draws, relative to the far origin. */
  reachLeft: number;
  reachRight: number;
  /** Height each fighter ends up at, as a share of the frame. */
  shareFar: number;
  shareNear: number;
  /**
   * Resting-box overlap in fighter-size units, 0 for most pairs. Non-zero only
   * where standing clear would push a fighter under the height floor.
   */
  overlap: number;
  /** Which constraint decided the size. "target" means the pair got what it asked for. */
  limitedBy: "target" | "width" | "roof";
}

/**
 * Stable per-round geometry: two scales, two ground lines, one separation.
 *
 * **The pair is staged in depth, not on a shared floor.** The near fighter — the
 * team's, always, so the challenger reads as the one facing something bigger —
 * stands on the lower line and is drawn `ARENA.nearScale` larger and on top; the
 * challenger stands on the higher line, smaller. A single ground line left the
 * top third of the arena empty in every frame.
 *
 * **The two resting boxes never touch.** There is no overlap budget any more:
 * with the pair at two depths the old trick of sliding them into each other is
 * both unnecessary to read and, at these sizes, ugly.
 *
 * **The guarantee is still the arena wall.** Everything either fighter ever
 * draws — body, prop, the debris of its death — stays inside the arena's inner
 * box, and that is what caps the size for most pairs: a fighter 30% of the frame
 * tall is 430-590px wide, and two of those plus a gap do not fit in a 924px
 * arena. `TARGET_FIGHTER_HEIGHT_SHARE` is an aim, and the gate prints every pair
 * that falls short of it with the reason.
 */
export function roundPlacement(
  challengerSprite: string,
  opponentSprite: string,
): RoundPlacement {
  const restFar = spriteBounds(challengerSprite);
  const restNear = spriteBounds(opponentSprite);
  const motionFar = spriteMotionBounds(challengerSprite, true);
  const motionNear = spriteMotionBounds(opponentSprite, true);

  // Aim a whisker over the target: solving for exactly 30% leaves the result
  // sitting on the boundary, where rounding can push it under.
  // Anchored on whichever of the two ends up shorter on screen, not on the near
  // one: the near fighter is 12% bigger by construction, so aiming at it left
  // the far fighter under the floor whenever it was the stubbier of the pair.
  const shorter = Math.min(restFar.height / ARENA.nearScale, restNear.height);
  const aim = (HEIGHT * TARGET_FIGHTER_HEIGHT_SHARE * 1.01) / shorter;

  // Vertical room each fighter has above its own line, and below the near one
  // for the collapse. Measured from the motion envelope: an idle bob or the
  // recoil lifts the crown above where the fighter stands.
  const roomNear = ARENA.groundY - ARENA.inner.y - VERTICAL_PAD;
  const roomFar = ARENA.groundFarY - ARENA.inner.y - VERTICAL_PAD;
  const underNear = ARENA.inner.y + ARENA.inner.h - ARENA.groundY - VERTICAL_PAD;
  const underFar = ARENA.inner.y + ARENA.inner.h - ARENA.groundFarY - VERTICAL_PAD;

  const crownNear = restNear.bottom - motionNear.top;
  const crownFar = restFar.bottom - motionFar.top;
  const slumpNear = Math.max(0, motionNear.bottom - restNear.bottom);
  const slumpFar = Math.max(0, motionFar.bottom - restFar.bottom);

  // Everything scales with the near size, so every limit solves directly.
  const scale = ARENA.nearScale;
  const widthUnits =
    (restFar.right / scale - restNear.left) +
    (motionNear.right - motionFar.left / scale);

  const vertical = Math.min(
    roomNear / crownNear,
    (roomFar / crownFar) * scale,
    slumpNear > 0 ? underNear / slumpNear : Number.POSITIVE_INFINITY,
    slumpFar > 0 ? (underFar / slumpFar) * scale : Number.POSITIVE_INFINITY,
  );
  const byWidth = (ARENA_BUDGET - BODY_GAP) / widthUnits;

  // Preferred: the pair apart, nothing touching.
  let sizeNear = Math.min(aim, vertical, byWidth);
  let overlap = 0;
  // The floor wins over "apart". Two fighters at 22% of frame height are
  // 320-450px wide each and 14 of the 36 pairs cannot stand clear of each
  // other inside a 924px arena — the worst is 260px short. Those pairs slide
  // together by exactly the shortfall and no more.
  const floorSize = (HEIGHT * MIN_FIGHTER_HEIGHT_SHARE * 1.01) / shorter;
  if (sizeNear < floorSize) {
    sizeNear = Math.min(floorSize, vertical);
    overlap = Math.max(0, widthUnits - (ARENA_BUDGET - BODY_GAP) / sizeNear);
  }
  const sizeFar = sizeNear / scale;

  const reachLeft = (motionFar.left / scale) * sizeNear;
  const reachRight = motionNear.right * sizeNear;
  const separation =
    (restFar.right / scale - restNear.left - overlap) * sizeNear + BODY_GAP;

  return {
    sizeFar,
    sizeNear,
    separation,
    reachLeft,
    reachRight,
    shareFar: (restFar.height * sizeFar) / HEIGHT,
    shareNear: (restNear.height * sizeNear) / HEIGHT,
    overlap,
    limitedBy:
      sizeNear >= aim - 1e-6 ? "target" : byWidth <= vertical ? "width" : "roof",
  };
}

/** On-screen scale of the near fighter for a round. */
export function fighterSizeFor(challengerSprite: string, opponentSprite: string): number {
  return roundPlacement(challengerSprite, opponentSprite).sizeNear;
}

/** The camera settings a round is fought at. Zoom is what sizes the pair. */
export function roundCamera(
  challengerSprite: string,
  opponentSprite: string,
): { zoom: number; worldSeparation: number; reachLeft: number; reachRight: number } {
  const placement = roundPlacement(challengerSprite, opponentSprite);
  const zoom = placement.sizeNear / L.fighterWorld;
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
  const placement = roundPlacement(result.challenger.spriteId, opponent.spriteId);
  const camera = roundCamera(result.challenger.spriteId, opponent.spriteId);
  const zoom = camera.zoom;
  // Far is the challenger, near is the boss. Two scales, two ground lines.
  const sizeFar = placement.sizeFar;
  const sizeNear = placement.sizeNear;
  const boundsA = spriteBounds(result.challenger.spriteId);
  const boundsB = spriteBounds(opponent.spriteId);

  const separation = placement.separation;
  const wobble = drift(index, frame);

  // Centre the pair on the bodies, not on the reach. Centring on the reach
  // shoves the pair off to one side whenever one fighter's death throws debris
  // much further than the other's — which is most rounds, and it reads as a
  // composition mistake for the whole fight to pay for two seconds of dying.
  const restLeft = boundsA.left * sizeFar;
  const restRight = separation + boundsB.right * sizeNear;
  const centred =
    ARENA.inner.x + (ARENA.inner.w - (restRight - restLeft)) / 2 - restLeft;
  // The pan is clamped against the arena wall, not the frame edge.
  const lowest = ARENA.inner.x + ARENA_PAD - camera.reachLeft;
  const highest =
    ARENA.inner.x + ARENA.inner.w - ARENA_PAD - separation - camera.reachRight;
  const originAx = Math.max(lowest, Math.min(centred + wobble.x, Math.max(lowest, highest)));
  const originBx = originAx + separation;

  // Vertical pan is bounded to a hair so the two ground lines stay fixed.
  const panY = Math.max(-HEAD_PAD, Math.min(wobble.y, HEAD_PAD));
  const originAy = ARENA.groundFarY - boundsA.bottom * sizeFar + panY;
  const originBy = ARENA.groundY - boundsB.bottom * sizeNear + panY;

  const spriteA: Rect = {
    name: "challengerSprite",
    x: originAx + boundsA.left * sizeFar,
    y: originAy + boundsA.top * sizeFar,
    w: boundsA.width * sizeFar,
    h: boundsA.height * sizeFar,
  };
  const spriteB: Rect = {
    name: "opponentSprite",
    x: originBx + boundsB.left * sizeNear,
    y: originBy + boundsB.top * sizeNear,
    w: boundsB.width * sizeNear,
    h: boundsB.height * sizeNear,
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
  // Two widgets on a narrow pair would stack; push them apart evenly.
  const clash = hpA.x + HP_WIDGET.width + HP_WIDGET_GAP - hpB.x;
  if (clash > 0) {
    hpA = hpFor("challengerHp", originAx - clash / 2);
    hpB = hpFor("opponentHp", originBx + clash / 2);
  }

  // Reach boxes use the true measured envelope, per side.
  const reachOf = (
    name: string,
    spriteId: string,
    originX: number,
    originY: number,
    size: number,
  ): Rect => {
    // The full measured envelope, uncapped: if any part of a fighter would
    // cross the arena wall, the gate must see it.
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
    fighterSize: sizeNear,
    sizeFar,
    sizeNear,
    groundY: ARENA.groundY,
    groundFarY: ARENA.groundFarY,
    overlap: placement.overlap,
    arena: { ...ARENA_RECT },
    camera: {
      // Screen pan expressed back in world units, which is what it means.
      x: (centred - originAx) / zoom,
      y: -panY / zoom,
      zoom,
    },
    challenger: {
      sprite: spriteA,
      reach: reachOf("challengerSprite", result.challenger.spriteId, originAx, originAy, sizeFar),
      centre: { x: originAx, y: originAy },
      hp: hpA,
    },
    opponent: {
      sprite: spriteB,
      reach: reachOf("opponentSprite", opponent.spriteId, originBx, originBy, sizeNear),
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

  // The card lives in the band under the arena — the strip the round caption
  // already occupies. Over the arena it covered the winner from the chest down,
  // which defeated the point of keeping them in shot.
  const pad = Math.round(WIDTH * 0.02);
  const room = WIDTH - Math.round(WIDTH * 0.03) * 2 - pad * 2;

  // Both sides can hit zero on the same tick — damage is applied after every
  // actor has swung, so a mutual kill is a real outcome, not a rounding
  // artefact. "ОСТАЛОСЬ 0 HP" is true there and reads as a broken card, so that
  // case gets its own line.
  const trade = hpLeft <= 0;
  const headlineSize = Math.round(WIDTH * 0.036);
  const nameSize = fitText(name, Math.round(WIDTH * 0.062), room, Math.round(WIDTH * 0.03));
  const hpText = trade ? "РАЗМЕН — УПАЛИ ОБА" : `ОСТАЛОСЬ ${hpLeft} HP`;
  const hpSize = fitText(hpText, Math.round(WIDTH * 0.048), room, Math.round(WIDTH * 0.026));

  const headline = trade ? "ДОБИЛ И УПАЛ" : won ? "ПРОШЁЛ ВСЕХ" : "НЕ СПРАВИЛСЯ";
  const sizes = [headlineSize, nameSize, hpSize];
  const texts = [headline, name, hpText];
  const names = ["victoryHeadline", "victoryName", "victoryHp"];
  const gap = Math.round(HEIGHT * 0.005);
  const bodyHeight = sizes.reduce((sum, size) => sum + size * 1.2, 0) + gap * (sizes.length - 1);

  // Under the arena, never over it. The strip between the arena's bottom edge
  // and the progress bar is already empty and already meant for text.
  const plateHeight = bodyHeight + pad * 2;
  const bandTop = ARENA.y + ARENA.side;
  const bandBottom = L.progressY - Math.round(HEIGHT * 0.008);
  const plate: Rect = {
    name: "victoryPlate",
    x: Math.round(WIDTH * 0.03),
    y: Math.round(bandTop + (bandBottom - bandTop - plateHeight) / 2),
    w: WIDTH - Math.round(WIDTH * 0.03) * 2,
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
