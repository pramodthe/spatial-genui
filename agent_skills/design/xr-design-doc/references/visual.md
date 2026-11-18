# Visual and UI direction

The designer decides how the game looks, sounds and talks. The look's builders and the kit decide how it is drawn.
Make the choices here specific enough that two coders would build the same scene.

## What you choose freely

- The theme and setting: where the game happens and who the player is ("a young baker at a market stall", "an
  engineer at a river crossing"). Original names only.
- Characters and story, if any, and a theme per level.
- The palette, within the rules below.
- The UI voice: how the panel and signs speak (a friendly coach, a chef, a ship's captain).
- Feedback, motion and sound for every action.

## What stays fixed

- The kit draws everything: no renderer, scene, camera or lights of the game's own (`/skills/common/kit`).
- Each look's builders take colours only from that look's palette (`look.PAL`); low-poly's builders refuse others.
- Sizes and reach from `environment.md`; panel text limits from `SKILL.md`.

## 1. Choose the look

Pick the look that fits the kind of subject. The look's skill (`/skills/looks/<look>`) has its builders and palette.

| Look | Best for | Not for |
|---|---|---|
| `ink-toon` | How-tos, recipes, procedures, repairs, everyday science with a few objects | Maps, big systems, circuits, anatomy, data |
| `exploded-view` | What is inside one object and how its parts work together (locks, staplers, toasters, mechanisms) | Living things, landscapes, abstract ideas |
| `circuit-city` | Journeys through a system: how a computer runs a program, how data or messages travel, supply flows | Amounts, one object's parts, real maps |
| `low-poly` | Processes in a place: cycles, routes, supply chains, ecosystems, farming, towns | Inside a machine, circuits, anatomy, abstract maths |
| `painted` | Stories and processes in a place: how bread or wool is made, history scenes, journeys | Precise machines, circuits, maths, anatomy |
| `paper-pop-up` | Stages and stories: life cycles, step-by-step processes, timelines, children's topics | Precise machines, circuits, anatomy, turning things in 3D |
| `soft-clay` | Amounts and comparisons: money, sharing, fractions, counting, balance, simple forces, portions | Precise machines, circuits, maps, anatomy |
| `voxel` | Things that build up in stages or countable units: growth, layers, area and volume, populations | Curves, faces, anatomy, circuits, fine mechanisms |
| `plain` | Real-looking materials, and anything the looks above do not fit | – |

If the request names a look ("make it comic style"), use it. If none fits well, choose a **custom look** (below).

## 2. Palette

**With one of the eight looks:** name colours from the look's palette, by name, and say which object gets which.
The hero gets the look's hero or strongest colour; everything the hands do not touch stays quieter. Example for
`ink-toon`: hero persimmon; tools navy; ceramics cream; wood and chocolate bean; plants leaf; water and glass water.

**Custom look (`plain` + your palette):** when no look fits, or the subject needs real materials (an engine, a bridge,
a heart), write:

- 4 to 6 colours as hex values, each with a name and a job ("#E4572E coral: the hero").
- One kit material preset per kind of object, from: plastic, glossy, rubber, paintedMetal, metal, brushedMetal,
  chrome, steel, iron, gold, copper, brass, rust, glass, wood, stone, rock, concrete, brick, sand, soil, grass, snow,
  ice, water, lava, fabric, leather, paper, ceramic, skin, tissue, leaf, bone, light.
- Optional textures from: noise, bands, cells, stripes, checker, gradient, bricks, wood.

Rules for both: the hero stands out against the set at a glance (a coral boat on teal water, not a brown boat on a
brown dock); the "done" colour and the "try again" colour stay the same through the whole game.

## 3. UI direction

| Part | Decide | Limits |
|---|---|---|
| Panel | Its voice, and the one-sentence goal it opens with | `kit.panel` only; at most two short sentences on screen; beside the game (desk) or host-placed (world) |
| Signs in the scene | What they show (a result where it happened, a step word, a label) and their colours | `kit.sign(text, { width, paper, ink, edge, sub })` in palette colours; never the game's name (the app shows it); `ink-toon` has `look.stepWord` |
| Feedback | For each action in the controls table: what the player sees and hears when it works and when it does not | The same frame as the action (`references/controls.md`) |
| Motion | What moves while idle, and how moves land (snappy, bouncy, slow) | Small amplitudes on things not being held; the look's own motion style |
| Sound | One sound per action, plus an ambience for a world | From the sound library unless a generated sound is planned in the asset list |

## Write in the design (section 9)

```markdown
## 9. Visual and UI direction
- Look: <one of the nine, or "custom (plain)">, because <why it fits the subject>
- Theme and setting: <where it happens, who the player is>
- Palette:
  | Colour (name or hex) | Used for |
  |---|---|
- Materials (custom look only): <object kind: preset, texture>
- Panel voice: <how it speaks>; opening line: "<the goal in one sentence>"
- Signs: <what, where, colours>
- Feedback: <success / try again, consistent across the game>
- Motion: <idle motion; how moves land>
- Sound: <per action; ambience>
```
