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
| 3D workers | Python service on Modal (`apps/worker3d/modal_app.py`); every CadQuery script and Blender session runs in its own Modal Sandbox | CadQuery and Blender's Python API (`bpy`) are Python-only; agent-written code needs a real isolation boundary. |
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
| Haiku 5.5 | 4/4 | 4/4 | 2/2 | 3.5 | 18 s | $0.003 |

Early signal (n=4, not conclusive): every Claude tier writes valid spatial UI. Quality rises with model size, and so do latency and cost; Haiku is 7× faster than Sonnet. That matters for Phase 5 routing, e.g. a fast draft followed by a refine. The pilot cost about $3.4 in generation (estimated from tokens × catalog prices).

_Scoring rule (since Nov 12, after code review): a scene counts as a success only if it passed the checks **and** ran in the emulator without errors, and failed scenes score 1/5 in quality averages so every model is averaged over all its scenes. This corrected DeepSeek's run-1 numbers: one scene passed the then-lenient checks but crashed in the browser._

**Run 1 (Nov 12): Sonnet 5.5 vs Muse Spark 1.3 (Meta API) vs DeepSeek V4.1 Flash (Fireworks).** 12 held-out prompts × 2 repetitions = 72 scenes. The judge panel is the three models themselves; quality excludes a model's own family and is adjusted for each judge's strictness. Full table in `bench/results/run-1/summary.md`; side-by-side screenshots in [`gallery.md`](bench/results/run-1/gallery.md) (renders on GitHub) and `gallery.html` (local).

| Model | pass@1 | Success | Mounted clean | Grab works | Quality, Opus 5.5 judge | Panel (adj.) | Median time | Cost / scene |
|---|---|---|---|---|---|---|---|---|
| Sonnet 5.5 | 100% | 100% | 24/24 | 14/17 | **4.18** | **4.32** | **40 s** | $0.075 |
| Muse Spark 1.3 | 100% | 100% | 24/24 | **23/24** | 4.13 | 4.25 | 98 s | unknown (no price listed) |
| DeepSeek V4.1 Flash | 88% | 96% | 23/24 | 14/14 | 3.84 | 3.92 | 47 s | **$0.010** |

The main quality score comes from **Claude Opus 5.5 as an independent judge** (not a contestant, though it's made by Anthropic like Sonnet). It agrees with all three contestant judges on the order Sonnet ≥ Muse > DeepSeek. Sonnet and Muse are effectively tied (0.05 apart; with Opus, Sonnet had the best version of 12 of 23 requests and Muse 11). By criterion, **clarity is every model's weakest score (3.3–3.5 / 5)**: overlapping or crowded panels. That's the clearest target for improving the system prompt and host layout.

**Findings:**
- **All three can do Open GenUI in XR:** 72/72 succeeded within ≤2 repairs, across all tiers. Quality differences are small but consistent: every judge, including Meta's and DeepSeek's, ranked Sonnet ≥ Muse ≥ DeepSeek.
- **Judges grade on very different curves.** Muse gave a mean of 4.7, Claude 3.8. Unadjusted cross-family scores are therefore misleading, which is a methodological point for the paper.
- **Our test run was looser than the real runtime.** It ran as a lenient (sloppy-mode) script, while browsers load the code as a strict module. A DeepSeek scene (`sunGroup里 = null`) passed every server check but crashed in the browser. The dry run is now strict, and all 71 other scenes still pass.
- **Grab failures:** an `InstancedMesh` marked grabbable (Sonnet, times tables), probably unsupported by IWSDK's grab (to verify), plus 2 unexplained misses.

**Run 2 (Nov 12): Muse Ember 1.0 (`reasoning_effort: max`, Meta API) and Kimi K3.1 Pro (Fireworks).** Same 12 prompts × 2 repetitions and the identical system prompt as run 1 (verified). Judged by Opus 5.5, so the scores are comparable with run 1. Kimi's data: [`run-2-kimi/summary.md`](bench/results/run-2-kimi/summary.md), [`run-2-kimi/gallery.md`](bench/results/run-2-kimi/gallery.md). Ember's original-system data was removed once run 3 superseded it; its numbers stay in the table below.

| Model (all judged by Opus 5.5) | Success | First try | Grab works | Quality | Fidelity | Clarity | Correctness | Hands-on | Median time | Cost / scene |
|---|---|---|---|---|---|---|---|---|---|---|
| Sonnet 5.5 (run 1) | 24/24 | 24/24 | 14/17 | **4.18** | 4.50 | **3.54** | **4.62** | 4.04 | 40 s | $0.075 |
| Muse Spark 1.3 (run 1) | 24/24 | 24/24 | **23/24** | 4.12 | 4.50 | 3.33 | 4.54 | **4.12** | 98 s | – |
| Kimi K3.1 Pro (run 2) | 24/24 | 24/24 | 10/12 | 4.05 | 4.46 | 3.38 | 4.46 | 3.92 | 149 s | $0.097 |
| DeepSeek V4.1 Flash (run 1) | 23/24 | 21/24 | 14/14 | 3.84 | 4.26 | 3.26 | 4.61 | 3.74 | 47 s | **$0.010** |
| Muse Ember 1.0 max (run 2) | 24/24 | 21/24 | 15/16 | 3.77 | 4.33 | **2.71** | 4.29 | 3.75 | **27 s** | – |

**Findings:**
- **Ember is the fastest model tested** (27 s median at max reasoning, vs Muse Spark's 98 s), but it has the lowest quality. That's almost entirely clarity, according to Opus's notes:
  - non-ASCII text such as CO₂ subscripts and emoji renders as missing-glyph boxes in UIKit panels;
  - panels are small or tilted, with tiny text;
  - labels overlap.
- **Kimi** is solid (4.05, 24/24 first try) but the slowest (149 s).
- **Per request (best Opus score across the 5 models):** Sonnet 6 and Muse Spark 6 of 12 (ties counted for each), Kimi 4, DeepSeek 2, Ember 0.
- **Clarity problems are mostly fixable by the system, not the model.** A rule against non-ASCII glyphs, a minimum panel size and font size, limits on panel rotation and label overlap checks would raise every model. Ember stands to gain most.

**Run 3 (Nov 12): Ember 1.0 max with the improved system.** Same model, prompts and judge; only our system changed, in two iterations:
1. **Plain-text rule.** The panel font is a 104-glyph Inter atlas: ASCII plus ° § ä ö ü Ä Ö Ü ß. Unsupported characters were rendering as empty boxes, in 13/24 of Ember's run-2 scenes, 18/24 of Kimi's and 8/24 of Sonnet's run-1 scenes. The fix adds a prompt rule, a validator that names each bad character with its replacement (`apps/server/src/glyphs.ts`), and a host fallback.
2. **Readable panels.** Panel roots must have a fixed px width, so text wraps instead of shrinking the panel (Ember never set one). The dry run computes text height as ui_width × font_px / root_px and requires ≥ 1.1 cm. Panels may turn at most ±0.4 rad. Ember gets 64k output tokens so max reasoning isn't cut off.

| Ember 1.0 max (Opus 5.5 judge) | Original (run 2) | Iteration 1 | Iteration 2 (run 3) |
|---|---|---|---|
| Quality | 3.77 | 4.04 | **4.30** |
| Clarity | 2.71 | 3.17 | **3.67** |
| Correctness | 4.29 | 4.71 | **4.75** |
| Hands-on | 3.75 | 3.92 | **4.25** |
| First try | 21/24 | 22/24 | **24/24** |
| Median time | 27 s | 29 s | 28 s |

In the emulator, run 3 had 24/24 clean mounts, 16/16 grabs and 17/17 presses. Data: [`run-3-ember-max`](bench/results/run-3-ember-max/gallery.md). The fair 5-model comparison on the improved system is run 4 below. Clarity's remaining issue is overlapping elements.

**Run 4 (Nov 12): fair comparison, all five models on the improved system.** Sonnet, Muse Spark, DeepSeek and Kimi were re-run with the same system prompt, checks and 64k output limit as Ember's run 3 (verified identical), on the same 12 requests × 2, judged by Opus 5.5. The emulator stage now also presses up to 3 **panel buttons** per scene. Side by side: [`compare-fair/gallery.md`](bench/results/compare-fair/gallery.md).

| Model (improved system) | Quality | Clarity | Hands-on | Panel buttons work | Median time | Cost / scene |
|---|---|---|---|---|---|---|
| Ember 1.0 max | **4.30** | 3.67 | **4.25** | 43/50 (86%) | **28 s** | – |
| Kimi K3.1 Pro | **4.30** | 3.75 | 4.04 | 32/36 (89%) | 159 s | $0.104 |
| Sonnet 5.5 | 4.29 | **3.79** | 3.88 | 36/39 (92%) | 42 s | $0.070 |
| Muse Spark 1.3 | 4.29 | 3.58 | 4.12 | 37/52 (71%) | 119 s | – |
| DeepSeek V4.1 Flash | 4.22 | 3.67 | 4.00 | 35/37 (**95%**) | 49 s | **$0.010** |

**Main finding: the system matters more than the model.** The improved system raised every model by +0.11 to +0.53, and closed the gap between them from 0.53 to 0.08: all five now score 4.22-4.30. With quality tied, the choice comes down to **speed** (Ember, 28 s), **cost** (DeepSeek, $0.01) and **interaction reliability** (DeepSeek and Sonnet have the most working panel buttons; Muse Spark the fewest). For the live app, Ember is the strongest default: tied-best quality at the lowest latency.

**Two harness bugs found while adding the panel-button probe:**
- uikit computes element world matrices lazily, so button positions were up to 30 cm stale; the host now forces an update before measuring.
- After a grab, the emulated hand's ray stopped delivering clicks; probes now run panel buttons → 3D press → grab.

**Run 5 (Nov 12): complex apps.** 12 harder held-out requests ([`hard-12.json`](bench/prompts/hard-12.json), tier T4): recipe coach, pendulum lab, headphone shop with cart, sprint board with filter and burndown, smart-home controller, arm bones with quiz, Paris trip planner, chess puzzle, linked-chart budget dashboard, solar-system simulator with modes, 3-step registration form, escape-room puzzle. All 5 models on the improved system, 1 repetition, Opus 5.5 judge. Side by side: [`run-5-hard/gallery.md`](bench/results/run-5-hard/gallery.md).

| Model (complex apps) | Quality | Panel buttons work | Median time | Cost / scene |
|---|---|---|---|---|
| Sonnet 5.5 | **4.00** | 69% | 187 s | $0.26 |
| Kimi K3.1 Pro | 3.98 | 76% | 296 s | $0.20 |
| Ember 1.0 max | 3.92 | **91%** | **47 s** | – |
| Muse Spark 1.3 | 3.67 | 75% | 270 s | – |
| DeepSeek V4.1 Flash | 3.63 | 82% | 110 s | **$0.02** |

**Findings:**
- **All 60 complex apps succeeded** within ≤2 repairs and ran in the emulator without errors.
- **Complexity separates the models.** The quality spread grows from 0.08 (run 4) to 0.37. Sonnet, Kimi and Ember lead; Muse Spark and DeepSeek trail.
- **Clarity falls for everyone** (3.0-3.4): more panels means more crowding and overlap. That's the next system improvement.
- **Ember remains the best fit for a live app:** within 0.08 of the top quality, 4× faster than Sonnet, and the most reliable buttons. Sonnet's buttons were the least reliable on complex layouts (69%).

**Provider errors fixed:** Node's built-in fetch abandons a request after 5 minutes without response headers, and a non-streaming reasoning model sends none while it thinks. Kimi needed up to 9.5 minutes, and both Kimi and DeepSeek requests failed this way. The client now uses an undici agent that waits up to the 30-minute request timeout; transient rate-limit (429) rows are retried, not scored.

**Known gaps in the harness:**
- Panel-button probe covers up to 3 buttons per scene by ray; pokes don't trigger uikit clicks in the emulator.
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

**Sandbox:** ~~a Docker image~~ built on Modal instead (Nov 12): one image with Python, CadQuery and headless Blender; each job runs in a Modal Sandbox (gVisor) with networking blocked, no secrets and a time limit. Locally, the same workers run under a macOS `sandbox-exec` profile.

**Exit gate (Sun Nov 15, end of day):** production pipelines and router rules chosen.
**Fallback:** P1 plus a curated library of licensed models.

#### Phase 3 results (Nov 12, `bench/results/3d-run-1`)

**Setup.** 12 learning objects (`bench/prompts/objects-12.json`: astronomy, biology, mechanical, everyday, architecture, earth science), each with 4–7 parts that must be separately named. 3 pipelines × {no reference, reference image (M1)}, and every job then runs the critic loop (M2, up to 3 rounds), so "pipeline alone" (round 0) and "pipeline + critic" (the round the critic scored highest) are measured on the same starting model. 72 jobs, 0 failures. Generator and critic: Muse Ember 1.0 at max reasoning. Judge: Opus 5.5 on a four-view render; every pipeline's GLB goes through the same Three.js renderer. P4/P5 (mesh generators) were not run: code pipelines only, decided Nov 12.

| Pipeline | Judge (1–5) | + critic | + reference | + both | Parts named | Triangles | Meshes | Time to model | Cost / model |
|---|---|---|---|---|---|---|---|---|---|
| P1 Three.js code | **3.75** | 3.75 | 3.75 | 3.92 | 100% | 6.1k | 37 | **28 s** | **$0.009** |
| P2 CadQuery | 3.42 | 3.67 | 3.25 | 3.50 | 100% | 21.6k | 12 | 55 s | $0.013 |
| P3 Blender agent (MCP) | 3.58 | 3.67 | 3.42 | 3.67 | 100% | 6.4k | 18 | 39 s | $0.013 |

Triangles, meshes, time and cost are for the pipeline alone (medians; cost is the mean, at Ember's $0.10/$0.50 per million tokens). The critic loop roughly doubles time and costs 2–4× (still under $0.06 per model, except P3 with both add-ons at $0.13).

**Findings.**
1. **No pipeline is clearly better on quality.** Paired over the 12 objects: P1 − P2 = +0.33 (95% bootstrap CI −0.08 to +0.75), P1 − P3 = +0.17 (−0.17 to +0.50). P1 is the fastest and cheapest and needs no backend: it runs in the browser as part of the GenUI module. CadQuery trails on organic shapes (biology 3.08 vs 3.58 for P1) and makes the densest meshes (curved CAD surfaces tessellate finely), but the fewest draw calls.
2. **The critic helps a little, safely.** +0.11 pooled over all pipelines (CI +0.03 to +0.22). Because the loop keeps the round the critic scored highest, a revision made the delivered model worse in only 1 of 72 jobs. Critic and judge agree moderately (Pearson r = 0.54 on the same renders).
3. **Reference images don't help.** −0.11 pooled (CI −0.31 to +0.08), and they slow things down: the image takes ~17 s (median) and the time to a model rises by 8–28 s. Generated references also contain mistakes (a test image mislabeled the heart's chambers), so they are requested without labels.
4. **The named-part contract works:** 100% of required parts are separate, named nodes in every pipeline, which is what labelling, highlighting and grabbing a single part need.
5. **Routing isn't worth it yet:** picking the best pipeline per object after the fact would score 3.83, against 3.75 for P1 alone.
6. **Harness lessons:** a literal critic asked for true astronomical scale (Titan shrank to a dot), fixed by stating that classroom models compress scale; a revision can be worse than its input, fixed by best-round selection; a truncated tool reply was miscounted as a failed export, fixed and re-run.

**Decision (exit gate).** Live requests use P1 (Three.js inside the GenUI module), without a reference image. The critic loop is used for pre-generated demo lessons, where time doesn't matter. P2 and P3 stay deployed on the Modal 3D backend as options (precise mechanical parts, reusable GLB assets) and for the paper. **Caveats:** one generator model, 12 objects, one run each, integer judge scores: directional, not conclusive. The paper run needs more objects, runs and a human rating pass.

**Next: architecture v2.** Reviewing the gallery, the code-built models are too schematic for a learning app (Nov 12). Accuracy has to come from authoritative data, as in X-Ray Mirror (BodyParts3D) and SceneCraft (retrieve, then compose): the redesign is in [`docs/3d-architecture.md`](docs/3d-architecture.md). The decision above stands only until v2's first milestone ships.

**Built.** `apps/server/src/three-d/` (pipelines, critic, reference images, shared renderer, judge, report, gallery); `apps/worker3d/` (CadQuery runner, Blender MCP server with tools `execute_blender_code`, `get_scene_info` and `export_glb`, macOS sandbox profile, Modal app). The Modal backend serves `POST /cadquery` and the Blender MCP server over streamable HTTP at `/mcp`, behind a bearer token; each MCP session gets its own Blender sandbox. Gallery: [`bench/results/3d-run-1/gallery.md`](bench/results/3d-run-1/gallery.md).

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

**Status (Nov 13):**

- **Headset session 0 (Quest 3S, USB, `iwsdk-native-xr-test`):** a real `immersive-ar` session with plane and mesh detection, anchors and hand tracking. A microscope lesson mounted about 0.5 m ahead at table height; a trigger press on "explode" moved its six parts 8.8 cm apart and "reset" put them back exactly (positions read from the scene). The USB link kept resetting, which drops the ADB route and reloads the page; a watcher that re-adds the route works around it.
- **Hands-only start:** the prompt box is a DOM overlay, invisible in XR, so a **lesson picker** panel (`apps/xr/src/genui/picker.ts`) stands front and centre in XR: four example lesson cards (point and pinch), progress (writing / fixing / ready / failed), and it docks to the learner's left once a lesson is ready.
- **Ready-made lessons:** the four cards open a saved lesson at once (`apps/xr/public/lessons/`, each the better of two candidates judged by Opus 5.5: heart 4.0, microscope 4.5, gears 4.0, flower 4.0), so the first moment needs no model call. "Make a new one" writes a fresh version live.
- **Voice:** Quest Browser has no SpeechRecognition (checked on the device) but can record. The page sends 16 kHz mono WAV to `/api/transcribe`, which uses Meta's Muse Voice Transcribe (`POST /v1/asr/transcribe`); a spoken request comes back word for word in about 2-3 s. "Ask your own" on the picker: pinch, speak, pinch. Not yet tried in the headset.
- **Placement on the desk:** a detected horizontal plane 15-90 cm below the eyes, within reach and ahead, holds the lesson (a table or desk label wins a close call); otherwise it floats at seated height. In the emulator's room, seated at the desk, the lesson stands on the "table" plane at its exact height and the framing step no longer lowers it into the surface.
- **Repair without a button:** a lesson that crashes while loading (e.g. a panel element the agent never created) is repaired once on its own; a later break shows "Fix it" on the picker.
- **Hand input found so far:** point-and-pinch (hand ray) and controller rays click panel buttons; a fingertip poke registers as hover but does not click UIKit panels in the emulator (lesson panels included). To check on the device.
- **Still to do:** the interaction matrix and fps on the headset, voice in XR, poke on the device.

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

**Status (Nov 13):**

- **Guards** (`apps/server/src/guard.ts`): per-visitor rate limit (`RATE_LIMIT_PER_10_MIN`, default 6), a daily budget (`DAILY_BUDGET_USD`, default 15; estimated from tokens and catalogue prices, kept per day in `runs/`), and a content screen with a fast model for the competition rules (no identifiable real people, no brands or logos, nothing unfit for 13+). It allows the heart, Newton's laws and a colour button; it refuses a celebrity statue, a brand logo and explosives, each with a friendly alternative. A failed screen lets the request through rather than blocking learning.
- **One origin:** with `STATIC_DIR` set, the agent server also serves the built XR app (path traversal refused), so the deployment is one container; `Dockerfile` added (not yet built here).
- **Reliability:** ready-made lessons (Phase 4) cover an outage or a spent budget. An Anthropic outage on Nov 13 (Haiku and Opus returning "503 credential validation failed" for about 20 minutes) showed why: benchmarks resumed, the cards kept working, and the app's parallel path now plans with the main model when the planner's provider fails.
- **Hosting** is chosen once the app is complete: a private test deploy around Sun/Mon to find the hosting problems early, the final one at the freeze.

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
apps/worker3d/          Python 3D backend: CadQuery runner, Blender MCP server, Modal app, sandbox
bench/                  prompts, harness, raw outputs, results, reports
docs/paper/             research notes and draft
```
