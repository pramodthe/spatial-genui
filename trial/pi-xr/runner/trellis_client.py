"""One picture in, one textured GLB out, by TRELLIS.2 on Modal (the deployed app spatial-genui-3d-v2, class Trellis,
from the Nov 13 3D work: git 24568da apps/worker3d/modal_trellis.py). Called with this machine's Modal login, so it
runs outside the agent's sandbox, from the studio service (studio-server.mjs).

Usage: python trellis_client.py <image> <out.glb> [triangles: 20000] [texture size: 1024]
Prints one line of JSON: {"ok", "wall_s", "generate_s", "export_s", "bytes", "settings"} or {"ok": false, "error"}.
"""

import json
import sys
import time
from pathlib import Path

import modal


def main() -> None:
    image, out = Path(sys.argv[1]), Path(sys.argv[2])
    triangles = int(sys.argv[3]) if len(sys.argv) > 3 else 20_000
    texture = int(sys.argv[4]) if len(sys.argv) > 4 else 1024
    started = time.time()
    try:
        trellis = modal.Cls.from_name("spatial-genui-3d-v2", "Trellis")()
        result = trellis.image_to_glb.remote(image.read_bytes(), decimation_target=triangles, texture_size=texture)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(result["glb"])
        print(json.dumps({"ok": True, "wall_s": round(time.time() - started, 1), "generate_s": result["generate_s"],
                          "export_s": result["export_s"], "bytes": len(result["glb"]), "settings": result["settings"]}))
    except Exception as err:  # the caller reports it to the agent in words
        print(json.dumps({"ok": False, "wall_s": round(time.time() - started, 1), "error": str(err)[:400]}))
        sys.exit(1)


if __name__ == "__main__":
    main()
