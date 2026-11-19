# playtest.json: the game played by hand, written down

`playtest.json` at the project root lists the hand sequences that play the game from its first move to a result, in
order, each with what `GameState` shows afterwards. The tool `playtest_record` writes it: it runs a step's sequence
and adds the step when the move worked, so do not write the file by hand. `playtest_replay`, and afterwards the
independent check, reload the page, enter XR with hands, and replay the file with nothing else: if a step needs
state that only an ECS edit or an earlier unsaved action gave it, the replay fails there. This is the file's shape:

```json
{
  "version": 1,
  "state": "GameState",
  "steps": [
    {
      "id": "move-1",
      "sequence": { "device": "hand-right", "steps": [
        { "target": "Log 1", "approach": { "distance": 0.06 }, "pinch": { "value": 1, "at": "arrival" } },
        { "target": "Dam Slot 1", "depart": { "distance": 0.08 } },
        { "pinch": 0, "duration": 0.15 } ] },
      "waitMs": 800,
      "expect": { "movesDone": 1 }
    },
    {
      "id": "start",
      "sequence": { "device": "hand-right", "steps": [ { "target": "Start Button", "press": {} } ] },
      "expect": { "phase": "play" }
    },
    {
      "id": "round",
      "sequence": { "device": "hand-right", "steps": [ { "target": "Gate Lever", "press": {} } ] },
      "waitFor": { "phase": "result", "timeoutMs": 30000 },
      "expect": { "stars": { "gte": 1 } }
    }
  ]
}
```

- `sequence` is exactly the input of `xr_run_sequence`; `playtest_record` takes the same object.
- `waitMs` waits that long after the sequence before the state is read (default 500).
- `waitFor` waits until those `GameState` fields have those values, up to `timeoutMs` (default 15000). Use it for
  anything the game takes time over, such as a round that runs for some seconds.
- `expect` is checked against `GameState`. A plain value must be equal; `{ "gte": n }`, `{ "lte": n }` and
  `{ "ne": v }` compare.

What the checker requires:

1. One step for each row of the design's Moves table, in order, then Start, then the round.
2. Every sequence completes.
3. `GameState` changes at every step: a step that changes nothing is a move the game did not notice.
4. After the last step `phase` is `result` and `stars` is at least 1.
5. The console has no errors.
