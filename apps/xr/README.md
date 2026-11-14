# IWSDK App

This project uses `iwsdk.config.json` for declarative scene, asset, component,
XR, and emulator configuration. Application systems remain explicit in
`src/index.ts`.

```sh
npm install
npm run dev
```

Use the Runtime and Editor controls in the managed browser to switch between
the running experience and its authored scene.

## What is here

The authored scene holds only lights and a shadow catcher: the IWSDK starter content (robot, welcome panel,
station labels and studio props) was removed. Everything the learner sees is built at runtime by the GenUI host
in `src/genui/` (lessons, the lesson picker in `public/ui/lesson-picker.uikitml`, labels and move handles) and
by the 2D start page. See the repository README for how the app and the agent server fit together.

- Minimal scene walkthrough: https://iwsdk.dev/guides/01b-minimal-scene.html
- XR-enabled projects — IWER emulator controls: https://iwsdk.dev/guides/02-testing-experience.html#iwer-controls
