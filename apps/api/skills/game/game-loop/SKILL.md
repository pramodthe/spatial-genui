---
name: game-loop
description: Attract mode, start, score, lives, restart, difficulty, and the scoreboard behind the board.
---

# Game loop

- One goal, understood in five seconds. The panel's first line says how to play, in one sentence.
- Before Start, the game plays a demo of itself (attract mode). Nothing scores until the player starts. Put a big pressable START piece on the playfield as well as the panel button.
- `update(time, delta)` moves, collides and scores. Multiply speeds by `delta` and clamp it with `Math.min(delta, 0.05)`.
- Score, lives or time is a stat. A status line says what just happened. Win or lose is a clear message, and Play again is one press. It gets harder as the player does well.
- The panel is the HUD beside the playfield, in reach (a pointing hand cannot reach a panel behind the scene). One to three buttons.
- Name important meshes (`object.name = 'Paddle'`).
