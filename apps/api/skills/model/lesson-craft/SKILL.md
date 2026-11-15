---
name: lesson-craft
description: Real proportions, three layers of detail, ground the model, stay inside the triangle budget. The model-maker's own copy.
---

# Lesson craft

Spend the effort on the one object you were asked for.

- Start from the real object: real proportions, base at y = 0, about 0.2–0.4 m across. Derive every position from a few named dimensions so parts sit on the surfaces they attach to.
- Three layers: 5–15 main masses, then hatches, rims, handles and windows, then bolts, rivets and slats. Do not stop at layer one. Use extrude, lathe, tube and roundedBox instead of a stack of boxes.
- 3–6 materials that differ in roughness and metalness, one accent, wear on outdoor things. `kit.material('light')` and `kit.glow` for anything that shines.
- Stand a single object on `kit.stand`.
- 10,000–60,000 triangles is the useful range. Hard limits: 150,000 triangles and 150 draw calls. Repeated detail goes through `kit.instances`, `kit.along` or `kit.merge`.
- Export one function the parent lesson can call. Save it under `/work` and say the path, the function name, whether the dry run passed, and the triangle count.
