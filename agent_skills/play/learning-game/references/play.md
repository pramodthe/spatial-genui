# The play block: how a hand plays this game

`build()` returns a `play` block beside `root` and `update`. It says, as data, what a player's hand does: one
gesture for each move, then the gestures that play one round. The check (`scripts/check.mjs`) plays them with a
simulated hand, at 72 and at 30 frames a second, again after Try again, and with no hand at all, and prints what
went wrong as `Play:` lines. A game that cannot be played through by its own gestures cannot be played by a person
either.

```js
return {
  root, update,
  play: {
    learn: [                                        // one gesture per move, in the order of MOVES
      { grab: flap, to: creaseSpot },               // pinch the flap, carry it to the spot, let go
      { press: lever },
    ],
    challenge: [                                    // what a good player does in one round, in order
      { grab: plane, path: [[0, 0.12, 0.1], [0, 0.16, -0.1]], seconds: 0.3, throw: true },
    ],
    state: () => ({ phase, move, result, stars }),
  },
};
```

## Gestures

| Gesture | What the hand does | For |
|---|---|---|
| `{ grab: place, to: place }` | pinches there, carries to the second place, lets go with a still hand | folding, placing, stacking, sorting |
| `{ grab: place }` | pinches there for a moment and lets go | picking a thing up, a tap by pinch |
| `{ grab: place, path: [place, ...], seconds, throw: true }` | pinches, moves along the points in `seconds`, lets go while still moving | throwing, launching, flicking |
| `{ grab: place, to: place, until: () => boolean }` | pinches, carries, and holds it there until `until` is true, then lets go | pouring from a jug into a bowl |
| `{ press: object }` | presses a 3D button (an object with `onPress`, or spawned `game.Pressable`) | levers, Start on the playfield |
| `{ button: 'id' }` | presses a panel button by its id | Start, Try again |
| `{ hold: place, seconds, pinch: true }` | keeps the hand there, pinching or not, following the place when it moves | pouring, steering, hovering |
| `{ path: [place, place, ...], seconds, pinch: false }` | sweeps the hand along the points | swiping, slicing |
| `{ wait: seconds }` | nothing | letting something finish |

Every gesture also takes:

- `hand: 'left'` (the right hand is the default).
- **The hand's pose**, in degrees: `tilt` (fingertips tipped down), `roll` (right side down), `yaw` (turned to the
  right). Each is a number, or a function read every frame: `roll: () => 20 * steerToward(nextHoop)`. A level hand
  is the default. A held thing turns with the hand, as in the headset, so read a tilt or a twist from the held
  thing's own rotation (the hands kit does). A gesture that pinches keeps the hand level until it has pinched, then
  turns it: the jug is taken upright and tipped, the knob is taken and turned. A jug that pours by tipping needs
  `tilt`; a knob turns by `roll`; a bar that steers by its roll needs `roll`.
- `until: () => boolean` on `hold`, `wait` and `grab`: the gesture ends when it turns true (a channel opens, the cup
  is full). On `hold` and `wait`, `seconds` is then the longest it lasts (20 without it); a `grab` waits up to 20 s
  where it carried the thing. Running out is a failure.
- `keep: true` on a gesture that pinches: the hand does not let go at its end, and the next gesture of that hand
  carries on holding (take the handle to start, then steer with it).

A **place** is an object (its centre is used, wherever it is at that moment), `[x, y, z]` in the units the game is
built in (the same coordinates as `hands.right.tip`), or a function that returns either, for a place that depends
on the game's state: `to: () => nextSlot()`. A `hold` reads its place every frame; `to` and `path` read theirs once.

What the simulated hand does, so the gestures match it:

- A pinch within 4 cm of a grabbable thing picks it up: it follows the hand and `isGrabbed(object)` is true until
  the pinch ends. A pinch in the air only shows in `hands`.
- A thing that is hidden when the hand wants it is waited for, up to 5 s (a piece that comes back when the last
  move has settled). After that it is a failure.
- A challenge gesture is cut short when the round ends, and after the last one the round has 30 s to end by
  itself, so no `wait` is needed at the end.
- In a world, a place farther than an arm (0.8 m) is walked to, at 1.4 m a second.

## Hand actions: the hands kit

Pour, stir, fold, twist and cut have tested helpers in every module (`/skills/game/hands`), each with the gesture
that plays it. Use the helper's places, which stay right wherever the game is placed:

| Action | Gesture |
|---|---|
| pour (`handPour`) | `{ grab: jug, to: pour.above, tilt: 70, until: () => pour.poured >= 150 }` |
| stir (`handStir`) | `{ grab: spoon, path: stir.path(2), seconds: 3 }` |
| fold (`handFold`) | `{ grab: corner, path: fold.path, seconds: 0.8 }` |
| twist (`handTwist`) | `{ hold: knob, pinch: true, roll: 90, seconds: 1 }` |
| cut (`handCut`) | `{ grab: knife, path: cut.path, seconds: 0.5 }` |

## The round, Start and Try again

- `learn` is for moves done before Start. When the moves are done inside the round (Start, then fold eight
  times), write `learn: []`, put every hand action in `challenge`, and give `moves: <how many>`: the played round
  must count that many.
- `start` and `again` say how a round starts and restarts. Leave them out when the panel has buttons with the ids
  `start` and `again` (the starter's do); else name what the hand does: `start: { press: startButton }`, or
  `start: { grab: handle, keep: true }` when taking a thing starts the round. After Try again the game may go
  straight into a round or back to waiting for Start; both are fine.
- `challenge` may be a function returning the gestures, when a later round starts from a different scene.

## State

`state()` is read after every frame of a round. It returns

- `phase`: `'learn'` while moves are learned before Start, `'ready'` while the game waits for Start, `'play'`
  during a round, `'done'` when the round has ended. The game's own names for these are mapped here:
  `phase === 'idle' ? 'ready' : phase === 'won' || phase === 'lost' ? 'done' : 'play'`;
- `move`: how many moves are done so far;
- `result`: the measured result of the round that just ended (a number), `null` at any other time;
- `stars`: 0 to 3 for that round, `null` at any other time.

In an ECS game these come from the Round entity: `phase: round.getValue(Round, 'phase')`.

## What the check proves, and what each failure means

| Finding | It means | Usual fix |
|---|---|---|
| Move N did not register | the gesture was done and the move was not counted | make the gesture the real action, or fix what counts the move as done |
| The gesture for move N also completed move N+1 | two moves are one hand action | make them two things to do, or one move |
| The game went to 'play' by itself | a round began before Start | wait in `ready`; nothing scores before Start |
| Start / Try again did not begin a round, or its button is hidden | a player could not start either | show the button when the moves are done and when a round ends |
| The round did not end | 30 s after the last gesture the game is still in `play` | end the round by itself; or the gestures did nothing: check where each aims and the hand's pose |
| What the gesture waits for (until) had not happened | the hold did not do its work | aim it where the tool's effect lands; give the pose the game reads |
| Ended without a measured result | `result` is not a number or `stars` is not 0 to 3 | set both when the round ends |
| Earned no star | the game did not answer its own best play | the gestures do not play it well, or the scoring is wrong |
| Completed M of the game's N moves | a move in the round is never counted | count it when the hand has done it |
| Did not fly | a thrown thing stopped where the hand let go | give it the hand's speed at release (how far the hand moved in the last frames, divided by the time) |
| At 30 frames a second... | the same play gave a different result | multiply every speed, clock and fill by `delta` |
| With no hand, a move completed or was counted | `done()` does not depend on the hand | a move is done only when the hand has done it |
| With no hand the round ended with 2 or 3 stars | the result comes from a timer | make the result depend on the action |
| After Try again and no hand, the next round ended with 2 or 3 stars | Try again kept what the last round built | put everything back as Start found it |
| The game failed during the play-through | an error or a number that is not a number, somewhere past the first second | fix the line it names |

## Writing honest gestures

- Write the gestures a first-time player would make after reading the move's `say`: the same object, the same
  direction, about the same distance. Do not write a gesture that only satisfies `done()`, and do not change the
  game from inside a place, `until` or pose function: they only read what a player can see.
- With a held tool, aim the tool's effect, not the hand: hold the hand where the water lands on the mark, not at
  the mark (a function place does this, reading where the effect is now).
- One gesture per move is the rule. A move that needs several hand actions is too big: split the move.
- The challenge's gestures are a good round, not a perfect one: they should earn at least one star.
- Keep them up to date: when a move changes, change its gesture in the same edit, and run the check.
