# Hand actions: what the player does, the IWSDK piece for it, and the sequence that tests it

Pick each move's hand action from this table. The component names are IWSDK's; for their fields and exact use, the
authority is `.agents/skills/iwsdk-dev/references/api-reference.md` (sections "Grabbable Components" and "Input &
Interaction") and the `get_api_reference` tool. If the typecheck disagrees with this page, the typecheck is right.

| Hand action | The player does | IWSDK | The game knows when |
|---|---|---|---|
| **Grab and place** | pinches a thing, carries it, lets go at a place | `OneHandGrabbable` on the thing | the thing leaves the `Grabbed` tag (a query on `[Thing, Grabbed]`, `disqualify`) near the place; snap it there and count the move |
| **Press** | pokes a button with a fingertip | `PokeInteractable` and `RayInteractable` on the button | the button gains the `Pressed` tag (a query on `[Button, Pressed]`, `qualify`) |
| **Press on a panel** | pokes a UIKitML button | the panel entity has `PokeInteractable`; the element has an id | the element's `click` listener runs |
| **Hold and tilt** (pour, tip) | pinches a thing and turns the wrist | `OneHandGrabbable` on the thing | while it has `Grabbed`, the angle between its up axis and world up passes a threshold (read `entity.object3D`'s world quaternion in `update`) |
| **Carry along a path** (stir, wipe, trace) | pinches a tool and moves it through places | `OneHandGrabbable` on the tool | the held tool passes each waypoint in turn (distance checks in `update`) |

Notes that save time:

- A thing has **one** grab component. `OneHandGrabbable` is the hand-pinch one; it works because hand pinch grabs by
  default in this project.
- `Grabbed` and `Pressed` are tags IWSDK adds and removes. Read them with queries; never add or remove them.
- To put a thing back (Try again), release it first with `GrabSystem.forceRelease(entity)`, then set its position.
- Give each thing its runtime name on its `Object3D` (`mesh.name = 'Log 1'`) or as the scene node's `name`. The
  emulated hand finds targets by that name, and `xr_list_targets` shows what it can find.
- A placed thing that should stay put: remove its `OneHandGrabbable`, or it can be pulled away again.
- Keep the things to grab apart by at least their own width, so the hand takes the one it aims at.

## The sequences that test them

First, once per page load: enter XR (`xr_accept_session`), set hand mode (`xr_set_input_mode` with `{"mode":"hand"}`)
and list the targets (`xr_list_targets`). Then, for `xr_run_sequence`:

Grab a thing, carry it to another named thing, let go:

```json
{"device":"hand-right","steps":[
  {"target":"Log 1","approach":{"distance":0.06},"pinch":{"value":1,"at":"arrival"}},
  {"target":"Dam Slot 1","depart":{"distance":0.08}},
  {"pinch":0,"duration":0.15}]}
```

While the hand holds something, a step that targets a surface sets the held thing down on it. A step may give
`"position":{"x":0.3,"y":1,"z":-0.6}` (metres from the player's start; -Z is forward, +Y up) instead of a `target`.
The result lists the events the app saw: with no `selectstart`, the pinch never reached the thing.

Press a button or a panel element with the fingertip (a press, never a pinch):

```json
{"device":"hand-right","steps":[{"target":"Start Button","press":{}}]}
```

The press landed when `presses[0].contactMs` is under 800; at 800 or more, run it once more.

Hold and tilt is the hardest to get right; choose it only when the subject needs it. Grab as above, then a step
that turns the hand, a step that holds, and let go:

```json
{"device":"hand-right","steps":[
  {"target":"Jug","approach":{"distance":0.06},"pinch":{"value":1,"at":"arrival"}},
  {"position":{"x":0.1,"y":1.15,"z":-0.5},"depart":{"distance":0.1}},
  {"label":"tip","orientation":{"pitch":0,"yaw":0,"roll":-70}},
  {"label":"hold","duration":1.5},
  {"pinch":0,"duration":0.15}]}
```

After the tip step, read the held thing's `Transform` to see that it turned with the hand before building on it.

Add `"dryRun":true` beside `"device"` to check a sequence's plan without moving the hand. After any sequence, read
`GameState` (`ecs_find_entities` with `{"withComponents":["GameState"]}`, then `ecs_query_entity` with its
`entityIndex`) and compare it with what the move should have done.
