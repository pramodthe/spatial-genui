"""Runs inside the sandbox: execute an agent-written CadQuery script and export its assembly as GLB.

Usage: python cadquery_runner.py <script.py | -> <out.glb | ->
("-" reads the script from stdin / returns the GLB inline as base64, for remote sandboxes.)
The script must define `build() -> cadquery.Assembly` with one named, colored part per component,
in millimetres with Z up (CadQuery's usual conventions); the GLB comes out in metres, Y up.
Prints one JSON line: {"ok": true, "parts": [...]} or {"ok": false, "error": "..."}.
"""

import base64
import json
import os
import sys
import tempfile
import traceback

import cadquery as cq
from cadquery.occ_impl.assembly import toCAF
from cadquery.occ_impl.geom import Location
from OCP.Message import Message_ProgressRange
from OCP.RWGltf import RWGltf_CafWriter
from OCP.TColStd import TColStd_IndexedDataMapOfStringString
from OCP.TCollection import TCollection_AsciiString

# Coarse enough for Quest budgets, fine enough that curved parts don't look faceted at desk scale.
LINEAR_TOLERANCE_MM = 0.5
ANGULAR_TOLERANCE = 0.2  # radians


def export_glb(assy: cq.Assembly, path: str) -> None:
    """Like CadQuery's GLTF export (Z up -> glTF Y up), plus millimetres -> metres, which glTF expects."""
    assy.loc *= Location((0, 0, 0), (1, 0, 0), -90)
    _, doc = toCAF(assy, True, True, LINEAR_TOLERANCE_MM, ANGULAR_TOLERANCE)
    writer = RWGltf_CafWriter(TCollection_AsciiString(path), True)
    writer.ChangeCoordinateSystemConverter().SetInputLengthUnit(0.001)
    writer.SetMergeFaces(True)  # one mesh per part, not one per CAD face (draw calls on Quest)
    if not writer.Perform(doc, TColStd_IndexedDataMapOfStringString(), Message_ProgressRange()):
        raise RuntimeError("GLB export failed.")


def part_names(assy: cq.Assembly) -> list[str]:
    names = []
    for child in assy.children:
        names.append(child.name)
        names.extend(part_names(child))
    return names


def main() -> None:
    script, out = sys.argv[1], sys.argv[2]
    namespace: dict = {"__name__": "agent_script"}
    try:
        source = sys.stdin.read() if script == "-" else open(script, encoding="utf-8").read()
        exec(compile(source, "model.py", "exec"), namespace)
        build = namespace.get("build")
        if not callable(build):
            raise ValueError("The script must define a function build() that returns a cadquery.Assembly.")
        assy = build()
        if not isinstance(assy, cq.Assembly):
            raise ValueError(f"build() must return a cadquery.Assembly, not {type(assy).__name__}.")
        if not assy.children:
            raise ValueError("The assembly is empty: add each part with assy.add(shape, name=..., color=...).")
        if out == "-":
            path = os.path.join(tempfile.mkdtemp(), "model.glb")
            export_glb(assy, path)
            glb = base64.b64encode(open(path, "rb").read()).decode()
            print(json.dumps({"ok": True, "parts": part_names(assy), "glb_base64": glb}))
        else:
            export_glb(assy, out)
            print(json.dumps({"ok": True, "parts": part_names(assy)}))
    except Exception as err:  # report everything back to the agent for repair
        tb = traceback.extract_tb(err.__traceback__)
        line = next((f.lineno for f in reversed(tb) if f.filename == "model.py"), None)
        where = f" (model.py line {line})" if line else ""
        print(json.dumps({"ok": False, "error": f"{type(err).__name__}: {err}{where}"[:2000]}))


if __name__ == "__main__":
    main()
