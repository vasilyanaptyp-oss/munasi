import type { SKRSContext2D } from "@napi-rs/canvas";
import { createCanvas } from "@napi-rs/canvas";
import type { GauntletResult, GauntletSnapshot } from "../sim/gauntlet.js";
import type { PickupType } from "../sim/types.js";
import { FPS } from "../sim/types.js";
import { DEATH_FRAMES, drawFighter, RECOVERY_FRAMES, WINDUP_FRAMES } from "./drawFighter.js";
import { buildRenderIndex, eventsAt, strokedText, type RenderIndex } from "./frame.js";
import type { PlannedFrame } from "./framePlan.js";
import {
  gauntletFrameLayout,
  hudLayout,
  type GauntletFrameLayout,
  type HudMetrics,
  type Rect,
} from "./gauntletLayout.js";
import { GAUNTLET_COLORS as C, GAUNTLET_LAYOUT as L, HP_WIDGET } from "./gauntletTheme.js";
import { ensureFonts, font, HEIGHT, WIDTH } from "./theme.js";

type Ctx = SKRSContext2D;

const DAMAGE_NUMBER_FRAMES = Math.round(FPS * 0.5);
const FLASH_FRAMES = 4;

/**
 * The gauntlet frame, following the reference's composition: a flat blue field,
 * a square arena wider than the frame, and a camera that pans over it.
 *
 * One deliberate departure: the reference moves its overlay text *with* the
 * camera, so the roster panel and captions slide off frame (two of the six
 * reference frames have the panel cut in half). Our fighter names are long
 * enough that losing half of one costs the joke, so the overlay is screen-fixed
 * and only the arena and its occupants move.
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
  // Dark digits on the light fill, light digits once the widget goes dark.
  const onLight = share > HP_WIDGET.hurtBelow;
  strokedText(
    ctx,
    label,
    0,
    barTop + barHeight / 2,
    size,
    onLight ? "#3c3d3d" : "#e8ecf2",
    onLight ? 0 : 5,
  );
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.restore();
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
  strokedText(ctx, PICKUP_LABEL[pickup.type], x, y + r + WIDTH * 0.04, Math.round(WIDTH * 0.032), PICKUP_COLOR[pickup.type], 6);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
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
): { flash: number; strike: number | null; death: number } {
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
  return { flash, strike: strikePhase(index, frame, fighterId), death };
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
  let y = L.panelTop + lineHeight;

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
  const size = metrics.challengerNameSize;
  const x = Math.round(WIDTH * 0.03);
  const y = L.panelTop + Math.round(HEIGHT * 0.052);
  strokedText(ctx, name, x, y, size, C.ink, 8);
  // VS sits under the name, so the panel keeps the right half to itself no
  // matter how long either side's names run.
  strokedText(ctx, "VS", x, y + metrics.vsSize * 1.15, metrics.vsSize, C.vs, 9);
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
      let text: string;
      let colour: string;
      switch (event.type) {
        case "crit":
          text = `-${event.value}!`;
          colour = C.critText;
          break;
        case "hit":
        case "minion_hit":
        case "aoe":
          text = `-${event.value}`;
          colour = C.damageText;
          break;
        case "heal":
          text = `+${event.value}`;
          colour = C.buffText;
          break;
        case "pickup_claim":
          text = "+БАФ";
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
        text,
        rect.x + rect.w / 2,
        rect.y + rect.h / 2,
        rect.h / 1.05,
        colour,
        rect.h * 0.15,
      );
      ctx.globalAlpha = 1;
    }
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawVictoryBanner(ctx: Ctx, result: GauntletResult): void {
  ctx.fillStyle = "rgba(5,20,30,0.66)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const won = result.challengerWon;
  strokedText(
    ctx,
    won ? "ПРОШЁЛ ВСЕХ" : "НЕ СПРАВИЛСЯ",
    WIDTH / 2,
    HEIGHT / 2 - HEIGHT * 0.06,
    Math.round(WIDTH * 0.075),
    won ? C.hpHealthy : C.hpHurt,
  );
  strokedText(
    ctx,
    won ? result.challenger.name : (result.rounds.at(-1)?.opponentName ?? ""),
    WIDTH / 2,
    HEIGHT / 2 + HEIGHT * 0.02,
    Math.round(WIDTH * 0.085),
    C.ink,
  );
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
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

  // The arena frames the pair rather than sitting behind them at a fixed size.
  ctx.lineWidth = Math.round(WIDTH * 0.042);
  ctx.strokeStyle = C.outline;
  ctx.strokeRect(
    layout.arena.x + ctx.lineWidth / 2,
    layout.arena.y + ctx.lineWidth / 2,
    layout.arena.w - ctx.lineWidth,
    layout.arena.h - ctx.lineWidth,
  );

  drawPickup(ctx, snap, layout);

  const sides = [
    {
      state: snap.challenger,
      fighter: result.challenger,
      place: layout.challenger,
      facing: 1 as const,
    },
    {
      state: snap.opponent,
      fighter: result.team.members[snap.round] ?? result.team.members[0]!,
      place: layout.opponent,
      facing: -1 as const,
    },
  ];

  for (const { state, fighter, place, facing } of sides) {
    const vis = visualState(index, frame, state.id);
    const size = layout.fighterSize;

    // Minions cluster behind their owner, on the ground line.
    snap.minions
      .filter((m) => m.ownerId === state.id)
      .forEach((minion, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const mx = place.centre.x + side * (place.sprite.w * 0.6 + Math.floor(i / 2) * L.minionSize);
        const my = layout.groundY - L.minionSize * 0.5;
        ctx.save();
        ctx.translate(mx, my);
        drawFighter(ctx, fighter.spriteId, { size: L.minionSize, facing, frame, asMinion: true });
        ctx.restore();
        const w = L.minionSize * 0.7;
        const share = Math.max(0, Math.min(1, minion.hp / minion.maxHp));
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(mx - w / 2, my + L.minionSize * 0.6, w, 7);
        ctx.fillStyle = C.buffText;
        ctx.fillRect(mx - w / 2, my + L.minionSize * 0.6, w * share, 7);
      });

    ctx.save();
    ctx.translate(place.centre.x, place.centre.y);
    drawFighter(ctx, fighter.spriteId, {
      size,
      facing,
      frame,
      strike: vis.strike,
      death: vis.death,
      flash: vis.flash,
      buffed: state.buffed,
    });
    ctx.restore();

    drawHpWidget(ctx, place.hp, state.hp, state.maxHp);
  }

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
  if (planned?.flash !== undefined && planned.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, planned.flash).toFixed(3)})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  if (options.victoryOverlay || planned?.victoryOverlay) drawVictoryBanner(ctx, result);

  return canvas.toBuffer("image/png");
}
