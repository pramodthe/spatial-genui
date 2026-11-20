# The sound library

Every project has these sounds as files: `public/audio/library/<name>.mp3`. Nothing is generated; pick the nearest
fit, and leave an action without its own sound only when none fits. Register the ones the game uses in
`src/assets.ts` (or give an entity an `AudioSource` with `src: './audio/library/<name>.mp3'`) and play one with
`AudioUtils.play(entity)`. List each in the design's asset list with the action it answers.

A hand action should be heard as well as seen: one short effect per action, one for success, one for "try again",
and at most one quiet looping ambience for the place.

## Effects

| Name | Length | What it is |
|---|---|---|
| `wood-knock` | 1 s | a knock on wood: a block set down, a door tap |
| `block-snap` | 1 s | a wooden piece clicking into place |
| `stone-thud` | 1 s | a stone or heavy block set down |
| `glass-clink` | 1 s | glass touching glass |
| `metal-clang` | 1 s | a small metal hit |
| `paper-rustle` | 1 s | paper being folded or turned |
| `paper-throw` | 1 s | a paper plane or light thing thrown |
| `splash-small` | 1 s | something small drops into water |
| `splash-big` | 2 s | something big lands in water |
| `bubble-pop` | 1 s | a bubble popping |
| `whoosh` | 1 s | something fast passing |
| `rope-creak` | 1 s | a rope or wood under strain |
| `spring-boing` | 1 s | a spring or bounce |
| `ball-bounce` | 1 s | a ball bouncing once |
| `cloth-flutter` | 2 s | a kite, flag or sail in wind |
| `bird-chirp` | 1 s | a small bird |
| `bat-chirp` | 1 s | a bat's echolocation call, slowed to be heard |
| `wing-flap` | 1 s | wings beating |
| `coin` | 1 s | a reward: a coin or gem collected |
| `chime-good` | 1 s | a right answer |
| `knock-soft-miss` | 1 s | a gentle wrong answer |
| `footstep-grass` | 1 s | a step on grass |
| `cork-pop` | 1 s | a cork or a launch |
| `cheer-small` | 2 s | a small crowd cheering |

## Loops (ambience)

| Name | Length | What it is |
|---|---|---|
| `wind-hill` | 10 s | steady wind on an open hill |
| `forest-birds` | 10 s | a forest with birds |
| `river-flow` | 10 s | a flowing river or stream |
| `cave-drips` | 10 s | a cave with water drips |
| `night-crickets` | 10 s | a night outdoors |
| `ocean-waves` | 10 s | waves on a beach |
