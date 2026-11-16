---
name: library-models
description: Use assets.get(id) for a library model and its named parts. Look ids up with the library_lookup tool.
---

# Library models

Call the host tool `library_lookup` with the object's name. It returns ids, part names and a short credit. It does not return secrets.

In the module, the id is a string literal (the host only preloads literals):

```js
const heart = assets.get('heart-bp3d');
root.add(heart.object3D);
heart.labelParts(['left_ventricle']);
heart.explode(0.6);
heart.cutaway(true);
heart.highlight('left_ventricle');
```

Use the model's parts instead of rebuilding that object from shapes. Put the credit on the last line of the main panel. Show at most 6 labels at a time.

`include_tools`: this skill is for the host `library_lookup` tool. Do not guess an id.
