# Mistakes seen in generated games and lessons

Each of these happened in a real generated scene. Read them once before you finish.

1. **A lesson with a game bolted on.** A boat game kept the look's numbered stage flags ("1 Harbour", "2 Lighthouse")
   with no harbour or lighthouse behind them, because they came with the lesson starter. Every object in a game is
   there for the game: if it has no job in a move or the challenge, it is scenery, and scenery has no numbers.

2. **The hero lost in the scene.** The sailboat the player steered was a thin mast on a small dark hull, smaller
   than the crates it collected. The hero is the biggest interactive thing and stands out in colour
   (`references/feel.md`).

3. **The thing being built vanished.** A paper plane lesson put the sheet inside a group that a later step hid, so the
   paper disappeared for three folds. Build the hero once and keep it visible from the first move to the challenge;
   later steps change it, never replace or hide it.

4. **Buttons instead of hands.** Folds were presses on the paper, so the player watched the paper fold itself. When
   the real action is moving something, the hand moves it (`references/design.md`, Build it).

5. **Losing before playing.** A current pushed the boat onto rocks while the player was still reading the panel, so
   the hull was half gone before Start. Nothing scores, drifts into danger or times out before Start.

6. **A still world.** Water drawn as faceted triangles that never moved, because `look.update(time)` was not called.
   Call it every frame; give idle things a small motion.

7. **A decoy to grab.** The only grabbable thing in a steering game was a "Lucky buoy", while the boat was steered by
   an invisible pinch-drag anywhere. Say how to control the hero on the panel, and make grabbable only what the player
   should pick up.

8. **A challenge that measures something else.** Points for clicking fast, in a game about balance. The number at the
   end must depend on the idea (`references/design.md`, The challenge).

9. **Walls of text.** A panel paragraph of 60 words that no one reads in a headset. Two short sentences at most;
   the why is one line; the voice tutor is there for more.

10. **Reading the engine instead of building.** A run spent most of its time printing the kit's and the gate's source
    code. Everything a game needs is in this skill, the look's skill and `/skills/common`; read those, then build.

11. **A panel no hand can reach.** A boat game put its scoreboard behind the playfield, as old game rules said, and
    the pointing ray hit the sea before it reached Start. The panel stands beside the game, in reach.

12. **Too many controls.** A bat game asked for a turned left hand to aim, a finger tap on a pad to chirp, then a
    pinch-drag-release of a marker to catch, with a three-chirp bonus; a fruit game had catch, turn, swipe, pinch,
    drop and Serve. Players could not tell what the game was. One gesture per move, at most three different hand
    actions, each learned in its own move before the round uses it, and the game said in one sentence.

13. **The starter left in.** `look.demo(subject)`, REPLACE markers or the starter's "Touch every piece" challenge
    left in the game. The check stops on all three.

14. **Try again kept the last round.** A dam game reset the water and the score on Try again but left the wall
    standing, so the next round was won by waiting. Try again puts everything back as Start found it: the pieces
    home, the hero as it began.

15. **A win without the idea.** The same dam was won with a thin wall and no base stones, the one move the lesson
    was about, and the win text still praised "your thick base". The challenge cannot be won while the move that
    carries the idea is skipped, and the win text says what the player really did.
