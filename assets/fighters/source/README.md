# Source photographs

Photographs on a white background go here; `pnpm cutout` turns each one into a
cut-out in `assets/fighters/` and reads its outline.

## Per-file white threshold: `<name>.cut.json`

There is no single threshold that suits every photograph. The background is
removed by flooding in from the edge of the picture over anything whiter than
the threshold (236 by default), and light clothing at the edge of a figure can
be whiter than the backdrop's shadows:

- **Barista Guy**'s white t-shirt forms the outside of his figure. At 236 the
  fill ran straight through it and took his shoulder, so his file says
  `{"white": 253}`.
- **Fencer Guy**'s white jacket needed the same treatment: `{"white": 248}`.

Raising the threshold for everyone would not work either: Magician Guy's shirt is
brighter still, and at 248 he loses 2.3% of himself. Set it per file, only where
it is needed.

Format: `{"white": 253}`, optionally `"feather"` (default `white - 28`) and
`"maxWidth"`.

## What `pnpm cutout` prints

One line per file: how much of the picture the figure takes up, how much of it
is enclosed holes, and its width against height.

- **figure share** — above 85% the background did not come off, below 12% the
  fill ate the figure; `cutout` warns on both.
- **holes** — transparent areas enclosed by the figure. Data, not a verdict: the
  gap between a raised arm and the head is a real hole.
- **width/height** — around 0.57-0.75 reads best on screen.

## `pnpm cutout --probe`

Prints how much more of each figure would survive at a threshold of 253. Useful
for spotting light clothing that was eaten — but the number also rises when the
backdrop itself is darker than 253, so look at the result rather than trusting
the number.
