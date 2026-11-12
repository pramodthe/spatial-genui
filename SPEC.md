# Spatial Generative UI: Project Spec

- **Working title:** TBD
- **Status:** Draft v0.1, November 12, 2026
- **Competition:** Meta VR Start Developer Competition 2026 (rules summary in `llm.txt`)
- **Hard deadline:** Wed November 18, 2026, 12:00 PM PT. Target submission time: 9:00 AM PT.

---

## 1. Vision

Generative UI (GenUI) lets an AI agent build the interface at runtime instead of a developer shipping it in advance. Today it exists for 2D screens (A2UI, AG-UI, Flutter GenUI SDK, CopilotKit). We bring it to spatial computing. A user speaks or pinches a request, and agents generate the spatial UI, 3D models and interactions on the spot, in passthrough on the user's real desk, ready to grab with their hands.

The long-term picture is a "Jarvis" for AR: voice, hands and GenUI together, for any domain (learning, commerce, productivity).

**First use case (competition entry):** on-demand, hands-on learning. "Teach me the solar system" makes an interactive 3D lesson assemble on your desk: models you can grab, spin and pull apart, labels and explanations, and a quiz you answer by touch.

## 2. Goals

| Goal | Success looks like |
|---|---|
| **Research** | Answer RQ1–RQ4 (section 3) with measured results; enough material for a paper even if the product falls short. |
| **Product** | A working, hands-first WebXR entry submitted before the deadline that stays online until about December 11, 2026. |

**Not in scope by Nov 18:** commerce and productivity domains, multiplayer, user accounts, lessons persisting across sessions, a native Quest APK. These go in the "future plans" section of the submission.

## 3. Research questions

- **RQ1. Spatial GenUI:** Can an LLM agent generate working, hand-interactable spatial UI components for WebXR at runtime? How does **open** GenUI (the agent writes code) compare with **declarative** GenUI (A2UI) and **controlled** GenUI (the agent picks pre-built components) in XR?
- **RQ2. Model choice:** Which LLMs (Claude, OpenAI, Kimi, Qwen, …) generate the best spatial UI, measured by success rate, quality, latency and cost?
- **RQ3. 3D generation:** Which architecture produces the best 3D assets within Quest performance budgets and time limits: raw code, CadQuery, Blender through MCP, or text-to-3D services? How much do reference images and a critic loop help?
- **RQ4. Parallelism:** How much does splitting work across parallel agents cut time-to-content without lowering quality?

## 4. Prior art (done; full review in `docs/paper/prior-art.md`)

Spatial GenUI is **not empty territory**. The closest work:

| Work | Overlap with us |
|---|---|
| Microsoft **LLMR** (CHI 2024) | Runtime code generation for Unity mixed reality |
| Google **XR Blocks / Vibe Coding XR** (VRST '26) | LLM-friendly WebXR SDK; Gemini-only benchmark scored only on "no runtime errors" |
| Google **three-live** (Beta) | Sandboxed runtime for agent-written Three.js on WebXR, Android XR and visionOS |
| Penn State **LLMER** (TVCG 2025) | LLM-generated JSON scenes in Unity |
| Meta **IWSDK 1.0** | AI-agent tooling, but for developers at build time, not end users at runtime |

**Gaps we target:**
1. Nobody compares the GenUI types (open, declarative, controlled; see Phase 1) for spatial UI on one runtime, and nobody uses the GenUI protocols (AG-UI, A2UI) in XR. The prior work maps onto these types: three-live, XR Blocks and LLMR are open GenUI; LLMER is declarative.
2. No benchmark compares several providers with scoring for hand interaction and comfort layout.
3. No real A2UI renderer exists for XR (only a 7-star browser demo).
4. No end-user runtime GenUI product exists on Quest.

**Revised novelty claim:** an A2UI-compatible spatial GenUI runtime for WebXR on Quest, with hand interactions built into every component, plus the first multi-provider benchmark that compares output formats for runtime spatial UI. **Don't claim "first GenUI in VR."**

## 5. Architecture overview

```
 User (voice / hands)
        │
        ▼
 ┌──────────────────────┐   event stream (SSE/WebSocket)  ┌───────────────────────────┐
 │  XR client (IWSDK)   │ ◄─────────────────────────────► │  Agent server (TS)        │
 │  passthrough, hands  │                                 │  orchestrator + workers   │
 │  GenUI host runtime  │                                 └──────┬─────────┬──────────┘
 │  module loader +     │                                        │         │
 │  validator           │                         model gateway  │         │ 3D jobs
 └──────────────────────┘           (Claude, OpenAI, Kimi, Qwen) │         ▼
                                                                 │  ┌─────────────────────┐
                                                                 │  │ 3D worker sandbox   │
                                                                 │  │ (Python: CadQuery,  │
                                                                 │  │ Blender + MCP)      │
                                                                 │  └─────────────────────┘
                                                                 ▼
                                                   asset store + generation cache
```

### Key decisions

| Decision | Choice | Why |
|---|---|---|
| XR platform | WebXR with Meta's Immersive Web SDK (IWSDK), passthrough (`immersive-ar`) | Content can load at runtime, which GenUI needs; a native Quest APK can't compile new C# at runtime. Submission is a hosted link, with no APK or release channel. |
| Agent framework | **TypeScript + Vercel AI SDK, no LangChain** | Same language as the client and the shared SDK schema (Zod types used by both agents and renderer). Works with any provider: Anthropic, OpenAI, and OpenAI-compatible endpoints for Kimi and Qwen, which the benchmark needs. Built-in structured output, tool calling and streaming. A thin layer, so prompts stay fully visible and controllable for a fair benchmark. Orchestration is plain async code. *Alternative:* LangGraph (Python) if the team is Python-first. |
| 3D workers | Python service in a container | CadQuery and Blender's Python API (`bpy`) are Python-only. |
| Agent ↔ XR client connection | **AG-UI protocol** (`@ag-ui/client`, `@ag-ui/core`, v1.0.4 on npm) | CopilotKit's standard connection between an agent and a frontend. It supports every GenUI type, so all versions share one connection, and it makes ours the first AG-UI client for XR. |
| Model access | Direct provider APIs, or one gateway (OpenRouter or Vercel AI Gateway) | One key and one interface for the benchmark. |
| Speech-to-text | Server-side (e.g. Deepgram or Whisper) | The Quest Browser's built-in speech recognition is unreliable. |

---

## 6. Phases (in priority order)

The order below is the logical order. The schedule in section 7 runs some phases in parallel, because they don't fit the deadline back to back.

### Phase 1: Generative UI agent

**Goal:** an AI agent that **writes the code** for spatial UI components at runtime (panels, buttons, quiz cards, 3D objects, animations), and that code appears and works in the live WebXR scene. No pre-built components: the agent writes everything.

In [CopilotKit's taxonomy](https://www.copilotkit.ai/generative-ui), this is **Open Generative UI**: "the agent owns the entire visual surface" and returns complete UI code that runs in a sandbox. CopilotKit calls Open GenUI "still mostly experimental" even on 2D screens, which is exactly why doing it in XR is a research contribution.

**Status (Nov 12):** Steps 1–4 are built and running (`apps/server`, `apps/xr/src/genui/`). Verified so far:
- The host mounts agent-written code in the IWSDK emulator: 3D meshes, UIKitML panels loaded from generated markup, button handlers, `update()` animation.
- An emulated hand pinch grabs, moves and releases an object the agent marked `grab: true` (`OneHandGrabbable` attached by the host).
- First real generation (Claude Sonnet 5.5 through Anthropic's OpenAI-compatible endpoint): a solar system with the Sun, 8 planets, 10 panels and a quiz. It passed all checks first try, but took **96 s** (13.7k output tokens including thinking).
- **First finding from the emulator:** the planets were packed 1–2 cm apart, so one pinch grabbed two of them. Making the agent repair the spacing backfired: for a pizza it removed grabbing entirely. **The fix belongs in the host.** Grabbables closer than 4 cm get ray grab (`DistanceGrabbable`, which picks exactly the object it hits); well-spaced ones keep touch grab. This was verified: the ray grab held only Mars among planets 1 cm apart. The dry run now records `crowdedGrabPairs` as a statistic. This interaction-level behaviour is invisible to a pass@1 "no runtime errors" metric (XR Blocks).

**✅ Gate 1 passed (Nov 12): 10/10** development prompts (`bench/prompts/dev-10.json`) generated, passed the checks and mounted in the emulator with zero runtime errors. Model: Claude Sonnet 5.5 via the OpenAI-compatible endpoint.

| | Result |
|---|---|
| Passed first try / after repair | 5 / 5 |
| Failure causes (all repaired) | 3× output cut off at the 16k-token limit (limit now 32k), 3× crowded grabbables (now handled by the host), 1× syntax error |
| Time per generation | median 71 s; 25 s (single planet) to 185 s (fractions, with repair) |
| Quality (from screenshots) | Strong for data and UI (bar chart with correct 2024 UN figures, product card, kanban). Weak for organic 3D: a heart as balls on sticks, a blobby shoe. That is Phase 3's job |

**Known issues carried forward:**
- Latency (60–180 s) is far too slow for a live demo → Phase 5 (parallel agents, streaming, cache).
- The comfort-fit ignores panel heights, so a panel-heavy UI (kanban) can come out over 1 m tall → host fix.
- The starter's welcome panel overlaps generated content, and the desktop prompt box isn't visible in the headset → Phase 4.
- Node `vm` is not a security boundary, and the browser runs checked code on the main thread → harden before deployment (Phase 6).

**Step 1: prior-art review.** ✅ Done; see section 4 and `docs/paper/prior-art.md`.

**Step 2: the agent writes components as code.** The agent receives a request ("show me the solar system with a quiz") and returns a JavaScript module built with Three.js, the 3D library IWSDK uses:

```js
// Written by the agent at runtime, not by us
export default function build({ THREE, traits, ui }) {
  const root = new THREE.Group();

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 32, 16),
    new THREE.MeshStandardMaterial({ color: 0xffcc33, emissive: 0xffaa00 }),
  );
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 24, 12),
    new THREE.MeshStandardMaterial({ color: 0x3366ff }),
  );
  traits(earth, { grab: true, label: 'Earth' });   // ask the host for hand interaction
  root.add(sun, earth);

  const quiz = ui(`<panel>…Which planet is closest to the Sun?…</panel>`); // spatial UI markup
  root.add(quiz);

  return {
    root,
    update(t) { earth.position.set(Math.cos(t / 2) * 0.25, 0, Math.sin(t / 2) * 0.25); },
  };
}
```

- **3D objects:** written directly in Three.js.
- **UI panels** (text, buttons, quiz cards): written as spatial UI markup. IWSDK has an HTML-like markup for 3D interfaces (UIKitML) that it can load at runtime. Check on day 1 that this works for generated markup; if not, the agent writes panels in Three.js too.
- **Behavior:** an `update(t)` function for animation and handlers for taps and grabs.

**Step 3: the host, the small piece of plumbing that runs whatever the agent writes.** It contains no components; it only connects generated code to the XR scene:

| Part | What it does |
|---|---|
| **Loader** | Receives the generated module and adds its result to the live IWSDK scene |
| **Safety check** | Before loading: parse the code and reject anything that uses the network, `eval`, the DOM or imports. Then run it once in a Web Worker as a dry run, which catches crashes and infinite loops (three-live's idea) |
| **Error isolation** | Each component's `update` and handlers run in try/catch; a broken component is removed without crashing the app |
| **Hand-interaction bridge** | Plain Three.js objects aren't grabbable. The agent marks objects with `traits(obj, { grab, poke, scale })`, and the host attaches IWSDK's hand-interaction components to them |
| **Comfort and performance guard** | Moves content into the seated reach zone and field of view, and rejects scenes over the triangle or draw-call budget |

**Step 4: repair loop.** If the safety check, dry run or loading fails, the error goes back to the agent so it can fix its own code, with at most 2 retries.

**Later: the other GenUI types as baselines for the paper (only after Gate 1).** To claim "Open GenUI is better or worse in XR", the paper needs something to compare against. CopilotKit's three types give the natural comparison:

| Version | GenUI type | Agent outputs | Why |
|---|---|---|---|
| **A** (Steps 2–4 above) | **Open** | A full Three.js module | Our main approach |
| A′ | Open, with a helper library | Code that may only call a small helper library | Matches Google's XR Blocks approach, for direct comparison |
| C | **Declarative** | A2UI v1.0 JSON with a spatial catalog | The industry standard; LLMER suggests it may be more reliable |
| D | **Controlled** | Picks one of a few hand-built spatial components and fills in its data | The most reliable type; costs us engineering work per component |

If there's no time for these, the paper's claim narrows to the multi-model benchmark of Version A.

**Deliverables:** an agent that writes component code, the host (loader, safety check, interaction bridge), the repair loop, 10 development prompts, and a first render in the desktop browser and emulator.

**Exit gate (Fri Nov 13, end of day):** prompt → agent-written code → working in the IWSDK scene, with grabbable objects, for at least 7 of 10 development prompts.
**Fallback:** if free code is too unreliable, the product switches to Version C and Version A stays a research result. A negative result is still a valid result.

### Phase 2: LLM benchmark for spatial GenUI

**Goal:** a measured answer to which model generates spatial UI best.

**Status (Nov 12):** harness built and piloted.
- **Generation:** `apps/server` `npm run bench`.
- **Emulator mount + hand probes:** `apps/xr` `scripts/bench-browser.mjs`.
- **Vision judge:** `npm run bench:judge`.
- **Report:** `npm run bench:report`.

Candidates are pinned in `bench/models.json` (IDs and prices from OpenRouter's catalog, Nov 12). Prompts are a held-out set, `bench/prompts/test-12.json`, because the dev prompts were used to tune the system prompt.

**Pilot (4 Claude models × 4 prompts, 1 run each, judged by Claude Opus only, so there's no self-preference control yet):**

| Model | pass@1 | Success | Grab works | Quality | Median time | Cost / success |
|---|---|---|---|---|---|---|
| Fable 5.2 | 4/4 | 4/4 | 3/4 | 4.5 | 125 s | $0.61 |
| Opus 5.5 | 3/4 | 4/4 | 3/3 | 4.06 | 59 s | $0.16 |
| Sonnet 5.5 | 4/4 | 4/4 | 4/4 | 4.0 | 42 s | $0.08 |
| Haiku 5.5 | 4/4 | 4/4 | 3/3 | 3.5 | 18 s | $0.003 |

Early signal (n=4, not conclusive): every Claude tier writes valid spatial UI. Quality rises with model size, and so do latency and cost; Haiku is 7× faster than Sonnet. That matters for Phase 5 routing, e.g. a fast draft followed by a refine. The pilot cost about $3.4 in generation (estimated from tokens × catalog prices).

**Run 1 (Nov 12): Sonnet 5.5 vs Muse Spark 1.3 (Meta API) vs DeepSeek V4.1 Flash (Fireworks).** 12 held-out prompts × 2 repetitions = 72 scenes. The judge panel is the three models themselves; quality excludes a model's own family and is adjusted for each judge's strictness. Full table in `bench/results/run-1/summary.md`, side-by-side screenshots in `gallery.html`.

| Model | pass@1 | Success | Mounted clean | Grab works | Quality, Opus 5.5 judge | Panel (adj.) | Median time | Cost / scene |
|---|---|---|---|---|---|---|---|---|
| Sonnet 5.5 | 100% | 100% | 24/24 | 14/17 | **4.18** | **4.32** | **40 s** | $0.075 |
| Muse Spark 1.3 | 100% | 100% | 24/24 | **23/24** | 4.13 | 4.25 | 98 s | unknown (no price listed) |
| DeepSeek V4.1 Flash | 92% | 100% | 23/24 | 14/14 | 3.97 | 4.05 | 47 s | **$0.010** |

The main quality score comes from **Claude Opus 5.5 as an independent judge** (not a contestant, though it's made by Anthropic like Sonnet). It agrees with all three contestant judges on the order Sonnet ≥ Muse > DeepSeek. Sonnet and Muse are effectively tied (0.05 apart; with Opus, Sonnet had the best version of 12 of 23 requests and Muse 11). By criterion, **clarity is every model's weakest score (3.3–3.5 / 5)**: overlapping or crowded panels. That's the clearest target for improving the system prompt and host layout.

**Findings:**
- **All three can do Open GenUI in XR:** 72/72 succeeded within ≤2 repairs, across all tiers. Quality differences are small but consistent: every judge, including Meta's and DeepSeek's, ranked Sonnet ≥ Muse ≥ DeepSeek.
- **Judges grade on very different curves.** Muse gave a mean of 4.7, Claude 3.8. Unadjusted cross-family scores are therefore misleading, which is a methodological point for the paper.
- **Our test run was looser than the real runtime.** It ran as a lenient (sloppy-mode) script, while browsers load the code as a strict module. A DeepSeek scene (`sunGroup里 = null`) passed every server check but crashed in the browser. The dry run is now strict, and all 71 other scenes still pass.
- **Grab failures:** an `InstancedMesh` marked grabbable (Sonnet, times tables), probably unsupported by IWSDK's grab (to verify), plus 2 unexplained misses.

**Known gaps in the harness:**
- Panel buttons (e.g. quiz answers) aren't probed yet, only trait-based press/grab.
- Ray-grab probes can hit a neighbouring object first, e.g. nested Earth shells.

**Candidates.** Pin exact model IDs on benchmark day and record them.

| Provider | Models |
|---|---|
| Anthropic | Claude Opus 5.5 (`claude-opus-5-5`), Fable 5.1 (`claude-fable-5-1`), Sonnet 5.5 (`claude-sonnet-5-5`), Haiku 5.5 (`claude-haiku-5-5`) |
| OpenAI | GPT-6 Astra (as named in WorldBench, Oct 2026) and a fast tier |
| Moonshot | Kimi K3 |
| Alibaba | Latest Qwen coder model |
| Google | Gemini 3.1 Pro, Gemini 3 Flash (needed for direct comparison with XR Blocks) |
| Optional | Grok 4.7, DeepSeek, GLM |

**Methods borrowed from prior work:**
- Report pass@1 (no runtime errors) in the same way as XR Blocks' VCXR60, so results can be compared directly.
- Use WorldBench's two-channel judge: explore the running scene and also read the code.
- Validate the judge with mutation tests: remove features on purpose and check the judge notices.

**Task suite.** Prompts in three difficulty tiers:

- **T1:** a single component ("a slider that changes planet size").
- **T2:** a composed scene ("the solar system with labels").
- **T3:** interactive with state ("a 3-question quiz about the heart with scoring").

Prompts span learning, commerce, productivity and data visualization, so we can show it generalizes.

**Test harness (`bench/`).**

1. The prompt and the arm's system prompt plus SDK docs (identical for every model) go to the model; the raw output is saved.
2. Playwright drives headless Chromium with IWER, Meta's WebXR emulator.
3. The output is loaded and rendered in the scene.
4. Measurements are collected (table below).

| Metric | How it's measured |
|---|---|
| Render success | Loads, no runtime error within 5 s, at least one visible object |
| Success after repair | Succeeds within 2 repair rounds |
| Interaction pass | A simulated grab or poke in IWER on each declared interactive element triggers the expected change |
| Layout compliance | Interactive elements inside the reach zone, essential text inside the FoV cone, no overlaps |
| Performance | Draw calls, triangle count, budget compliance |
| Quality | Screenshots from 3 angles scored 1–5 by a vision-model judge, using a cross-provider judge panel to reduce self-preference bias, plus blind human ratings on a subset |
| Latency | Time to first token, time to a valid module |
| Cost | Dollars per successful scene |

**Two sizes of benchmark:**

- **Competition run (by Sat Nov 14):** 12 prompts × about 6 models × the 2 best arms × 2 runs. Estimate cost from a 5-prompt pilot first and set a budget cap.
- **Paper run (after Nov 18):** 40+ prompts, all arms, 5 runs each, more models, plus a small user study.

**Deliverables:** a leaderboard table, a list of how and why generations fail, and model routing rules for Phase 5 (for example, a fast model for planning and the best model for code).

### Phase 3: 3D generation architectures

**Goal:** find the 3D pipeline with the best balance of quality, speed, cost and named-part structure.

**Pipelines compared:**

| ID | Pipeline | Output |
|---|---|---|
| P1 | LLM → Three.js geometry code (built from parameters and primitives) | Meshes built at runtime |
| P2 | LLM → CadQuery (Python) → STEP/STL → GLB | GLB |
| P3 | LLM agent → Blender through MCP (`bpy`) in a sandbox → GLB | GLB |
| P4 | Text-to-3D service (e.g. Meshy, Tripo, Hunyuan3D, TRELLIS); check licensing | GLB |
| P5 | Text → generated image → image-to-3D | GLB |

**Add-ons, tested on P1–P3:**

- **M1: reference image.** Generate an image first and give it to a multimodal LLM.
- **M2: critic agent.** Render 4 views, a vision-model critic lists problems and gives a score, then the generator revises, for at most 3 rounds or until the score passes a threshold.
- **M3: retrieval.** Few-shot examples taken from a library of good past outputs.

**Experiment:** P1–P5 as baselines, then P1–P3 × {M1, M2, M1+M2}, on about 20 objects across astronomy, biology, mechanical, everyday and architecture.

| Metric | How it's measured |
|---|---|
| Prompt alignment | A vision-model judge scores renders from 4 angles (with CLIP score as a secondary measure) |
| Human preference | Blind pairwise votes ranked with an Elo score |
| Named parts | Number of named parts; whether it supports explode, labels and grabbing a single part (key for learning) |
| Quest budget | Triangles, GLB size, draw calls |
| Reliability | Success rate |
| Latency | Median (p50) and 90th-percentile (p90) generation time |
| Cost | Dollars per asset |

**Hypothesis:** code-based pipelines (P1–P3) win on named parts, which interactive learning needs (e.g. "grab Saturn's ring" or a "left ventricle" label). Generated meshes (P4/P5) win on how realistic organic shapes look. The production answer is probably a **router that picks a pipeline by object type**.

**Sandbox:** a Docker image with Python, CadQuery, headless Blender and the Blender MCP server. Limits on CPU time and memory, and no network beyond an allowlist. Run it locally first; choose a cloud host in Phase 6.

**Exit gate (Sun Nov 15, end of day):** production pipelines and router rules chosen.
**Fallback:** P1 plus a curated library of licensed models.

### Phase 4: XR integration and hand interaction

**Goal:** confirm that generated UI and 3D content can be used with hands alone, in passthrough, at 60 fps or better on Quest. This phase **starts on day 1 in parallel**, using hand-written sample components.

- **Scaffold:** `npm create @iwsdk@latest`, an `immersive-ar` session with passthrough and hand tracking.
- **Placement:** detect the table surface (WebXR plane detection) and place the lesson on it, scaled to fit. If no surface is found, place it at a fixed seated position about 0.5 m in front of the user, at table height.
- **Interaction contract:** generated elements declare their interactions in metadata, and the runtime attaches IWSDK interaction components (grab, distance grab, poke, two-hand scale). **An explicit test:** do raw Three.js objects from Arm A still get interactions?
- **Comfort zones** (starting values, tune on the headset): interactive elements within about 0.6 m reach (the "airplane seat test"), and essential UI within ±30° horizontally and ±20° vertically of straight ahead.
- **Input:** voice is optional (poke a mic button, then server-side speech-to-text). There's always a hands-only path: topic chips, follow-up suggestion chips and a virtual keyboard.
- **Generation UX:** a placeholder appears instantly, components fade in as they're ready, with a progress indicator and a cancel option.
- **Performance:** target 72 fps on the Quest 3 browser, with 60 fps as the minimum. The SDK enforces triangle and draw-call caps and simplifies or rejects oversized GLBs.

**Hand-interaction test matrix.** Run it in the emulator, automated where possible, then on the headset.

| Interaction ↓ / Content source → | Hand-written | Arm A | Arm B | Arm C | P1 mesh | P2/P3 GLB | P4 GLB |
|---|---|---|---|---|---|---|---|
| Direct grab | | | | | | | |
| Distance grab (pinch ray) | | | | | | | |
| Poke button or panel | | | | | | | |
| Two-hand scale/rotate | | | | | | | |
| Explode / select part | | | | | | | |
| Answer a quiz by poke | | | | | | | |

**Headset sessions:**

- **Session 1 (Sat/Sun):** interaction matrix, surface placement, fps.
- **Session 2 (Tue):** final regression test and video capture.

**Exit gate:** every interaction type works on hand-written content and at least one generated source in the emulator by Saturday, then on the headset in session 1.

### Phase 5: multi-agent parallelization

**Goal:** make generation fast enough for the "one bus stop" test (`llm.txt:77`).

**Steps:**

1. **Planner** (fast model): turns the request into a lesson plan, as JSON listing the components with their dependencies and priorities.
2. **Workers, run in parallel:**
   - UI workers, one per panel.
   - 3D workers, one per object, using the pipeline the router picks.
   - A content worker for explanations and quizzes, grounded in fact data so it doesn't hallucinate.
   - An image worker, plus optional text-to-speech.
3. **Critics:** run alongside, on items as they finish.
4. **Streaming:** events go to the client in AG-UI style: `RUN_STARTED`, `PLAN_READY`, `COMPONENT_STARTED`, `COMPONENT_READY`, `COMPONENT_FAILED`, `RUN_FINISHED`. Consider extending AG-UI/A2UI for spatial use, which is a research contribution in itself.

**Supporting pieces:**

- **Limits and fallbacks:** concurrency and per-provider rate limits. Timeouts fall back to simpler output; for example, a slow 3D job shows a primitive placeholder version.
- **Cache:** keyed on the normalized request plus a hash of the component spec. Demo lessons are generated in advance.

**Latency targets** (starting values):

| Milestone | Target |
|---|---|
| Placeholder visible | 1 s or less |
| First real component | 8 s or less |
| Full lesson, excluding slow 3D | 30 s or less |

**Measure:** compare against generating everything one after another, and re-run part of the benchmark to confirm quality didn't drop.

### Phase 6: final architecture and deployment

**Hosting:**

- XR client: static site (Vercel or GitHub Pages; WebXR requires HTTPS).
- Agent server: Node service that supports long-lived streams.
- 3D worker: a container host that can run Blender, needed only if P3 ships. Choose by Monday.

**Security:**

- API keys only on the server.
- Rate limit per session.
- **Global daily spending cap**, falling back to a demo mode with saved lessons when reached.
- Moderation on input and output (`llm.txt:126-127`: no logos or real people).
- Sandboxed code execution, the AST allowlist and a Content Security Policy (CSP).

**Reliability:**

- At least 3 curated lessons generated in advance and loaded instantly (solar system plus 2 more).
- Live generation on top of those.
- Fallback to the second-best model if the main provider fails.
- Health checks and an uptime monitor.

**Freeze and submission:**

- Feature freeze Tue Nov 17, 12:00 PT; code freeze Tue night.
- Submit Wed Nov 18 by 9:00 AM PT.
- No changes after that. The backend, API keys and budget stay live until December 11 or later (`llm.txt:192`).

**Submission package:**

- Video under 3 minutes, starting with the "ask → it appears → grab it" moment.
- Devpost description of about 500 words, tagline of 140 characters or fewer, and screenshots.
- Build link tested while logged out.

---

## 7. Schedule (parallel lanes)

The schedule assumes 2 people. With 3, split Lane B into "XR" and "3D".

| Day | Lane A: GenUI and benchmark | Lane B: XR and 3D | Milestone |
|---|---|---|---|
| **Thu Nov 12** | Prior-art review ✅; agent writing component code with one model; host loader | IWSDK scaffold; passthrough and hands in emulator; hand-written sample components | First agent-written component on screen |
| **Fri Nov 13** | Safety check, dry run, repair loop; 10 development prompts | Interaction contract; loading generated modules into the scene | **Gate 1:** prompt → rendered component, end to end |
| **Sat Nov 14** | Benchmark harness; competition run | 3D pipelines P1, P2, P4; sandbox image | Headset session 1 |
| **Sun Nov 15** | Benchmark analysis → model choice | P3 (Blender MCP), M1/M2 add-ons; 3D evaluation | **Gate 2:** models and 3D pipeline chosen |
| **Mon Nov 16** | Phase 5 orchestrator and event stream | Generation UX, voice input, placement polish | Full flow working end to end |
| **Tue Nov 17** | Deploy, security, cache, demo lessons | Performance pass; headset session 2; video capture | Feature freeze at noon, code freeze at night |
| **Wed Nov 18** | Devpost text, final checks | Video edit and upload | **Submit by 9:00 AM PT** |

## 8. Competition compliance

| Requirement | How we meet it |
|---|---|
| Hands-first, end to end (`llm.txt:65`) | Every flow works by hand; voice is an optional extra |
| Seated, 2-foot radius (`llm.txt:76`) | Reach-zone layout enforced by the SDK |
| A complete moment in 10 minutes or less (`llm.txt:77`) | Saved lessons load instantly; one lesson takes about 5 minutes |
| "Take it away" test (`llm.txt:78`) | Without the AI, the host runtime and saved lessons still work |
| 60 fps or better on Quest (`llm.txt:138`) | Budgets enforced at load; checked on the headset |
| Passthrough with a purpose (`llm.txt:137`) | The lesson sits on, and scales to, your real desk |
| Free, working build link (`llm.txt:96`, `98`) | Hosted HTTPS link with no login; spending cap plus fallback |
| Online until about Dec 11 (`llm.txt:192`) | Backend and budget kept live; uptime monitor |
| Content rules (`llm.txt:126-127`) | Moderation on input and output |
| **Track / division** | Productivity (tentative) / New Experience; special award target: Best Agentic Interaction |

## 9. Risks

| Risk | Mitigation |
|---|---|
| 6 phases in about 5.5 days | Parallel lanes, hard gates, separate competition and paper runs; research continues after Nov 18 |
| Free-form code generation is unreliable | Repair loop; Arm B/C fallback; saved demo lessons |
| 3D generation too slow for live use | Placeholders and streaming; demo lessons generated in advance; route live requests to P1 |
| Blender sandbox too heavy to host | P3 can win the benchmark without shipping in production |
| Hallucinated facts in lessons | Ground the content worker in fact data; critic checks quiz answers |
| Limited headset access | Build in the emulator first; two scheduled headset sessions |
| API outage or cost spike during judging | Spending cap, provider fallback, saved lessons |
| Overlap with 3D prior work (SceneCraft, LL3M…) | Base the novelty claim on spatial GenUI and the XR-specific benchmark |
| WebXR feature support on Quest Browser (surface detection, hands) | Verify in the emulator on day 1 and in headset session 1; fallback placement |

## 10. Open questions

- Team size, roles and each person's strongest language (TS or Python)?
- Dates for the headset sessions?
- API budget for the benchmark and the judging period?
- Project name?
- The 3 curated demo lessons (solar system + ?)?
- Paper venue and timeline (after Nov 18)?

## 11. Repo layout

```
apps/xr/                IWSDK WebXR client
apps/server/            agent server (TS, Vercel AI SDK)
packages/genui-host/    host runtime: loader, safety check, interaction bridge, guards
workers/3d/             Python 3D worker: CadQuery, Blender + MCP (Docker)
bench/                  prompts, harness, raw outputs, results, reports
docs/paper/             research notes and draft
```
