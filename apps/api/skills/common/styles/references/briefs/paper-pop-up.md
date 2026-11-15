# Paper pop-up

Start: `node /skills/common/styles/scripts/new-lesson.mjs paper-pop-up /work/module.js`. Module: `assets/styles/paper-pop-up.js`. Film source: `assets/film/styles/paper-pop-up.js`.

A pop-up book open on the desk. Every scene is built from flat die-cut card in a few flat colours, creased, standing
in layers on fold mechanisms, with the pale core showing on every cut edge. Good for a story or process in a few
steps: one spread per step.

## Set

The open book is the stand: two boards (cloth covered, `kit.roundedBox(0.2, 0.008, 0.26, 0.002)` each in
`kit.material('fabric', { color: '#1f4a4b' })`) meeting at the gutter along x = 0, with a cream page on each
(`kit.roundedBox(0.19, 0.003, 0.25, 0.001)` in `lookInk(kit, '#fbf3df')`). Pages slightly cupped toward the gutter
(rotate each page 2 to 4 degrees about z). The book is 0.4 m wide open; the pop-up stands on it.

## Palette

`const PAL = { card: '#f5ecd9', cream: '#fbf3df', navy: '#22364e', coral: '#e2604a', pink: '#f3ab99', yellow: '#f5bd35', honey: '#eba020', amber: '#cf7d22', leaf: '#74a25e', sage: '#a6c787', deep: '#2f6753', sky: '#cfe5df' }`.
Each spread uses 4 or 5 of these. Core (cut edges) `#fbf5e6`.

## Materials and pieces

Every piece is a die-cut card: `lookCard(THREE, kit, outline, ink, core)` - an outline `[[x, y], ...]` in metres,
1.2 mm thick, faces printed in `ink` (`lookInk(kit, PAL.coral)`), the edge showing `core`. Make one ink material per
colour and one core, and reuse them.

- Print detail as **smaller cards layered 1 mm in front** (a window on a house, a stripe on a bee), never as texture.
- A cream margin round a shape: the same outline scaled up 4 to 6 %, in `cream`, 1 mm behind it.
- Build depth with 3 to 5 layers standing at different distances from the gutter: back layer tallest.

## Motion: the steps

One spread per step. Only the paper moves:

- **Pop up**: each layer is hinged on the page at its base and stands up from flat as the step opens:
  `layer.rotation.x = -Math.PI / 2 * (1 - lookBack(lookSeg(t, t0 + i * 0.12, t0 + i * 0.12 + 0.5), 1.2))`, back
  layers first. Pieces on paper arms tremble for a moment when they land (a decaying sine of 1 to 2 degrees).
- **Page turn** between steps: the right page (with its layers folded flat) swings over the gutter about z, while
  the next spread's layers rise. Keep the turn short (0.8 s) and let `Next` trigger it.
- **Pull tab**: on the last spread a tab slides out of the page edge to change one thing (fill a jar, reveal, move).
  Make the tab grabbable or a panel button.

## Words

One short line per spread on a paper ribbon: a card in `cream` with the words on a `kit.card` tag just in front of it,
at the front of the page. Sentences go on the panel.

## Helpers

`lookCard`, `lookInk`, `lookSeg`, `lookBack`.

## Avoid

Thick blocks instead of card, textures pretending to be print, more than one subject per spread, a book wider than the
desk.
