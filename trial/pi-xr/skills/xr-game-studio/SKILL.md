---
name: xr-game-studio
description: Create a complete VR learning game for a child from a short idea, in this IWSDK project, coordinating the canvas design, a visual mockup, a first playable slice, production art (pictures, 3D models, sounds), implementation and a hands play-test; route changes that span specialist domains.
---

# XR Game Studio

Use this skill for a new game and for work that spans several domains or has no clear path. Preserve an existing project's conventions unless the request asks otherwise.

A learning game here is one real idea the player comes to understand by doing it with their hands. "Deeper water pushes harder" is taught by building a dam and watching the bottom log strain, not by a label that says so.

## Classify the work

- `create`: deliver a coherent game with a complete core loop, intentional art, clear hand actions, failure and reset behaviour, and feedback for every action.
- `feature`: trace the existing structure, implement the requested behaviour, and check nearby regressions.
- `bugfix`: reproduce it, find the cause, make the smallest reliable fix, and rerun the affected flow.
- `polish`: tie a visual, sound or feel change to a named improvement the player notices.

Do not turn a focused feature or bug request into a redesign of the game.

## Create a game

1. **Design on the canvas.** Use `canvas_initialize` if the canvas is missing, then read `canvas/AGENTS.md`. Write the main design document, `canvas/documents/design.md`, from `references/design-template.md` (12 sections, about 800 words): the idea, the player fantasy, three moves, one measured round, three levels, mistakes and reset, the visual direction, and an **asset list** with each asset's gameplay role, size, source and where the game will load it from. Register it in `canvas/index.json` as `mainDocumentId`, put a document node on the board, and run `canvas_check`.
2. **One mockup of the first view.** Use `../xr-game-ui/SKILL.md`. Add an image node for what the player sees in the first second, generate it with `generate_canvas_media`, and read the picture. It sets the direction for the art and the layout; it does not fulfil the asset list. Then add the image and model-3d nodes for the production art the asset list names and start them with `generate_canvas_media` and `background: true`: the first 3D model can take ten minutes while the generator starts, and the playable slice does not need it.
3. **A small playable slice, before any production art.** Follow IWSDK's planner (`.agents/skills/iwsdk-dev/references/planner.md`), with the design as its contract and `references/hand-actions.md` for the hand actions. Remove the starter's demo content you do not need. Build the `GameState` component, the main thing of the scene from plain shapes, and **move 1 only**. Typecheck, enter XR with hands, and play move 1 with `playtest_record` (id `move-1`, its hand sequence, `expect: { "movesDone": 1 }`): it runs the sequence, reads `GameState` before and after, and writes the step into `playtest.json` only when the move worked. A working move 1 matters more than anything else in the session; every later move is built the same way.
4. **The rest of the loop.** Moves 2 and 3, the Start button, the round and its measure, the result (stars from the level's thresholds), Try again (same level, state reset, nothing left held) and Next level after a star. Keep the level numbers in one `LEVELS` array.
5. **Production art, integrated.** Collect the art started in step 2 (call `generate_canvas_media` again with the same nodes), generate what is still missing, and put it into the working game with `../xr-3d-asset-pipeline/SKILL.md`: a 3D model only for a thing a few plain shapes cannot make (at most three), pictures only as textures on 3D surfaces, sounds from the library (`references/sounds.md`). Blocks, planks, wedges, balls, posts and tables are built in code even with art budget left, and get their look from colour, material and a generated texture (a wood grain is one picture and seconds; a model is minutes, and up to ten while the generator starts). The budget is a limit, not a target. Record each generation as a node on the board and generate through `generate_canvas_media`. Keep the design document in step with meaningful decisions. Every generated model must be in view from where the player starts. The surroundings are 3D and belong to the idea (a bench and a fence around a playground seesaw), or stay plain; never a flat picture standing behind the game.
6. **Play-test and close.** Use `../xr-game-playtest/SKILL.md`: record every move, Start and one round with `playtest_record`, then run `playtest_replay`, which reloads the page and replays the file exactly as the independent check will and measures the first view (each panel's size, distance and angle). Fix what it reports and run it again until it passes. Check the asset list against the actual files and their use in the game. Then compare the opening view with the mockup: take a screenshot from the player's start and read it beside the mockup picture, name the three biggest differences (what is where, how big it is, what is missing or in the way), fix the ones that are cheap, and say which remain. Then read the same screenshot as a child who has never seen the game: from the picture alone, say what to do first and what each control does. What you cannot say from the picture needs words, or a pulse on the next thing to touch. Repair what falls short and recheck it.

When an asset cannot be generated because the tool fails or its budget is used, use a coherent substitute built in code and say so in the final report. Do not retry an unchanged failing generation.

## What makes it teach

- **Three moves**, each a real action from the subject, each teaching one part of the idea, each with a `why` of about 12 words that the panel shows after it. At most three different hand actions in the game; the first use of each is easy.
- **One round**: after the moves, the player presses Start and does it for real. Something is measured in real units, and the measure depends on the idea, so understanding it is how you score.
- **The idea is visible where it acts.** The quantities that decide the result are shown on the objects and change as the hands change them: the weight and the distance on each side of a seesaw, an arrow for each push, the depth marked on the dam. The panel can repeat them; it does not replace them.
- **The scene answers every action at once**, with something seen and something heard. Silence after a hand action reads as "broken".
- **Nothing scores, drifts or times out before Start.** The learning moves have no clock.
- **A wrong step shows why it matters** and can be undone; it is never just "Wrong".
- **Few words**: the goal in one sentence, then one `why` at a time. The doing is the lesson.

## Route by domain

Read only the specialist skills the request needs:

- State, structure, input mapping, levels: `../xr-game-foundations/SKILL.md`
- Visual direction, the mockup, panels and signs: `../xr-game-ui/SKILL.md`
- Generated pictures, 3D models and sounds in the game: `../xr-3d-asset-pipeline/SKILL.md`
- Playing by hand, the replay file, visual checks: `../xr-game-playtest/SKILL.md`
- IWSDK code, scenes, panels, grab and press, physics, debugging: IWSDK's own skills, starting from `iwsdk-dev`

For mixed work, keep one plan (`update_plan`) and one definition of done across all of them.

## Contract

- Follow the project's `AGENTS.md`. The dev runtime is the harness's: never start or stop it.
- The game's state is one `GameState` component; every thing the hands touch has a unique name.
- Generated files under `assets/generated/` are not part of the game until a copy is under `public/` and `src/assets.ts` registers it.
- Verify in proportion to the change. Never claim a visual or hand check that was not actually performed.
