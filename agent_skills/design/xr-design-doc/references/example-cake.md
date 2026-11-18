# Example: "teach me how to make a cake"

A complete design at the expected quality. Positions are desk centimetres from the desk centre: x to the right, y up,
z towards the player.

```markdown
# Rise and Bake — Design

Weigh, mix and bake a sponge cake with your hands, then see how high it rises.

## 1. Learning
- Kind: procedure
- The idea: a cake rises when the mix holds air and a hot oven sets it before the air escapes.
- After playing, the player can:
  - name the four main sponge ingredients and weigh them (equal weights)
  - explain why butter and sugar are beaten together (it traps air)
  - explain why the oven is heated to about 180 °C first
  - say that an adult uses a real oven, with oven gloves
- Ages: about 9 to adult

## 2. Player fantasy
You are a young baker at your own little kitchen table. Everything is there: a bowl, a whisk, a scale and a tiny
oven. Your cake rises because of what your hands did.

## 3. Core loop
1. Goal: "Bake a sponge cake that rises high and even."
2. Moves: 7 hand steps, below.
3. Challenge: the cake bakes (sped up to 10 seconds); its rise in cm and how even its top is are measured. Both
   depend on the amounts, the mixing and the oven heat, which is the idea.
4. Result: stars, best rise, Try again (keeps the level and the recipe card, resets the bowl, tin and oven).

### Moves
| # | Move (real action) | Hand action | What the scene answers | Why | done() when |
|---|---|---|---|---|---|
| 1 | Weigh the butter | Grab and place 25 g slices on the scale | Scale needle and number rise | Equal weights keep a sponge balanced | 100 g ± 10 on the scale, then tipped into the bowl |
| 2 | Add the sugar | Pour: hold the scoop over the bowl and tip it | Sugar pours, bowl number rises | Sugar sweetens and helps trap air | 100 g ± 10 in the bowl |
| 3 | Cream butter and sugar | Stir: the whisk follows the right tip around the bowl | Mix turns paler and fluffier each turn | Beating traps tiny air bubbles that lift the cake | 20 or more turns |
| 4 | Crack two eggs | Grab an egg, bring it down on the rim | Shell splits, egg drops in | Eggs hold the bubbles and set firm in the oven | 2 eggs in the bowl |
| 5 | Fold in the flour | Pour 100 g, then stir gently | Flour disappears into the mix | Gentle mixing keeps the air in | 100 g ± 10 and 8 or more turns |
| 6 | Pour into the tin | Pour: hold the bowl over the tin and tip it | Batter fills the tin evenly | An even layer bakes evenly | Bowl empty, tin full |
| 7 | Set the oven and bake | Twist the knob, then press Bake | Dial shows °C, oven glows, Bake button sinks | A hot oven sets the bubbles before they escape | Bake pressed |

## 4. Controls
| Action | Hand | Gesture | Basic action and API | Object and size | Zone | Feedback (see, hear) | Emulator check |
|---|---|---|---|---|---|---|---|
| Weigh butter | Right | Pinch a slice, drop it on the scale | Grab and place: `traits(slice, { grab: true })` | Slice 3 × 3 × 1 cm | Shelf to scale | Needle moves, soft thud | Grab slice, release over scale: `scaleGrams` +25 |
| Pour sugar or flour | Right | Hold the scoop over the bowl and tip the hand | Grab + tilt: `isGrabbed(scoop)` and the scoop itself tipped at least 30° | Scoop 5 cm | Within 6 cm above the bowl | Grains fall, sand pour sound | Hold scoop over bowl tipped 45° for 1 s (`{ hold: bowl, pinch: true, tilt: 45 }`): `bowlGrams` rises 25 g per second |
| Cream, fold | Right | Circle the whisk inside the bowl | Follow: whisk follows `hands.right.tip`, clamped to the bowl | Whisk 10 cm | Inside the bowl rim | Mix lightens, swish per turn | Tip circles the bowl centre 20 times: `turns` ≥ 20 |
| Crack egg | Right | Bring the held egg down on the rim | Grab and place: crack when the held egg crosses the rim moving down | Egg 4 cm | Above the bowl | Shell splits, crack | Grab egg, move 6 cm down over rim: `eggs` +1 |
| Pour batter | Right | Hold the bowl over the tin and tip the hand | Grab + tilt | Bowl handle 4 cm | Within 6 cm above the tin | Batter ribbon, tin fills | Hold bowl over tin tipped 60° for 3 s (`{ hold: tin, pinch: true, tilt: 60 }`): `tinFull` |
| Set oven | Right | Turn the knob's handle | Twist: angle of the grabbed handle around the knob centre | Knob 5 cm, handle 3 cm | Oven front | Dial number, click per 10 °C | Rotate handle 180°: `ovenC` = 180 ± 5 |
| Bake | Right | Press the button | Press: `traits(button, { onPress })` | Button 4 cm | Oven front | Button sinks, oven hums | Press: `baking` is true |

Each emulator check is also the move's gesture in the game's `play` block (`/skills/play/learning-game/references/play.md`),
and the values it names (`bowlGrams`, `tinFull`, `ovenC`) are returned by `play.state()` beside `phase`, `move`,
`result` and `stars`.

## 5. Environment
- Mode: desk, because baking is learned by hand at a table.
- First second: the kitchen set on the desk; the butter slices bounce first.

| Object | Position (x, y, z cm) | Size (cm) | Hands touch it? |
|---|---|---|---|
| Mixing bowl (hero, persimmon) | 0, 0, 8 | 12 wide | Yes (handle, when pouring) |
| Scale | -14, 0, 6 | 10 | No |
| Ingredient shelf: butter, sugar, flour, eggs | -18 to -6, 0, -6 | 3 to 5 each | Yes |
| Whisk | 9, 0, 12 | 10 long | Yes (follows hand) |
| Cake tin | 12, 0, 4 | 12 wide | No |
| Oven with knob and Bake button | 18, 0, -6 | 20 wide | Knob and button |
| Panel | host-placed, beside the game | | Yes |

## 6. Levels and progression
| Level | What changes | 1 star | 2 stars | 3 stars |
|---|---|---|---|---|
| 1. Follow the recipe | Guide marks on the scale and a turn counter | Cake baked | Rise ≥ 2.5 cm | Rise ≥ 3.5 cm and even top |
| 2. From the card | No guide marks; only the recipe card | Cake baked | Rise ≥ 2.5 cm | Rise ≥ 3.5 cm and even top |
| 3. Fix the recipe | A friend's card has one mistake (200 g flour or 120 °C); find it before baking | Cake baked | Mistake found | Mistake fixed and rise ≥ 3.5 cm |
| 4. Bake for twice as many | Double every amount, bigger tin | Cake baked | All amounts doubled within 10% | Rise ≥ 3.5 cm and even top |

## 7. Mistakes, failure and reset
| Wrong step | What happens | How the player recovers |
|---|---|---|
| More than 110 g flour | Cake is low and heavy (rise ≤ 1.5 cm) | Try again; the card notes "too much flour" |
| Fewer than 12 creaming turns | Less air, lower rise | Try again |
| More than 20 turns after the flour | Air knocked out, lower rise | Try again |
| Oven below 160 °C | Cake sinks in the middle | Try again; the dial shows the right mark |
| Oven above 210 °C | Dark, domed, cracked top | Try again |

- During the moves, a wrong amount can be scooped back out; no points are lost.
- Nothing scores or times out before the first move. Try again keeps the level and card, resets bowl, tin and oven.

## 8. Facts and safety
| Fact the game teaches | Value and units | Where it appears |
|---|---|---|
| A simple sponge uses equal weights of butter, sugar, flour and egg | About 100 g each; 2 medium eggs ≈ 100 g without shells | Moves 1, 2, 4, 5 |
| Self-raising flour has a raising agent mixed in | – | Move 5 why, on the card |
| Oven temperature for a sponge | 180 °C (160 °C fan) | Move 7, the dial mark |

Safety notes: an adult uses a real oven; oven gloves for hot tins; wash hands after cracking eggs.
Facts to check: the bake time for this 2-egg mix in one 20 cm tin (shown as 10 seconds in the game; the real time
appears on the panel only once checked).
Game values (not real-world facts): the rise heights and star thresholds come from the game's model.

## 9. Visual and UI direction
- Look: ink-toon, because it is made for recipes and how-tos with a few recognisable objects
- Theme and setting: a sunny kitchen corner drawn like a cookbook comic; the player is a young baker getting ready
  for a friend's birthday
- Palette:
  | Colour (ink-toon palette) | Used for |
  |---|---|
  | persimmon | The mixing bowl (hero) and the oven's glow |
  | cream | Batter, eggs, the scale's face |
  | mustard | Butter, the risen cake, the star burst on success |
  | white | Flour, the recipe card |
  | navy | Whisk, scoop, oven body, tin |
  | bean | Wooden shelf and spoon handles |
- Panel voice: a cheerful baker friend; opening line: "Bake a sponge cake that rises high."
- Signs: one big step word per move with `look.stepWord` ("WEIGH", "CREAM", "CRACK", "FOLD", "POUR", "BAKE");
  the rise in cm on a sign beside the cake after baking
- Feedback: success = mustard star burst and a pop; try again = a wobble and the item slides back, no red
- Motion: snappy, on twos (the look's style); batter ripples; the next ingredient bounces; steam squiggles while baking
- Sound: crack, grain pour, whisk swish, oven hum, a ding when baked (sound library)

## 10. Assets
| ID | Type | Gameplay role | Real size | Made from | Matches style of | Used by | Source |
|---|---|---|---|---|---|---|---|
| style-kitchen | Style | Ink-toon look, palette above, real-scale kitchen props | – | – | – | All | Designer |
| bowl | 3D model | Hero; holds the mix; poured from | 12 cm | – | style-kitchen | Moves 1–6 | Look builder |
| batter | Mesh inside bowl | Shows mixing (colour, fluffiness) | Fills bowl | bowl | style-kitchen | Moves 2–6 | Kit shape |
| whisk | 3D model | Follows the hand to stir | 10 cm | – | style-kitchen | Moves 3, 5 | Look builder |
| egg | 3D model | Cracked into the bowl | 4 cm | – | style-kitchen | Move 4 | Kit shape |
| butter-slice | 3D model | Weighed on the scale | 3 cm | – | style-kitchen | Move 1 | Kit shape |
| scoop | 3D model | Pours sugar and flour | 5 cm | – | style-kitchen | Moves 2, 5 | Kit shape |
| scale | 3D model | Shows grams | 10 cm | – | style-kitchen | Moves 1, 2, 5 | Look builder |
| tin | 3D model | Holds batter; shapes the cake | 12 cm | – | style-kitchen | Move 6, challenge | Kit shape |
| oven | 3D model | Knob, Bake button, glow | 20 cm | – | style-kitchen | Move 7, challenge | Look builder |
| cake | Mesh | Rises; shows the result | 12 cm | tin, batter | style-kitchen | Challenge | Kit shape |
| recipe-card | Sign | Shows amounts; level 3 mistake | 10 cm | – | style-kitchen | All levels | `kit.sign` |
| sfx-crack, sfx-pour, sfx-whisk, sfx-ding | Sound | Feedback | – | – | – | Moves 2–7 | Sound library |

## 11. Checks
Logic checks:
- 100 g butter, 100 g sugar, 2 eggs, 100 g flour, 20 creaming turns, 10 folding turns, 180 °C: rise ≥ 3.5 cm, even top.
- The same with 200 g flour: rise ≤ 1.5 cm.
- Oven at 140 °C: result is "sunk".
- Level 4 with every amount doubled gives the same rise as level 1.

Hand checks:
- Grab a butter slice, release over the scale: `scaleGrams` = 25.
- Grab an egg, move it 6 cm down over the rim: `eggs` = 1.
- Tip circles the bowl centre 20 times: `turns` ≥ 20.
- Grab the knob handle, rotate 180°: `ovenC` = 180 ± 5.
- Nothing changes before the first move.

## 12. Out of scope
- Icing, decorating, cutting and tasting
- Other cakes and real bake time (the bake is sped up)
- Real oven use: the game says an adult does this
```
