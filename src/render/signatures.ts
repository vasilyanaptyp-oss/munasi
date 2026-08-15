import type { SKRSContext2D } from "@napi-rs/canvas";
import type { MatchEvent } from "../sim/types.js";
import { FPS } from "../sim/types.js";
import { SIGNATURE_LEAD_SECONDS } from "../sim/simulate.js";
import { GAUNTLET_COLORS as C } from "./gauntletTheme.js";
import { strokedText } from "./frame.js";


/**
 * The signature abilities.
 *
 * **An ability has to show who is attacking and what is hitting whom.** These
 * used to be effects painted across the middle of the arena — a compass rose
 * over everything, a white flash over the frame — with no connection to either
 * fighter. The owner's verdict was that you could not tell what was attacking,
 * and that was fair: the effect started nowhere, went nowhere, and the damage
 * appeared somewhere else entirely.
 *
 * So both are built the same way now, which is the way the reference builds its
 * one ability:
 *
 *   1. it **starts on its owner** — a ring winds up around the caster, so the
 *      character and the effect are visibly the same thing;
 *   2. it **travels** across the arena, in view, in a straight readable line;
 *   3. it **arrives on the victim** on the exact frame the damage lands, where
 *      the impact mark and the number are already drawn.
 *
 * The arrival is synced to `SIGNATURE_LEAD_SECONDS` from the simulation rather
 * than to a number chosen here. If the two ever drift apart the effect lands
 * before or after the health drops, and the ability goes back to being
 * decoration that happens near a fight.
 */

type Ctx = SKRSContext2D;

/** Frames each effect plays for. */
export const SIGNATURE_FRAMES = Math.round(FPS * 1.4);
/** Frames from the cast to the moment it bites. Matched to the simulation. */
export const SIGNATURE_TRAVEL_FRAMES = Math.round(FPS * SIGNATURE_LEAD_SECONDS);

export interface ArenaBox {
  x: number;
  y: number;
  side: number;
  border: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Every signature the renderer knows how to draw. */
export type SignatureKind = "magnetic_north" | "nobody_moves" | "haymaker" | "four_eyes";

/** Ease-out, so the thing leaves fast and settles onto its target. */
function ease(t: number): number {
  return 1 - Math.pow(1 - t, 2.2);
}

/** The wind-up ring on the caster: this is who is attacking. */
function casterRing(ctx: Ctx, from: Point, age: number, scale: number, colour: string): void {
  const t = Math.min(1, age / SIGNATURE_TRAVEL_FRAMES);
  if (t >= 1) return;
  ctx.save();
  ctx.globalAlpha = 0.85 * (1 - t);
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(4, scale * 0.02);
  ctx.beginPath();
  // Collapses inward as the shot builds, so it reads as gathering rather than
  // as another expanding blast.
  ctx.arc(from.x, from.y, scale * (0.55 - 0.3 * t), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * MAGNETIC NORTH — Compass Guy.
 *
 * The rose is **on him**, not on the arena, and its needle swings round and
 * points at the other fighter. A charge then runs out along that needle and
 * into them. Needle points at you, bolt arrives, your health drops.
 */
function magneticNorth(
  ctx: Ctx,
  from: Point,
  to: Point,
  age: number,
  scale: number,
  width: number,
  arena: ArenaBox,
  slot: number,
): void {
  const t = Math.min(1, age / SIGNATURE_FRAMES);
  const travel = Math.min(1, age / SIGNATURE_TRAVEL_FRAMES);
  const alpha = t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 1;
  const radius = scale * 0.62;
  const heading = Math.atan2(to.y - from.y, to.x - from.x);

  ctx.save();
  ctx.globalAlpha = alpha * 0.95;
  ctx.translate(from.x, from.y);

  // Rings and ticks, sized to the man rather than to the square.
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(3, radius * 0.035);
  for (const r of [radius, radius * 0.76]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = Math.max(2, radius * 0.022);
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    const long = i % 6 === 0;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * radius, Math.sin(a) * radius);
    ctx.lineTo(Math.cos(a) * radius * (long ? 0.8 : 0.89), Math.sin(a) * radius * (long ? 0.8 : 0.89));
    ctx.stroke();
  }

  // The needle spins up and locks onto the opponent by the time the bolt goes.
  const eased = ease(travel);
  const angle = heading + (1 - eased) * Math.PI * 2 * 3;
  ctx.save();
  ctx.rotate(angle);
  const len = radius * 0.92;
  for (const [dir, colour] of [[1, "#ed1e2a"], [-1, "#ffffff"]] as const) {
    ctx.beginPath();
    ctx.moveTo(len * dir, 0);
    ctx.lineTo(-len * 0.08 * dir, -radius * 0.11);
    ctx.lineTo(-len * 0.08 * dir, radius * 0.11);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.lineWidth = Math.max(2, radius * 0.018);
    ctx.strokeStyle = C.outline;
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();

  // The charge itself, running from him to them along the needle's line.
  if (travel > 0.25) {
    const p = ease((travel - 0.25) / 0.75);
    const bx = from.x + (to.x - from.x) * p;
    const by = from.y + (to.y - from.y) * p;
    ctx.save();
    ctx.globalAlpha = alpha;
    // A tail back toward the caster keeps the line of the attack readable.
    const tail = 0.22;
    const grad = ctx.createLinearGradient(
      from.x + (to.x - from.x) * Math.max(0, p - tail),
      from.y + (to.y - from.y) * Math.max(0, p - tail),
      bx,
      by,
    );
    grad.addColorStop(0, "rgba(237,30,42,0)");
    grad.addColorStop(1, "#ed1e2a");
    ctx.strokeStyle = grad;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(5, scale * 0.075);
    ctx.beginPath();
    ctx.moveTo(
      from.x + (to.x - from.x) * Math.max(0, p - tail),
      from.y + (to.y - from.y) * Math.max(0, p - tail),
    );
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(bx, by, scale * 0.055, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  label(ctx, "MAGNETIC NORTH", alpha, width, arena, "#ffe45c", slot);
}


/**
 * HAYMAKER — Boxer Guy.
 *
 * A glove leaves him, crosses the arena spinning, and lands. The most literal
 * reading of "who is attacking": the thing that hits you is the thing he threw.
 */
function haymaker(
  ctx: Ctx,
  from: Point,
  to: Point,
  age: number,
  scale: number,
  width: number,
  arena: ArenaBox,
  slot: number,
): void {
  const t = Math.min(1, age / SIGNATURE_FRAMES);
  const travel = Math.min(1, age / SIGNATURE_TRAVEL_FRAMES);
  const alpha = t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 1;
  const p = ease(travel);
  const gx = from.x + (to.x - from.x) * p;
  const gy = from.y + (to.y - from.y) * p;
  const r = scale * 0.28;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Speed lines trailing back the way it came, so the direction is unmistakable.
  const back = Math.atan2(from.y - to.y, from.x - to.x);
  ctx.strokeStyle = "rgba(255,255,255,0.65)";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(3, scale * 0.02);
  for (const off of [-0.5, 0, 0.5]) {
    const nx = Math.cos(back + Math.PI / 2) * r * off;
    const ny = Math.sin(back + Math.PI / 2) * r * off;
    ctx.beginPath();
    ctx.moveTo(gx + nx, gy + ny);
    ctx.lineTo(gx + nx + Math.cos(back) * r * 2.4, gy + ny + Math.sin(back) * r * 2.4);
    ctx.stroke();
  }

  // The glove: a fist-shaped blob with a cuff, turned to face where it is going.
  ctx.translate(gx, gy);
  ctx.rotate(Math.atan2(to.y - from.y, to.x - from.x) + travel * Math.PI * 1.5);
  ctx.fillStyle = "#e02b1e";
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = Math.max(3, r * 0.14);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // The thumb, so it reads as a glove rather than a ball.
  ctx.beginPath();
  ctx.arc(-r * 0.55, r * 0.5, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // The cuff.
  ctx.fillStyle = "#1b1b1b";
  ctx.beginPath();
  ctx.rect(-r * 1.5, -r * 0.42, r * 0.6, r * 0.84);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  label(ctx, "HAYMAKER", alpha, width, arena, "#ff6a3d", slot);
}

/**
 * FOUR EYES — Glasses Guy.
 *
 * He flings a fan of spectacles. They leave him together, spread on the way
 * over, and arrive on the same frame — a scatter rather than one projectile, so
 * the volley reads even when it crosses a busy arena.
 */
function fourEyes(
  ctx: Ctx,
  from: Point,
  to: Point,
  age: number,
  scale: number,
  width: number,
  arena: ArenaBox,
  slot: number,
): void {
  const t = Math.min(1, age / SIGNATURE_FRAMES);
  const travel = Math.min(1, age / SIGNATURE_TRAVEL_FRAMES);
  const alpha = t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 1;
  const p = ease(travel);
  const heading = Math.atan2(to.y - from.y, to.x - from.x);
  const across = heading + Math.PI / 2;
  const w = scale * 0.3;

  ctx.save();
  ctx.globalAlpha = alpha;
  // Bow out at the midpoint and close again on the target, so the fan is widest
  // where there is room for it and tightest where it lands.
  const spread = Math.sin(p * Math.PI) * scale * 0.55;
  for (const lane of [-1, 0, 1]) {
    const cx = from.x + (to.x - from.x) * p + Math.cos(across) * spread * lane;
    const cy = from.y + (to.y - from.y) * p + Math.sin(across) * spread * lane;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(heading + travel * Math.PI * 4 * (lane === 0 ? 1 : lane));
    // A pair of spectacles: two rims and a bridge.
    ctx.strokeStyle = "#111318";
    ctx.lineWidth = Math.max(3, w * 0.16);
    ctx.lineJoin = "round";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * w * 0.42, 0, w * 0.34, w * 0.28, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-w * 0.08, -w * 0.04);
    ctx.lineTo(w * 0.08, -w * 0.04);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-w * 0.76, -w * 0.02);
    ctx.lineTo(-w * 1.02, -w * 0.16);
    ctx.moveTo(w * 0.76, -w * 0.02);
    ctx.lineTo(w * 1.02, -w * 0.16);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  label(ctx, "FOUR EYES", alpha, width, arena, "#9fd8ff", slot);
}

/**
 * NOBODY MOVES — Bodyguard Guy.
 *
 * A ring goes out **from him** and stops whatever it reaches. The freeze is the
 * effect; the ring is how a viewer sees where it came from and who it caught.
 * It used to be a white flash over the whole frame, which is the least specific
 * thing a picture can do.
 */
function nobodyMoves(
  ctx: Ctx,
  from: Point,
  to: Point,
  age: number,
  scale: number,
  width: number,
  arena: ArenaBox,
  slot: number,
): void {
  const t = Math.min(1, age / SIGNATURE_FRAMES);
  const travel = Math.min(1, age / SIGNATURE_TRAVEL_FRAMES);
  const alpha = t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 1;
  const reach = Math.hypot(to.x - from.x, to.y - from.y);

  ctx.save();
  ctx.globalAlpha = alpha;
  // Three rings chasing each other out to exactly the victim's distance, so the
  // wave visibly *arrives* rather than washing over everything.
  for (const lag of [0, 0.18, 0.36]) {
    const p = ease(Math.max(0, Math.min(1, (travel - lag) / (1 - lag))));
    if (p <= 0) continue;
    ctx.globalAlpha = alpha * (1 - p) * (lag === 0 ? 1 : 0.55);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(4, scale * 0.06 * (1 - p * 0.6));
    ctx.beginPath();
    ctx.arc(from.x, from.y, reach * p, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // The moment it lands: a hard collar snapping shut on the victim.
  if (travel >= 1) {
    const hold = Math.min(1, (age - SIGNATURE_TRAVEL_FRAMES) / (SIGNATURE_FRAMES - SIGNATURE_TRAVEL_FRAMES));
    ctx.save();
    ctx.globalAlpha = alpha * (1 - hold * 0.5);
    ctx.strokeStyle = "#0d0d0d";
    ctx.lineWidth = Math.max(5, scale * 0.09);
    ctx.beginPath();
    ctx.arc(to.x, to.y, scale * (0.75 + hold * 0.1), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  label(ctx, "NOBODY MOVES", alpha, width, arena, "#ffffff", slot);
}

/**
 * The ability's name, held to the frame so it never runs off the edge.
 *
 * `slot` stacks simultaneous casts. The cooldowns are 5s and 6s against a 1.4s
 * animation, so two signatures overlapping is ordinary, and both names used to
 * be printed at the same spot — one video had "MAGNETIC NORTH" and "NOBODY
 * MOVES" struck through each other into unreadable pulp.
 */
function label(
  ctx: Ctx,
  text: string,
  alpha: number,
  width: number,
  arena: ArenaBox,
  colour: string,
  slot: number,
): void {
  const inner = arena.side - arena.border * 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const size = Math.round(inner * 0.058);
  const y = arena.y + arena.border + inner * 0.08 + slot * size * 1.35;
  strokedText(ctx, text, width / 2, y, size, colour, 8);
  ctx.restore();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/**
 * Draws whichever signature is playing on this frame.
 *
 * `positionOf` gives a fighter's centre on screen *this* frame, so the effect
 * tracks both ends as they keep bouncing. An ability drawn between two stale
 * positions detaches from its owner within a few frames, which is most of what
 * made these read as unattached to anybody.
 */
export function drawSignatures(
  ctx: Ctx,
  events: MatchEvent[],
  frame: number,
  arena: ArenaBox,
  size: { width: number; height: number },
  kindOf: (actorId: string) => SignatureKind | null,
  positionOf: (id: string) => Point | null,
  fighterScale: number,
): void {
  let slot = 0;
  for (const event of events) {
    if (event.type !== "signature") continue;
    const age = frame - event.frame;
    if (age < 0 || age >= SIGNATURE_FRAMES) continue;
    const kind = kindOf(event.actorId);
    if (kind === null) continue;
    const from = positionOf(event.actorId);
    const to = positionOf(event.targetId);
    if (!from || !to) continue;

    const ringColour =
      kind === "magnetic_north" ? "#ed1e2a" : kind === "haymaker" ? "#ff6a3d" : kind === "four_eyes" ? "#9fd8ff" : "#ffffff";
    casterRing(ctx, from, age, fighterScale, ringColour);
    if (kind === "magnetic_north") magneticNorth(ctx, from, to, age, fighterScale, size.width, arena, slot);
    else if (kind === "haymaker") haymaker(ctx, from, to, age, fighterScale, size.width, arena, slot);
    else if (kind === "four_eyes") fourEyes(ctx, from, to, age, fighterScale, size.width, arena, slot);
    else nobodyMoves(ctx, from, to, age, fighterScale, size.width, arena, slot);
    slot += 1;
  }
}
