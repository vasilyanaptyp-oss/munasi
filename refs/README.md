# Reference frames

Six frames from a third-party short in the genre we are building, kept as a
layout and timing reference.

**Provenance and limits.** These are someone else's frames (the watermark is
visible in most of them). They are here to be *measured*, not copied. Nothing
from them ships: the character treatment in the reference is cut-out photos of
real people, which we do not use — our fighters stay procedural
(`src/render/fighters/`). Channel branding and captions are ignored entirely.
Do not add these images to any build output.

## What was measured

All frames are 576x1024. Fractions below are of frame width (576) or height
(1024) so they carry over to our 1080x1920.

| Thing | Pixels (576x1024) | As a fraction |
| --- | --- | --- |
| Background | `#18a2d3` flat, 69-76% of every frame | — |
| Arena border thickness | 24 | 0.042 of width |
| Arena inner size | 566 x 566 (**square**) | 0.983 of width |
| Arena outer size | 613 x 613 | **1.064 of width** |
| HP widget total width | 75 | 0.130 of width |
| HP widget stem width | 21 | 0.036 of width |
| HP widget crossbar width | 52 | 0.090 of width |
| Caption cap height ("3v3 Battle") | 34 | 0.033 of height |

### Palette

| Element | Colour |
| --- | --- |
| Background | `#18a2d3` |
| Arena border, outlines | `#000000` |
| HP widget body (empty) | `#3c3d3d` |
| HP fill, damaged | `#ed1e2a` |
| HP fill, healthy | `#ffffff` |
| Team heading | `#8a0085` magenta |
| Roster member, alive | `#ffffff` |
| Roster member, defeated | `#8b8b8b` |
| Buff pickup text | `#00b05b` green |

### The camera moves; the layout does not

The arena's inner height is **566px in all six frames** and the caption's cap
height is **34px in all six** — so there is no zoom. But the arena's top edge
sits at y = 179, 188, 194, 196, 218, 281 across the frames, and the caption
moves with it at a **constant 638px offset** every time.

So the whole composition — arena, roster panel, VS, caption — is one scene
under a camera that translates to follow the action. The arena is a square
1.064x the frame width, which is why only one side wall is ever on screen.

### HP widget

A plus/cross shape above each fighter. The crossbar carries the current HP
number; the shape fills bottom-up in proportion to HP. Verified readings:
`1000` renders white and completely full, `400` and `296` render as a dark grey
cross with a red fill in the lower stem, `10` is dark with no visible fill. The
white-to-red switch happens around half HP (560 still reads white, 400 is red).

### Round structure

The roster panel is the evidence, and it is unambiguous:

| Frame | Pointer | Roster state | Challenger HP |
| --- | --- | --- | --- |
| ref-06 | Knight | all three white | 1000 (Knight also 1000) |
| ref-05 | Knight | all three white | 400 (Knight 296) |
| ref-04 | Priest | Knight grey | 300 (Priest 337) |
| ref-03 | Blacksmith | Knight, Priest grey | 300 (Blacksmith 560) |
| ref-02 | Blacksmith | Knight, Priest grey | 180 (Blacksmith 120) |
| ref-01 | none | **all three grey** | 10, alone in the arena |

Two fighters are on screen at a time, never three. The pointer advances
Knight → Priest → Blacksmith, defeated members grey out, and the challenger's
HP falls monotonically across the whole sequence without ever resetting.

Note that the file names are a guess made before measuring: **ref-01 is the
final state** (all three defeated, challenger alive at 10 HP) and **ref-06 is
the opening** (both at full 1000). They were named the other way round.
