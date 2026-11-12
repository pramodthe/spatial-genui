"""Runs inside a sandboxed, headless Blender: executes bpy code sent as JSON lines on stdin.

Started by blender_mcp_server.py as `Blender -b --factory-startup --python blender_bridge.py`.
Each request is one JSON line ({"op": "exec" | "scene" | "export", ...}); each reply is one line on
stdout prefixed with REPLY, because Blender writes its own messages to stdout too.
"""

import base64
import contextlib
import io
import json
import os
import sys
import tempfile
import traceback

import bpy

REPLY = "@@BRIDGE@@ "
namespace = {"bpy": bpy, "__name__": "agent_code"}


def scene_info() -> dict:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    objects, total_tris = [], 0
    for obj in bpy.context.scene.objects:
        entry = {
            "name": obj.name,
            "type": obj.type,
            "parent": obj.parent.name if obj.parent else None,
            "location": [round(v, 4) for v in obj.matrix_world.translation],
            "dimensions": [round(v, 4) for v in obj.dimensions],
        }
        if obj.type == "MESH":
            mesh = obj.evaluated_get(depsgraph).to_mesh()
            tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
            obj.evaluated_get(depsgraph).to_mesh_clear()
            entry["triangles"] = tris
            entry["materials"] = [s.material.name for s in obj.material_slots if s.material]
            total_tris += tris
        objects.append(entry)
    return {"objects": objects, "triangles": total_tris}


def handle(request: dict) -> dict:
    op = request.get("op")
    if op == "exec":
        out = io.StringIO()
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
                exec(compile(request["code"], "agent_code.py", "exec"), namespace)
            return {"ok": True, "output": out.getvalue()[-4000:], "scene": scene_info()}
        except Exception as err:
            tb = traceback.extract_tb(err.__traceback__)
            line = next((f.lineno for f in reversed(tb) if f.filename == "agent_code.py"), None)
            where = f" (line {line})" if line else ""
            return {"ok": False, "output": out.getvalue()[-4000:], "error": f"{type(err).__name__}: {err}{where}"[:2000], "scene": scene_info()}
    if op == "scene":
        return {"ok": True, "scene": scene_info()}
    if op == "export":
        path = request.get("path") or os.path.join(tempfile.mkdtemp(), "model.glb")
        bpy.ops.export_scene.gltf(
            filepath=path, export_format="GLB", export_apply=True, export_yup=True,
            export_cameras=False, export_lights=False,
        )
        glb = base64.b64encode(open(path, "rb").read()).decode()
        return {"ok": True, "glb_base64": glb, "scene": scene_info()}
    return {"ok": False, "error": f"Unknown op {op!r}"}


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)  # start from an empty scene, metres, Z up
    sys.stdout.write(REPLY + json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            reply = handle(json.loads(line))
        except Exception as err:
            reply = {"ok": False, "error": f"Bridge error: {type(err).__name__}: {err}"}
        sys.stdout.write(REPLY + json.dumps(reply) + "\n")
        sys.stdout.flush()


main()
