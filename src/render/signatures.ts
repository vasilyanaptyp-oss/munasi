import type { SKRSContext2D } from "@napi-rs/canvas";
import type { MatchEvent } from "../sim/types.js";
import { FPS } from "../sim/types.js";
import { SIGNATURE_LEAD_SECONDS, SIGNATURE_PULSE_SECONDS } from "../sim/simulate.js";
import { GAUNTLET_COLORS as C } from "./gauntletTheme.js";
import { propImage } from "./photo.js";


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
 *
 * **The ability's name is not written on the frame.** It used to print
 * "HAYMAKER" and the rest across the top of the arena while the effect played.
 * No reference does that — the overlay is the title and the caption and nothing
 * else — and on our own last frames it was the worst thing in the shot: faded
 * yellow at low alpha over the blue field goes olive, and it landed on the
 * winner's HP plus. The three-step shape above is what says who is attacking
 * whom; a caption on top of it was never doing that work.
 */

type Ctx = SKRSContext2D;

/** Frames each effect plays for. */
export const SIGNATURE_FRAMES = Math.round(FPS * 1.4);
/** Frames from the cast to the moment it bites. Matched to the simulation. */
export const SIGNATURE_TRAVEL_FRAMES = Math.round(FPS * SIGNATURE_LEAD_SECONDS);
/**
 * Frames between one thrown pair of glasses and the next.
 *
 * The same gap the simulation spaces a cast's pulses at, so the nth pair lands
 * on the frame the nth number appears. Drifting apart here is the difference
 * between a volley and a decoration.
 */
export const FOUR_EYES_STAGGER_FRAMES = Math.round(FPS * SIGNATURE_PULSE_SECONDS);

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
  for (const [dir, colour] of [[1, C.damageText], [-1, "#ffffff"]] as const) {
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
    grad.addColorStop(0, "rgba(255,239,77,0)");
    grad.addColorStop(1, C.damageText);
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

}


/**
 * HAYMAKER — Boxer Guy.
 *
 * **He does not throw anything.** He is a boxer: he closes the distance and
 * hits you from in range. The simulation dashes him at the other man for
 * exactly the lead time, so this draws the charge and then the punch landing.
 *
 * It used to draw the charge and stop there — a thin trail streaming off him
 * and nothing at the far end, so the biggest hit in the video arrived as three
 * small scuffs identical to the ones a bump gives you. There was no punch on
 * screen. Now the arrival is its own event: a shockwave arc across the victim,
 * facing back at the man who threw it, and a fan of heavy strokes carrying on
 * **in the punch's direction**.
 *
 * One-sided on purpose. Anything that radiates evenly from a centre reads as a
 * cartoon sun — that mistake has been made here once already — and a punch is
 * not symmetric anyway: it comes from somewhere and it sends you somewhere.
 */
function haymaker(
  ctx: Ctx,
  from: Point,
  to: Point,
  age: number,
  scale: number,
): void {
  const t = Math.min(1, age / SIGNATURE_FRAMES);
  const travel = Math.min(1, age / SIGNATURE_TRAVEL_FRAMES);
  const alpha = t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 1;
  const heading = Math.atan2(to.y - from.y, to.x - from.x);
  const back = heading + Math.PI;

  // The charge: a trail streaming off him, because it is the man that moved.
  if (travel < 1) {
    ctx.save();
    ctx.globalAlpha = alpha * (1 - travel * 0.35);
    ctx.lineCap = "round";
    ctx.strokeStyle = C.damageText;
    ctx.lineWidth = Math.max(5, scale * 0.05);
    const reach = scale * (0.8 + travel * 1.4);
    for (const off of [-0.55, 0, 0.55]) {
      const nx = Math.cos(back + Math.PI / 2) * scale * 0.32 * off;
      const ny = Math.sin(back + Math.PI / 2) * scale * 0.32 * off;
      const len = reach * (off === 0 ? 1 : 0.65);
      ctx.beginPath();
      ctx.moveTo(from.x + nx + Math.cos(back) * scale * 0.35, from.y + ny + Math.sin(back) * scale * 0.35);
      ctx.lineTo(from.x + nx + Math.cos(back) * len, from.y + ny + Math.sin(back) * len);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // The punch. Runs for the third of a second after it lands, over the frames
  // where the number is already climbing off the victim.
  const since = (age - SIGNATURE_TRAVEL_FRAMES) / (SIGNATURE_FRAMES - SIGNATURE_TRAVEL_FRAMES);
  const grow = Math.min(1, since * 3.2);
  ctx.save();
  ctx.globalAlpha = alpha * Math.max(0, 1 - since);
  ctx.translate(to.x, to.y);
  ctx.rotate(heading);
  ctx.lineCap = "round";
  ctx.strokeStyle = C.damageText;

  // Shockwave: an arc across the victim, opening back toward the boxer.
  ctx.lineWidth = Math.max(6, scale * 0.09) * (1 - since * 0.6);
  ctx.beginPath();
  ctx.arc(0, 0, scale * (0.32 + grow * 0.45), Math.PI * 0.62, Math.PI * 1.38);
  ctx.stroke();

  // And the follow-through, carrying on the way the punch was going.
  ctx.lineWidth = Math.max(4, scale * 0.055);
  for (const [spread, len] of [[-0.34, 0.9], [0, 1.15], [0.34, 0.78]] as const) {
    const a = spread;
    const near = scale * (0.34 + grow * 0.3);
    const far = near + scale * len * grow * 0.7;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * near, Math.sin(a) * near);
    ctx.lineTo(Math.cos(a) * far, Math.sin(a) * far);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * FOUR EYES — Glasses Guy.
 *
 * **He throws two to four pairs, and the count is the point.** The number is
 * rolled in the simulation and carried on the event, so what flies across the
 * arena is exactly what comes off the health bar — you can count the glasses
 * and count the numbers and get the same answer.
 *
 * They leave together and land one after another, spaced by the same gap the
 * simulation schedules its pulses at, each on its own lane. Before this they
 * were always three, always arriving on the same frame, and the damage behind
 * them was a single lump: the picture and the fight were telling different
 * stories.
 */
function fourEyes(
  ctx: Ctx,
  from: Point,
  to: Point,
  age: number,
  scale: number,
  count: number,
): void {
  const t = Math.min(1, age / SIGNATURE_FRAMES);
  const alpha = t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 1;
  const heading = Math.atan2(to.y - from.y, to.x - from.x);
  const across = heading + Math.PI / 2;
  const sprite = propImage("glasses");
  const gw = scale * 0.62;
  const gh = (gw * sprite.height) / sprite.width;
  const thrown = Math.max(1, Math.min(6, Math.round(count)));

  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < thrown; i += 1) {
    // Each pair is on the road for the lead time, starting `i` gaps late — the
    // same schedule the pulses land on.
    const travel = (age - i * FOUR_EYES_STAGGER_FRAMES) / SIGNATURE_TRAVEL_FRAMES;
    if (travel < 0 || travel > 1) continue;
    const p = ease(travel);
    // Lanes fan out from the middle: -1, 1, -2, 2 ... so an odd count is
    // centred and an even one is symmetric.
    const lane = (Math.floor(i / 2) + 1) * (i % 2 === 0 ? -1 : 1) * (thrown === 1 ? 0 : 1);
    const spread = Math.sin(p * Math.PI) * scale * 0.34 * lane;
    const cx = from.x + (to.x - from.x) * p + Math.cos(across) * spread;
    const cy = from.y + (to.y - from.y) * p + Math.sin(across) * spread;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(heading + travel * Math.PI * 4 * (lane === 0 ? 1 : Math.sign(lane)));
    ctx.drawImage(sprite, -gw / 2, -gh / 2, gw, gh);
    ctx.restore();
  }
  ctx.restore();
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
): void {
  const t = Math.min(1, age / SIGNATURE_FRAMES);
  const travel = Math.min(1, age / SIGNATURE_TRAVEL_FRAMES);
  const alpha = t > 0.7 ? Math.max(0, (1 - t) / 0.3) : 1;
  const reach = Math.hypot(to.x - from.x, to.y - from.y);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  // **One thin ring, in the same yellow as everything else.**
  //
  // This drew three white rings racing out to the victim's distance and then a
  // near-black collar around him, both scaled off that distance — so when the
  // pair was far apart the screen filled with enormous dark circles that read as
  // damage to the video rather than as an ability. Sized to the fighter now, not
  // to the gap, and hairline rather than a band.
  ctx.strokeStyle = C.damageText;
  for (const lag of [0, 0.22]) {
    const p = ease(Math.max(0, Math.min(1, (travel - lag) / (1 - lag))));
    if (p <= 0) continue;
    ctx.globalAlpha = alpha * (1 - p) * (lag === 0 ? 0.9 : 0.45);
    ctx.lineWidth = Math.max(3, scale * 0.022);
    ctx.beginPath();
    ctx.arc(from.x, from.y, reach * p, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // The moment it lands: a ring closing on the victim, sized to him.
  if (travel >= 1) {
    const hold = Math.min(1, (age - SIGNATURE_TRAVEL_FRAMES) / (SIGNATURE_FRAMES - SIGNATURE_TRAVEL_FRAMES));
    ctx.save();
    ctx.globalAlpha = alpha * (1 - hold * 0.6);
    ctx.strokeStyle = C.damageText;
    ctx.lineWidth = Math.max(3, scale * 0.03);
    ctx.beginPath();
    ctx.arc(to.x, to.y, scale * (0.62 - hold * 0.08), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

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
  kindOf: (actorId: string) => SignatureKind | null,
  positionOf: (id: string) => Point | null,
  fighterScale: number,
): void {
  // **Everything an ability draws stays inside the arena.**
  //
  // The square is the fight's container: in the reference nothing belonging to
  // the fight is ever drawn on the flat blue outside it — the note track, the
  // pads and every effect are inside the walls. Ours were not clipped, so a
  // haymaker aimed at a fighter near the top wall trailed a line up across the
  // blue and over the title, and a caster ring drawn on someone by the edge
  // spilled out into the margin. The only thing allowed out is the HP plus,
  // which the reference lets poke over the top wall too.
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    arena.x + arena.border,
    arena.y + arena.border,
    arena.side - arena.border * 2,
    arena.side - arena.border * 2,
  );
  ctx.clip();

  for (const event of events) {
    if (event.type !== "signature") continue;
    const age = frame - event.frame;
    if (age < 0 || age >= SIGNATURE_FRAMES) continue;
    const kind = kindOf(event.actorId);
    if (kind === null) continue;
    const from = positionOf(event.actorId);
    const to = positionOf(event.targetId);
    if (!from || !to) continue;

    // One colour for the whole hit language — wind-up, effect, impact and
    // number. Four abilities in four colours plus a red impact mark and an
    // orange telegraph made a frame no viewer could parse.
    casterRing(ctx, from, age, fighterScale, C.damageText);
    if (kind === "magnetic_north") magneticNorth(ctx, from, to, age, fighterScale);
    else if (kind === "haymaker") haymaker(ctx, from, to, age, fighterScale);
    else if (kind === "four_eyes") fourEyes(ctx, from, to, age, fighterScale, event.value);
    else nobodyMoves(ctx, from, to, age, fighterScale);
  }
  ctx.restore();
}
