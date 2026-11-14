# 3D generation architecture (v2): accurate, part-structured 3D for learning

- **Status:** Draft for review, November 12, 2026
- **Replaces:** the Phase 3 approach of having the LLM build every object's geometry as code
- **Inputs:** the Phase 3 benchmark (`bench/results/3d-run-1`), the X-Ray Mirror example, SceneCraft (arXiv 2403.01248), the `setout` project, and the sources in section 10

---

## 1. Why a new architecture

The Phase 3 benchmark asked one model (Muse Ember) to build 12 learning objects as code in three ways: Three.js, CadQuery and an agent with Blender tools. All 72 jobs produced a valid, named-part model, and the independent judge scored them 3.25–3.92 out of 5. The results look schematic: a heart made of blobs and tubes, a skull would be worse. For a learning app that is not good enough. Teaching wrong anatomy or science is a real harm, not a cosmetic issue.

Three pieces of evidence point the same way:

1. **Code-built geometry has a ceiling.** Swapping pipelines barely moved the score (no difference was statistically clear), and a critic loop added only +0.11. The limit is not the tool; it is that a language model can't type a CT-accurate skull from memory.
2. **Accurate examples don't generate the geometry.** The X-Ray Mirror page embeds BodyParts3D meshes (scan-derived anatomy, 26 labelled structures; the cerebrum alone is 70,000 triangles) and uses MediaPipe tracking to place them. AI wrote the app, not the skull.
3. **Research agents retrieve, then compose.** SceneCraft retrieves assets instead of generating them, has the LLM plan relations in a graph, scores layouts with code, and refines with a vision critic. Removing the relation graph dropped its constraint score from 88.9 to 3.2, removing the critic loop to 26.1, and removing the learned function library to 64.5 (vs 5.6 for BlenderGPT, the "LLM writes Blender code" baseline). Newer 3D work is moving the same way: part-aware generators that name their parts, and benchmarks showing that agents improve when they can inspect the 3D object through tools.

**Principle: ground truth first, generate last, verify always.** Accuracy comes from authoritative data wherever it exists. The LLM's job is to find the right asset, structure it for teaching and compose the lesson. Generation fills the long tail, and every result says where it came from and how much to trust it.

## 2. Requirements

| # | Requirement | Measure |
|---|---|---|
| R1 | **Accuracy.** Geometry true to the real thing; for science and anatomy, traceable to an authoritative source | Expert/judge accuracy score; share of assets from verified sources |
| R2 | **Named part structure.** Separable parts named and mapped to a concept ID (anatomy: FMA; general: Wikidata), with a hierarchy (heart → left ventricle) | Required parts present and correctly mapped |
| R3 | **Teaching rig.** Label anchors, explode directions, cut-away planes, X-ray materials and highlight for every part | Rig completeness; label legibility in the headset |
| R4 | **Quest budget.** Triangles, draw calls, texture memory, file size; levels of detail (LODs) | Budget checks at load |
| R5 | **Coverage.** Any object a learner asks for gets a usable model, even if less certain | Share of requests served per tier |
| R6 | **Latency.** Cached assets load in about a second; new ones arrive progressively (placeholder, then final) | Time to first model, time to final |
| R7 | **Licensing.** Every asset carries its licence and attribution; incompatible licences are excluded | Licence check at ingestion |
| R8 | **Provenance and confidence.** Every asset records its source tier and verification result, and the app can show it | Present on 100% of assets |

## 3. Overview

```
 Request ("teach me the heart")          GenUI agent (lesson) asks for assets by concept
        │
        ▼
 ┌─ 1. Concept grounding ─────────────────────────────────────────────────────────┐
 │  concept ID (FMA / Wikidata) + required parts from an ontology, not LLM memory  │
 └────────────────────────────────────────────────────────────────────────────────┘
        │  AssetSpec
        ▼
 ┌─ 2. Source router: try tiers in order of trust ────────────────────────────────┐
 │  A  Curated library hit (scan/scientific data)           → verified            │
 │  B  Data-driven builder (authoritative data + code)      → verified by build   │
 │  C  Open-licence retrieval (Objaverse, Smithsonian…)     → plausible           │
 │  D  Generate: reference image → image-to-3D → parts      → generated           │
 │  E  Agentic modelling (Blender/CadQuery/Three.js code)   → schematic           │
 └────────────────────────────────────────────────────────────────────────────────┘
        │  candidate mesh(es)
        ▼
 3. Part structuring: segment if needed → name parts → map to required parts → hierarchy
        ▼
 4. Teaching rig: label anchors, explode vectors, cut planes, X-ray/highlight variants
        ▼
 5. Verification ensemble: structure + geometry + visual critic vs real reference photos
        │        fail → next tier or revise         pass → confidence + provenance
        ▼
 6. Optimise for Quest: decimate, LODs, compress, merge per part
        ▼
 7. Asset library: stored with metadata, embeddings, licence; later requests are retrievals
        ▼
 8. Lesson composition (GenUI host): assets.load(id), relation graph → layout solver → layout critic
```

## 4. Components

### 4.1 Concept grounding

The GenUI agent requests an asset with an `AssetSpec` instead of free text:

```json
{
  "concept": "heart",
  "conceptId": "FMA:7088",
  "parts": [{ "name": "left ventricle", "conceptId": "FMA:9466" }, "..."],
  "detail": "chambers-and-great-vessels",
  "use": ["label", "explode", "cutaway"],
  "style": "realistic",
  "sizeM": 0.25
}
```

- The **part list comes from an ontology** where one exists: the FMA (anatomy, which BodyParts3D uses), Wikidata "has part" (P527) for general objects, curated lists for other domains. The LLM proposes, the ontology confirms. A part list that only the LLM vouches for is marked lower confidence.
- **Level of detail is explicit.** A heart for a 10-year-old needs 6 parts, for a medical student 30. The same source asset serves both by grouping parts.

### 4.2 Asset library

One catalogue for every source, so retrieval, the router and the host see a single shape:

| Field | Example |
|---|---|
| `id`, `concepts` | `heart-bp3d-v1`, `[FMA:7088]` |
| `parts` | node name ↔ concept ID ↔ display name, hierarchy |
| `tier`, `provenance` | `A`, "BodyParts3D 4.0, simplified to 40k triangles" |
| `licence`, `attribution` | CC BY-SA, required credit text |
| `scale`, `axes`, `origin` | real size in metres, Y up, base at origin |
| `lods`, `budget` | triangle counts per LOD, draw calls, bytes |
| `rig` | label anchors, explode vectors, cut planes (section 4.6) |
| `verification` | checks passed, critic notes, reviewer, date |
| `thumbnails`, `embeddings` | four-view renders; text and image embeddings |

Ingestion pipelines, one per source, all ending in the same normalised GLB plus metadata:

| Source | Content | Licence (check before use) | Parts |
|---|---|---|---|
| BodyParts3D / Z-Anatomy | Human anatomy from scans | CC BY-SA (sources disagree on version) | Per structure, FMA IDs |
| NASA 3D Resources | Planets, spacecraft, landers | NASA media guidelines (generally free, no endorsement) | Partly |
| Smithsonian Open Access 3D | Fossils, artefacts, specimens | CC0 | No (needs segmentation) |
| Poly Haven | Everyday props | CC0 | Some |
| Objaverse (Cap3D-filtered) | Long tail, 100k+ objects | Per object; keep CC0/CC BY | Rarely |

Storage: GLBs in object storage (Modal Volume to start; a CDN later), catalogue in SQLite/JSON with embeddings. Licences are checked at ingestion; non-commercial and unknown licences are excluded by default.

### 4.3 Retrieval

SceneCraft-style, with an exact path first:

1. **Concept-ID match** (exact, highest trust).
2. **Text search** over captions and part names (embedding similarity).
3. **Image search** over multi-view thumbnails (image embeddings of the query or a reference image).
4. **Vision rerank:** render the top candidates and have the vision model pick the one that matches the spec, or reject all.

Below a confidence threshold the router moves to the next tier instead of returning a weak match.

### 4.4 Data-driven builders (tier B)

Many learning subjects have authoritative numbers even without a mesh. Geometry built from data is accurate by construction, and the LLM's job shrinks to writing glue code against a data API:

- **Molecules and proteins:** PubChem 3D conformers, PDB structures → atoms, bonds, ribbons.
- **Solar system:** NASA radii, axial tilts, ring dimensions, orbital elements, public-domain textures.
- **DNA, crystals, lattices:** published geometric parameters.
- **Earth science:** elevation data for terrain, plate boundaries.
- **Maths and physics:** exact functions, fields, trajectories.

Each builder is a tested function in a shared kit, not code the LLM writes from scratch each time.

### 4.5 Generation tiers (D and E)

**Tier D, image-to-3D with parts**, for realistic long-tail objects:

1. A reference image: a retrieved real photo first (Wikimedia Commons, licence-checked), else Muse Image.
2. Image-to-3D on a GPU: SAM 3D Objects (Meta; SAM License, commercial use allowed with conditions; needs ≥32 GB of GPU memory) or TRELLIS (MIT licence). Pick by mesh quality and licence after a bake-off.
3. Part segmentation of the result: PartField (open source, class-agnostic) or P3-SAM.
4. **Part naming with SAM 3.1** on the Meta API: render the mesh from several views with a face-ID buffer, ask SAM 3.1 for each required part by name ("left ventricle"), and vote which faces each mask covers. This turns unnamed segments into named parts using Meta's own models.

Output is marked `generated`: usable and labelled, but not trusted until verification passes.

**Tier E, agentic modelling**, for structured objects with no data and no asset (machines, buildings, diagrams). This is the Phase 3 work, upgraded with what SceneCraft, LL3M and ShapeCraft show:

- Plan a part graph first (parts, relations, dimensions), then write code per part.
- A shared kit of tested helpers (gears, shells, sweeps, arrays), grown by library learning (section 4.9).
- The agent inspects its own scene through tools (sizes, contacts, renders), not just the final image.
- Runs on Modal as a deployed Function that replays the code steps per call (the `setout` design): no session state, safe retries, undo by dropping a step.

### 4.6 Part structuring and teaching rig

For every asset, whatever the tier:

- **Hierarchy:** organ → structures → substructures, so a lesson can show 6 parts or 30.
- **Label anchors:** a surface point and outward normal per part (raycast from the part's centre outwards), so labels sit on the part with a leader line.
- **Explode vectors:** each part's offset from the object's centre, adjusted until parts don't collide when spread.
- **Cut planes and X-ray:** precomputed section planes, plus a translucent material variant per part.
- **Highlight and focus:** per-part outline or emissive variant.

Stored in the GLB (`extras`) or a sidecar JSON. The host turns them into hand interactions: grab a part, pull it out, tap to name it.

### 4.7 Verification ensemble

A model ships only with a verdict:

| Check | How | Catches |
|---|---|---|
| Structure | Required parts present and mapped to concept IDs | Missing or misnamed parts |
| Topology | Ontology relations hold geometrically (e.g. the aorta touches the left ventricle) via contact tests | Parts in the wrong place |
| Geometry | Manifoldness, real-world scale vs known size, interpenetration, floating parts | Broken meshes |
| Visual | Multi-view vision critic against **real reference photos**, not generated ones | Wrong shapes and proportions |
| Budget | Triangles, draw calls, texture memory | Quest frame rate |

The result is a confidence level (verified / plausible / generated / rejected) plus notes. A human review queue promotes generated assets to verified. The app can show learners where a model came from.

### 4.8 Optimisation for Quest

meshoptimizer/gltfpack: simplification per part (keeping part boundaries), 2–3 LODs, quantisation and meshopt compression, KTX2 textures, one draw call per part where possible. Budgets per asset and per scene are enforced at load, as the Phase 1 host already does for generated scenes.

### 4.9 Lesson composition and library learning

**Composition** (the GenUI side):

- The host gains `assets.load(id)`, returning a group with named parts and the rig, plus helpers: `labelPart`, `explode`, `highlight`, `xray`, `cutaway`.
- The agent states **relations** ("label near its part", "panel within reach", "nothing overlaps", "faces the learner"), and host code places things with scoring functions and a small solver, as in SceneCraft. The agent no longer guesses coordinates.
- A vision critic checks the layout. The Phase 3 data suggests critics help layout more than geometry, matching SceneCraft's ablation.

**Library learning** (SceneCraft's outer loop): when the critic repeatedly asks for the same fix across many lessons, the change is merged into a shared helper function. Verified generated assets join the asset library, so a request generated once is a retrieval the next time.

## 5. Models and where they run

| Role | Model | Why |
|---|---|---|
| Lesson agent, planner, coder | Muse Ember 1.0 (max) | Phase 2 app default: accurate, fast, very cheap |
| Critic (layout, visual checks) | Muse Ember 1.0; Muse Wonder 1.0 for hard verification cases | Wonder is stronger but about 40× the price |
| Reference images | Muse Image 1.0 (when no real photo is found) | $0.01 each |
| Part naming on renders | SAM 3.1 (Meta API, text-prompted masks) | Names segments with Meta's own model |
| Image-to-3D | SAM 3D Objects or TRELLIS on a Modal GPU | Bake-off first |
| Part segmentation | PartField or P3-SAM on a Modal GPU | Open source |
| Independent judge (benchmarks only) | Claude Opus 5.5 | Not used by any pipeline |

An almost all-Meta pipeline (Muse Ember, Muse Image, SAM 3.1, SAM 3D) also suits the Meta competition.

## 6. Infrastructure

- **Compute on Modal**, following the `setout` design: deployed Modal Functions called from the device's Modal login, networking blocked for any code an LLM wrote, Blender steps replayed per call. GPU functions (image-to-3D, segmentation) scale to zero.
- **Jobs are asynchronous with progress events:** the headset shows a placeholder (bounding box, or the closest library asset) immediately and swaps in the final model when ready.
- **Asset store and catalogue** as in section 4.2; caching by concept and detail level.
- **Provenance log** for every asset: sources, model versions, prompts, checks, costs.

## 7. Evaluation (benchmark v2)

- **Object set:** about 40 learning objects across anatomy, astronomy, biology, chemistry, mechanical, architecture, earth science and everyday objects, with ground truth where it exists (BodyParts3D meshes and FMA part lists, NASA dimensions, PubChem geometry).
- **Systems compared:** code-only (the Phase 3 baseline, 3.75/5), retrieval only, generation with part naming, data-driven builders, and the full router.
- **Metrics:**
  - accuracy (vision judge plus expert ratings on an anatomy and science subset);
  - part coverage and correct mapping against the ontology;
  - geometric error against ground truth (Chamfer distance / F-score) for the generation tier;
  - teaching-rig quality (label legibility and explode clarity, in the headset);
  - Quest budget, latency, cost;
  - provenance rate (share of assets from tiers A–B).
- **Hypothesis:** the full router beats code-only on accuracy by a wide margin on science subjects, at lower latency for cached assets. Generation closes most of the gap on everyday objects but not on anatomy.

## 8. Build order

Each milestone ends with something visible in the headset or emulator and a measurable check.

| Milestone | Delivers | Exit check |
|---|---|---|
| M1 Library core | Catalogue, normalisation pipeline, BodyParts3D ingestion (heart, skull, brain), host `assets.load` with named parts | An accurate heart lesson with labels; parts grabbable |
| M2 Teaching rig + layout | Label anchors, explode, cut-away, X-ray; relation-graph layout solver; layout critic | Labels legible and non-overlapping on 3 anatomy assets |
| M3 Concept grounding + retrieval + router | AssetSpec, ontology part lists, search and rerank, tiers A and C | Correct asset for a held-out request set |
| M4 Data-driven builders | Solar system, molecules, DNA | Dimensions match source data |
| M5 Generation tier | Image-to-3D bake-off, segmentation, SAM 3.1 part naming | Named parts on 10 everyday objects |
| M6 Verification ensemble | Topology, geometry and visual checks; review queue | Rejects planted wrong models |
| M7 Benchmark v2 + paper | Section 7 | Results table |
| M8 Library learning | Helper evolution, generated-to-verified promotion | Fewer critic rounds over time |

## 9. Decisions needed

1. **Licensing.** Are CC BY-SA assets acceptable? They require credit and that our modified meshes be shared under the same licence, as X-Ray Mirror does. Exclude non-commercial assets?
2. **GPU spend.** Tier D needs GPU time on Modal (image-to-3D needs a large GPU). Approve a budget, or defer tier D until M5?
3. **Style.** Realistic (textured, scan-like) or clean educational (flat colours, clear parts), or switchable per lesson?
4. **First domains.** Anatomy first (best data, strongest demo), then astronomy and chemistry?
5. **Backend.** Move the Modal backend to the `setout` design (Functions called from the device, replayed steps) as part of M1.

## 11. Where v2 lives

v2 was built as an experiment on its own branch and worktree, and adopted on Nov 14: it was merged into
`main`, and the worktree and its branch were removed.

- **Modal:** everything v2 deploys uses its own names: apps `spatial-genui-3d-v2` (TRELLIS.2), `spatial-genui-3d-v2-retrieval` (DINOv3), `spatial-genui-3d-v2-parts` (P3-SAM) and `spatial-genui-3d-v2-blender` (the Blender agent's sandbox), volume `genui-assets-v2`. The Phase 3 backend (`spatial-genui-3d`) keeps running unchanged. GPU functions scale to zero, so nothing is billed while idle.
- **The model library** (`data/library/`: the GLB files and their catalogue) is in git, so a fresh clone or a hosted copy has the models without building them again. `data/library/CREDITS.md` lists each model's source and licence.
- **Everything else under `data/`** is git-ignored and exists only on the machine that made it: downloads (BodyParts3D, the Objaverse index and models), work files of each pipeline stage, and the app's database (`data/app.db`: saved courses, lessons and the index of models made for courses).

## 12. Progress

**Tier D bake-off (Nov 13).** TRELLIS.2 (Microsoft, MIT) runs on Modal (`apps/worker3d/modal_trellis.py`, RTX PRO 6000, about 6–100 s per model warm, under $1 for 12 models). On the Phase 3 objects and reference images it scores 3.58/5 with the best craft of any pipeline (4.00): excellent on everyday objects (office chair and guitar 5/5, bicycle and lunar lander 4/5), weak where the model must teach a concept (gears that don't mesh, a volcano without a vent), and with no named parts (one fused mesh, ~100k triangles). Consistent with the router: generators for real-world objects, code or data for concepts.

**M1 library core (Nov 13).** Done, in the emulator:
- `apps/worker3d/library/bp3d_build.py` builds assets from BodyParts3D 4.0 (CC BY 4.0 per the licence page updated 2025-02-27; the OBJ headers still carry the older CC BY-SA 2.1 JP notice, recorded in each asset's provenance) using recipes in `library/recipes/`: heart (27 parts), skull (22 bones), brain (19 parts). Real size, named parts with FMA IDs, label anchors, explode directions, colours, 60–80k triangles each.
- Opus 5.5 judges all three 4/5 (recognizable 5, accuracy 4, craft 4) with every required part named. The heart ties TRELLIS.2's and beats every code-built heart (3/5).
- Modules use `assets.get('heart-bp3d')` (validated against the catalogue, dry-run with stand-ins, preloaded by the host through IWSDK's AssetManager). Muse Ember chose the library heart on its own and built a labelled blood-flow tour on the first attempt; in the emulator the heart is grabbable and 3/3 panel buttons work by hand ray.
- Known data limits: BodyParts3D has no ventricular wall (the ventricles are cavity casts, so coronary arteries sit slightly proud of the surface), no teeth, and some cortical gyri are missing; meshes are 99%-reduced and slightly faceted.

Rebuild the assets: download BodyParts3D into `data/bodyparts3d/` (see the builder's docstring), then `apps/worker3d/.venv/bin/python3 apps/worker3d/library/bp3d_build.py apps/worker3d/library/recipes/heart.json` (and skull, brain). The agent server serves `data/library/` at `/api/library`.

**M2 teaching rig (Nov 13).** Done, in the emulator:
- Every library model gets host-side teaching tools (`apps/xr/src/genui/rig.ts`, mirrored by the server's dry run): `label`/`labelParts` (two columns beside the model, stacked without overlap, leader lines that follow the parts), `explode(t)`, `cutaway()` (a clipping plane that follows the model), `xray(keep)`, `highlight(part)`, `reset()`, and pulling parts out by hand via `traits(part, { grab: true })`. A fixture lesson (`tests/rig-demo.mjs`) exercises every state with screenshots.
- The heart's missing ventricle walls are reconstructed (cavities grown by 8 mm left / 3 mm right, fused into a septum, marching cubes), recorded as reconstructed in the provenance; the coronary arteries now lie on the surface (median 0.8–1.1 mm away).
- Lessons, Muse Ember 1.0 (max), same 3 requests (heart, skull, brain), 2 runs each, Opus 5.5 judge on the emulator screenshot:

| | Fidelity | Correctness | Clarity | Hands-on | Panel buttons by hand | Median time | Cost / lesson |
|---|---|---|---|---|---|---|---|
| Built from shapes (no library) | 3.0 | 3.5 | 3.2 | 4.0 | 18/18 | 55 s | $0.014 |
| Library + teaching rig | **4.0** | **4.0** | 3.0–3.5 | 4.2 | 15/18 | **32 s** | **$0.009** |

  The library fixes fidelity (every shape-built model was called "crude", "blobby", "a bouquet of balloons") and the lessons are faster and cheaper to generate because the agent writes no geometry. Clarity is the open problem: across reruns the judge's notes moved from tiny labels and panels on top of labels (fixed: bigger labels, label columns kept below the model's top, a one-time host pass that moves panels sideways off labels, comfort fit no longer shrinking text) to a crowded label ring (fixed: at most 6 labels at a time). Clarity differences of ±0.5 between identical reruns show the judge's noise at n = 6.
- Found and fixed on the way: the comfort fit scaled whole lessons (text included) below the readable size the server had checked; library labels caught hand rays meant for buttons; inside-out reconstructed walls looked see-through.
- Open: in one skull lesson the agent's panel sits over the model and a hand ray from below hits the skull before the buttons (the host lifts panels at most 15 cm); the grab probe aims at an object's centre, which misses hollow models such as the skull.

**Lesson layout (Nov 13).** For library lessons the host now places the lesson's own panels too (`layoutLessonPanels` in `host.ts`): the main panel centred above the model and its label columns, in front of the model's front face; other panels stacked beyond the label columns. It runs once all panels have their real sizes and reports `layoutSettled` for tests. Two real input bugs found while chasing failed presses: leader lines caught hand rays (three.js counts a ray within 1 unit of a line as a hit, even when hidden), and hidden labels stayed hittable. Both fixed (lines ignore rays, hidden labels collapse).
- Result on the same 6 lessons: fidelity 4.0, correctness 3.8, clarity 3.2, hands-on 4.2; panel buttons 15/18. Clarity did not move: the judge sees only the first step and now mostly asks for a larger model and for the quiz to be visible.
- Open: in one skull lesson all panel presses fail even with labels removed, the per-frame explode removed and the layout pass disabled, so the cause is in that lesson's own panel. `tests/debug-buttons.mjs` (with `genui.debugRay`) reproduces it.

**M3 router, data-driven builders and retrieval (Nov 13).** This covers M3 and the data half of M4.
- **Router** (`apps/server/src/router.ts`): before a lesson is written, one quick Muse Ember call (low reasoning, about 1 s) reads a compact catalogue and picks the models the request needs (at most 4), and names any chemical compounds it needs that the library lacks. Only the chosen models go into the agent's prompt, so the prompt stays small as the library grows. If the call fails, keyword matching takes over.
- **Data-driven builders** (tier B, `apps/worker3d/library/`):
  - From NASA Planetary Fact Sheet numbers: Saturn with its rings and Titan, the eight planets at true relative size, and a compressed solar system. Each model's provenance notes say what is and isn't to scale, and the agent is told to repeat them in the lesson.
  - From PubChem 3D conformers: ball-and-stick molecules with one named part per atom. They are built on demand when a lesson needs a compound the library lacks; ethanol and oxygen were built this way during the evaluation, in a few seconds each.
- **Evaluation:**
  - **Setup:** 8 lesson requests: anatomy (heart); astronomy (planet order, Saturn's rings, planet sizes); chemistry (caffeine; ethanol and photosynthesis, which need molecules not yet built); and a bicycle control with no library model. 2 runs each; Opus 5.5 judges the emulator screenshot.
  - **Router accuracy:** with Ember it chose exactly the expected models in 16/16 lessons, and every lesson used them. With Sonnet it did so in 14/16; the other two added the planets-to-scale model to the planet-order lesson, which is defensible.

  | Lesson agent | Fidelity | Correctness | Clarity | Hands-on | Panel buttons by hand | First try | Median time | Cost / lesson |
  |---|---|---|---|---|---|---|---|---|
  | Muse Ember, built from shapes | 4.06 | 4.50 | 3.56 | 4.00 | 42/46 | 16/16 | 44 s | $0.013 |
  | Muse Ember, library + router (M2 layout) | 3.62 | 4.38 | 2.56 | 3.81 | 47/48 | 14/16 | 38 s | $0.012 |
  | Muse Ember, library + router (new layout, same code) | 3.88 | 4.50 | 3.12 | 3.94 | 48/48 | 14/16 | 38 s | $0.012 |
  | Claude Sonnet 5.5, library + router (new layout) | 3.81 | 4.44 | 3.25 | 4.00 | 45/48 | 15/16 | 39 s | $0.088 |

  - **What the numbers show:**
    - The router and models are right; library lessons match shape-built lessons on correctness, and their buttons are more reliable.
    - The library gains little visible fidelity here: a planet is a sphere and a molecule is balls and sticks, which Ember draws well. Accurate sizes, ring radii and bond angles don't show in a single screenshot. The large fidelity gain is in anatomy (M2: 3.0 → 4.0).
    - Sonnet 5.5 ties Ember within the judge's noise at 7× the cost, so Ember stays the lesson model.
- **Layout for wide and flat models:** at first the library lost clarity (2.56) because M2's layout assumed a tall, compact model. Panels covered a solar system lying flat, labels in side columns were far from the planets they named, and quiz panels fell off the edge of the view. Fixed in the host:
  - Wide or flat models get pin labels above each part (`rig.ts`).
  - The main panel's height comes from the viewer's line of sight, so it hides no part of the model.
  - Framing lowers the whole lesson, and moves a deep model back, by the least that keeps the panel's top within 20° above the eye and the model's near edge within 55° below (`host.ts`; `tests/layout-info.mjs` prints each decision).
  - Side panels that would fall out of view go beside the main panel.
  - Clarity rose to 3.12. The rest of the gap to shapes is small planet labels and a quiz panel clipped at the edge in one solar-system lesson; it is the same for both lesson models, so it is a host problem.
- **Retrieval** (tier C):
  - **Pipeline:**
    - `objaverse_index.py` builds a SQLite full-text index of Objaverse 1.0: 708,311 CC0 and CC BY models (share-alike, non-commercial and no-derivatives licences excluded), 493 MB, searches in under 0.4 s.
    - `objaverse_retrieve.py` takes the best 40 text matches and ranks them by DINOv3 ViT-L/16 similarity between each model's thumbnail and the object's reference picture. DINOv3 runs on Modal app `spatial-genui-3d-v2-retrieval`, which takes any of four GPU types and scales to zero; the call takes seconds once warm.
    - `bench3d:retrieve` renders the 6 best from four angles, and Ember picks one or rejects them all.
  - **Results:** on the 12 Phase 3 objects it picked a model for 7. On those 7 the judge scores it 4.14 against 4.00 for TRELLIS.2 (recognisable 4.71, accuracy 4.14, craft 4.00), with the bicycle better than any generated model.
  - Retrieved models keep their authors' structure (the office chair has 45 named nodes, the volcano 6), take about 50 s with no image-to-3D GPU time, and are CC BY, so each needs its author credited.
  - The 5 rejections were strict but fair: Saturn without Titan, animal or low-poly cells, the wrong gear mechanism, a piston without its engine, flowers without the parts a lesson labels. In the router's order these fall through to the NASA-built Saturn, to TRELLIS, or to code.
- **Found and fixed on the way:**
  - Two-atom molecules failed to orient.
  - A 3-model cap dropped oxygen from photosynthesis.
  - The browser kept a stale catalogue, and another process's catalogue went stale after a molecule was built.
  - Ember looped over model ids; the validator needs them written out, and a prompt line for multi-model lessons took first tries from 0/2 to 3/3.
  - Smooth shading made Saturn's flat rings look like tubes.
  - The pin-label loop could spin forever on a floating-point tie and froze the browser.
  - The grab probe aimed at an object's centre, which isn't on a ring or a hollow model; it now aims at a reachable surface point.
  - DINOv3 needs `torchvision` and full precision.
  - Phrase searches matched no model titles.
  - Running retrieval alongside a benchmark starved the 15 s code sandbox. Don't run heavy jobs during a benchmark.
- **Open:** grab probes still miss small or internal parts (a valve inside the heart, a 1.2 cm Earth).

**Retrieved models in the library (Nov 13).** The six retrieval picks other than the heart (the BodyParts3D heart is better) are now library assets with named parts and a teaching rig:
- **Ingestion** (`bench3d:ingest`, with `library/retrieved.py` doing the geometry):
  1. Split the model into its physically separate pieces. Faces are joined through shared positions, so UV seams don't split a piece.
  2. Drop stray pieces that no chain of near neighbours connects to the model (the lander file had two 4 cm specks 8 m away).
  3. Merge small pieces into the nearest of at most 12 large ones.
  4. Render each group in solid red with the rest faint, and ask Muse Ember to name every group, pick the view a learner should see first, and give the real size.
  5. Write the asset with the author's own textured materials, one node per part, the CC BY credit (author, title, link) and provenance notes. Notes say "not real size, about 1:N" where the object is too big for a desk, and that no subject expert checked the model.
- **Results:** bicycle (front wheel, rear wheel, frame, saddle, handlebar, pedal), office chair (seat, backrest, star base, armrest, gas lift), Apollo lunar module (descent stage, ascent stage, engine nozzle, ladder), Parthenon (temple building, cella), volcano (volcano, magma chamber), acoustic guitar (body, neck). Pieces the author modelled as one stay one part; real segmentation is M5.
- **Lessons that use them** (6 requests × 2 runs, Muse Ember; the router picked the right model 12/12):

  | | Fidelity | Correctness | Clarity | Hands-on | Panel buttons by hand | Median time | Cost / lesson |
  |---|---|---|---|---|---|---|---|
  | Built from shapes | 3.83 | 4.00 | 3.50 | 3.92 | 30/35 | 60 s | $0.016 |
  | Retrieved models + teaching rig | 3.92 | 4.33 | 3.50 | 4.08 | 36/36 | 37 s | $0.009 |

  Equal or better on every measure. Lessons are 40% faster and cheaper because the agent writes no geometry, and every button worked. The judge's main complaint is too few parts (the guitar and the temple have two) and a bicycle drivetrain shown only as "frame".
- **Found and fixed on the way:**
  - "Which view shows the front" was ambiguous: a bicycle's front is its handlebar end, but a learner should see its profile. Ember is now asked for the best view for a learner.
  - Ember skipped groups, so it is now asked again for any it leaves out, and leftovers become "other" (no geometry is dropped).
  - Colour-coded groups were confused under lighting (red against magenta), so each group now gets its own highlight render.
  - Stray pieces inflated a model's size. Trimesh 4 / NumPy 2 removed `ndarray.ptp`.

**Clarity fixes (Nov 13).**
- The host now centres the main panel and the panels beside it together, so a quiz panel no longer runs off the edge of the view.
- Labels scale with the framed distance (up to 1.8×), so text keeps the angular size it was designed for. That takes a second layout pass with the main panel kept.
- On the same 16 M3 lessons, clarity is unchanged (3.06 against 3.12, within noise): the judge no longer mentions clipped panels, and the heart lessons improved, but bigger pin labels now pile up over the solar system, where labels at different depths overlap on screen.
- Remaining:
  - Screen-space label placement (the rig would need the eye position).
  - Lesson text styling (mixed italics come from the agent's markup).
  - First steps that don't yet explain the topic. That is a lesson-plan problem, not a layout one.

**M5 part segmentation, first attempt: SAM 3.1 on renders (Nov 13).**
- **Pipeline** (`bench3d:segment`, `library/segment.py`):
  1. Muse Ember lists the parts to find, the request's visible parts plus the main body.
  2. The model is rendered from 10 angles, as made and as face-number colours. The renderer's new `renderViews` reads exact colours back from an offscreen buffer, so every pixel says which face it shows.
  3. SAM 3.1 (Meta API, $0.0025 per image, about 1 s per call) finds each part in each view.
  4. Masked pixels vote for their faces; the smallest overlapping mask wins. A mask covering most of the object is ignored, since SAM returns that when it can't find the part. Unclaimed faces next to a part join it, and the rest join the main body, or a part named after the object if SAM found no main body.
  5. Low-poly models are subdivided first, keeping UVs, so boundaries can fall between faces.
  - About 30 s and $0.15–0.20 of SAM per model. Meta's `meta-sam-parser` decodes the masks.
- **Independent check** (`bench3d:judge-parts`): Claude Opus 5.5 sees each part in solid red with the rest faint and scores it 1–5.

  | 18 models (6 retrieved, 12 TRELLIS.2) | Usable overall | Average part | Good parts (4–5) per model |
  |---|---|---|---|
  | Retrieved, SAM given part names | 2.33 | 3.43 | 1.8 |
  | Retrieved, SAM given what parts look like | 2.17 | 3.36 | 2.0 |
  | TRELLIS.2, part names | 1.83 | 3.23 | 1.4 |
  | TRELLIS.2, what parts look like | 1.83 | 2.95 | 1.0 |

- **Results:**
  - **Distinct shapes come out well:** headstock, bridge and neck on guitars; saddle and pedals on bicycles; footpads; columns and entablature on temples; volcano craters.
  - **Most models get only one or two clean parts.** The rest bleed: a seat that takes the chair's base, a frame that takes half of each wheel, strings as fragments.
  - SAM doesn't know technical names ("descent stage", "vacuole", "crankshaft"). Describing what the parts look like didn't help on average.
  - TRELLIS meshes, one fused surface, segment worse than retrieved models.
- **Conclusion:** masks from 2D views, each slightly off and lifted onto the surface, give ragged regions. Not good enough for lessons as it stands.
- **The usual remedy:** a 3D segmentation model that cuts the mesh into geometrically clean regions, with SAM 3.1 or Ember only naming them. Candidates:
  - PartField (NVIDIA License: non-commercial research and educational use only).
  - P3-SAM (Tencent Hunyuan 3D-Part Community License: not valid in the EU, UK or South Korea, Tencent's terms elsewhere).
  - Both run on a Modal GPU. Choosing one is a licensing decision (section 9).

**M5 with P3-SAM (Nov 13).** Chosen: P3-SAM, accepting a non-commercial limit. Its Sonata backbone's weights are CC BY-NC 4.0, so P3-SAM is effectively non-commercial too, like PartField. Fine for the competition and education; replace it before any commercial use. Each segmented asset's provenance says so.
- **Deployment:** `apps/worker3d/modal_parts.py`, Modal app `spatial-genui-3d-v2-parts` (L40S, A10G or L4; scales to zero; repo pinned to `e96be06`).
  - Segments a mesh in 15–41 s of GPU time, 3–31 regions per model.
  - We send our own merged mesh with P3-SAM's cleaning off, so its face numbers are ours.
  - Prompt batch 8, because upstream's 32 needs more than a 24 GB GPU.
- **Naming** (`bench3d:name-regions`, `segment.py regions` / `finalize`):
  1. Tiny regions merge into the neighbour they share most edges with (at most 16 regions).
  2. Muse Ember names every region from one highlight render each, in the lesson's words.
  3. Regions with the same name become one part.
- **Opus 5.5 part check on the same 18 models** (same check as above):

  | | Usable overall | Average part | Good parts (4–5) per model |
  |---|---|---|---|
  | Retrieved: SAM 3.1 only | 2.33 | 3.43 | 1.8 |
  | Retrieved: P3-SAM regions, SAM 3.1 votes name them | 2.17 | 4.00 | 2.2 |
  | Retrieved: P3-SAM regions, Ember names them | 2.83 | 3.75 | 2.8 |
  | TRELLIS.2: SAM 3.1 only | 1.83 | 3.23 | 1.4 |
  | TRELLIS.2: P3-SAM, SAM votes | 1.83 | 3.81 | 1.2 |
  | TRELLIS.2: P3-SAM, Ember names | 2.83 | 3.50 | 2.8 |

- **Results:**
  - P3-SAM's regions are geometrically clean. With SAM naming them, part quality rises (average part 3.2–3.4 → 3.8–4.0), but few regions collect enough votes to be named.
  - Ember names every region and knows technical words (descent stage, crankshaft, mitochondrion): twice as many good parts per model, and usability 1.8–2.3 → 2.8.
  - **Best results:**
    - TRELLIS flower 5/5, every part right.
    - Retrieved bicycle 4/5: both wheels, saddle, handlebar and pedals perfect.
    - Saturn with Titan and its rings 4/5.
    - Guitars: body and bridge perfect.
  - **Weak:** some technical names are wrong on generated insides (a TRELLIS engine's "piston" and "connecting rod", a heart's "right atrium", a temple's "pediment"). Thin parts (chains, strings) stay hard. A painted-on feature such as a sound hole can't be cut by any 3D method.
- **Next:**
  - A verification step (Ember checks each named region before it reaches a lesson).
  - Wire the segmented TRELLIS and retrieved models into the library through `retrieved.py ingest`.

**M5 self-check, library and lessons (Nov 13).**
- **Self-check** (`bench3d:verify-parts`): Muse Ember looks at each named part again, in solid red with the rest faint, and keeps it, renames it, or merges it into the main body. It is told to be strict, since a wrong label teaches something false.
  - On the 18 models it mostly removes bad parts. Parts the Opus check scores 1–2 fell from 7 to 3 (retrieved) and from 15 to 10 (TRELLIS); average part quality rose (3.75 → 4.00, 3.50 → 3.63); good parts fell slightly (17 → 16, 34 → 30); overall usability is unchanged (2.83).
  - Its verdicts vary between runs: one run merged the TRELLIS engine's wrong "piston", the next kept it.
  - A bug found on the way: region names with underscores didn't match verdicts written with spaces.
- **Library** (offline curation with the Opus part check; the automatic path has no Opus):
  - The guitar, lunar lander and Parthenon moved to their P3-SAM versions (Opus 3 → 4, 2 → 3, 1 → 2). The office chair, bicycle and volcano kept their earlier versions (better or tied).
  - New TRELLIS.2 assets (tier D), with credit and the P3-SAM licence note: flower (petal, stem, stamen, pistil, sepal) and plant cell (nucleus, cell wall, vacuole, mitochondrion, membrane, chloroplast, endoplasmic reticulum).
  - Things too small for a desk are now enlarged with the magnification stated ("about 3,000 times larger").
- **Lessons on the four Phase 3 topics** the library lacked (flower, plant cell, engine strokes, gear ratio; 2 runs each; Muse Ember; the router picked the TRELLIS model 8/8):

  | | Fidelity | Correctness | Clarity | Hands-on | Panel buttons by hand | Median time | Cost / lesson |
  |---|---|---|---|---|---|---|---|
  | Built from shapes | 4.00 | 4.62 | 3.75 | 4.38 | 23/23 | 51 s | $0.014 |
  | TRELLIS.2 + P3-SAM parts | 3.75 | 4.00 | 3.12 | 4.00 | 24/24 | 36 s | $0.010 |

- **What this shows:**
  - The generated models don't beat shapes here.
  - **Mechanisms lose:** an engine-stroke or gear lesson needs moving parts. A generated mesh is static, while Ember's code-built pistons and gears turn; the TRELLIS engine was also a whole engine block, not one cylinder. The engine and gear-train assets are retired to `data/library-retired/`, so those topics go back to code (the routing rule of section 4.1: generators for real-world objects, code for concepts and mechanisms).
  - **Biology ties on fidelity** but loses clarity because the real-size flower (10 cm) sits small and far away with tiny labels. Next: scale small models up further in lessons.
  - Library lessons are still faster and cheaper.

**On-demand path (Nov 13).** One job now takes a real-world object from "not in the library" to a library model with named parts (`apps/server/src/three-d/acquire.ts`; the stages are shared with the benchmarks through `stages.ts`):

```
reference picture: Ember briefs it, Muse Image draws it, Ember checks it (redrawn up to 3 times)
  -> search Objaverse (CC0 / CC BY), rank by DINOv3, Ember picks from renders     tier C
  -> if nothing fits: TRELLIS.2 builds one from the reference picture             tier D
  -> P3-SAM cuts regions, Ember names them, Ember checks the names
  -> library asset with credit, licence and provenance
```

- **How a lesson uses it:**
  - With `ASSETS_ON_DEMAND=1` the router also names at most one real-world object the lesson is about that the library lacks. The rule: the thing the lesson teaches, not a prop such as a pizza for fractions. Ember and Sonnet both got it right on 7 of 7 re-check requests.
  - The lesson is served at once, built from shapes. The job runs in the background (one at a time; `GET /api/assets/jobs/<id>` reports progress).
  - The page shows progress and offers "Rebuild with the accurate model" when the asset is in. It never rebuilds on its own, since the learner may be mid-lesson.
  - Off by default: each model costs a reference picture and one to three minutes of Modal GPU time.
  - `npm run assets:acquire -- --name <object> --describe "<one line>"` runs the same path from the command line, to test it or to stock the library ahead of time (`--no-search` generates).
- **First run, a microscope (retrieved):** 187 s end to end.
  - A CC BY school microscope was found on Objaverse.
  - 29 P3-SAM regions were named and merged into eyepiece, body tube, objective lenses, stage, focus knob and base. The self-check merged away a doubtful "arm".
  - Stored at real size (35 cm), with keywords so the router finds it next time.
- **The reference picture is checked before anything is built from it.** A model generated from a picture repeats the picture's mistakes.
  - **What went wrong before:** the Phase 3 gear train's reference showed the gears from an angle, overlapping, and TRELLIS.2 put the small gear at right angles to the big one. Every later stage inherited that, including a Blender repair that spent half an hour on it.
  - **The new first stage** (`checkedReference`):
    - Ember writes a brief, with the view that shows the structure and the facts the picture must show.
    - Muse Image draws it.
    - Ember checks the picture against the facts. A failed picture is redrawn with its problems named.
    - No model is generated from a picture scoring under 3 of 5.
  - **Gear train, regenerated from a checked picture:** 392 s.
    - The gears are in one plane with their teeth together and the crank is on the small gear.
    - The parts came out right with no repair: base plate, drive gear, driven gear, crank handle, axle, axle support.
    - The check rejected two pictures with extra gears at different depths and kept a correct one.
  - **Costs and flaws seen:**
    - A face-on picture leaves depth to the generator: the new model's base plate is ragged at the back. The brief now asks for a slightly turned and raised view.
    - Ember's first brief invented structure ("the base plate behind the gears") and marked a correct picture down for it, causing two needless redraws. The brief may now state only structure the request gives or every such object has.
    - Not every error starts in the picture: the engine's reference was good, and its faults came from part naming.
  - **The 12 original Phase 3 pictures, checked afterwards** (`bench3d:check-refs`; TRELLIS.2 had built a model from each, n = 12):
    - Checking facts only: pictures scoring 4-5 led to models averaging 4.00 (judge), pictures scoring 1-3 to 3.29. It flagged 5 of the 7 models the judge scored 3 or lower. Typical flaws: no ladder on the lunar lander, no vent in the volcano, no leaf on the flower.
    - It passed the old gear-train picture, though. That picture is not wrong in 2D; its depth can be read two ways (gears overlapping, seen at a slant), and the generator read it the wrong way.
    - The checker now also asks whether an arrangement could be read two ways. With that it flags all 7 weak models, and 3 of the 5 good ones (e.g. the guitar's slanted sound hole). A false alarm costs a redraw or two, not correctness, since the best picture of three is still used.
  - **The 7 weak models, rebuilt from checked pictures** (`assets:acquire --no-search`, n = 7; same TRELLIS.2 and requests, only the picture changed):
    - Head to head (`bench3d:compare`, Opus 5.5 sees old and new four-view renders in both orders; a model wins only by winning both): the new model wins 6 of 7, every win in both orders. Accuracy 2.71 → 4.00 (mean of both orders).
    - Biggest gains: the temple (2 → 5: a whole roofed temple instead of an open box), the volcano (2 → 4: a vent from the chamber to the crater), the plant cell (3 → 5).
    - The gear train lost (3 → 2): the gears came out on one shaft. None of the 3 pictures reached 4, and the kept one (3/5) carried exactly this warning: in a slanted view the small gear could lie along the axle. A 3 that names a depth ambiguity should not pass; the earlier face-on gear picture built a correct model.
    - Parts barely moved (`bench3d:judge-parts`, same judge): overall 3.00 → 3.14, good parts (4-5) per model 2.57 → 2.71. Saturn, the volcano and the engine gained; the flower lost its stamen and pistil parts and the richer plant cell its mitochondria and ER. With better models, part cutting and naming is now the weaker stage.
    - Time: 3 to 15 minutes per model (the plant cell and Saturn took longest), two at a time.
- **Not done yet:**
  - The "model ready" notice exists on the desktop page only, not inside the headset.
  - The page flow hasn't been run in the emulator.
  - The Blender repair stage is not part of this path.

**On a Quest 3S (Nov 13).** The app was run in the headset's own browser in an immersive AR session, driven over USB (`iwsdk-native-xr-test`, ADB reverse on loopback). The page can now start a lesson from its address (`/?prompt=…`) or from four one-tap examples, so nothing has to be typed in the headset.
- The microscope lesson (retrieved model, six named parts) mounted about 0.5 m in front at table height, with its tour and quiz panels beside it.
- A trigger press on the tour panel's "explode" moved all six parts 8.8 cm outward; "reset" returned them exactly (part positions read from the scene before and after).
- Mixed reality features the session got: plane and mesh detection, anchors, hand tracking.
- Problem seen: the USB link reset several times, which drops the ADB route; the dev server then reloads the page and the lesson is rebuilt. A watcher that re-adds the route kept the test going.

**Blender repair pilot (Nov 13).** `bench3d:repair`: an agent in the sandboxed headless Blender (Phase 3's MCP server) fixes a segmented model's parts and structure; Muse Ember reviews each round from renders and the best round wins. Motion is out of scope for now. Tried on the old gear train, whose gears stand at right angles:

| Agent | Rounds | Result | Steps | Time | Cost |
|---|---|---|---|---|---|
| Claude Sonnet 5.5 (no caching through the OpenAI-compatible endpoint) | 1 | Six correct parts, small gear turned into the big gear's plane; export failed, so never scored | 34 tool calls | 25 min | $3.61 |
| Muse Spark 1.3 contributor, bare tools | 0 | Stopped after an hour, still measuring | 22 | 60 min | cents |
| Muse Spark 1.3 contributor, with the fixes below | 2 | Part names right in round 2, gears still not meshing; critic 2/5 (from 1/5) | 48 | 57 min | $0.07 |

- **Fixes made for the agent:**
  - Each P3-SAM region is its own piece under its part (`retrieved.py --split-regions`).
  - Every piece's measurements are in the first message.
  - A helper kit is preloaded in Blender (`apps/worker3d/research/repair_kit.py`: list parts, split loose pieces, cut at a plane, assign, rotate, move, join).
  - A `look` tool shows the agent the model as the critic sees it.
  - A step with no reply in 6 minutes is retried.
  - Meta's prompt cache served 93% of the input.
  - Exports are no longer sent inline (a 4.5 MB model broke the connection).
- **Conclusion:** repair after the fact is slow and, with Spark, did not fix the structure. The same model regenerated from a checked reference picture came out right in 6.5 minutes (above). So mistakes are caught at the picture first; repair stays a pilot for what a better picture cannot fix.

## 10. Sources

- SceneCraft: An LLM Agent for Synthesizing 3D Scene as Blender Code. https://arxiv.org/abs/2403.01248
- LL3M: Large Language 3D Modelers. https://www.researchgate.net/publication/394439477_LL3M_Large_Language_3D_Modelers
- ShapeCraft: LLM Agents for Structured, Textured and Interactive 3D Modeling (NeurIPS 2025). https://arxiv.org/abs/2510.17603
- 3DHarnessBench: Probing Agentic 3D-to-Code Capabilities of Frontier VLMs. https://arxiv.org/abs/2609.06535
- DreamPartGen: Semantically Grounded Part-Level 3D Generation (ECCV 2026). https://arxiv.org/abs/2603.19216
- Part-X-MLLM: Part-aware 3D multimodal LLM (ICLR 2026). https://proceedings.iclr.cc/paper_files/paper/2026/file/f38cb4cf9a5eaa92b3cfa481832719c6-Paper-Conference.pdf
- Name That Part: 3D Part Segmentation and Naming (CVPR 2026). https://openaccess.thecvf.com/content/CVPR2026F/papers/Paul_Name_That_Part_3D_Part_Segmentation_and_Naming_CVPRF_2026_paper.pdf
- PartField: Learning 3D Feature Fields for Part Segmentation. https://arxiv.org/abs/2504.11451
- P3-SAM: Native 3D Part Segmentation. https://arxiv.org/abs/2509.06784
- SAM 3D Objects (Meta). https://huggingface.co/facebook/sam-3d-objects
- Meta Model API models (SAM 3.1, Muse Image, Muse Wonder). https://dev.meta.ai/docs/models
- Cap3D (license-filtered Objaverse captions). https://huggingface.co/datasets/tiange/Cap3D
- Z-Anatomy (CC BY-SA 4.0, derived from BodyParts3D). https://github.com/Z-Anatomy/Models-of-human-anatomy
- BodyParts3D archive (DBCLS). https://dbarchive.biosciencedbc.jp/
