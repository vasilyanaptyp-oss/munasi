# munasi

Generates short vertical battle videos — two characters, 1080×1920, 30fps,
ready for TikTok and Shorts. Same seed, same bytes, every time.

A character is a **cut-out photograph**, not a drawing. Two of them bounce
around a square, run into each other, and lose health; abilities move people,
stop people, change when things happen, or move health between them. Nothing is
drawn over the top. That is the entire visual language, and it is copied from a
reference channel by measurement rather than by eye.

```bash
npm install -g munasi        # or: pnpm add -g munasi
munasi init                  # lay out a project here
# put photographs in assets/fighters/source/ — see "You bring the cast"
munasi cutout
munasi generate --count 10
```

Videos land in `out/`, one row per video in `out/manifest.json`.

## Requirements

- **Node 20+**
- **ffmpeg** and **ffprobe** on `PATH` — `sudo apt install ffmpeg`,
  `brew install ffmpeg`, `sudo pacman -S ffmpeg`. Somewhere else? Set
  `FFMPEG_PATH=/full/path/to/ffmpeg`.

## You bring the cast

**munasi ships with no characters, and cannot.** A character here is a
photograph of a real person; those are licensed to whoever bought them and are
not redistributable inside a package. So the first thing a fresh install needs
is a cast:

```bash
munasi init                              # creates assets/fighters/source/ etc.
cp ~/photos/*.jpg assets/fighters/source/
munasi cutout                            # background off, outline read from alpha
# describe them in fighters.json, then:
munasi calibrate                         # solve each fighter's damage
munasi solve 3                           # even every pair out
munasi balance                           # check the matrix
munasi generate --count 10
```

Photographs need a **white studio background** — the cut-out is a flood fill
from the edge of the frame, so a room, a gradient or a drop shadow will stay.
Waist-up, one person, 700px or more on the short side. Full requirements and the
roster format: [`docs/ADDING-A-FIGHTER.md`](docs/ADDING-A-FIGHTER.md).

Run `munasi generate` before that and it tells you so, with the three steps —
it does not fail somewhere inside a render worker.

**Licensing is on you.** Stock photography usually forbids showing a model in an
unflattering light, and this format has them losing fights. A free-to-use
licence covers copyright, not a person's right to their own image.

## Commands

| Command | What it does |
| --- | --- |
| `munasi init` | lay out a project in the current directory |
| `munasi generate --count 20` | render the next 20 matchups |
| `munasi cutout` | photo on white → cut-out PNG, outline and aspect included |
| `munasi calibrate` | rebuild `fighters.json` from the roster |
| `munasi solve [rounds]` | even the whole roster out as a fixed point |
| `munasi balance` | winrate matrix for every pair |
| `munasi frame [n...]` | sample frames to `out/preview/` |
| `munasi compare ours.mp4 -- theirs.mp4` | measure both files with the same code |
| `munasi sheet out/*.mp4` | contact sheet of a batch, one image |
| `munasi motion out/*.mp4` | how much a finished mp4 actually moves |
| `munasi smoke` | the shipped path end to end, then rebuilt from its manifest row |

`generate` skips pairs already in the manifest, so running it again continues
where the last batch stopped. `--redo` starts over, `--seeds N` changes how many
seeds are searched per matchup, `--workers N` sets render parallelism,
`--out DIR` writes somewhere else, `--pick=0,3,7` selects matchups by index.

Working inside a clone instead? Every command is also a script:
`pnpm generate --count 20`, `pnpm solve`, and so on.

### Environment

| Variable | Effect |
| --- | --- |
| `FFMPEG_PATH` / `FFPROBE_PATH` | binaries somewhere other than `PATH` |
| `MUNASI_PROJECT` | work on a directory you are not standing in |
| `MUNASI_ROSTER` | read the roster from somewhere else |

## What it guarantees

**A seed is a video.** All randomness goes through one seeded mulberry32
stream; a frame is a pure synchronous function of `(result, frame)`, which is
what lets frames be split across worker processes and still come back
byte-identical. Checked rather than assumed — `munasi smoke` regenerates a
shipped sample from its manifest row and compares bytes.

The vendored DejaVu faces ship *with the package* for the same reason: text
metrics are part of the rendered bytes, so a font resolved from the host would
make the same seed produce different pixels on different machines.

**A manifest row records the constants, not just the seed.** A seed replays a
different fight the moment a tuning number moves. Every row carries the commit,
a hash of `fighters.json`, the seed budget, the ending the search was asked for,
and a snapshot of every constant the bytes depend on.

**Drama is selected, not authored.** A random fight is boring, so the generator
simulates hundreds of seeds per matchup and keeps the one that scores highest on
closeness, lead changes, comebacks, pacing, and how late the outcome stayed in
doubt.

**The roster is balanced by construction.** Fighter damage is solved for, never
hand-written. `munasi solve` treats the whole roster as a fixed point, because
bisection stops working past two fighters — each one's winrate depends on all
the others. Every pair currently sits inside 35-65%.

**The format is measured, not remembered.** `munasi compare` pulls frames from
your videos and from a reference and measures the same quantities in both by
pixel: arena size, wall thickness, camera travel, fighter height, colour shares,
damage numbers per second, the worst gap without one. It prints a table and
passes no judgement — five separate "measurements" in this project turned out to
be eyeballed off a still and wrong, and that tool is how each was caught.

## How it fits together

```
src/sim/       simulation, movement, drama scoring — pure, no rendering, no I/O
src/render/    snapshots -> PNG frames (@napi-rs/canvas), single or multi-process
src/export/    frames + synthesised audio -> mp4 (ffmpeg), and measurement of the result
src/content/   the roster, its calibration, and balance tooling
src/cli/       the `munasi` binary and every command behind it
```

`src/sim/` may not import from `src/render/` or `src/export/`. The project's
rules and the reasoning behind every combat decision live in
[CLAUDE.md](./CLAUDE.md) — read it before changing anything under `src/sim/`.

## Abilities

Sixteen are implemented. An ability may move somebody, stop somebody, change
when something happens, or move health between the two — and nothing else,
because this format does not draw. Each is picked for having a silhouette that
reads at thumbnail size:

`switcheroo` swaps the two · `magnet_pull` reels the other man in ·
`spin_cycle` orbits him · `overclock` accelerates and crits ·
`dead_weight` plants and rebounds · `wall_slam` throws him off a wall ·
`siphon` moves health across · `countdown` lands 2.5s later ·
`riposte` returns what it takes · `slipstream` passes through ·
`magnetic_north` rewrites his heading · `thrown_out` hurls him ·
`haymaker` charges and hits · `glasses_throw` and `four_eyes` throw an object ·
`nobody_moves` freezes him

An ability can also put a **photograph** on screen — an object flying across the
square, held at its owner's side, or worn by whoever it caught. Drop
`<name>.png` into `assets/props/` and it appears; no code changes.

## Licence

MIT for the code. **Not** for the photographs — see [LICENSE](./LICENSE).
