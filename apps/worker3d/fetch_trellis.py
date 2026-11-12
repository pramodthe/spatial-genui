"""Image-to-3D with TRELLIS.2 on our Modal GPU (modal_trellis.py), for the tier D comparison.

Usage: python fetch_trellis.py <dir with <object>.jpg reference images> <out dir> [object ids...]
Writes <out dir>/<object>.glb and appends timing and settings to <out dir>/trellis.jsonl. Resumable:
objects that already have a GLB are skipped. Calls the deployed Modal app with this machine's Modal login.
(Hugging Face's free demo quota, about two GPU minutes a day, allowed one model a day, hence Modal.)
"""

import json
import sys
import time
from pathlib import Path

import modal


def main() -> None:
    refs, out = Path(sys.argv[1]), Path(sys.argv[2])
    wanted = sys.argv[3:] or sorted(p.stem for p in refs.glob("*.jpg"))
    out.mkdir(parents=True, exist_ok=True)
    trellis = modal.Cls.from_name("spatial-genui-3d-v2", "Trellis")()
    for obj in wanted:
        if (out / f"{obj}.glb").exists():
            continue
        image = refs / f"{obj}.jpg"
        if not image.exists():
            print(f"{obj}: no reference image", flush=True)
            continue
        started = time.time()
        try:
            result = trellis.image_to_glb.remote(image.read_bytes())
            (out / f"{obj}.glb").write_bytes(result["glb"])
            row = {"object": obj, "ok": True, "wall_s": round(time.time() - started, 1), "generate_s": result["generate_s"],
                   "export_s": result["export_s"], "model": "TRELLIS.2-4B", "gpu": "RTX-PRO-6000", **result["settings"]}
            print(f"{obj}: ok, {row['wall_s']} s ({row['generate_s']} s generating)", flush=True)
        except Exception as err:  # recorded; a re-run retries this object
            row = {"object": obj, "ok": False, "wall_s": round(time.time() - started, 1), "error": str(err)[:400]}
            print(f"{obj}: failed: {row['error']}", flush=True)
        with (out / "trellis.jsonl").open("a") as f:
            f.write(json.dumps(row) + "\n")


if __name__ == "__main__":
    main()
