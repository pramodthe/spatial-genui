# Environment: desk or world

Every design states its mode and writes a **scene plan**: every thing with its role, its size and how it stands to the
others. It never gives coordinates: the app's placement solver (`/skills/play/learning-game/references/scene.md`)
finds places where the relations hold and the layout checker passes (nothing hidden, out of reach, blocking the start
or too big up close). The rules below are what the roles and sizes must respect.

## Choose the mode

| | Desk (the default) | World |
|---|---|---|
| What it is | A toy-sized game on the player's real desk, in mixed reality (passthrough) | A place the player stands in and walks around, in full VR |
| Choose it when | The idea is learned by hand at a table: folding, mixing, building, sorting | The request asks for a place, a ride, being inside something, or something too big for a desk |
| Player | Seated, about half a metre from the game | Standing at the origin, facing -Z |
| Scale | Real desk centimetres | Built in desk centimetres, shown 12 times bigger |

## Desk layout

- The hero (the one thing the hands work on) is the biggest interactive thing, at least 8 cm across (a steered
  vehicle or creature 12 cm long or more, at most a third of the playfield's width), in the front half of the desk,
  in a colour that stands out from the set.
- Pieces and targets are at least 3 cm; tools that follow the hand at least 6 cm.
- Pinches count within about 25 cm of the playfield.
- The panel stands beside the game, in reach; never behind the playfield.
- Nothing large sits between the player's eyes and the hero.

## World layout

| In the design (desk cm) | In the headset |
|---|---|
| 1 cm | 12 cm |
| 5 to 12 cm up | waist to chest height: where hands touch things |
| 13 cm up | the player's eyes |
| 5 cm around the player | what they reach without walking |
| 8 to 15 cm ahead | 1 to 2 m: where the first thing to do stands |
| 30 to 60 cm away | 4 to 7 m: the far side of the place |

- Things the hands touch stand 5 to 12 cm high, on a post, table, rock or ledge; never flat on the ground or overhead.
- Lay the place out as a near area to learn in, a path, and a far area for the challenge, with at least 4 cm
  (half a metre) to walk between things.
- Sky: `day`, `dawn`, `dusk`, `night` or `overcast`. Ground: `grass`, `sand`, `snow` or `rock`.
- Signs stand on the place, 15 to 25 cm up, readable from the start spot. The host places the panel.
- The player walks by thumbstick or teleport; the design shows the way (a path or a glowing ring).

## Write in the design

1. The mode, and why.
2. The scene plan, in the solver's format (`scene.md`):
   - every thing once, with a `role` (`hero`, `tool`, `target`, `button`, `set`, `ground`, `scenery`, `panel`) and a
     `size` [width, height, depth] in metres, the game's units; `count` for several of the same, `lift` for one that
     floats above the ground;
   - only the relations that matter to the game: `left of`, `right of`, `in front of`, `behind`, `beside`, `near`,
     `far`, `on`, `above`, `in`, `between`, `around`, `facing`, and `room` for the space a moving thing needs.
   The roles do the rest: the hero in front of the player, what the hands use in reach, the set out of the way.
3. What the player sees in the first second, and the one thing that bounces to say "touch me first".
