# Prior-art review (Phase 1, step 1)

- **Date:** November 12, 2026; updated November 14, 2026
- **Time box:** 3 hours (Nov 12); about 30 minutes (Nov 14)
- **Method:** web search, then opened the primary source for the closest items. The Nov 14 update looked for AI tutors and learning apps in XR, an angle the first pass did not search.

Items marked ✅ were opened and read at the primary source. Items marked ◻️ were seen only in search results or secondary listings; read them before citing in the paper.

## Bottom line

**Spatial generative UI is not empty territory, and neither is an AI tutor with 3D models on Quest.** Google, Microsoft and academic groups already generate XR scenes at runtime with LLMs, Meta ships AI-agent tooling for IWSDK, and CuriosityXR, on the Meta store since 2023, answers spoken questions with 3D models you can take apart in passthrough.

There are still clear gaps that none of them covers:

1. **Nobody compares output formats for spatial UI on the same runtime and tasks** (free code vs SDK-restricted code vs declarative JSON). LLMR (code) and LLMER (JSON) are separate Unity systems; XR Blocks tests only SDK code. *RQ1 now fills this: open code was both the most reliable and the best, against LLMER's argument for JSON (SPEC.md, "RQ1 results").*
2. **No benchmark compares several providers on runtime spatial UI with interaction-aware scoring.** XR Blocks, the closest work, tested Gemini only. Its pass@1 counts only "no runtime errors", and the authors list the missing checks themselves: semantic correctness, spatial fidelity, and "ungrabbable rackets". Multimodal autoraters are on their future-work list. *RQ2 now fills this: five models from four companies, with grabs and button presses in the emulator.*
3. **No real A2UI renderer exists for XR.** The only 3D A2UI renderer is a 7-star browser demo with no WebXR and no hands. *Version C is one, but A2UI came second of three in RQ1, so it is a side contribution.*
4. **AI tutors with 3D models already exist on Quest; we found none that writes the lesson.** CuriosityXR appears to retrieve a matching model (its title says "1M+ 3D Models"), and Meta's own AI tooling (IWSDK 1.0, Oct 14, 2026) is for developers at build time, not end users at runtime. *Changed Nov 14: this gap used to read "No end-user GenUI product exists on Quest", which a judge who knows CuriosityXR would dispute.*
5. **None of the work above measures splitting a spatial UI across parallel agents.** Not searched specifically. *RQ4 measures it.*

**Novelty claim (updated Nov 14):**
> A WebXR system on Quest in which an agent writes each hands-on lesson (3D models, behaviour and panels) as code at runtime for any request, instead of retrieving pre-built content; plus the first controlled comparison we know of between open, declarative and controlled GenUI on one XR runtime, in which open code was both the most reliable and the best (Sonnet 5.5 and Muse Ember 1.0), and a five-model benchmark scored on rendering, real grabs and button presses in the emulator, and visual quality.

The Nov 12 claim led with "an A2UI-compatible spatial GenUI runtime". RQ1 then put A2UI second of three, and the app ships open code with `kit.panel` for its panels, so the claim now leads with what the app does and what we measured.

Drop "first Gen UI in VR". Don't call the product the first AI tutor or learning app on Quest either. Say "generated, not retrieved", and show it.

## Closest work

### Runtime LLM → XR scenes (code)

| Work | What it is | Overlap with us | Where we differ |
|---|---|---|---|
| ✅ **LLMR**, Microsoft Research + MIT, CHI 2024 (Honorable Mention). De La Torre, Fang, Huang, Banburski-Fahey, Amores, Lanier | Unity framework; LLM modules build and change interactive mixed-reality scenes while the user works. Scene understanding, planning, self-debugging, memory. Reports 4× lower error rate than plain GPT-4. 11-person user study | Arm A (code) and the Phase 5 multi-agent design | Unity, GPT-4 era, scenes rather than UI components, no format comparison, no multi-provider benchmark |
| ✅ **XR Blocks / Vibe Coding XR**, Google XR Labs (Ruofei Du et al.), arXiv 2603.24591, VRST '26 | Open-source WebXR framework designed for LLM code generation. Semantic "Reality Model" (`user`, `world`, `ui`, `ai`) and `xb.Script` lifecycle; system prompt, templates and type definitions for grounding; retry loops. Prompting inside the headset with instant run. 25-joint hands, pinch, grab, palm-up, point | **Closest to Arm B** (code against an LLM-friendly SDK). Its VCXR60 benchmark (60 prompts, pass@1 as runtime check in headless Chromium with Playwright) is the obvious baseline for Phase 2 | Gemini only (3.1 Pro ≈95.5%, 3 Flash ≈87.8% pass@1). Pass@1 ignores intent, spatial correctness and grabbability, as the authors acknowledge. Android XR focus. No declarative arm, no 2D GenUI protocol |
| ✅ **three-live**, `google/three-live` (Beta, Apache-2.0, ~326 stars, "not an officially supported Google product") | Runtime and JIT that runs short Three.js code from agents in a sandbox (Rust VM, or a Web Worker / sandboxed iframe on the web) on WebXR, Android XR and visionOS. XR behavior declared through `userData.xr` traits (grab, billboard, anchor). Bad generations "never break the live scene". Includes an MCP server | **Closest to the Arm A runtime design**: sandboxing plus trait-based interactions | No UI component or panel system, no A2UI, no benchmark. **Borrow its ideas** (worker or iframe sandbox, traits) rather than depend on it, since we use IWSDK as the client |

### Runtime LLM → XR scenes (declarative)

| Work | What it is | Overlap | Where we differ |
|---|---|---|---|
| ◻️ **LLMER**, Penn State (Chen, Wu, Lan, Li), arXiv 2502.02441, IEEE TVCG 31(5) 2025 | LLM outputs JSON matching schemas instead of code; Context Library plus LLM Wrapper; Unity on commercial headsets. Reports >80% fewer tokens and ~60% shorter task time vs prior work; argues JSON avoids script errors and crashes | **Closest to Arm C**, and evidence that declarative may beat code | Custom schema (not A2UI), Unity, not a controlled three-way format comparison on one runtime. **Read the full paper**: their comparison method matters for our RQ1 |
| ✅ **A2UI 3D renderer**, `josh-english-2k18/a2ui-3d-renderer` | React + Three.js demo rendering A2UI (`Surface`, `Row`, `Column`, `Card`, `Text`, `Button`) as a 3D scene with hover; mock stream or Gemini Flash | Proof that A2UI can be rendered in 3D | 7 stars, 4 commits, no WebXR, no hands, simplified layout. A toy |

### AI tutors and learning in XR (added Nov 14)

| Work | What it is | Overlap with us | Where we differ |
|---|---|---|---|
| ✅ **CuriosityXR: AI Tutor & 1M+ 3D Models**, Meta store, developer Aaditya Vaze. Released Mar 16, 2023; $19.99; 3.7★ from 37 ratings (VRDB, Nov 14) | You ask aloud; "the AI teacher answers out loud and places a matching model in front of you". Grab, scale and "take it apart" with hands or controllers; colour passthrough on Quest 3 and 3S; each answer builds on the last. Examples: a human heart with labels and pathways, the solar system, volcanoes, DNA | **Closest product to ours**, on the same store, with our demo topics. Judges at Meta may know it | The listing doesn't say where the models come from or whether anything is generated; "1M+ 3D Models" suggests a library. If so, a lesson is a found model plus a spoken answer, while ours is written for the request, with its own behaviour and panels. **Not verified: try one request outside its examples** |
| ◻️ **Reality Copilot**, arXiv 2602.11025 (Feb 2026) | Voice-first assistant on Quest 3 (Unity). A commercial multimodal model (ChatGPT or Gemini) handles requests and calls SAM3D on a self-hosted GPU server for 3D objects, delivered as GLB. One scenario guides a student through soldering | Runtime 3D generation from voice on Quest | Generates single objects, not lessons or UI. No user study or measurements |
| ◻️ **WorldViz E-Learning Lab** (vendor page) | Educators build VR lessons without code, generate 3D models on demand with services such as Meshy, and add AI avatars that answer questions | AI-generated 3D in lessons | An authoring tool: the educator builds the lesson in advance; no agent builds it at the learner's request |
| ◻️ **ARIA**, UCF, IUI 2026 | Real-time architecture for an embodied AI instructor in AR; an LLM adapts dialogue, teaching strategy and persona | AI tutor in AR, like our voice tutor | Tutor dialogue, not generated 3D lessons |

### Developer-time AI tooling for XR (not runtime GenUI)

| Work | Note |
|---|---|
| ✅ **IWSDK 1.0**, Meta (blog, Oct 14, 2026) | MCP server and agent skills in every project; agents can view the scene, drive the emulated headset, controllers and hands, and test on a connected Quest. Agentic Scene Composer is a visual editor the agent can drive. **Developer-time only.** Our runtime GenUI complements it, and we should use its MCP to develop faster. Judges at Meta will know it, so state the difference clearly |
| ◻️ **Meta Layout SDK / UI Set SDK**, Sep 2026 | Compose-based UI kits with agent skills (`metavr init`). Android-app path, developer-time |

### 3D generation through code (Phase 3)

| Work | Takeaway for us |
|---|---|
| ◻️ **SceneCraft**, Google/DeepMind/Caltech, ICML 2024 | LLM writes Blender Python for scenes with up to ~100 assets; scene-graph planner; GPT-4V critic loop; reusable function library. Reports >45% CLIP gain vs BlenderGPT. **Precedent for our M2 critic** |
| ◻️ **LL3M**, UChicago, arXiv 2508.08228 | Multi-agent Blender code: planner, retrieval (BlenderRAG), coder, critic, verifier. **Precedent for P3 + M2 + M3** |
| ◻️ **P3D-Bench**, arXiv 2606.11152 | Parametric 3D in several code formats (secondary listing names JSON, OpenSCAD, CadQuery, Three.js); text, image and assembly tasks. Finding: **multi-part assemblies are much harder** (wrong part count and geometry), which supports our "named parts" hypothesis |
| ◻️ **CodeGen-3D**, SJSU, IEEE Access 2026 | 100-prompt Blender-Python benchmark, zero-shot vs iterative self-correction, 8 LLMs plus BlenderLLM |
| ◻️ **3DCodeBench** (2606.01057), **3DHarnessBench** (2609.06535), **WorldCoder-Bench** (2606.01869) | Benchmarks for 3D through code with agents, and for behaviorally correct Three.js worlds (no system above 30% verification coverage) |
| ✅ **WorldBench**, arXiv 2610.10622 (single author) | Three.js voxel world; **two-channel judge** (explores the running scene plus reads the code; they disagree on about 1/3 of items); mutation test showing code-only judges over-credit. One world per model: Claude Fable 5.1 210.8, GPT-6 Astra 199.7, Kimi K3 191.4, Grok 4.7 187.8, Gemini 3.1 Pro 149.0 (of 280). **Borrow the method for Phase 2** |

### Adjacent (cite as related work)

◻️ SituationAdapt (LLM-optimized MR UI layout), ◻️ sMoRe, ◻️ Roomify, ◻️ CinemaWorld, ◻️ SpatialPrompt, ◻️ OrchestrXR (multi-agent XR study authoring, Unity), ◻️ DreamCodeVR, ◻️ MagicItem, ◻️ confabulation taxonomy for LLM scene editing (2607.23213), ◻️ survey of LLMs in XR (2508.03014).

Added Nov 14: ◻️ Spatial Lingo (Meta, open source, Jan 2026; AI language practice with real objects in passthrough), ◻️ Matrix (Warwick; text-to-3D, speech translation and LLMs in AR on HoloLens 2), ◻️ ELEVATE (2606.30662) and ◻️ Open TutorAI (2602.07176) (LLM tutors as 3D avatars, not AR), ◻️ AI-Driven Mixed Reality for Scalable and Adaptive Training (Springer, Jan 2026; tutorials made from an expert's demonstration on HoloLens 2).

## What this changes in the plan

1. **Arm C uses A2UI v1.0 directly** instead of a homemade JSON. A2UI supports custom catalogs (a JSON Schema identified by `catalogId`; renderers advertise `supportedCatalogIds`), so we publish a **spatial catalog** (`Model`, `Orbit`, `ExplodedView`, `QuizCard`…) and build the **first WebXR A2UI renderer with hands**. That makes it interoperable and a clean open-source contribution.
2. **The Arm A sandbox borrows from three-live**: run generated modules in a Web Worker or sandboxed iframe, with behaviors as declared traits. Don't run raw code on the main thread.
3. **Arm B is compared directly with XR Blocks.** Our SDK is the IWSDK equivalent. Report VCXR-style pass@1 alongside our richer metrics so results can be compared.
4. **The Phase 2 judge borrows from WorldBench**: running scene plus code, mutation tests to validate the judge, a cross-provider judge panel.
5. **Phase 2 candidates updated** with current model names seen in WorldBench (Oct 2026): Claude Fable 5.1, GPT-6 Astra, Kimi K3, Grok 4.7, Gemini 3.1 Pro. Confirm API availability and IDs on benchmark day.
6. **Use IWSDK's own MCP and agent skills** to build faster. That's development tooling, separate from our runtime GenUI.

Added Nov 14:

7. **Show the difference from CuriosityXR in the demo.** Don't open with the solar system or the heart, which are its own examples. Open with a request no model library answers, one with behaviour (a machine running, an experiment with sliders, a process to step through), so the lesson's interactions are visibly written for that topic.
8. **Try CuriosityXR before the submission** with one request outside its examples, to confirm whether it generates anything, and update this review.
9. **SPEC.md section 4 still states the Nov 12 claim.** Bring it in line with the one above.

## Must read in full before writing the paper

1. XR Blocks / Vibe Coding XR (2603.24591): closest work; benchmark protocol and limitations.
2. LLMER (2502.02441): JSON-vs-code evidence.
3. LLMR (2309.12276): code and self-debugging baseline.
4. A2UI v1.0 spec: catalogs, streaming, actions.
5. WorldBench (2610.10622): judge method.
6. P3D-Bench (2606.11152) and LL3M (2508.08228): Phase 3.
7. CuriosityXR: use it (see item 8 above), since the store listing is all we have.
8. Reality Copilot (2602.11025): runtime 3D from voice on Quest 3.

## Sources

- LLMR: https://dspace.mit.edu/handle/1721.1/155184 · https://arxiv.org/pdf/2309.12276
- XR Blocks / Vibe Coding XR: https://arxiv.org/html/2603.24591
- three-live: https://github.com/google/three-live
- LLMER: https://arxiv.org/pdf/2502.02441
- A2UI spec v1.0: https://a2ui.org/specification/v1.0-a2ui/ · renderers: https://a2ui.org/ecosystem/renderers/
- A2UI 3D renderer demo: https://github.com/josh-english-2k18/a2ui-3d-renderer
- IWSDK 1.0: https://developers.meta.com/vr/blog/immersive-web-sdk-1-0/ · AI tooling docs: https://developers.meta.com/horizon/documentation/web/iwsdk-ai-assisted-dev-tooling
- Meta Layout/UI Set SDK (secondary): https://vr.org/articles/meta-vr-layout-sdk-react-native-two-panels-gaze-sdk-store-rejected-2026
- SceneCraft: https://arxiv.org/html/2403.01248v1
- LL3M: https://arxiv.org/abs/2508.08228
- P3D-Bench: https://arxiv.org/abs/2606.11152
- CodeGen-3D: https://scholarworks.sjsu.edu/faculty_rsca/6835/
- 3DCodeBench: https://arxiv.org/pdf/2606.01057 · 3DHarnessBench: https://arxiv.org/pdf/2609.06535 · WorldCoder-Bench: https://arxiv.org/pdf/2606.01869
- WorldBench: https://arxiv.org/html/2610.10622
- CuriosityXR: https://www.meta.com/experiences/curiosityxr-ai-tutor-1m-3d-models/8662430537161741/ · https://vrdb.app/game/8662430537161741
- Reality Copilot: https://arxiv.org/abs/2602.11025
- WorldViz E-Learning Lab: https://www.worldviz.com/post/ai-powered-vr-classrooms-no-coding-required
- ARIA (IUI 2026): https://varlab.cs.ucf.edu/wp-content/uploads/2026/03/IUI2026_SystemsPaper__Final_Version_.pdf
- Spatial Lingo: https://developers.meta.com/horizon/blog/spatial-lingo-open-source-app-ai-assisted-language-practice/ · Matrix: https://warwick.ac.uk/fac/cross_fac/eduport/edufund/projects/yang/projects/from-voices-to-worlds-developing-an-ai-powered-framework-for-3d-object-generation-in-1241c9/ · ELEVATE: https://arxiv.org/abs/2606.30662 · Open TutorAI: https://arxiv.org/abs/2602.07176 · AI-Driven MR training: https://link.springer.com/chapter/10.1007/978-3-032-10951-4_18
- SituationAdapt: https://arxiv.org/pdf/2409.12836 · sMoRe: https://arxiv.org/pdf/2411.11752 · Roomify: https://arxiv.org/html/2603.04917 · CinemaWorld: https://arxiv.org/pdf/2603.08060 · OrchestrXR: https://arxiv.org/pdf/2607.01588 · Confabulation taxonomy: https://arxiv.org/pdf/2607.23213 · LLMs in XR survey: https://arxiv.org/html/2508.03014v1
