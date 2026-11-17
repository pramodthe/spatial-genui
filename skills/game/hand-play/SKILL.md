---
name: hand-play
description: The hands API. Tools follow a hand, a pinch acts, both hands, and a lost hand stays put.
---

# Hands

`build` also receives `hands`. Read it inside `update`. `hands.left` and `hands.right` are `{ tracked, tip, palm, pinching, pinched }`. `tip` and `palm` are `THREE.Vector3` in `root`'s coordinates. `pinching` is true while the pinch holds. `pinched` is true only on the frame a pinch starts.

- A paddle, bat, net or cannon follows `hands.right.tip` every frame, clamped to the playfield and smoothed with lerp. No pinch is required to move it.
- A pinch fires, jumps, launches or places. It counts wherever the player's hand is around the game: over the playfield and within about 25 cm of it (in front of the board, above it). A pinch out at the menu or across the room reports `pinching` and `pinched` as false. The other hand is the second tool or the second player.
- Hits are distances from the hand or its tool to the ball or target. Tools are at least 0.06 m. Targets are at least 0.03 m.
- `traits` grab is only for pieces the player picks up and puts down. Balls, enemies and shots are never grabbable.
- When `tracked` is false, leave the tool where it was.
