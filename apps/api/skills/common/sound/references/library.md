# The sound library

Sounds every game can use, by id, with no wait and no cost: `{ clip: 'snd-…', volume }` in SOUNDS, or
`sound.clip(id, { volume, loop })` in code. Use one when it fits; make a sound with `make_sound` only for what
the library does not have. An ambience loops: start it on Start with `{ clip: id, loop: true, volume: 0.2 }`.

| Name | Id | Kind | Seconds | What it is |
|---|---|---|---|---|
| wood-knock | `snd-4e9f1aaae2` | effect | 1 | a knock on wood: a block set down, a door tap |
| block-snap | `snd-23d5e2b90b` | effect | 1 | a wooden piece clicking into place |
| stone-thud | `snd-e8265ae9e2` | effect | 1 | a stone or heavy block set down |
| glass-clink | `snd-33aefce57b` | effect | 1 | glass touching glass |
| metal-clang | `snd-2a05396490` | effect | 1 | a small metal hit |
| paper-rustle | `snd-8b70a4ffa5` | effect | 1 | paper being folded or turned |
| paper-throw | `snd-92d728b1f0` | effect | 1 | a paper plane or light thing thrown |
| splash-small | `snd-4bf24d5e9f` | effect | 1 | something small drops into water |
| splash-big | `snd-16d0231974` | effect | 2 | something big lands in water |
| bubble-pop | `snd-22a35d6762` | effect | 1 | a bubble popping |
| whoosh | `snd-ae44cff8e4` | effect | 1 | something fast passing |
| rope-creak | `snd-f0771a564e` | effect | 1 | a rope or wood under strain |
| spring-boing | `snd-bc08bc3b23` | effect | 1 | a spring or bounce |
| ball-bounce | `snd-b6c3671c1f` | effect | 1 | a ball bouncing once |
| cloth-flutter | `snd-e854f20fc6` | effect | 2 | a kite, flag or sail in wind |
| bird-chirp | `snd-a0aaba9925` | effect | 1 | a small bird |
| bat-chirp | `snd-348e29a961` | effect | 1 | a bat's echolocation call, slowed to be heard |
| wing-flap | `snd-7c1482d3fc` | effect | 1 | wings beating |
| coin | `snd-2da7887db1` | effect | 1 | a reward: a coin or gem collected |
| chime-good | `snd-5745be6b26` | effect | 1 | a right answer |
| knock-soft-miss | `snd-2c9f851c14` | effect | 1 | a gentle wrong answer |
| footstep-grass | `snd-71ec0fe588` | effect | 1 | a step on grass |
| cork-pop | `snd-13d39e142f` | effect | 1 | a cork or a launch |
| cheer-small | `snd-b9fd9aad68` | effect | 2 | a small crowd cheering |
| wind-hill | `snd-fc895efa75` | ambience | 10 | steady wind on an open hill |
| forest-birds | `snd-662d8efa2e` | ambience | 10 | a forest with birds |
| river-flow | `snd-bf5d153ae5` | ambience | 10 | a flowing river or stream |
| cave-drips | `snd-fad617568f` | ambience | 10 | a cave with water drips |
| night-crickets | `snd-443878dc53` | ambience | 10 | a night outdoors |
| ocean-waves | `snd-748a96c201` | ambience | 10 | waves on a beach |
