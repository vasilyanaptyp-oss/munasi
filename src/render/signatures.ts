import type { SKRSContext2D } from "@napi-rs/canvas";
import type { AbilityType, MatchEvent } from "../sim/types.js";
import { FPS } from "../sim/types.js";
import { SIGNATURE_LEAD_SECONDS, SIGNATURE_PULSE_SECONDS } from "../sim/simulate.js";
import { hasProp, propImage } from "./photo.js";

/**
 * The signature abilities.
 *
 * **Nothing here is drawn.** No rings, no streaks, no stars, no particles. Three
 * passes at hand-drawn effects were rejected in a row, and the ruling is the
 * right one: this format is a collage of photographs on a flat blue field, and
 * vector art pasted into it looks like vector art pasted into it. The reference
 * channel does not draw its abilities either — it uses *pictures*: a
 * photographed alarm clock and a bundle of dynamite in one character's hands, a
 * stock fireworks burst, a stock fireball.
 *
 * So an ability may put exactly two things on screen:
 *
 * 1. **a real photograph** — a PNG from `assets/props/`, flown across the arena,
 *    held beside its owner, or worn by whoever it caught;
 * 2. **nothing at all**, when there is no picture for it yet.
 *
 * An ability with no prop is not an invisible ability, because the ability is
 * not the picture — it is what it *does*, and all four do something you can
 * watch: the boxer charges the length of the arena, the compass rewrites where
 * the other man is flying, the bodyguard stops him dead, the glasses man's
 * spectacles cross the square. The blow itself still reads the way the reference
 * makes every blow read: the victim flashes to a **solid white silhouette** and
 * a **yellow number** climbs off him. Both of those are the format's own, and
 * neither is an illustration.
 *
 * **Adding a picture takes no code.** Drop `<name>.png` into `assets/props/`,
 * cut out on transparency, under the name listed in `ABILITY_PROPS` below; it is
 * loaded at startup and used from the next render. Nothing is ever downloaded —
 * every asset here is a file the owner put there, which is also the only way the
 * licensing works.
 */

type Ctx = SKRSContext2D;

/** Frames each effect plays for. */
export const SIGNATURE_FRAMES = Math.round(FPS * 1.4);
/** Frames from the cast to the moment it bites. Matched to the simulation. */
export const SIGNATURE_TRAVEL_FRAMES = Math.round(FPS * SIGNATURE_LEAD_SECONDS);
/**
 * Frames between one thrown prop and the next.
 *
 * The same gap the simulation spaces a cast's pulses at, so the nth picture
 * lands on the frame the nth number appears.
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

/** Every signature the renderer knows about. */
export type SignatureKind =
  | "magnetic_north"
  | "nobody_moves"
  | "thrown_out"
  | "haymaker"
  | "glasses_throw"
  | "four_eyes";

/**
 * How a picture shows itself.
 *
 * - `thrown` — it flies from the caster to the victim and is gone when it lands,
 *   one per pulse. This is the glasses man's whole fight.
 * - `held` — it sits beside its owner for the length of the cast, the way the
 *   reference's Time Traveler holds his clock. **Beside**, never over: the
 *   photograph of the fighter is the only thing a viewer recognises him by, and
 *   a prop centred on his chest covers it.
 * - `worn` — it sits on the victim while the ability holds him.
 */
type PropMode = "thrown" | "held" | "worn";

/**
 * The picture for each ability, and how it is shown.
 *
 * A name with no file behind it simply draws nothing, which is a complete
 * shippable state rather than a placeholder — see the note at the top. Put the
 * PNG in `assets/props/` under this name and it appears.
 */
const ABILITY_PROPS: Record<SignatureKind, { prop: string; mode: PropMode; size: number }> = {
  // The owner's own photograph of a pair of spectacles, supplied for exactly
  // this. Every point of damage this character deals arrives on one of these.
  glasses_throw: { prop: "glasses", mode: "thrown", size: 0.62 },
  four_eyes: { prop: "glasses", mode: "thrown", size: 0.62 },
  // No files yet: drop `compass.png`, `tape.png` or `glove.png` in and these
  // light up with no other change.
  magnetic_north: { prop: "compass", mode: "held", size: 0.8 },
  nobody_moves: { prop: "tape", mode: "worn", size: 1.15 },
  thrown_out: { prop: "grab", mode: "held", size: 0.8 },
  haymaker: { prop: "glove", mode: "held", size: 0.7 },
};

const TAIL_FRAMES = SIGNATURE_FRAMES - SIGNATURE_TRAVEL_FRAMES;

/** Ease-out, so a thrown thing leaves fast and settles onto its target. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 2.2);
}

/**
 * A photograph in flight, with motion blur: the same picture stamped a few times
 * along where it has just been, dimmest and smallest at the back.
 *
 * The ghosts are the picture itself, not a drawing of motion — one crisp copy
 * sliding across the screen reads as a sticker being dragged.
 */
function flyingProp(
  ctx: Ctx,
  sprite: ReturnType<typeof propImage>,
  x: number,
  y: number,
  heading: number,
  width: number,
  spin: number,
  trail: number,
): void {
  const height = (width * sprite.height) / sprite.width;
  const dx = Math.cos(heading);
  const dy = Math.sin(heading);
  for (let i = 3; i >= 0; i -= 1) {
    const back = (i / 3) * trail;
    ctx.save();
    ctx.globalAlpha = i === 0 ? 1 : 0.12 / i;
    ctx.translate(x - dx * back, y - dy * back);
    ctx.rotate(spin - i * 0.18);
    const scale = 1 - i * 0.08;
    ctx.drawImage(sprite, (-width * scale) / 2, (-height * scale) / 2, width * scale, height * scale);
    ctx.restore();
  }
}

/** A picture held at its owner's side, or worn by whoever the ability caught. */
function placedProp(
  ctx: Ctx,
  sprite: ReturnType<typeof propImage>,
  at: Point,
  width: number,
  offsetX: number,
  offsetY: number,
  alpha: number,
): void {
  const height = (width * sprite.height) / sprite.width;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, at.x + offsetX - width / 2, at.y + offsetY - height / 2, width, height);
  ctx.restore();
}


/**
 * The two graphic devices the reference channel uses for an ability, copied from
 * it rather than invented here.
 *
 * Measured off "Detective Guy vs Camera Guy" and "Detective Guy vs Exploding
 * Guy" at full resolution:
 *
 * - **A flat translucent cone.** Camera Guy's flash is a plain red triangle from
 *   his lens across half the square, about half opacity, no outline, no
 *   gradient, no particles. It is the biggest thing in those frames and it is
 *   also the simplest.
 * The tape that went with it — Detective Guy's yellow "DO NOT CROSS" strips
 * across the square — was copied onto Bodyguard Guy and that was simply the
 * wrong man. Hazard tape is a *detective's* prop, and a bodyguard who cordons
 * the arena off is doing a policeman's job. He throws people out instead; see
 * `thrown_out` in `simulate.ts`.
 */



/**
 * Draws whichever signature is playing on this frame — which, for an ability
 * with no picture behind it, is nothing.
 *
 * `positionOf` gives a fighter's centre on screen *this* frame, so a thrown prop
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
  // Inside the walls, like everything else the fight puts on screen. In the
  // reference nothing belonging to the fight is drawn on the flat blue outside
  // the square; the only thing allowed out is the HP plus.
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

    // **`MAGNETIC_NORTH` draws nothing.** It used to lay a flat translucent
    // wedge from him to the other man, on the theory that the reference's own
    // camera flash is a plain triangle — but that reference belongs to a
    // character we do not have, and a coloured shape stretched across the arena
    // is vector graphics pasted into a collage of photographs, which is the one
    // thing this format is not. It was rejected three times as drawing and then
    // outlived the removal, because it lived on its own branch above the props
    // table and nothing walked past it.
    //
    // What the ability *does* is still on screen and still the strongest thing
    // an ability can do here: it rewrites where the other man is flying. When
    // `compass.png` is in `assets/props/`, it gets a picture like everyone else.

    const spec = ABILITY_PROPS[kind];
    if (!hasProp(spec.prop)) continue;

    const sprite = propImage(spec.prop);
    const width = fighterScale * spec.size;
    const heading = Math.atan2(to.y - from.y, to.x - from.x);

    if (spec.mode === "held") {
      const life = Math.min(1, age / SIGNATURE_FRAMES);
      placedProp(
        ctx,
        sprite,
        from,
        width,
        -Math.cos(heading) * fighterScale * 0.55,
        -fighterScale * 0.55,
        life > 0.8 ? (1 - life) / 0.2 : 1,
      );
      continue;
    }

    if (spec.mode === "worn") {
      if (age < SIGNATURE_TRAVEL_FRAMES) continue;
      const since = Math.min(1, (age - SIGNATURE_TRAVEL_FRAMES) / TAIL_FRAMES);
      placedProp(ctx, sprite, to, width, 0, 0, Math.max(0, 1 - since * 0.6));
      continue;
    }

    // Thrown: one per pulse, staggered by the gap the simulation schedules them
    // at, so the nth picture lands on the frame the nth number appears.
    const thrown = Math.max(1, Math.min(6, Math.round(kind === "four_eyes" ? event.value : 1)));
    for (let i = 0; i < thrown; i += 1) {
      const local = age - i * GLASSES_STAGGER_FRAMES;
      if (local < 0) continue;
      const travel = local / SIGNATURE_TRAVEL_FRAMES;
      // Gone the moment it lands. What happens next is the victim's white flash
      // and his number, which is how the reference marks every blow.
      if (travel > 1) continue;
      const p = easeOut(travel);
      // Lanes fan out from the middle — -1, +1, -2, +2 — so an odd count is
      // centred and an even one symmetric, bowing out at the midpoint where
      // there is room and closing again on the target.
      const lane = thrown === 1 ? 0 : (Math.floor(i / 2) + 1) * (i % 2 === 0 ? -1 : 1);
      const spread = Math.sin(p * Math.PI) * fighterScale * 0.36 * lane;
      flyingProp(
        ctx,
        sprite,
        from.x + (to.x - from.x) * p + Math.cos(heading + Math.PI / 2) * spread,
        from.y + (to.y - from.y) * p + Math.sin(heading + Math.PI / 2) * spread,
        heading,
        width,
        heading + travel * Math.PI * 3.2 * (lane === 0 ? 1 : Math.sign(lane)),
        fighterScale * 0.42,
      );
    }
  }
  ctx.restore();
}

/**
 * What an ability does **to the photographs**, which is the only material this
 * format has.
 *
 * There is no illustration anywhere in these videos, so an ability that wants to
 * be seen has to be seen on the cut-outs themselves. Every one of these is the
 * picture handled — grown, turned, repeated, bleached — and not a line drawn
 * near it:
 *
 * - `HAYMAKER` — the boxer **grows and smears** as he charges, so he comes at
 *   the other man out of the screen; on arrival the victim is **knocked
 *   crooked** and squashed, and rights himself over the next half second.
 * - `MAGNETIC NORTH` — the man being pulled **leaves copies of himself** along
 *   the line he is being dragged down, for as long as the needle holds him.
 * - `NOBODY MOVES` — whoever is caught goes **pale and still**, the photograph
 *   bleached most of the way to a white silhouette while the hold lasts.
 * - the thrown spectacles do their own work; the fighters are left alone.
 */
export interface PhotoTreatment {
  scale: number;
  rotation: number;
  smear: number;
  smearAngle: number;
  wash: number;
}

const NO_TREATMENT: PhotoTreatment = { scale: 1, rotation: 0, smear: 0, smearAngle: 0, wash: 0 };

/**
 * The treatment for one fighter on one frame, from every signature in flight.
 *
 * Pure in `(events, frame)` like everything else in the render: the same frame
 * handles the same photograph the same way, forever.
 */
export function photoTreatment(
  events: MatchEvent[],
  frame: number,
  kindOf: (event: MatchEvent) => SignatureKind | null,
  fighterId: string,
  headingOf: (event: MatchEvent) => number,
  scale: number,
): PhotoTreatment {
  void scale;
  let out = { ...NO_TREATMENT };
  for (const event of events) {
    if (event.type !== "signature") continue;
    const age = frame - event.frame;
    if (age < 0 || age >= SIGNATURE_FRAMES) continue;
    const kind = kindOf(event);
    if (kind === null) continue;
    const caster = event.actorId === fighterId;
    const victim = event.targetId === fighterId;
    if (!caster && !victim) continue;
    void headingOf;
    const since = (age - SIGNATURE_TRAVEL_FRAMES) / TAIL_FRAMES;

    if (kind === "haymaker" && caster) {
      // **No trail, and no swelling.** He used to grow by a third and drag three
      // copies of himself behind him, which on a shipped frame is a pale cloud
      // twice the size of a man with a photograph somewhere inside it. Nothing
      // in any of the four references does either: a fighter is the same size
      // in every frame, and the only thing that ever happens to the photograph
      // itself is that it flashes solid white.
      //
      // The charge still reads, because the charge is *movement* — he crosses
      // half the square in a third of a second, which is the fastest anything
      // in the format moves.
      const t = Math.min(1, age / SIGNATURE_TRAVEL_FRAMES);
      const settle = age <= SIGNATURE_TRAVEL_FRAMES ? 1 : Math.max(0, 1 - since * 3);
      out.scale = Math.max(out.scale, 1 + 0.06 * easeOut(t) * settle);
    }
    if (kind === "haymaker" && victim && age >= SIGNATURE_TRAVEL_FRAMES) {
      // Knocked off true, and squashed, righting himself over half a second.
      const decay = Math.max(0, 1 - since * 1.6);
      out.rotation += 0.3 * decay * Math.sin(since * 9 + 1);
      out.scale *= 1 - 0.1 * decay;
    }

    if (kind === "thrown_out" && victim) {
      // Hurled across the square at four times his own speed. That speed is the
      // effect; a trail behind it was three more copies of the same photograph
      // and read as a smudge.
      const t = Math.min(1, age / SIGNATURE_FRAMES);
      out.rotation += 0.16 * Math.sin(t * 7) * (1 - t);
    }
  }
  return out;
}

/** Ability types that have a signature moment at all. */
export const SIGNATURE_KINDS = new Set<AbilityType>([
  "magnetic_north",
  "nobody_moves",
  "thrown_out",
  "haymaker",
  "glasses_throw",
  "four_eyes",
]);
