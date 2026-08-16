import type { SKRSContext2D } from "@napi-rs/canvas";
import type { AbilityType, MatchEvent } from "../sim/types.js";
import { FPS } from "../sim/types.js";
import { SIGNATURE_LEAD_SECONDS, SIGNATURE_PULSE_SECONDS } from "../sim/simulate.js";
import { ABILITY_COLOURS as A } from "./gauntletTheme.js";
import { propImage } from "./photo.js";
import {
  clamp01,
  easeOut,
  firework,
  flyingSprite,
  glint,
  hash01,
  jitter,
  keyedFill,
  shardBurst,
  spikeStar,
  stripedRing,
  taper,
} from "./fx.js";

/**
 * The signature abilities.
 *
 * **Each one is a nameable object in its own colours**, which is what the
 * reference channel does and what two previous attempts here did not. See the
 * note at the top of `fx.ts` for what its abilities actually look like frame by
 * frame — real fireworks in green and orange, a fireball, red seven-segment
 * digits on a black panel, five differently coloured fret pads. Ours were rings,
 * streaks and sparks, all in one yellow, four times over.
 *
 * So: Compass Guy carries **an actual compass** and drags iron filings; the
 * Bodyguard wraps you in **hazard tape**; the Boxer lands **a comic impact
 * star**; the Glasses man's spectacles **shatter** on you.
 *
 * What stays from before, because it is the part that made them readable:
 *
 *   1. it **starts on its owner**, so the character and the effect are visibly
 *      the same thing;
 *   2. it **travels** across the arena along a line you can follow;
 *   3. it **arrives on the victim** on the exact frame the damage lands.
 *
 * The arrival is synced to `SIGNATURE_LEAD_SECONDS` from the simulation rather
 * than to a number chosen here.
 *
 * **The ability's name is not written on the frame.** No reference does that —
 * the overlay is the title and the caption and nothing else.
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
 * on the frame the nth number appears.
 */
export const GLASSES_STAGGER_FRAMES = Math.round(FPS * SIGNATURE_PULSE_SECONDS);

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
export type SignatureKind =
  | "magnetic_north"
  | "nobody_moves"
  | "haymaker"
  | "glasses_throw"
  | "four_eyes";

const TAIL_FRAMES = SIGNATURE_FRAMES - SIGNATURE_TRAVEL_FRAMES;

function phases(age: number): { travel: number; since: number; alpha: number } {
  const life = clamp01(age / SIGNATURE_FRAMES);
  return {
    travel: clamp01(age / SIGNATURE_TRAVEL_FRAMES),
    since: clamp01((age - SIGNATURE_TRAVEL_FRAMES) / TAIL_FRAMES),
    alpha: life > 0.78 ? Math.max(0, (1 - life) / 0.22) : 1,
  };
}

/**
 * MAGNETIC NORTH — Compass Guy.
 *
 * **An actual compass**, held over him: cream face, dark rim, a black tick ring
 * with the cardinals marked, and a red-and-white needle that spins down and
 * locks onto the other man. Then the arena's iron goes with it — a field of
 * small dark filings snaps round to point at him and streams across, and the
 * needle's line drags him along it.
 *
 * It was a thin yellow dial before, which is neither a compass nor anything
 * else you could put a name to.
 */
function magneticNorth(ctx: Ctx, from: Point, to: Point, age: number, scale: number, seed: string): void {
  const { travel, since, alpha } = phases(age);
  // **Held beside him, not painted over him.** The character is the
  // photograph — a dial centred on his chest at 0.62 of his height covered him
  // completely, and the one thing a viewer recognises him by was gone for the
  // whole cast. The reference's Time Traveler Guy holds his clock next to him.
  const r = scale * 0.4;
  const heading = Math.atan2(to.y - from.y, to.x - from.x);
  const locked = easeOut(travel);
  const hub = { x: from.x - Math.cos(heading) * scale * 0.5, y: from.y - scale * 0.62 };

  // The filings: a field of little dark dashes, all pointing at the compass.
  const fieldFade = alpha * (1 - since * 0.7);
  if (fieldFade > 0) {
    ctx.save();
    ctx.globalAlpha = fieldFade * 0.85;
    for (let i = 0; i < 44; i += 1) {
      const ring = 1.2 + (i % 4) * 0.62;
      const a = hash01(seed, i) * Math.PI * 2;
      const drift = easeOut(clamp01(travel * 1.2)) * scale * 0.3;
      const px = hub.x + Math.cos(a) * (scale * ring - drift);
      const py = hub.y + Math.sin(a) * (scale * ring * 0.9 - drift);
      const point = Math.atan2(hub.y - py, hub.x - px);
      const len = scale * (0.07 + hash01(seed, i + 90) * 0.09);
      taper(
        ctx,
        px - Math.cos(point) * len,
        py - Math.sin(point) * len,
        px + Math.cos(point) * len,
        py + Math.sin(point) * len,
        Math.max(2, scale * 0.014),
        Math.max(1, scale * 0.03),
        { colour: A.compassRim, alpha: 0.75 },
      );
    }
    ctx.restore();
  }

  // The instrument.
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(hub.x, hub.y);
  ctx.scale(1, 0.94);
  keyedFill(
    ctx,
    () => {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
    },
    { fill: A.compassRim, keyline: Math.max(2, r * 0.05) },
  );
  keyedFill(
    ctx,
    () => {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2);
    },
    { fill: A.compassFace },
  );

  ctx.fillStyle = A.compassRim;
  ctx.strokeStyle = A.compassRim;
  ctx.lineCap = "butt";
  for (let i = 0; i < 36; i += 1) {
    const a = (i / 36) * Math.PI * 2 - Math.PI / 2;
    const cardinal = i % 9 === 0;
    ctx.lineWidth = Math.max(1.5, r * (cardinal ? 0.055 : 0.022));
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
    ctx.lineTo(Math.cos(a) * r * (cardinal ? 0.6 : 0.7), Math.sin(a) * r * (cardinal ? 0.6 : 0.7));
    ctx.stroke();
  }

  ctx.rotate(heading + Math.PI / 2 + (1 - locked) * Math.PI * 2 * 2.5);
  for (const [dir, fill] of [[-1, A.compassNorth], [1, A.compassSouth]] as const) {
    keyedFill(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(0, r * 0.76 * dir);
        ctx.lineTo(-r * 0.12, 0);
        ctx.lineTo(r * 0.12, 0);
        ctx.closePath();
      },
      { fill, keyline: Math.max(1.5, r * 0.035) },
    );
  }
  keyedFill(
    ctx,
    () => {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.09, 0, Math.PI * 2);
    },
    { fill: A.compassRim },
  );
  ctx.restore();

  // The pull: the line the needle points along, and the victim dragged on it.
  if (travel > 0.25) {
    const p = easeOut((travel - 0.25) / 0.75);
    taper(
      ctx,
      hub.x + (to.x - hub.x) * Math.max(0, p - 0.45),
      hub.y + (to.y - hub.y) * Math.max(0, p - 0.45),
      hub.x + (to.x - hub.x) * p,
      hub.y + (to.y - hub.y) * p,
      0,
      Math.max(5, scale * 0.1),
      { colour: A.magnetPull, alpha, keyline: Math.max(2, scale * 0.012) },
    );
  }

  if (age >= SIGNATURE_TRAVEL_FRAMES) {
    spikeStar(ctx, to.x, to.y, {
      radius: scale * (0.3 + easeOut(Math.min(1, since * 3)) * 0.4),
      points: 9,
      inner: 0.5,
      rotation: heading,
      bands: [A.magnetPull, A.compassSouth, A.compassFace],
      seed,
      alpha: alpha * Math.max(0, 1 - since * 1.3),
      keyline: Math.max(2, scale * 0.02),
    });
  }
}

/**
 * HAYMAKER — Boxer Guy.
 *
 * He closes the distance himself and lands **a comic impact star** — the shape
 * the reference draws over a fighter on a big hit, filled in bands from orange
 * through amber to a pale core and keylined black, with speed dashes flying on
 * the way the punch was going. It is the biggest thing in the video, because his
 * is the biggest number in the video.
 */
function haymaker(ctx: Ctx, from: Point, to: Point, age: number, scale: number, seed: string): void {
  const { travel, since, alpha } = phases(age);
  const heading = Math.atan2(to.y - from.y, to.x - from.x);
  const back = heading + Math.PI;

  if (travel < 1) {
    // The crossing: heavy tapered streaks off him, because it is the man moving.
    const reach = scale * (0.7 + easeOut(travel) * 2);
    for (const lane of [-0.62, 0, 0.62]) {
      const ox = Math.cos(back + Math.PI / 2) * scale * 0.3 * lane;
      const oy = Math.sin(back + Math.PI / 2) * scale * 0.3 * lane;
      const len = reach * (lane === 0 ? 1 : 0.6);
      taper(
        ctx,
        from.x + ox + Math.cos(back) * scale * 0.3,
        from.y + oy + Math.sin(back) * scale * 0.3,
        from.x + ox + Math.cos(back) * len,
        from.y + oy + Math.sin(back) * len,
        Math.max(6, scale * (lane === 0 ? 0.13 : 0.08)),
        0,
        { colour: A.impactMid, alpha: alpha * (1 - travel * 0.25), keyline: Math.max(2, scale * 0.012) },
      );
    }
    return;
  }

  const grow = easeOut(Math.min(1, since * 2.4));
  const fade = alpha * Math.max(0, 1 - since * 1.25);
  if (fade <= 0) return;

  spikeStar(ctx, to.x, to.y, {
    radius: scale * (0.55 + grow * 0.75),
    points: 12,
    inner: 0.46,
    rotation: heading + since * 0.5,
    bands: [A.impactOuter, A.impactMid, A.impactCore],
    seed,
    alpha: fade,
    keyline: Math.max(3, scale * 0.028),
  });

  // Debris carrying on the way the punch was going — never radial.
  for (let i = 0; i < 5; i += 1) {
    const a = heading + jitter(seed, i, 0.6);
    const near = scale * (0.6 + grow * 0.5);
    const far = near + scale * (0.4 + hash01(seed, i + 30) * 0.7) * grow;
    taper(
      ctx,
      to.x + Math.cos(a) * near,
      to.y + Math.sin(a) * near,
      to.x + Math.cos(a) * far,
      to.y + Math.sin(a) * far,
      Math.max(4, scale * 0.045),
      0,
      { colour: A.impactMid, alpha: fade, keyline: Math.max(1.5, scale * 0.01) },
    );
  }
}

/**
 * NOBODY MOVES — Bodyguard Guy.
 *
 * He cordons you off: **hazard tape** swings shut around the other man in a red
 * and white band, and holds. A picture can say "this one is not going anywhere"
 * in a single frame with tape; it cannot with a thin ring, which is what this
 * was.
 */
function nobodyMoves(ctx: Ctx, from: Point, to: Point, age: number, scale: number, seed: string): void {
  const { travel, since, alpha } = phases(age);
  const reach = Math.hypot(to.x - from.x, to.y - from.y);

  // A tape line paying out from him toward the other man.
  if (travel < 1) {
    const p = easeOut(travel);
    stripedRing(ctx, from.x, from.y, {
      rx: reach * p,
      ry: reach * p * 0.7,
      band: Math.max(9, scale * 0.11) * (1 - p * 0.35),
      stripes: 12,
      phase: 0,
      colours: [A.tapeRed, A.tapeWhite],
      alpha: alpha * Math.max(0.35, 1 - p * 0.75),
    });
    return;
  }

  const shut = easeOut(Math.min(1, since * 3.2));
  const fade = alpha * Math.max(0, 1 - since * 0.55);
  stripedRing(ctx, to.x, to.y, {
    rx: scale * 0.62,
    ry: scale * 0.74,
    band: Math.max(8, scale * 0.13),
    stripes: 9,
    phase: Math.floor(since * 6) % 2,
    colours: [A.tapeRed, A.tapeWhite],
    alpha: fade,
    sweep: shut,
  });
  void seed;
}

/**
 * The thrown spectacles — the whole of Glasses Guy's fight.
 *
 * **He never touches anybody**; every point he takes off the other man arrives
 * on a pair of glasses. So the prop flies with motion blur down its own streak
 * and **shatters** on him: hard-edged glass shards flying on in the direction of
 * the throw, a spray of finer glass behind them, and a glint at the point of
 * impact. Cold white and cyan, against the boxer's hot orange.
 *
 * `count` is rolled in the simulation and carried on the event, so exactly as
 * many pairs fly as numbers land, and `index` staggers them by the same gap the
 * pulses are scheduled at.
 */
function glassesVolley(
  ctx: Ctx,
  from: Point,
  to: Point,
  age: number,
  scale: number,
  seed: string,
  count: number,
): void {
  const sprite = propImage("glasses");
  const thrown = Math.max(1, Math.min(6, Math.round(count)));
  const heading = Math.atan2(to.y - from.y, to.x - from.x);
  const across = heading + Math.PI / 2;
  const gw = scale * 0.62;
  const gh = (gw * sprite.height) / sprite.width;
  const dx = Math.cos(heading);
  const dy = Math.sin(heading);

  for (let i = 0; i < thrown; i += 1) {
    const local = age - i * GLASSES_STAGGER_FRAMES;
    if (local < 0) continue;
    const travel = local / SIGNATURE_TRAVEL_FRAMES;
    const pairSeed = `${seed}:${i}`;

    if (travel <= 1) {
      const p = easeOut(travel);
      // Lanes fan out from the middle — -1, +1, -2, +2 — so an odd count is
      // centred and an even one symmetric, bowing out at the midpoint where
      // there is room and closing again on the target.
      const lane = thrown === 1 ? 0 : (Math.floor(i / 2) + 1) * (i % 2 === 0 ? -1 : 1);
      const spread = Math.sin(p * Math.PI) * scale * 0.36 * lane;
      flyingSprite(ctx, sprite, {
        x: from.x + (to.x - from.x) * p + Math.cos(across) * spread,
        y: from.y + (to.y - from.y) * p + Math.sin(across) * spread,
        dx,
        dy,
        width: gw,
        height: gh,
        rotation: heading + travel * Math.PI * 3.2 * (lane === 0 ? 1 : Math.sign(lane)),
        alpha: 1,
        trail: scale * 0.42,
        colour: A.glassEdge,
      });
      continue;
    }

    const since = clamp01((local - SIGNATURE_TRAVEL_FRAMES) / TAIL_FRAMES);
    const fade = Math.max(0, 1 - since * 1.2);
    if (fade <= 0) continue;

    // The break: big shards in the throw's direction, fine glass behind them.
    shardBurst(ctx, to.x, to.y, {
      t: since,
      reach: scale * 1.15,
      count: 11,
      size: scale * 0.16,
      heading,
      spread: 0.75,
      seed: pairSeed,
      colours: [A.glassEdge, A.glassFacet],
    });
    firework(ctx, to.x, to.y, {
      t: since,
      reach: scale * 0.9,
      trails: 22,
      perTrail: 5,
      colours: [A.glassFacet, A.glassEdge],
      seed: pairSeed,
      spread: 1.0,
      heading,
      dot: scale * 0.03,
      gravity: 0.5,
    });
    const flash = Math.max(0, 1 - since * 4);
    if (flash > 0) {
      glint(ctx, to.x, to.y, {
        radius: scale * 0.5 * flash,
        alpha: flash,
        colour: A.glassFacet,
        rotation: heading,
      });
    }
  }
}

/**
 * Draws whichever signature is playing on this frame.
 *
 * `positionOf` gives a fighter's centre on screen *this* frame, so the effect
 * tracks both ends as they keep bouncing.
 */
export function drawSignatures(
  ctx: Ctx,
  events: MatchEvent[],
  frame: number,
  arena: ArenaBox,
  kindOf: (event: MatchEvent) => SignatureKind | null,
  positionOf: (id: string) => Point | null,
  fighterScale: number,
): void {
  // **Everything an ability draws stays inside the arena.** In the reference
  // nothing belonging to the fight is drawn on the flat blue outside the square.
  // The only thing allowed out is the HP plus, which the reference lets poke
  // over the top wall too.
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
    const kind = kindOf(event);
    if (kind === null) continue;
    const from = positionOf(event.actorId);
    const to = positionOf(event.targetId);
    if (!from || !to) continue;

    const seed = `${event.frame}:${event.actorId}:${kind}`;
    if (kind === "magnetic_north") magneticNorth(ctx, from, to, age, fighterScale, seed);
    else if (kind === "haymaker") haymaker(ctx, from, to, age, fighterScale, seed);
    else if (kind === "glasses_throw") glassesVolley(ctx, from, to, age, fighterScale, seed, 1);
    else if (kind === "four_eyes") glassesVolley(ctx, from, to, age, fighterScale, seed, event.value);
    else nobodyMoves(ctx, from, to, age, fighterScale, seed);
  }
  ctx.restore();
}

/** Ability types that draw a signature effect. */
export const SIGNATURE_KINDS = new Set<AbilityType>([
  "magnetic_north",
  "nobody_moves",
  "haymaker",
  "glasses_throw",
  "four_eyes",
]);
