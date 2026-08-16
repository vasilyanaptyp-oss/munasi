import type { SKRSContext2D } from "@napi-rs/canvas";
import type { AbilityType, MatchEvent } from "../sim/types.js";
import { FPS } from "../sim/types.js";
import { SIGNATURE_LEAD_SECONDS, SIGNATURE_PULSE_SECONDS } from "../sim/simulate.js";
import { GAUNTLET_COLORS as C } from "./gauntletTheme.js";
import { propImage } from "./photo.js";
import {
  casterCharge,
  clamp01,
  easeOut,
  FX_CORE,
  glowStroke,
  hash01,
  jitter,
  keyedFill,
  flyingSprite,
  shockRing,
  sparkCone,
  taper,
} from "./fx.js";

/**
 * The signature abilities.
 *
 * **An ability has to show who is attacking and what is hitting whom.** All four
 * are built on the same three beats, which is how the reference builds its one:
 *
 *   1. it **starts on its owner** — `casterCharge` gathers on the caster, so the
 *      character and the effect are visibly the same thing;
 *   2. it **travels** across the arena, in view, along a line you can follow;
 *   3. it **arrives on the victim** on the exact frame the damage lands, where
 *      the number is already climbing off them.
 *
 * The arrival is synced to `SIGNATURE_LEAD_SECONDS` from the simulation rather
 * than to a number chosen here. If the two drift apart the effect lands before
 * or after the health drops, and the ability goes back to being decoration that
 * happens near a fight.
 *
 * **They are drawn, not sketched.** See `fx.ts` for the parts every one of them
 * is assembled from — halo under core, dark keyline on solids, tapered streaks,
 * squashed shockwaves, directional debris. Before that each of these was a
 * couple of flat one-width strokes written inline, and they looked it.
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
 * on the frame the nth number appears. Drifting apart here is the difference
 * between a volley and a decoration.
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

const SIGNATURE_TAIL_FRAMES = SIGNATURE_FRAMES - SIGNATURE_TRAVEL_FRAMES;

/** Common timings: 0..1 through the whole effect, and 0..1 to the moment it bites. */
function phases(age: number): { life: number; travel: number; since: number; alpha: number } {
  const life = clamp01(age / SIGNATURE_FRAMES);
  return {
    life,
    travel: clamp01(age / SIGNATURE_TRAVEL_FRAMES),
    since: clamp01((age - SIGNATURE_TRAVEL_FRAMES) / SIGNATURE_TAIL_FRAMES),
    // Full brightness until the last third, then out.
    alpha: life > 0.7 ? Math.max(0, (1 - life) / 0.3) : 1,
  };
}

/**
 * What every one of these lands with: a shockwave squashed along the line it
 * came in on, a white core flash at the point of contact, and debris carrying on
 * the way the blow was going.
 *
 * One shared arrival means a viewer learns the language once. The size is the
 * only thing that differs, and it is how a haymaker reads as heavier than a
 * thrown pair of spectacles without needing a second colour.
 */
function arrival(
  ctx: Ctx,
  at: Point,
  heading: number,
  since: number,
  scale: number,
  seed: string,
  weight: number,
): void {
  const grow = easeOut(Math.min(1, since * 2.6));
  const fade = Math.max(0, 1 - since * 1.15);
  if (fade <= 0) return;

  // **Compact.** Sized to the blow, not to the man: at the first attempt this
  // was a hoop taller than the fighter, wrapped round him for a third of a
  // second, and it hid the number instead of pointing at it.
  shockRing(ctx, at.x, at.y, heading, scale * weight * (0.16 + grow * 0.38), {
    squash: 0.42,
    width: Math.max(3, scale * 0.038 * weight) * (1 - grow * 0.55),
    alpha: fade * 0.9,
    echoes: 1,
  });

  // The white flash at the point of contact, gone in a few frames.
  const flash = Math.max(0, 1 - since * 5);
  if (flash > 0) {
    keyedFill(
      ctx,
      () => {
        ctx.beginPath();
        ctx.ellipse(at.x, at.y, scale * 0.1 * weight * flash, scale * 0.13 * weight * flash, heading, 0, Math.PI * 2);
      },
      { fill: FX_CORE, alpha: flash, keyline: 0 },
    );
  }

  sparkCone(ctx, at.x, at.y, heading, {
    spread: 0.5,
    count: Math.round(2 + weight * 2),
    near: scale * 0.16 * weight,
    far: scale * (0.34 + grow * 0.6) * weight,
    width: Math.max(2.5, scale * 0.028 * weight),
    alpha: fade * 0.9,
    seed,
  });
}

/**
 * MAGNETIC NORTH — Compass Guy.
 *
 * The rose is **on him**, drawn as an instrument rather than as a circle: a dark
 * dial with a bright rim, ticks in three weights, and a needle with a keyline,
 * the whole thing squashed so it lies on him instead of floating flat against
 * the screen. The needle spins down and locks onto the other man, and the charge
 * runs out along the line it is pointing.
 *
 * Needle points at you, bolt arrives, your health drops.
 */
function magneticNorth(ctx: Ctx, from: Point, to: Point, age: number, scale: number, seed: string): void {
  const { travel, since, alpha } = phases(age);
  const radius = scale * 0.66;
  const heading = Math.atan2(to.y - from.y, to.x - from.x);
  const locked = easeOut(travel);

  // --- the dial, on him ---
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(from.x, from.y);
  ctx.scale(1, 0.78);

  keyedFill(
    ctx,
    () => {
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
    },
    // Faint: the character is the photograph, and a dial that blacks him out
    // has covered the only thing a viewer recognises him by.
    { fill: "rgba(8,20,26,0.28)", alpha: alpha * 0.8, keyline: 0 },
  );
  glowStroke(
    ctx,
    () => {
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
    },
    { width: Math.max(3, radius * 0.055), alpha: alpha * 0.95, core: 0.28 },
  );
  glowStroke(
    ctx,
    () => {
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.7, 0, Math.PI * 2);
    },
    { width: Math.max(2, radius * 0.022), alpha: alpha * 0.5, halo: 2 },
  );

  ctx.strokeStyle = C.damageText;
  ctx.lineCap = "butt";
  for (let i = 0; i < 32; i += 1) {
    const a = (i / 32) * Math.PI * 2;
    const rank = i % 8 === 0 ? 0 : i % 4 === 0 ? 1 : 2;
    const len = [0.3, 0.19, 0.1][rank]!;
    ctx.globalAlpha = alpha * [1, 0.8, 0.55][rank]!;
    ctx.lineWidth = Math.max(1.5, radius * [0.06, 0.04, 0.025][rank]!);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * radius * 0.94, Math.sin(a) * radius * 0.94);
    ctx.lineTo(Math.cos(a) * radius * (0.94 - len), Math.sin(a) * radius * (0.94 - len));
    ctx.stroke();
  }

  // The needle: two blades, the bright one leading.
  ctx.rotate(heading + (1 - locked) * Math.PI * 2 * 2.5);
  const len = radius * 0.86;
  for (const [dir, fill] of [[1, C.damageText], [-1, "#dfe7ea"]] as const) {
    keyedFill(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(len * dir, 0);
        ctx.lineTo(-len * 0.06 * dir, -radius * 0.13);
        ctx.lineTo(-len * 0.06 * dir, radius * 0.13);
        ctx.closePath();
      },
      { fill, alpha, keyline: Math.max(2, radius * 0.03) },
    );
  }
  ctx.restore();

  // --- the charge, running out along the needle ---
  if (travel > 0.22) {
    const p = easeOut((travel - 0.22) / 0.78);
    const bx = from.x + (to.x - from.x) * p;
    const by = from.y + (to.y - from.y) * p;
    const tail = 0.3;
    const sx = from.x + (to.x - from.x) * Math.max(0, p - tail);
    const sy = from.y + (to.y - from.y) * Math.max(0, p - tail);

    // A bolt, not a ruled line: three seeded kinks off the straight run.
    const nx = Math.cos(heading + Math.PI / 2);
    const ny = Math.sin(heading + Math.PI / 2);
    const kink = (k: number): Point => {
      const off = jitter(seed, k, scale * 0.13) * Math.sin(k * 0.9);
      return {
        x: sx + (bx - sx) * (k / 4) + nx * off,
        y: sy + (by - sy) * (k / 4) + ny * off,
      };
    };
    const points = [0, 1, 2, 3, 4].map(kink);
    glowStroke(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(points[0]!.x, points[0]!.y);
        for (const pt of points.slice(1)) ctx.lineTo(pt.x, pt.y);
      },
      { width: Math.max(5, scale * 0.062), alpha, core: 0.32 },
    );

    keyedFill(
      ctx,
      () => {
        ctx.beginPath();
        ctx.ellipse(bx, by, scale * 0.075, scale * 0.055, heading, 0, Math.PI * 2);
      },
      { fill: FX_CORE, alpha, keyline: 0 },
    );
  }

  if (age >= SIGNATURE_TRAVEL_FRAMES) arrival(ctx, to, heading, since, scale, seed, 1.05);
}

/**
 * HAYMAKER — Boxer Guy.
 *
 * **He does not throw anything.** He closes the distance and hits you from in
 * range; the simulation dashes him at the other man for exactly the lead time.
 * So this is three beats of one punch: he coils, he crosses, it lands.
 *
 * The landing is the biggest arrival in the video, because his is the biggest
 * number in the video. It used to draw the charge and nothing at the far end, so
 * the hardest hit arrived as three scuffs identical to a bump.
 */
function haymaker(ctx: Ctx, from: Point, to: Point, age: number, scale: number, seed: string): void {
  const { travel, since, alpha } = phases(age);
  const heading = Math.atan2(to.y - from.y, to.x - from.x);
  const back = heading + Math.PI;

  if (travel < 1) {
    // The crossing: streaks off him, tapering out behind, so it is the man that
    // moved rather than something leaving him.
    const reach = scale * (0.7 + easeOut(travel) * 1.9);
    for (const lane of [-0.62, 0, 0.62]) {
      const ox = Math.cos(back + Math.PI / 2) * scale * 0.3 * lane;
      const oy = Math.sin(back + Math.PI / 2) * scale * 0.3 * lane;
      const len = reach * (lane === 0 ? 1 : 0.62);
      taper(
        ctx,
        from.x + ox + Math.cos(back) * scale * 0.3,
        from.y + oy + Math.sin(back) * scale * 0.3,
        from.x + ox + Math.cos(back) * len,
        from.y + oy + Math.sin(back) * len,
        Math.max(5, scale * (lane === 0 ? 0.1 : 0.06)),
        Math.max(1, scale * 0.01),
        { alpha: alpha * (1 - travel * 0.3) },
      );
    }
    // And a wound-up arc behind the fist, aimed the way he is going.
    glowStroke(
      ctx,
      () => {
        ctx.beginPath();
        ctx.arc(from.x, from.y, scale * (0.5 + travel * 0.2), back - 0.9, back + 0.9);
      },
      { width: Math.max(4, scale * 0.05 * (1 - travel * 0.4)), alpha: alpha * (1 - travel) * 0.9, core: 0.3 },
    );
    return;
  }

  arrival(ctx, to, heading, since, scale, seed, 1.75);

  // Two crack lines through the point of contact, offset from centre so nothing
  // is symmetric enough to resolve into a star.
  const fade = Math.max(0, 1 - since * 1.4);
  if (fade > 0) {
    for (const [along, across, len] of [[-0.1, -0.42, 1.05], [0.24, 0.36, 0.8]] as const) {
      const ax = to.x + Math.cos(heading) * scale * along - Math.sin(heading) * scale * across;
      const ay = to.y + Math.sin(heading) * scale * along + Math.cos(heading) * scale * across;
      const grow = easeOut(Math.min(1, since * 3));
      taper(
        ctx,
        ax,
        ay,
        ax + Math.cos(heading) * scale * len * grow,
        ay + Math.sin(heading) * scale * len * grow,
        Math.max(4, scale * 0.05),
        Math.max(1, scale * 0.008),
        { alpha: fade * 0.85 },
      );
    }
  }
}

/**
 * NOBODY MOVES — Bodyguard Guy.
 *
 * A wave goes out **from him**, reaches the other man and closes on him as a
 * clamp: two arcs swinging shut, a flash where they meet, then a held ring with
 * four short rivets. The freeze is the effect; this is how a viewer sees where
 * it came from and who it caught.
 *
 * It used to be three white rings scaled off the distance between the pair, so
 * when they were far apart the screen filled with enormous dark circles.
 */
function nobodyMoves(ctx: Ctx, from: Point, to: Point, age: number, scale: number, seed: string): void {
  const { travel, since, alpha } = phases(age);
  const reach = Math.hypot(to.x - from.x, to.y - from.y);
  const heading = Math.atan2(to.y - from.y, to.x - from.x);

  // The wave, squashed so it reads as travelling across the floor of the arena.
  for (const lag of [0, 0.18, 0.34]) {
    const p = easeOut(clamp01((travel - lag) / (1 - lag)));
    if (p <= 0) continue;
    glowStroke(
      ctx,
      () => {
        ctx.beginPath();
        ctx.ellipse(from.x, from.y, reach * p, reach * p * 0.72, 0, 0, Math.PI * 2);
      },
      {
        width: Math.max(2.5, scale * 0.028 * (1 - p * 0.5)),
        alpha: alpha * (1 - p) * (lag === 0 ? 1 : 0.35),
        halo: lag === 0 ? 3.4 : 2,
      },
    );
  }

  if (travel < 1) return;

  // The clamp: two arcs swinging shut around him.
  const shut = easeOut(Math.min(1, since * 3.4));
  const gap = (1 - shut) * 1.15;
  const radius = scale * 0.66;
  for (const side of [0, Math.PI]) {
    glowStroke(
      ctx,
      () => {
        ctx.beginPath();
        ctx.ellipse(to.x, to.y, radius * 0.86, radius, 0, side + gap, side + Math.PI - gap);
      },
      { width: Math.max(4, scale * 0.045), alpha: alpha * 0.95, core: 0.28 },
    );
  }

  // Where they meet, and the rivets holding him.
  const snap = Math.max(0, 1 - Math.abs(shut - 1) * 6 - since * 1.2);
  if (snap > 0) {
    for (const side of [0, Math.PI]) {
      keyedFill(
        ctx,
        () => {
          ctx.beginPath();
          ctx.arc(to.x + Math.cos(side) * radius * 0.86, to.y + Math.sin(side) * radius, scale * 0.07 * snap, 0, Math.PI * 2);
        },
        { fill: FX_CORE, alpha: snap, keyline: 0 },
      );
    }
  }
  if (shut >= 1) {
    for (let i = 0; i < 4; i += 1) {
      const a = heading + Math.PI / 4 + (i / 4) * Math.PI * 2;
      taper(
        ctx,
        to.x + Math.cos(a) * radius * 0.86,
        to.y + Math.sin(a) * radius,
        to.x + Math.cos(a) * radius * 1.05,
        to.y + Math.sin(a) * radius * 1.2,
        Math.max(3, scale * 0.035),
        Math.max(2, scale * 0.02),
        { alpha: alpha * 0.7 * (1 - since * 0.5) },
      );
    }
  }
  void seed;
}

/**
 * The thrown pair of spectacles — the whole of Glasses Guy's fight.
 *
 * **He never touches anybody.** His contact damage is zero and his hands do
 * nothing; every point he takes off the other man arrives on a pair of glasses.
 * So this is the effect that has to carry a character on its own, and it gets
 * the full treatment: the prop spins with motion blur down a tapered streak,
 * lands with the shared arrival, and **shatters** — four shards carrying on the
 * way it was thrown.
 *
 * `index` staggers a pair inside a volley by the same gap the simulation spaces
 * its pulses at, so the nth pair lands on the frame the nth number appears.
 * `count` is rolled in the simulation and carried on the event: what flies is
 * exactly what comes off the health bar, and a viewer can count both.
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
  const gw = scale * 0.5;
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
      // centred and an even one is symmetric, and they bow out at the midpoint
      // where there is room and close again on the target.
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
        spin: 0.5,
        alpha: 1,
        trail: scale * 0.42,
      });
      continue;
    }

    const since = clamp01((local - SIGNATURE_TRAVEL_FRAMES) / SIGNATURE_TAIL_FRAMES);
    arrival(ctx, to, heading, since, scale, pairSeed, 0.8);

    // Shattered: four shards going on the way it was thrown.
    const fade = Math.max(0, 1 - since * 1.6);
    if (fade <= 0) continue;
    const grow = easeOut(Math.min(1, since * 3));
    for (let s = 0; s < 4; s += 1) {
      const a = heading + jitter(pairSeed, s + 5, 0.85);
      const near = scale * (0.16 + hash01(pairSeed, s) * 0.12);
      const far = near + scale * (0.3 + hash01(pairSeed, s + 9) * 0.45) * grow;
      taper(
        ctx,
        to.x + Math.cos(a) * near,
        to.y + Math.sin(a) * near,
        to.x + Math.cos(a) * far,
        to.y + Math.sin(a) * far,
        Math.max(2.5, scale * 0.03),
        Math.max(1, scale * 0.006),
        { alpha: fade * 0.9, colour: "#dfe7ea" },
      );
    }
  }
}

/**
 * Draws whichever signature is playing on this frame.
 *
 * `positionOf` gives a fighter's centre on screen *this* frame, so the effect
 * tracks both ends as they keep bouncing. An ability drawn between two stale
 * positions detaches from its owner within a few frames.
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
  // **Everything an ability draws stays inside the arena.**
  //
  // The square is the fight's container: in the reference nothing belonging to
  // the fight is ever drawn on the flat blue outside it. Ours were not clipped,
  // so a haymaker aimed at a fighter near the top wall trailed a line up across
  // the blue and over the title. The only thing allowed out is the HP plus,
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
    const kind = kindOf(event);
    if (kind === null) continue;
    const from = positionOf(event.actorId);
    const to = positionOf(event.targetId);
    if (!from || !to) continue;

    // One colour for the whole hit language — wind-up, effect, impact and
    // number. Four abilities in four colours plus a red impact mark and an
    // orange telegraph made a frame no viewer could parse.
    const seed = `${event.frame}:${event.actorId}:${kind}`;
    casterCharge(ctx, from.x, from.y, clamp01(age / SIGNATURE_TRAVEL_FRAMES), fighterScale, seed);

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
