# Headset app

The app on the Quest: WebXR in mixed reality, built on Meta's [IWSDK](https://iwsdk.dev). The authored scene holds
only lights and a shadow catcher (`iwsdk.config.json`); everything the learner sees is built at runtime.

```
src/index.ts            starts the world, the GenUI host and the start page
src/genui/
  host.ts               mounts a generated module: its entities, panels, hands, sound; desk or world mode;
                        and cleans everything up when the next one opens
  overlay.ts            the prompt box and status, writing, repairing and opening lessons and games
  start-page.ts         the 2D start page (Learn and Play)
  picker.ts             the in-headset picker (public/ui/lesson-picker.uikitml)
  courses.ts, games.ts, lessons.ts   courses, saved games, and the example lessons and games
  hud.ts                the title card a game opens with
  bounds.ts, handle.ts, grab.ts, hover.ts, game-hands.ts, rig.ts   the frame, handles, grabbing and the hands
  voice.ts, voice-agent.ts           speech to text and the voice tutor
  sound.ts, capture.ts, library.ts   sound, pictures for look-and-fix, library models
public/games/, public/lessons/       the example games and lessons, ready to open
tests/                  smoke tests in the IWSDK emulator
```

`src/assets.ts` and `src/components.ts` are IWSDK's (empty) asset and component manifests; its build expects them.

```bash
npm install
npm run dev          # the app and the emulator browser on https://localhost:8081 (/api goes to :8787)
npm run typecheck
npm run build
npx @iwsdk/cli browser run tests/hands-smoke.mjs   # a smoke test, with the dev server running
```
