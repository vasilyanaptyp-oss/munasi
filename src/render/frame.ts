import type { SKRSContext2D } from "@napi-rs/canvas";
import { createCanvas } from "@napi-rs/canvas";
import type { Fighter, MatchEvent, MatchResult, Side, Snapshot } from "../sim/types.js";
import { FPS } from "../sim/types.js";
import { DEATH_FRAMES, drawFighter, RECOVERY_FRAMES, WINDUP_FRAMES } from "./drawFighter.js";
import type { PlannedFrame } from "./framePlan.js";
import { COLORS, ensureFonts, font, HEIGHT, LAYOUT, WIDTH } from "./theme.js";

type Ctx = SKRSContext2D;

/** Frames a floating damage number stays on screen (0.5s at 30fps). */
const DAMAGE_NUMBER_FRAMES = Math.round(FPS * 0.5);
/** Frames the white damage flash lasts. */
const FLASH_FRAMES = 4;
/** Frames the screen keeps shaking after a crit. */
const SHAKE_FRAMES = 8;
/** How far back the HP bar's "ghost" trail remembers. */
const GHOST_FRAMES = 14;
/** Frames the opening "VS" badge stays up instead of the clock. */
const INTRO_FRAMES = 26;

/**
 * Events bucketed by frame. Built once per match so a 1800-frame render does
 * not rescan the whole event list for every frame.
 */
export interface RenderIndex {
  byFrame: Map<number, MatchEvent[]>;
  /** Frame each fighter died on, for the death animation. */
  deathFrame: Map<string, number>;
}

export function buildRenderIndex(result: { events: MatchEvent[] }): RenderIndex {
  const byFrame = new Map<number, MatchEvent[]>();
  const deathFrame = new Map<string, number>();
  for (const event of result.events) {
    const bucket = byFrame.get(event.frame);
    if (bucket) bucket.push(event);
    else byFrame.set(event.frame, [event]);
    if (event.type === "death" && !deathFrame.has(event.actorId)) {
      deathFrame.set(event.actorId, event.frame);
    }
  }
  return { byFrame, deathFrame };
}

export function eventsAt(index: RenderIndex, frame: number): MatchEvent[] {
  return index.byFrame.get(frame) ?? [];
}

/** Deterministic jitter so stacked damage numbers do not overlap. */
export function jitter(seed: string, spread: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (((h >>> 0) % 1000) / 1000 - 0.5) * 2 * spread;
}

function isAttack(event: MatchEvent): boolean {
  return event.type === "hit" || event.type === "crit" || event.type === "minion_hit";
}

export function strokedText(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  strokeWidth = size * 0.16,
): void {
  ctx.font = font(size);
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = COLORS.outline;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

/** Overdraw margin so screen shake never exposes bare canvas at the edges. */
const BLEED = 80;

function drawBackground(ctx: Ctx): void {
  const bg = ctx.createLinearGradient(0, -BLEED, 0, HEIGHT + BLEED);
  bg.addColorStop(0, COLORS.bgTop);
  bg.addColorStop(1, COLORS.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(-BLEED, -BLEED, WIDTH + BLEED * 2, HEIGHT + BLEED * 2);

  for (const [y, color] of [
    [LAYOUT.a.spriteY, COLORS.arenaGlowA],
    [LAYOUT.b.spriteY, COLORS.arenaGlowB],
  ] as const) {
    const glow = ctx.createRadialGradient(LAYOUT.centerX, y, 40, LAYOUT.centerX, y, 620);
    glow.addColorStop(0, color);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = glow;
    ctx.fillRect(-BLEED, y - 620, WIDTH + BLEED * 2, 1240);
    ctx.globalAlpha = 1;
  }

  // Floor lines under each fighter give the arena a sense of ground.
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 3;
  for (const y of [LAYOUT.a.floorY, LAYOUT.b.floorY]) {
    ctx.beginPath();
    ctx.moveTo(80, y);
    ctx.lineTo(WIDTH - 80, y);
    ctx.stroke();
  }
}

/** The clash line between the two halves of the arena, with the match clock. */
function drawDivider(ctx: Ctx, frame: number): void {
  const y = LAYOUT.divider;
  ctx.save();
  ctx.setLineDash([18, 22]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.moveTo(90, y);
  ctx.lineTo(WIDTH - 90, y);
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(LAYOUT.centerX, y, 62, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.bgTop;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (frame < INTRO_FRAMES) {
    // Frame 0 is the feed thumbnail, so the badge sells the matchup rather
    // than reporting a clock that reads 0.0.
    strokedText(ctx, "VS", LAYOUT.centerX, y + 2, 52, COLORS.accent, 9);
  } else {
    strokedText(ctx, `${(frame / FPS).toFixed(1)}`, LAYOUT.centerX, y - 6, 44, COLORS.ink, 8);
    strokedText(ctx, "SEC", LAYOUT.centerX, y + 30, 22, COLORS.inkDim, 5);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/**
 * Stat line under a fighter's HP bar. Fills what was dead space at the top of
 * the arena and gives a still frame something to read.
 */
function drawStatLine(ctx: Ctx, fighter: Fighter, y: number, accent: string): void {
  const x = (WIDTH - LAYOUT.barWidth) / 2;
  const chips: [string, string][] = [
    ["УРОН", String(Math.round(fighter.attack))],
    ["СКОР", fighter.attackSpeed.toFixed(2)],
    ["КРИТ", `${Math.round(fighter.critChance * 100)}%`],
  ];
  const gap = 14;
  const width = (LAYOUT.barWidth - gap * (chips.length - 1)) / chips.length;

  ctx.textBaseline = "middle";
  chips.forEach(([label, value], i) => {
    const cx = x + i * (width + gap);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(cx, y, width, 54);
    ctx.fillStyle = accent;
    ctx.fillRect(cx, y, 5, 54);

    ctx.textAlign = "left";
    strokedText(ctx, label, cx + 18, y + 27, 22, COLORS.inkDim, 5);
    ctx.textAlign = "right";
    strokedText(ctx, value, cx + width - 16, y + 27, 30, COLORS.ink, 6);
  });
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawTitle(ctx: Ctx, nameA: string, nameB: string): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const maxWidth = WIDTH - 72;

  const measure = (size: number): { a: number; vs: number; gap: number; total: number } => {
    const gap = size * 0.4;
    ctx.font = font(size);
    const a = ctx.measureText(nameA).width;
    const b = ctx.measureText(nameB).width;
    ctx.font = font(size * 0.72);
    const vs = ctx.measureText("vs").width;
    return { a, vs, gap, total: a + b + vs + gap * 2 };
  };

  // Shrink until it fits. One proportional guess is not enough: the gaps and
  // the "vs" scale too, and roster names run long enough to overflow twice.
  let size = 84;
  let m = measure(size);
  while (m.total > maxWidth && size > 30) {
    size = Math.max(30, Math.floor(size * Math.min(0.94, maxWidth / m.total)));
    m = measure(size);
  }

  let x = (WIDTH - m.total) / 2;
  const y = LAYOUT.titleBaseline;
  strokedText(ctx, nameA, x, y, size, COLORS.hpFillA);
  x += m.a + m.gap;
  strokedText(ctx, "vs", x, y - size * 0.08, size * 0.72, COLORS.inkDim);
  x += m.vs + m.gap;
  strokedText(ctx, nameB, x, y, size, COLORS.hpFillB);
}

function drawHpBar(
  ctx: Ctx,
  y: number,
  name: string,
  hp: number,
  maxHp: number,
  ghostHp: number,
  fill: string,
): void {
  const x = (WIDTH - LAYOUT.barWidth) / 2;
  const h = LAYOUT.barHeight;
  const r = h / 2;

  const rounded = (px: number, py: number, w: number, ph: number, radius: number): void => {
    ctx.beginPath();
    ctx.moveTo(px + radius, py);
    ctx.arcTo(px + w, py, px + w, py + ph, radius);
    ctx.arcTo(px + w, py + ph, px, py + ph, radius);
    ctx.arcTo(px, py + ph, px, py, radius);
    ctx.arcTo(px, py, px + w, py, radius);
    ctx.closePath();
  };

  ctx.save();
  rounded(x, y, LAYOUT.barWidth, h, r);
  ctx.fillStyle = COLORS.hpTrack;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = COLORS.outline;
  ctx.stroke();

  ctx.save();
  rounded(x, y, LAYOUT.barWidth, h, r);
  ctx.clip();
  const ghostShare = Math.max(0, Math.min(1, ghostHp / maxHp));
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = COLORS.hpGhost;
  ctx.fillRect(x, y, LAYOUT.barWidth * ghostShare, h);
  ctx.globalAlpha = 1;

  const share = Math.max(0, Math.min(1, hp / maxHp));
  const grad = ctx.createLinearGradient(x, y, x + LAYOUT.barWidth, y);
  grad.addColorStop(0, fill);
  grad.addColorStop(1, share < 0.25 ? "#ff4d4d" : fill);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, LAYOUT.barWidth * share, h);
  ctx.restore();
  ctx.restore();

  ctx.textBaseline = "alphabetic";
  const readout = `${Math.round(hp)} / ${Math.round(maxHp)}`;
  ctx.font = font(34);
  const readoutWidth = ctx.measureText(readout).width;

  // Long names shrink rather than run into the HP readout.
  const room = LAYOUT.barWidth - readoutWidth - 36;
  let nameSize = 34;
  ctx.font = font(nameSize);
  while (ctx.measureText(name).width > room && nameSize > 20) {
    nameSize -= 1;
    ctx.font = font(nameSize);
  }

  ctx.textAlign = "left";
  strokedText(ctx, name, x + 6, y - 16, nameSize, COLORS.inkDim, 6);
  ctx.textAlign = "right";
  strokedText(ctx, readout, x + LAYOUT.barWidth - 6, y - 16, 34, COLORS.ink, 6);
  ctx.textAlign = "left";
}

function drawProgress(ctx: Ctx, frame: number, total: number): void {
  const w = WIDTH - 160;
  const x = 80;
  const y = LAYOUT.progressY;
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fillRect(x, y, w, 8);
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(x, y, (w * (frame + 1)) / Math.max(1, total), 8);
}

export interface FighterVisualState {
  /** 0..1 white damage flash. */
  flash: number;
  /** -1..1 attack phase, or null when not swinging. */
  strike: number | null;
  /** 0..1 death progress. */
  death: number;
}

/**
 * How far into a swing the fighter is on this frame.
 *
 * The whole event list is known up front, so the renderer can look *ahead* to
 * the frame a blow lands on and play a wind-up before it — which is what makes
 * an attack read as intent rather than a twitch.
 */
function strikePhase(index: RenderIndex, frame: number, fighterId: string): number | null {
  let best: number | null = null;
  for (let f = frame - RECOVERY_FRAMES; f <= frame + WINDUP_FRAMES; f += 1) {
    if (f < 0) continue;
    const swung = eventsAt(index, f).some((e) => e.actorId === fighterId && isAttack(e));
    if (!swung) continue;
    if (best === null || Math.abs(f - frame) < Math.abs(best - frame)) best = f;
  }
  if (best === null) return null;
  return best > frame
    ? (frame - best) / WINDUP_FRAMES // -1..0, winding up
    : (frame - best) / RECOVERY_FRAMES; // 0..1, following through
}

function deathProgress(index: RenderIndex, frame: number, fighterId: string): number {
  const died = index.deathFrame.get(fighterId);
  if (died === undefined || frame < died) return 0;
  return Math.min(1, (frame - died) / DEATH_FRAMES);
}

export function fighterVisualState(
  index: RenderIndex,
  frame: number,
  fighterId: string,
): FighterVisualState {
  let flash = 0;
  for (let back = 0; back <= FLASH_FRAMES; back += 1) {
    const f = frame - back;
    if (f < 0) break;
    for (const event of eventsAt(index, f)) {
      if (event.targetId === fighterId && isAttack(event)) {
        flash = Math.max(flash, 0.75 * (1 - back / (FLASH_FRAMES + 1)));
      }
    }
  }
  return {
    flash,
    strike: strikePhase(index, frame, fighterId),
    death: deathProgress(index, frame, fighterId),
  };
}

export function shakeOffset(index: RenderIndex, frame: number): { x: number; y: number } {
  let amp = 0;
  for (let back = 0; back <= SHAKE_FRAMES; back += 1) {
    const f = frame - back;
    if (f < 0) break;
    for (const event of eventsAt(index, f)) {
      if (event.type === "crit" || event.type === "death") {
        const strength = event.type === "death" ? 34 : 20;
        amp = Math.max(amp, strength * (1 - back / (SHAKE_FRAMES + 1)));
      }
    }
  }
  if (amp === 0) return { x: 0, y: 0 };
  return { x: Math.sin(frame * 2.7) * amp, y: Math.cos(frame * 3.1) * amp * 0.6 };
}

function ghostHpAt(snapshots: Snapshot[], frame: number, side: Side): number {
  let best = 0;
  for (let f = Math.max(0, frame - GHOST_FRAMES); f <= frame; f += 1) {
    const snap = snapshots[f];
    if (!snap) continue;
    best = Math.max(best, side === "a" ? snap.a.hp : snap.b.hp);
  }
  return best;
}

function drawMinions(
  ctx: Ctx,
  snap: Snapshot,
  ownerId: string,
  ownerSpriteId: string,
  baseY: number,
): void {
  const mine = snap.minions.filter((m) => m.ownerId === ownerId);
  const facing: 1 | -1 = baseY < LAYOUT.divider ? 1 : -1;
  mine.forEach((minion, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const rank = Math.floor(i / 2);
    const x = LAYOUT.centerX + side * (250 + rank * 86);
    const y = baseY + 78 + (rank % 2) * 40;
    ctx.save();
    ctx.translate(x, y);
    drawFighter(ctx, ownerSpriteId, {
      size: LAYOUT.minionSize,
      facing,
      frame: snap.frame,
      asMinion: true,
      lungeAxis: "y",
    });
    ctx.restore();

    // Slim HP pip under each minion.
    const w = 78;
    const pipY = y + LAYOUT.minionSize * 0.6;
    const share = Math.max(0, Math.min(1, minion.hp / minion.maxHp));
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x - w / 2, pipY, w, 8);
    ctx.fillStyle = COLORS.heal;
    ctx.fillRect(x - w / 2, pipY, w * share, 8);
  });
}

function drawDamageNumbers(ctx: Ctx, index: RenderIndex, frame: number, result: MatchResult): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let back = 0; back <= DAMAGE_NUMBER_FRAMES; back += 1) {
    const f = frame - back;
    if (f < 0) break;
    for (const event of eventsAt(index, f)) {
      let text: string;
      let color: string;
      let size: number;
      switch (event.type) {
        case "crit":
          text = `${event.value}!`;
          color = COLORS.crit;
          size = 88;
          break;
        case "hit":
          text = `${event.value}`;
          color = COLORS.ink;
          size = 60;
          break;
        case "minion_hit":
          text = `${event.value}`;
          color = COLORS.minionDamage;
          size = 44;
          break;
        case "heal":
          text = `+${event.value}`;
          color = COLORS.heal;
          size = 58;
          break;
        case "aoe":
          text = `${event.value}`;
          color = COLORS.aoe;
          size = 66;
          break;
        default:
          continue;
      }

      const targetIsA = event.targetId === result.fighters.a.id;
      const targetIsB = event.targetId === result.fighters.b.id;
      const anchorY =
        event.type === "heal"
          ? event.actorId === result.fighters.a.id
            ? LAYOUT.a.spriteY
            : LAYOUT.b.spriteY
          : targetIsA
            ? LAYOUT.a.spriteY
            : targetIsB
              ? LAYOUT.b.spriteY
              : LAYOUT.divider;

      const age = back / DAMAGE_NUMBER_FRAMES;
      const x = LAYOUT.centerX + jitter(`${event.frame}:${event.actorId}:${event.type}`, 170);
      const y = anchorY - 150 - age * 130;
      ctx.globalAlpha = 1 - age;
      strokedText(ctx, text, x, y, size * (1 + 0.12 * (1 - age)), color, size * 0.14);
      ctx.globalAlpha = 1;
    }
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** Corner badge used by the cold open and the cut back to the start. */
function drawBadge(ctx: Ctx, text: string, accent: string): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = font(36);
  const width = ctx.measureText(text).width + 56;
  const x = WIDTH / 2 - width / 2;
  const y = LAYOUT.titleBaseline + 22;

  ctx.fillStyle = "rgba(5,7,13,0.78)";
  ctx.fillRect(x, y, width, 58);
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, 8, 58);
  strokedText(ctx, text, WIDTH / 2 + 4, y + 30, 36, accent, 7);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawVictoryBanner(ctx: Ctx, name: string, color: string): void {
  ctx.fillStyle = "rgba(5,7,13,0.62)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  strokedText(ctx, "WINNER", WIDTH / 2, HEIGHT / 2 - 110, 92, COLORS.inkDim);
  strokedText(ctx, name, WIDTH / 2, HEIGHT / 2 + 20, 128, color);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

export interface RenderFrameOptions {
  /** Prebuilt event index; built on demand when omitted. */
  index?: RenderIndex;
  /** Draws the winner overlay on top of the frame. */
  victoryOverlay?: boolean;
  /** Overlays carried by the frame plan (cold-open badge, cut flash). */
  planned?: PlannedFrame;
}

/**
 * Renders one frame to a PNG buffer. Pure: output depends only on the match
 * result and the frame number, never on previously rendered frames.
 */
export function renderSingleFrame(
  result: MatchResult,
  frame: number,
  options: RenderFrameOptions = {},
): Buffer {
  ensureFonts();
  const snap = result.snapshots[frame];
  if (!snap) {
    throw new Error(
      `renderSingleFrame: frame ${frame} is out of range (0..${result.durationFrames - 1})`,
    );
  }
  const index = options.index ?? buildRenderIndex(result);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  const shake = shakeOffset(index, frame);
  ctx.save();
  ctx.translate(shake.x, shake.y);
  drawBackground(ctx);

  drawTitle(ctx, result.fighters.a.name, result.fighters.b.name);
  drawDivider(ctx, frame);

  drawHpBar(
    ctx,
    LAYOUT.a.barY,
    result.fighters.a.name,
    snap.a.hp,
    snap.a.maxHp,
    ghostHpAt(result.snapshots, frame, "a"),
    COLORS.hpFillA,
  );
  drawHpBar(
    ctx,
    LAYOUT.b.barY,
    result.fighters.b.name,
    snap.b.hp,
    snap.b.maxHp,
    ghostHpAt(result.snapshots, frame, "b"),
    COLORS.hpFillB,
  );

  drawStatLine(ctx, result.fighters.a, LAYOUT.a.barY + LAYOUT.barHeight + 22, COLORS.hpFillA);
  drawStatLine(ctx, result.fighters.b, LAYOUT.b.barY + LAYOUT.barHeight + 22, COLORS.hpFillB);

  drawMinions(ctx, snap, result.fighters.a.id, result.fighters.a.spriteId, LAYOUT.a.spriteY);
  drawMinions(ctx, snap, result.fighters.b.id, result.fighters.b.spriteId, LAYOUT.b.spriteY);

  for (const side of ["a", "b"] as const) {
    const fighter = result.fighters[side];
    const state = snap[side];
    const facing: 1 | -1 = side === "a" ? 1 : -1;
    const vis = fighterVisualState(index, frame, fighter.id);

    ctx.save();
    ctx.translate(LAYOUT.centerX, side === "a" ? LAYOUT.a.spriteY : LAYOUT.b.spriteY);
    drawFighter(ctx, fighter.spriteId, {
      size: LAYOUT.spriteSize,
      facing,
      frame,
      lungeAxis: "y",
      strike: vis.strike,
      death: vis.death,
      flash: vis.flash,
      buffed: state.buffed,
    });
    ctx.restore();
  }

  drawDamageNumbers(ctx, index, frame, result);
  drawProgress(ctx, frame, result.durationFrames);
  ctx.restore();

  const planned = options.planned;
  if (planned?.coldOpenLabel !== undefined) drawBadge(ctx, planned.coldOpenLabel, COLORS.crit);
  if (planned?.startLabel !== undefined) drawBadge(ctx, planned.startLabel, COLORS.hpFillA);
  if (planned?.flash !== undefined && planned.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, planned.flash).toFixed(3)})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  if ((options.victoryOverlay || planned?.victoryOverlay) && result.winnerId !== null) {
    const winnerIsA = result.winnerId === result.fighters.a.id;
    drawVictoryBanner(
      ctx,
      winnerIsA ? result.fighters.a.name : result.fighters.b.name,
      winnerIsA ? COLORS.hpFillA : COLORS.hpFillB,
    );
  }

  return canvas.toBuffer("image/png");
}
