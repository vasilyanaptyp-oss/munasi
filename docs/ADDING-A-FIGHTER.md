# Adding a fighter

A fighter is a photograph and one ability. The photograph is the character —
everything a viewer recognises comes from it — and the ability is what makes
them worth watching. If you cannot describe the effect in one sentence, the
character will not work.

## 1. The photograph

These are requirements of the cut-out and of the frame, not of taste.

1. **A plain white studio background.** The background is removed by a flood
   fill from the edge of the picture. Grey, a gradient, a room or a shadow on the
   floor will not come off, and will show on the arena as a rectangle.
2. **Waist-up, arms close to the body.** Width against height should land around
   0.57-0.75. Arms spread wide make a squat figure; full length makes a thin one.
3. **At least 700 px on the short side.** A fighter is drawn about 414 px tall in
   a 1080-wide frame.
4. **One person, face visible, holding the prop of the gag** — a wand, a fishing
   rod, two coffee cups. The profession gives the silhouette; the object gives
   the joke.
5. **No turquoise, cyan or sky blue in the costume.** The field is `#18a2d3` and
   a costume near it disappears into it. `pnpm cutout` warns when it happens.

Generating characters with an AI image model is the cheapest route, and the
included cast was made that way: [`PHOTO-PROMPTS.md`](PHOTO-PROMPTS.md) has the
prompts, written to satisfy every rule above.

## 2. Cut it out

```bash
cp ~/photos/plumber.png assets/fighters/source/plumber-guy.png
pnpm cutout
```

`pnpm cutout` writes `assets/fighters/plumber-guy.png` and reads the figure's
outline out of its transparency — fighters collide by that outline, not by a
box. It prints how much of the picture the figure takes up:

- **above 85%** — the background stayed; the fill had nowhere to go in;
- **below 12%** — the fill ate the figure;
- anything in between is a figure; check it by eye with `pnpm frame`.

A white shirt at the edge of the figure can be eaten by the fill. Put a
`<name>.cut.json` next to the source with a stricter threshold, e.g.
`{ "white": 253 }` (the default is 236) — see
`assets/fighters/source/README.md`.

## 3. Add them to the roster

In `src/content/roster.ts`, add an entry to `SHIPPED_ROSTER`:

```ts
{
  id: "plumber",
  faction: "left",            // which side: left fights right
  name: "Plumber Guy",        // shown in the title — Title Case, short
  spriteId: "plumber-guy",    // the file name, without extension
  maxHp: 1000,                // the same for everyone
  attackSpeed: 0.85,
  critChance: 0.18,
  critMult: 1.5,
  meleeShare: 1.0,            // how much a collision with him hurts
  abilities: [{ type: "wall_slam", cooldown: 6, power: 0, hitShare: 2.0 }],
  fieldScale: 1.0,            // solved in the next step
},
```

A fighter you may use but not share goes in `src/content/roster.private.ts`
instead, in exactly the same shape.

**Style lives in `meleeShare` and `hitShare`, never in `attack`.** `attack` is
solved by the calibrator and anything typed in would be overwritten. A heavy
brawler has a high `meleeShare`; someone whose damage comes from the ability has
a low one and a high `hitShare`.

## 4. Rebalance

```bash
pnpm solve 3
pnpm balance
```

`pnpm solve` evens out the whole roster at once, because each fighter's winrate
depends on everybody else's. It takes minutes. `pnpm balance` prints every pair;
look at the pairs, not only the averages — a roster can be level overall and
still contain a matchup one side always wins.

## Abilities

| type | what it does |
| --- | --- |
| `switcheroo` | swaps the two fighters' places |
| `magnet_pull` | reels the opponent in |
| `spin_cycle` | circles around the opponent |
| `overclock` | speeds up, every contact is a crit |
| `dead_weight` | plants himself; the opponent bounces off harder |
| `wall_slam` | throws the opponent off a wall |
| `siphon` | health taken comes back to him |
| `countdown` | a heavy hit, 2.5 seconds after the cast |
| `riposte` | sends blows he takes back to the attacker |
| `slipstream` | passes straight through the opponent |
| `magnetic_north` | rewrites the opponent's heading |
| `thrown_out` | hurls the opponent across the arena |
| `haymaker` | charges in and lands one big punch |
| `glasses_throw` | throws an object at the opponent |
| `four_eyes` | throws three or four at once |
| `nobody_moves` | stops the opponent dead |

An ability can also put a photograph on screen — an object flying across the
arena, or held at its owner's side. Put `<name>.png` on white in
`assets/props/source/` under the name from `ABILITY_PROPS` in
`src/render/signatures.ts` and run `pnpm cutout`. Every ability works without
one: each of them already does something visible.
