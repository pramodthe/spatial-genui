"""Helpers for the repair agent (bench3d:repair, apps/server/src/three-d/repair.ts), loaded into the
sandboxed Blender's Python namespace before the agent's first turn.

They cover the routine steps of a repair (listing the parts with their measurements, splitting a piece,
moving a piece to another part, turning or shifting a piece, joining pieces), so the agent spends its turns on decisions instead of
re-deriving measurements. Everything is in world space, metres, Z up. Trusted code, but it runs inside
the sandbox like the agent's own.

A model here is: one top-level object per part (an empty named after the part) with mesh pieces as
children. The helpers keep that shape.
"""

from math import radians

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector


def _world(obj):
    """Vertex positions in world space, shape (n, 3)."""
    co = np.empty(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get("co", co)
    m = np.array(obj.matrix_world)
    return co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3]


def _face_centres(obj):
    centres = np.empty(len(obj.data.polygons) * 3)
    obj.data.polygons.foreach_get("center", centres)
    m = np.array(obj.matrix_world)
    return centres.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3]


def _fmt(v):
    return "[" + ", ".join(f"{x:.3f}" for x in v) + "]"


def _describe(obj, total):
    w = _world(obj)
    lo, hi = w.min(axis=0), w.max(axis=0)
    faces = len(obj.data.polygons)
    return (f"{obj.name}: {faces} faces ({100 * faces / total:.0f}% of the model), size {_fmt(hi - lo)}, centre {_fmt((lo + hi) / 2)}, "
            f"x {lo[0]:.3f}..{hi[0]:.3f}, y {lo[1]:.3f}..{hi[1]:.3f}, z {lo[2]:.3f}..{hi[2]:.3f}")


def parts():
    """Print every part and its mesh pieces: faces, size, centre and extent (world, metres)."""
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    total = sum(len(o.data.polygons) for o in meshes) or 1
    for top in sorted((o for o in bpy.context.scene.objects if o.parent is None), key=lambda o: o.name):
        pieces = [top] if top.type == "MESH" else [c for c in top.children_recursive if c.type == "MESH"]
        if not pieces:
            continue
        print(f'part "{top.name}": {len(pieces)} piece(s)')
        for obj in sorted(pieces, key=lambda o: o.name):
            print("  " + _describe(obj, total))


def _split(obj, groups, names):
    """Replace mesh object `obj` by one object per group (per-face integer labels); returns the new objects."""
    made = []
    for g, name in enumerate(names):
        if not (groups == g).any():
            continue
        new = obj.copy()
        new.data = obj.data.copy()
        for collection in obj.users_collection:
            collection.objects.link(new)
        bm = bmesh.new()
        bm.from_mesh(new.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if groups[f.index] != g], context="FACES")
        bm.to_mesh(new.data)
        bm.free()
        made.append((new, name))
    bpy.data.objects.remove(obj, do_unlink=True)
    for new, name in made:  # named after the original is gone, so its name is free
        new.name = name
    total = sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == "MESH") or 1
    for new, _ in made:
        print("  " + _describe(new, total))
    return [new.name for new, _ in made]


def split_loose(name, min_share=0.03):
    """Split mesh piece `name` into its physically separate pieces (it stays in its part). Pieces under
    min_share of its faces go with the nearest larger piece. Prints and returns the new piece names."""
    obj = bpy.data.objects[name]
    me = obj.data
    # Vertices at the same position count as one: imported meshes are split along texture seams.
    weld = np.unique(np.round(_world(obj), 5), axis=0, return_inverse=True)[1].ravel()
    edges = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", edges)
    edges = weld[edges.reshape(-1, 2)]
    label = np.arange(int(weld.max()) + 1)
    while True:
        low = np.minimum(label[edges[:, 0]], label[edges[:, 1]])
        new = label.copy()
        np.minimum.at(new, edges[:, 0], low)
        np.minimum.at(new, edges[:, 1], low)
        new = new[new]
        if np.array_equal(new, label):
            break
        label = new
    starts = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get("loop_start", starts)
    loops = np.empty(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", loops)
    face_label = label[weld[loops[starts]]]
    ids, counts = np.unique(face_label, return_counts=True)
    big = ids[counts >= min_share * len(face_label)]
    if len(big) < 2:
        print(f"{name} is one connected piece (plus {len(ids) - len(big)} small bits): nothing to split. Try split_plane.")
        return [name]
    centres = _face_centres(obj)
    big_centres = np.array([centres[face_label == b].mean(axis=0) for b in big])
    groups = np.empty(len(face_label), dtype=np.int64)
    for i in ids:
        mine = face_label == i
        hit = np.flatnonzero(big == i)
        groups[mine] = hit[0] if len(hit) else int(np.argmin(((big_centres - centres[mine].mean(axis=0)) ** 2).sum(axis=1)))
    order = np.argsort(-np.array([(groups == g).sum() for g in range(len(big))]))  # biggest first
    groups = np.argsort(order)[groups]
    print(f"{name} split into {len(big)} pieces:")
    return _split(obj, groups, [f"{name}_{'abcdefghijklmnop'[g % 16]}" for g in range(len(big))])


def split_plane(name, axis, value):
    """Cut mesh piece `name` in two by the side of a plane each face's centre lies on: axis 'x', 'y' or
    'z' (world), value in metres. No new geometry. Prints and returns the names [below, above]."""
    obj = bpy.data.objects[name]
    side = (_face_centres(obj)[:, "xyz".index(axis)] >= value).astype(np.int64)
    if side.min() == side.max():
        print(f"All of {name} is on one side of {axis} = {value}: nothing to split.")
        return [name]
    print(f"{name} split at {axis} = {value}:")
    return _split(obj, side, [f"{name}_lo", f"{name}_hi"])


def assign(piece, part):
    """Move mesh piece `piece` to part `part` (a top-level empty with that name, created if missing).
    The piece stays where it is in space."""
    obj = bpy.data.objects[piece]
    top = bpy.data.objects.get(part)
    if top is None:
        top = bpy.data.objects.new(part, None)
        bpy.context.scene.collection.objects.link(top)
    world = obj.matrix_world.copy()
    obj.parent = top
    obj.matrix_world = world
    print(f'{piece} is now in part "{top.name}"')


def join(names, new_name=None):
    """Join mesh pieces into one (the first keeps its part); returns the joined piece's name."""
    objs = [bpy.data.objects[n] for n in names]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    if new_name:
        objs[0].name = new_name
    return objs[0].name


def rotate(piece, axis, degrees, about=None):
    """Turn mesh piece `piece` about a world axis ('x', 'y' or 'z') through its own centre, or through
    the world point `about` ([x, y, z])."""
    obj = bpy.data.objects[piece]
    w = _world(obj)
    centre = Vector(((w.min(axis=0) + w.max(axis=0)) / 2) if about is None else about)
    turn = Matrix.Translation(centre) @ Matrix.Rotation(radians(degrees), 4, axis.upper()) @ Matrix.Translation(-centre)
    obj.matrix_world = turn @ obj.matrix_world
    bpy.context.view_layer.update()
    print("  " + _describe(obj, sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == "MESH") or 1))


def move(piece, dx=0.0, dy=0.0, dz=0.0):
    """Shift mesh piece `piece` by (dx, dy, dz) metres in world space."""
    obj = bpy.data.objects[piece]
    obj.matrix_world = Matrix.Translation((dx, dy, dz)) @ obj.matrix_world
    bpy.context.view_layer.update()
    print("  " + _describe(obj, sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == "MESH") or 1))


def rename_part(old, new):
    """Rename a part (its top-level object)."""
    obj = bpy.data.objects[old]
    obj.name = new
    print(f'part "{old}" is now "{obj.name}"')
