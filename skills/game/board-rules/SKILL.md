---
name: board-rules
description: Move generation for chess-like pieces and for pieces on a grid.
---

# Board rules

Generate legal moves in code. Do not ask the model to remember a position.

A grid (checkers, go, reversi): squares are `(file, rank)`. A step is `±1` in file and/or rank. A move is legal when the destination is on the board and empty, or holds an opponent, and the piece's rule allows that step. Store the board as a flat array of `files * ranks` and index it with `rank * files + file`.

Chess-like sliders (rook, bishop, queen): walk a direction until the edge, a friendly piece (stop before it) or an opponent (include that square, then stop). Knights jump; check the destination only. Kings take one step and may not move adjacent to the other king.

Apply a move by copying the board, clearing the origin and writing the piece on the destination. The game shows the legal destinations when a piece is pinched, and plays the move when a destination is pinched.
