---
name: xr-game-ui
description: Decide a VR game's visual direction, draw the first-view mockup on the canvas, and build restrained in-world panels and signs that support play - palette, materials, panel placement, text size and feedback.
---

# XR Game UI

Build surfaces that support play instead of turning the game into a dashboard floating in space. Keep an established look when changing an existing game.

## Visual direction

Before the mockup or any art, decide and write in the design document (section 9): the place and who the player is there, the material language (wood and stone, soft clay, paper, metal), a palette of 4 to 6 colours with one accent kept for what the hands touch, how the panel speaks, and how motion feels. Keep the palette as named constants in one module and use it everywhere, so the generated art and the shapes built in code belong together.

## The first-view mockup

Add one image node to the canvas board and generate it with `generate_canvas_media`:

- It shows what the player sees in the first second, from standing eye height: the main thing of the game in the middle within arm's reach, the things to pick up beside it, the panel off to one side, the place around them.
- Write the prompt as a scene description: subject and action first, then viewpoint ("first-person view from standing eye height, hands not shown"), then the material language and palette, then the light. Say "no text, no letters" unless a sign matters.
- Aspect ratio `16:9`. Title the node "First view mockup" and say in its description that it is a reference, not a production asset.

Read the picture. Take from it the layout (what is where, what is big), the colours and the mood, and carry them into the scene, the models and the panel. Do not put the mockup itself into the game.

## Layout rules in VR

- Protect the space between the player's eyes and the main thing: no panel, sign or effect in front of it.
- The player starts at the origin with their eyes 1.6 m up, looking along -Z. Put the work surface about 1.05 m up and the things to touch 0.6 to 0.7 m in front, so each is within 50 degrees to the side and no more than 40 degrees below straight ahead. A table 0.9 m up puts everything on the bottom edge of the view.
- The panel stands beside the playfield, 0.8 to 1.2 m from the player, at or just below eye height (1.2 to 1.5 m up), turned to face them. It is never above the head, behind the player or at the far side of the scene.
- The whole panel is within 45 degrees of straight ahead: with its centre 1 m away and 25 degrees to one side, a 0.6 m panel fits. `playtest_view` measures this and the things to touch in about 15 seconds; the replay and the independent check fail a game that breaks it.
- Keep it small: a panel or a sign is at most 0.6 m wide and 0.4 m tall. Nothing wider than 0.5 m stands within 1 m of the player except the main thing of the game. A big board close to the eyes hides the game it describes.
- All of a panel's text sits inside it with a margin. Long lines are cut, not shrunk: see it in a screenshot before trusting it.
- Show only what the player needs now: the goal in one sentence, then one `why` at a time, the measure during the round, the stars after it. No walls of instructions.
- Text is large: a line of body text at least 3 cm tall at 1 m. Prefer a number with its unit to a sentence.
- Use only plain keyboard characters in panel text (letters, digits, basic punctuation): the panel font draws a box for others, such as the "·" in "N·m". Write "N m".
- Use the scene itself for feedback before the panel: a glow on the next thing to touch, a part that moves, a colour that changes.
- Do not cover the view with blur, vignettes or head-locked overlays.

## Controls

- Every control says what it does: a word or two of UIKitML on it or right beside it ("Start", "Check", "Next level"). A coloured box with no words is not a button; a child cannot guess what it does. The replay fails a pressed control with no panel text within 0.2 m of it.
- Show only the controls that apply now: Start before the round, Check during it, Try again and Next level after it. Hide the others.
- Keep the controls on the panel or beside it, so the sentence that explains the step and the button that ends it are read together.

## Panel and sign art

- Never stand a generated picture up as scenery: no backdrop board, poster or framed painting behind the game. In a headset a flat picture reads as a board, not as a place. Pictures go on 3D surfaces as textures (a wood grain, a tiled floor, a painted crate), and on a sign only when the game needs that sign.
- Keep the changing text, numbers and buttons in UIKitML, set from code.
- A picture used as a panel background or a sign needs calm areas where text sits; ask for that in the prompt.
- Simple bars, dials and markers are built in code.

## Feedback

Give each kind of feedback one look and one sound for the whole game: success (the accent colour, a short rising sound), try again (a gentle wobble and a soft sound, never red and never a buzzer), and the next thing to do (a slow pulse). Keep it short; a child should be able to act again within a second.

Check the result in the runtime with `../xr-game-playtest/SKILL.md`: the opening view and the result view, from where the player stands.
