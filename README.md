# munasi

Generates short vertical battle videos — two characters, 1080×1920, 30 fps,
ready for TikTok, YouTube Shorts and Reels. Same seed, same bytes, every time.

A character is a **cut-out photograph**, not a drawing. Two of them bounce
around a square arena, run into each other and lose health, and each has one
ability that moves somebody, stops somebody, changes when something happens, or
moves health between the two. Nothing is drawn over the top: the whole look is
photographs on a flat blue field, a black arena, an HP bar over each head, and
the damage numbers.

## Quick start

```bash
corepack enable            # once per machine — provides pnpm
pnpm install
pnpm generate --count 5
```

Videos land in `out/`, with one row per video in `out/manifest.json`. Running
`pnpm generate` again continues with the next matchups instead of repeating the
ones already made.

## Requirements

- **Node.js 20 or newer** (22 recommended) — <https://nodejs.org>
- **pnpm** — comes with Node: run `corepack enable` once
- **ffmpeg** and **ffprobe** on `PATH`:
  - Windows: `winget install Gyan.FFmpeg`, then open a new terminal
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg` (or your distribution's package)
  - installed somewhere else: set `FFMPEG_PATH` and `FFPROBE_PATH`

Windows, macOS and Linux are supported.

## The cast

Ten characters are included, each with one ability, split into two sides that
fight each other — 25 matchups out of the box:

| Left | Ability | Right | Ability |
| --- | --- | --- | --- |
| Magician Guy | `switcheroo` — swaps places with you | Fisherman Guy | `magnet_pull` — reels you in |
| Rapper Guy | `spin_cycle` — circles around you | Barista Guy | `overclock` — speeds up, every hit a crit |
| Sumo Guy | `dead_weight` — plants himself, you bounce off | Luchador Guy | `wall_slam` — throws you off the wall |
| Vacuum Guy | `siphon` — takes your health for himself | Demolition Guy | `countdown` — a heavy hit, 2.5 seconds later |
| Fencer Guy | `riposte` — sends your blows back | Mime Guy | `slipstream` — walks straight through you |

The roster is **balanced by construction**: each fighter's damage is solved
for, never hand-written, so no matchup is a foregone conclusion. `pnpm balance`
prints the winrate of every pair.

## Adding your own fighters

A photograph on a white background, one command to cut it out, one entry in
`src/content/roster.ts`, one command to rebalance. Step by step, with the photo
requirements and a ready-made prompt set for generating characters with an AI
image model: [`docs/ADDING-A-FIGHTER.md`](docs/ADDING-A-FIGHTER.md) and
[`docs/PHOTO-PROMPTS.md`](docs/PHOTO-PROMPTS.md).

Fighters you may use but not share go in `src/content/roster.private.ts`
instead: they fight and are balanced like any other, and stay out of anything
you pass on.

**Rights to your photographs are yours to get.** A stock licence usually
forbids showing a model in an unflattering light, and here they lose fights. A
free licence covers copyright, not a person's right to their own image.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm generate --count 20` | render the next 20 matchups |
| `pnpm cutout` | photo on white → cut-out PNG, outline included |
| `pnpm calibrate` | rebuild `src/content/fighters.json` from the roster |
| `pnpm solve` | rebalance the whole roster |
| `pnpm balance` | winrate for every pair |
| `pnpm frame` | a few sample frames to `out/preview/`, without encoding |
| `pnpm inspect out/*.mp4` | read finished videos frame by frame and check every hit against the fight |
| `pnpm sheet out/*.mp4` | contact sheet of a batch, one image |
| `pnpm smoke` | end-to-end check of your install |
| `pnpm test` | the test suite |

`generate` options: `--count N`, `--seeds N` (how many fights are simulated per
matchup to find the best one, default 500), `--workers N` (render processes),
`--out DIR`, `--redo` (start the batch over), `--pick=0,3,7` (matchups by
index), `--cold-open` (open on a late moment, then play from the start).

## What it guarantees

**A seed is a video.** All randomness goes through one seeded stream and a
frame is a pure function of the fight, so the same seed produces the same
bytes — across runs and across render processes. The typeface ships with the
project for the same reason: text metrics are part of the pixels.

**Drama is selected, not authored.** A random fight is often a boring one, so
each video is the best of hundreds of simulated fights, scored on closeness,
lead changes, comebacks and how late the outcome stayed in doubt.

**Every hit is on screen.** Damage comes from contact and from abilities, never
from an invisible timer, and `pnpm inspect` checks it on the finished file:
it reads the video's own pixels, rebuilds the fight from its manifest row, and
reports any blow that happened without a number on screen, or a number with no
blow behind it.

**A manifest row is enough to rebuild a video.** Each row records the seed, the
matchup, a hash of the roster and every constant the output depends on.

## Platforms

This makes video files. Platforms decide what they recommend and monetise under
their own rules — YouTube's Partner Program, for one, excludes mass-produced,
repetitive content — so treat it as a tool for making videos, not a promise of
views or revenue.

## Licence

Commercial, one person or one business per purchase. The videos you make are
yours to publish, monetise and sell. The code and the included characters may
not be redistributed. Full terms: [LICENSE](./LICENSE).
