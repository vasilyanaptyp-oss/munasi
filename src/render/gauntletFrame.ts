import type { SKRSContext2D } from "@napi-rs/canvas";
import { createCanvas } from "@napi-rs/canvas";
import type { GauntletResult, GauntletSnapshot } from "../sim/gauntlet.js";
import type { PickupType } from "../sim/types.js";
import {
  DEATH_FRAMES,
  drawFighter,
  FIGHTER_OUTLINE,
  RECOVERY_FRAMES,
  WINDUP_FRAMES,
} from "./drawFighter.js";
import { buildRenderIndex, eventsAt, strokedText, type RenderIndex } from "./frame.js";
import type { PlannedFrame } from "./framePlan.js";
import {
  ARENA_RECT,
  DAMAGE_NUMBER_FRAMES,
  gauntletFrameLayout,
  hudLayout,
  MINION_OUTLINE,
  numberText,
  victoryCardLayout,
  type GauntletFrameLayout,
  type HudMetrics,
  type Rect,
} from "./gauntletLayout.js";
import { ARENA, GAUNTLET_COLORS as C, GAUNTLET_LAYOUT as L, HP_WIDGET } from "./gauntletTheme.js";
import { worldToScreen } from "./gauntletCamera.js";
import { spriteMotionBounds } from "./silhouette.js";
import { ensureFonts, font, HEIGHT, WIDTH } from "./theme.js";

type Ctx = SKRSContext2D;

const FLASH_FRAMES = 4;

/**
 * The gauntlet frame, following the reference's composition: a flat blue field
 * and a square arena the fighters play inside.
 *
 * The arena is a constant — fixed square, fixed border, fixed ground line — and
 * the camera pans and zooms inside it. It used to be fitted around whoever was
 * fighting, which meant the one element that should hold still moved whenever
 * the pair did.
 *
 * One deliberate departure from the reference: it moves its overlay text *with*
 * the camera, so the roster panel and captions slide off frame (two of the six
 * reference frames have the panel cut in half). Our fighter names are long
 * enough that losing half of one costs the joke, so the overlay is screen-fixed.
 */

/** Traces the plus-shaped HP widget, centred on the origin. */
function plusPath(ctx: Ctx, w: number, h: number, stem: number, barW: number, barH: number): void {
  const halfStem = stem / 2;
  const halfBarW = barW / 2;
  const top = -h / 2;
  const bottom = h / 2;
  // The crossbar sits a little above the middle, as in the reference.
  const barTop = top + h * 0.24;
  const barBottom = barTop + barH;
  void w;

  ctx.beginPath();
  ctx.moveTo(-halfStem, top);
  ctx.lineTo(halfStem, top);
  ctx.lineTo(halfStem, barTop);
  ctx.lineTo(halfBarW, barTop);
  ctx.lineTo(halfBarW, barBottom);
  ctx.lineTo(halfStem, barBottom);
  ctx.lineTo(halfStem, bottom);
  ctx.lineTo(-halfStem, bottom);
  ctx.lineTo(-halfStem, barBottom);
  ctx.lineTo(-halfBarW, barBottom);
  ctx.lineTo(-halfBarW, barTop);
  ctx.lineTo(-halfStem, barTop);
  ctx.closePath();
}

/**
 * HP as a plus sign that fills bottom-up: white while healthy, red once past
 * halfway, with the current HP printed across the bar.
 */
function drawHpWidget(ctx: Ctx, rect: Rect, hp: number, maxHp: number): void {
  const { stem, barWidth, barHeight } = HP_WIDGET;
  const w = rect.w;
  const h = rect.h;
  const share = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;

  ctx.save();
  ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);

  plusPath(ctx, w, h, stem, barWidth, barHeight);
  ctx.fillStyle = C.hpEmpty;
  ctx.fill();

  // Fill from the bottom, clipped to the plus.
  ctx.save();
  plusPath(ctx, w, h, stem, barWidth, barHeight);
  ctx.clip();
  const fillHeight = h * share;
  ctx.fillStyle = share > HP_WIDGET.hurtBelow ? C.hpHealthy : C.hpHurt;
  ctx.fillRect(-w, h / 2 - fillHeight, w * 2, fillHeight);
  ctx.restore();

  plusPath(ctx, w, h, stem, barWidth, barHeight);
  ctx.lineWidth = Math.max(3, Math.round(WIDTH * 0.005));
  ctx.strokeStyle = C.outline;
  ctx.stroke();

  const barTop = -h / 2 + h * 0.24;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = Math.round(barHeight * 0.86);
  const label = String(Math.max(0, Math.round(hp)));
  ctx.font = font(size);
  while (ctx.measureText(label).width > barWidth * 0.86 && size > 12) {
    size -= 1;
    ctx.font = font(size);
  }

  // The digits get a plate of their own rather than taking their colour from
  // how full the widget is. Switching between dark-on-light and light-on-dark
  // works only if the fill is uniform behind the number, and it never is: the
  // fill line crosses the crossbar somewhere around half HP, which put dark
  // digits half on white and half on the empty grey.
  ctx.fillStyle = C.hpPlate;
  ctx.fillRect(-barWidth / 2, barTop, barWidth, barHeight);
  strokedText(ctx, label, 0, barTop + barHeight / 2, size, C.hpDigits, Math.round(size * 0.14));
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}

/**
 * Renders one widget onto a blank canvas and returns the plate the digits sit
 * on, for the contrast gate.
 *
 * The plate rect is the point of the return value. Measuring contrast over the
 * whole canvas reads the brightest pixel anywhere against the darkest pixel
 * anywhere — and above half HP the widget's own fill is white, so the reading
 * came back at 15:1 no matter what colour the digits were. The gate has to look
 * inside this rectangle and nowhere else.
 */
export function drawHpWidgetForTest(ctx: Ctx, share: number): Rect {
  const rect: Rect = {
    name: "test",
    x: 40,
    y: 40,
    w: HP_WIDGET.width,
    h: HP_WIDGET.height,
  };
  drawHpWidget(ctx, rect, Math.round(1400 * share), 1400);
  // Mirrors the plate `drawHpWidget` fills, in canvas coordinates.
  return {
    name: "hpDigitPlate",
    x: rect.x + rect.w / 2 - HP_WIDGET.barWidth / 2,
    y: rect.y + rect.h * 0.24,
    w: HP_WIDGET.barWidth,
    h: HP_WIDGET.barHeight,
  };
}

const PICKUP_LABEL: Record<PickupType, string> = {
  heal: "+HP",
  damage_buff: "+УРОН",
  attack_speed: "+СКОР",
};
const PICKUP_COLOR: Record<PickupType, string> = {
  heal: C.buffText,
  damage_buff: C.critText,
  attack_speed: C.hpHealthy,
};

/** The item on the floor: a disc that pulses until someone reaches it. */
function drawPickup(ctx: Ctx, snap: GauntletSnapshot, layout: GauntletFrameLayout): void {
  const pickup = snap.pickup;
  if (!pickup) return;
  const age = snap.frame - pickup.spawnFrame;
  const pulse = 1 + Math.sin(age * 0.25) * 0.08;
  // Between the fighters, on the floor.
  const x = (layout.challenger.centre.x + layout.opponent.centre.x) / 2;
  const y = layout.groundY - WIDTH * 0.1;
  const r = WIDTH * 0.045 * pulse;

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = PICKUP_COLOR[pickup.type];
  ctx.fill();
  ctx.lineWidth = Math.max(3, Math.round(WIDTH * 0.006));
  ctx.strokeStyle = C.outline;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Clamped inside the arena, so a long label never runs into the wall.
  const label = PICKUP_LABEL[pickup.type];
  const size = Math.round(WIDTH * 0.032);
  ctx.font = font(size);
  const half = ctx.measureText(label).width / 2 + 4;
  const labelX = Math.max(
    ARENA.inner.x + half,
    Math.min(x, ARENA.inner.x + ARENA.inner.w - half),
  );
  strokedText(ctx, label, labelX, y + r + WIDTH * 0.04, size, PICKUP_COLOR[pickup.type], 6);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}

/**
 * The floor: two depth lines and a band of stripes that travel with the camera.
 *
 * Without this a pan is nearly invisible. The arena frame is nailed down and it
 * is the highest-contrast thing on screen; the field inside it is one flat
 * colour. Moving the camera over a flat colour changes no pixels at all, so a
 * shot that pans and zooms still measured as a slideshow. The stripes are scene
 * rather than chrome: they sit at fixed world positions and slide as the camera
 * moves, which is what a viewer reads as the shot travelling.
 *
 * Faint on purpose — they are a floor, not a pattern to look at.
 */
function drawFloor(ctx: Ctx, layout: GauntletFrameLayout): void {
  const left = ARENA.inner.x;
  const right = ARENA.inner.x + ARENA.inner.w;
  // Full height of the arena, not just the floor band: the striped area is
  // what a pan actually changes, and half an arena of flat colour was half the
  // motion budget thrown away.
  const top = ARENA.inner.y;
  const bottom = ARENA.inner.y + ARENA.inner.h;

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, ARENA.inner.y, ARENA.inner.w, ARENA.inner.h);
  ctx.clip();

  // One stripe every eighth of the arena, in world space.
  const step = 0.125;
  // 0.055 was invisible in more than the obvious sense: over the blue field it
  // shifts luma by 7 of 255, and the motion measurement ignores anything under
  // 8 as codec noise. A stripe nobody can measure is a stripe nobody can see.
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  for (let world = Math.floor(layout.camera.x / step) * step - 1; world < layout.camera.x + 1; world += step * 2) {
    const x0 = worldToScreen(world, layout.camera);
    const x1 = worldToScreen(world + step, layout.camera);
    if (x1 < left || x0 > right) continue;
    const a = Math.max(left, x0);
    const b = Math.min(right, x1);
    if (b > a) ctx.fillRect(a, top, b - a, bottom - top);
  }

  for (const [y, alpha] of [
    [ARENA.groundFarY, 0.1],
    [ARENA.groundY, 0.2],
  ] as const) {
    ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
    ctx.lineWidth = Math.max(2, Math.round(HEIGHT * 0.0022));
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }
  ctx.restore();
}

function strikePhase(index: RenderIndex, frame: number, fighterId: string): number | null {
  let best: number | null = null;
  for (let f = frame - RECOVERY_FRAMES; f <= frame + WINDUP_FRAMES; f += 1) {
    if (f < 0) continue;
    const swung = eventsAt(index, f).some(
      (e) => e.actorId === fighterId && (e.type === "hit" || e.type === "crit" || e.type === "minion_hit"),
    );
    if (!swung) continue;
    if (best === null || Math.abs(f - frame) < Math.abs(best - frame)) best = f;
  }
  if (best === null) return null;
  return best > frame ? (frame - best) / WINDUP_FRAMES : (frame - best) / RECOVERY_FRAMES;
}

function visualState(
  index: RenderIndex,
  frame: number,
  fighterId: string,
): { flash: number; hurt: number; strike: number | null; death: number } {
  let flash = 0;
  for (let back = 0; back <= FLASH_FRAMES; back += 1) {
    const f = frame - back;
    if (f < 0) break;
    for (const event of eventsAt(index, f)) {
      if (
        event.targetId === fighterId &&
        (event.type === "hit" || event.type === "crit" || event.type === "minion_hit")
      ) {
        flash = Math.max(flash, 0.8 * (1 - back / (FLASH_FRAMES + 1)));
      }
    }
  }
  const died = index.deathFrame.get(fighterId);
  const death = died === undefined || frame < died ? 0 : Math.min(1, (frame - died) / DEATH_FRAMES);
  // The flash curve peaks at 0.8; the recoil rides the same decay at full scale.
  return { flash, hurt: flash / 0.8, strike: strikePhase(index, frame, fighterId), death };
}

/** Team panel, top right: heading, then members with the active one marked. */
function drawRosterPanel(
  ctx: Ctx,
  result: GauntletResult,
  snap: GauntletSnapshot,
  metrics: HudMetrics,
): void {
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  const x = L.panelRight;
  const size = metrics.panelSize;
  const lineHeight = metrics.panelLineHeight;
  let y = metrics.panelTop + lineHeight;

  strokedText(ctx, result.team.name, x, y, Math.round(size * 1.1), C.teamHeading, 8);
  y += lineHeight;

  result.team.members.forEach((member, i) => {
    const defeated = i < snap.round;
    const active = i === snap.round;
    const colour = defeated ? C.memberDefeated : C.memberAlive;
    strokedText(ctx, member.name, x, y, size, colour, 8);

    if (active) {
      // Pointer sits to the left of the name, like the reference's triangle.
      ctx.font = font(size);
      const width = ctx.measureText(member.name).width;
      const px = x - width - Math.round(WIDTH * 0.03);
      ctx.beginPath();
      ctx.moveTo(px, y - size * 0.62);
      ctx.lineTo(px + size * 0.55, y - size * 0.32);
      ctx.lineTo(px, y - size * 0.02);
      ctx.closePath();
      ctx.fillStyle = C.teamHeading;
      ctx.fill();
    }
    y += lineHeight;
  });
  ctx.textAlign = "left";
}

/** Challenger's name and the VS mark, left of the panel. */
function drawChallengerLabel(ctx: Ctx, name: string, metrics: HudMetrics): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const x = Math.round(WIDTH * 0.03);
  // The name owns a full-width line of its own; VS sits under it, and the
  // roster panel starts below both. See the note in `hudLayout`.
  strokedText(ctx, name, x, metrics.nameBaseline, metrics.challengerNameSize, C.ink, 8);
  strokedText(ctx, "VS", x, metrics.vsBaseline, metrics.vsSize, C.vs, 9);
}

function drawDamageNumbers(
  ctx: Ctx,
  index: RenderIndex,
  frame: number,
  layout: GauntletFrameLayout,
): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const rects = layout.damageNumbers;
  let i = 0;
  for (let back = 0; back <= DAMAGE_NUMBER_FRAMES; back += 1) {
    const f = frame - back;
    if (f < 0) break;
    for (const event of eventsAt(index, f)) {
      let colour: string;
      switch (event.type) {
        // A crit is louder, not longer-flying: bigger cap height (the layout
        // sets it) and the brightest colour on the frame.
        case "crit":
          colour = C.critText;
          break;
        case "hit":
        case "minion_hit":
        case "aoe":
          colour = C.damageText;
          break;
        case "heal":
        case "pickup_claim":
          colour = C.buffText;
          break;
        default:
          continue;
      }
      // Positions come from the layout, which the gate also reads.
      const rect = rects[i];
      i += 1;
      if (!rect) continue;
      const age = back / DAMAGE_NUMBER_FRAMES;
      ctx.globalAlpha = 1 - age;
      strokedText(
        ctx,
        numberText(event.type, event.value),
        rect.x + rect.w / 2,
        rect.y + rect.h / 2,
        rect.h / 1.05,
        colour,
        rect.h * (event.type === "crit" ? 0.19 : 0.15),
      );
      ctx.globalAlpha = 1;
    }
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/**
 * Cold-open / cut badge, in the gap between the arena and the caption so it
 * never lands on the HUD or on a fighter.
 */
function drawBadge(ctx: Ctx, text: string, accent: string): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const size = Math.round(HEIGHT * 0.026);
  ctx.font = font(size);
  const w = ctx.measureText(text).width + size * 1.6;
  const h = size * 1.7;
  const x = WIDTH / 2 - w / 2;
  const y = ARENA_RECT.y + ARENA_RECT.h + Math.round(HEIGHT * 0.03);

  ctx.fillStyle = "rgba(5,18,26,0.82)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, Math.round(WIDTH * 0.008), h);
  strokedText(ctx, text, WIDTH / 2, y + h / 2, size, accent, 6);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawVictoryBanner(ctx: Ctx, result: GauntletResult): void {
  const card = victoryCardLayout(result);

  // A plate, not a blackout. The old card dimmed the whole frame to 34%
  // brightness, which hid the winner and both HP widgets at the exact moment
  // the viewer wants to read them.
  ctx.fillStyle = C.cardPlate;
  ctx.fillRect(card.plate.x, card.plate.y, card.plate.w, card.plate.h);
  ctx.lineWidth = Math.max(4, Math.round(WIDTH * 0.006));
  ctx.strokeStyle = C.outline;
  ctx.strokeRect(
    card.plate.x + ctx.lineWidth / 2,
    card.plate.y + ctx.lineWidth / 2,
    card.plate.w - ctx.lineWidth,
    card.plate.h - ctx.lineWidth,
  );

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const line of card.lines) {
    strokedText(
      ctx,
      line.text,
      line.rect.x + line.rect.w / 2,
      line.rect.y + line.rect.h / 2,
      line.size,
      line.accent ? (result.challengerWon ? C.hpHealthy : C.hpHurt) : C.ink,
      Math.round(line.size * 0.16),
    );
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** Ring drawn round the winner's HP widget, so the eye lands on the number. */
function markWinner(ctx: Ctx, rect: Rect, won: boolean): void {
  ctx.save();
  ctx.strokeStyle = won ? C.hpHealthy : C.hpHurt;
  ctx.lineWidth = Math.max(4, Math.round(WIDTH * 0.007));
  const pad = Math.round(WIDTH * 0.012);
  ctx.strokeRect(rect.x - pad, rect.y - pad, rect.w + pad * 2, rect.h + pad * 2);
  ctx.restore();
}

export interface GauntletFrameOptions {
  index?: RenderIndex;
  victoryOverlay?: boolean;
  planned?: PlannedFrame;
  /** Precomputed HUD, so a long render lays it out once. */
  hud?: ReturnType<typeof hudLayout>;
}

/**
 * Renders one gauntlet frame. Pure in `(result, frame)` — the camera, the poses
 * and the floating numbers are all derived from the event list, never from
 * previously rendered frames.
 */
export function renderGauntletFrame(
  result: GauntletResult,
  frame: number,
  options: GauntletFrameOptions = {},
): Buffer {
  ensureFonts();
  const snap = result.snapshots[frame];
  if (!snap) {
    throw new Error(
      `renderGauntletFrame: frame ${frame} is out of range (0..${result.durationFrames - 1})`,
    );
  }
  const index = options.index ?? buildRenderIndex(result);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Flat field, no gradient — measured off the reference.
  ctx.fillStyle = C.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const hud = options.hud ?? hudLayout(result);
  const layout = gauntletFrameLayout(result, frame, index, hud);

  // Fixed square, fixed border. Nothing here reads the fighters.
  ctx.lineWidth = ARENA.border;
  ctx.strokeStyle = C.outline;
  ctx.strokeRect(
    ARENA_RECT.x + ARENA.border / 2,
    ARENA_RECT.y + ARENA.border / 2,
    ARENA_RECT.w - ARENA.border,
    ARENA_RECT.h - ARENA.border,
  );
  // The floor the pair stands on, also fixed.
  drawFloor(ctx, layout);

  const sides = [
    {
      state: snap.challenger,
      fighter: result.challenger,
      place: layout.challenger,
      size: layout.sizeFar,
      facing: 1 as const,
    },
    {
      state: snap.opponent,
      fighter: result.team.members[snap.round] ?? result.team.members[0]!,
      place: layout.opponent,
      size: layout.sizeNear,
      facing: -1 as const,
    },
  ];

  for (const { state, fighter, place, size, facing } of sides) {
    const vis = visualState(index, frame, state.id);

    // Minions cluster behind their owner, on the ground line. Where exactly is
    // the layout's business, not this function's: placing them inline meant
    // nothing held them inside the arena wall and no gate could see that they
    // were not.
    for (const minion of layout.minions) {
      if (minion.ownerId !== state.id) continue;
      ctx.save();
      ctx.translate(minion.origin.x, minion.origin.y);
      drawFighter(ctx, fighter.spriteId, {
        size: L.minionSize,
        facing,
        frame,
        asMinion: true,
        lungeAxis: "x",
        outline: MINION_OUTLINE,
      });
      ctx.restore();
      const share = Math.max(0, Math.min(1, minion.hp / minion.maxHp));
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(minion.bar.x, minion.bar.y, minion.bar.w, minion.bar.h);
      ctx.fillStyle = C.buffText;
      ctx.fillRect(minion.bar.x, minion.bar.y, minion.bar.w * share, minion.bar.h);
    }

    ctx.save();
    ctx.translate(place.centre.x, place.centre.y);
    drawFighter(ctx, fighter.spriteId, {
      size,
      facing,
      frame,
      strike: vis.strike,
      death: vis.death,
      flash: vis.flash,
      hurt: vis.hurt,
      buffed: state.buffed,
      lungeAxis: "x",
      outline: FIGHTER_OUTLINE,
      outlineBounds: spriteMotionBounds(fighter.spriteId, true),
    });
    ctx.restore();

    drawHpWidget(ctx, place.hp, state.hp, state.maxHp);
  }

  // After the fighters: drawn under them, "+СКОР" lost its tail behind a body.
  drawPickup(ctx, snap, layout);
  drawDamageNumbers(ctx, index, frame, layout);

  // Overlay is screen-fixed so long names stay readable.
  drawChallengerLabel(ctx, result.challenger.name, hud.metrics);
  drawRosterPanel(ctx, result, snap, hud.metrics);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  strokedText(
    ctx,
    `РАУНД ${snap.round + 1}/${result.team.members.length}`,
    WIDTH / 2,
    L.captionBaseline,
    L.captionSize,
    C.ink,
  );
  ctx.textAlign = "left";

  const progressWidth = WIDTH - Math.round(WIDTH * 0.15);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect((WIDTH - progressWidth) / 2, L.progressY, progressWidth, 8);
  ctx.fillStyle = C.hpHealthy;
  ctx.fillRect(
    (WIDTH - progressWidth) / 2,
    L.progressY,
    (progressWidth * (frame + 1)) / Math.max(1, result.durationFrames),
    8,
  );

  const planned = options.planned;
  if (planned?.coldOpenLabel !== undefined) drawBadge(ctx, planned.coldOpenLabel, C.critText);
  if (planned?.startLabel !== undefined) drawBadge(ctx, planned.startLabel, C.hpHealthy);
  if (planned?.flash !== undefined && planned.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, planned.flash).toFixed(3)})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  if (options.victoryOverlay || planned?.victoryOverlay) {
    const winner = result.challengerWon ? layout.challenger : layout.opponent;
    markWinner(ctx, winner.hp, result.challengerWon);
    drawVictoryBanner(ctx, result);
  }

  return canvas.toBuffer("image/png");
}
