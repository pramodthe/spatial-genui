# This request is an app specification, not a learning game

The request in this run is a complete specification of an XR app, taken from a published benchmark. For this run, these points replace the learning-game conventions above (the child of 9, the three moves, Start and a round, levels, stars) and the 30-minute aim:

- Build exactly what the request specifies, every sentence of it. Do not add a lesson, levels, a Start button or a score it does not ask for, and do not weaken a requirement to make it easier to build or to test. Where the request is silent, choose what a careful developer would. Take the time the specification needs.
- The design document on the canvas is a requirements checklist, and it replaces the 12-section template: one line per requirement of the request, in its own words, with how the app meets it. At the end, mark each line as verified (and how) or not verified (and why).
- When the request needs the real room (passthrough, depth, occlusion, planes), change the XR session in `iwsdk.config.json` (`world.xr`) to the mode and features it needs; IWSDK's reference tools say how. Say in the summary what the emulator could and could not show of it.
- Keep one `GameState` component as the app's readable state: `phase` (`play`, then `result` when the app reaches its end state) and a field for each thing the request counts or shows. `movesDone`, `score`, `stars` and `level` may stay 0. The checker reads this component after every hand action.
- `playtest.json` (written with `playtest_record`) holds hand steps that show each main interaction working, each with the `GameState` change it causes. The replay does not have to reach the end of the app.
- The first-view mockup and generated art are for requests that leave the look open. When the request fixes the look, build that look.
