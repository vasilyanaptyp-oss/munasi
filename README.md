# munasi

Generates short vertical battle videos — two fighters, 1080x1920, 30fps, ready
for TikTok/Shorts.

The default format is a gauntlet: one worker against three bosses, one at a
time, carrying their health between rounds. The pipeline simulates the run,
scores how dramatic it was, keeps the best of 500 seeds, renders it to frames,
and muxes it into an mp4 with sound. `--duel` runs the original one-on-one
format instead.

```
pnpm install
pnpm generate --count 20
```

Videos land in `out/`, one row per video in `out/manifest.json`.

## Requirements

- Node 20+ and pnpm
- ffmpeg on `PATH` (`sudo pacman -S ffmpeg`, `sudo apt install ffmpeg`,
  `brew install ffmpeg`)

Nothing else: fighter art is drawn procedurally, and the soundtrack is
synthesised into `assets/audio/` the first time you export.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm generate --count 20` | generate the next 20 matchups |
| `pnpm balance` | winrate matrix for all 66 pairs |
| `pnpm calibrate` | regenerate `fighters.json` from `roster.ts` |
| `pnpm matchups` | list pairs, most even first |
| `pnpm frame [n...]` | render sample frames to `out/preview/` |
| `pnpm diagnose` | drama distribution, side-bias check (`--comeback` for the prototype) |
| `pnpm calibrate:gauntlet` | gauntlet balance table (`--solve`, `--variance`) |
| `pnpm test` / `pnpm typecheck` | tests and types |

`generate` skips pairs already in the manifest, so running it again continues
where the last batch left off. `--redo` starts from the top, `--seeds N`
changes how many seeds are searched per matchup, `--workers N` sets render
parallelism, `--keep-frames` leaves the intermediate PNGs behind.

`--cold-open` opens the video on the fight's most arresting earlier moment
before cutting back to the start. It is off by default so you can post both
cuts of the same matchup and compare watch time; the window chosen and the
reason go into `manifest.json`. The window can never contain a killing blow
or come from the last 20% of the fight — spoiling the ending costs more
retention than a slow opening.

## How it fits together

```
src/sim/       simulation and drama scoring — pure, no rendering, no I/O
src/render/    snapshots -> PNG frames (@napi-rs/canvas), single or multi-process
src/export/    frames + synthesised audio -> mp4 (ffmpeg)
src/content/   the roster, its calibration, and balance tooling
src/cli/       generate, frame preview, progress, manifest
```

**Determinism is the contract.** All randomness flows through a seeded
mulberry32 stream, so a `(matchup, seed)` pair always replays the same fight,
and a frame renders the same bytes no matter what was rendered before it — which
is what lets frames be split across worker processes.

**Drama is selected, not authored.** A random fight is almost always boring, so
`findBestMatch` simulates 500 seeds (~350ms) and keeps the one that scores
highest on closeness, lead changes, comebacks, pacing and how late the outcome
stayed in doubt.

**The roster is balanced by construction.** Fighter `attack` values are solved
for, not hand-written: see `src/content/calibrate.ts`. Every pair currently sits
inside 35-65% (tightest 38-62%) over 500 matches per pair, with a mean match
length of 26.8s.

Project rules and the reasoning behind the combat model live in
[CLAUDE.md](./CLAUDE.md) — read that before changing anything in `src/sim/`.

## Art and audio

Every fighter has its own drawing function in `src/render/fighters/` — its own
silhouette, a signature prop readable at thumbnail size, its own idle tell, its
own wind-up and its own death. The roster is a plumber, a night baker, a
courier and a market loader against a supreme arbiter, a privy councillor, an
eternal inspector and a committee chairman; the joke is in the pairing, and it
lands in the title before the fight starts.

`silhouette.test.ts` keeps them apart by measurement, not by eye: each fighter
is rendered as a solid mask at a common height and every pair must score under
0.70 intersection-over-union. The shipped roster's worst pair is 0.663.

Nothing is loaded from disk — no third-party images, no real people, no
borrowed franchises. To use your own sound, drop 16-bit 44.1kHz WAVs into
`assets/audio/` under the names listed there; existing files are never
overwritten.
