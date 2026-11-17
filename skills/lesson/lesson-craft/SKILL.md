---
name: lesson-craft
description: Real proportions, three layers of detail, ground the model, stay inside the triangle budget.
---

# Lesson craft

Spend the effort on the main model.

- Start from the real object: real proportions, base at y = 0, about 0.2–0.4 m across. Derive every position from a few named dimensions so parts sit on the surfaces they attach to.
- Three layers: 5–15 main masses, then hatches, rims, handles and windows, then bolts, rivets and slats. Do not stop at layer one. Use extrude, lathe, tube and roundedBox instead of a stack of boxes.
- 3–6 materials that differ in roughness and metalness, one accent, wear on outdoor things. `kit.material('light')` and `kit.glow` for anything that shines.
- A single machine stands on `kit.stand`. A spread-out scene uses `kit.shadow` under its pieces.
- 10,000–60,000 triangles is the useful range. Hard limits: 150,000 triangles and 150 draw calls. Repeated detail goes through `kit.instances`, `kit.along` or `kit.merge`.
- Keep the module under about 350 lines. Round parts the learner sees up close use 32–48 segments.
- The desk box is 0.8 m wide, 0.5 m tall, 0.5 m deep, above y = 0. Interactive objects are at least 0.03 m. Grabbable objects are still or slower than 0.05 m/s.
