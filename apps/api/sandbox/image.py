"""The coder image: Node 22, the gate, three.js r185, kit.js, the skills and the model library. No secrets are copied in.

`apps/gate` (the gate and the code it runs: validate, dry run, kit.js) is copied to `/opt/gate` with its own
packages installed there. Skills are baked at `/skills`, the model library at `/data/library`.
"""

from __future__ import annotations

from pathlib import Path

import modal

from app.config import REPO_ROOT

GATE_ROOT = "/opt/gate"
SKILLS_ROOT = "/skills"
WORK_ROOT = "/work"
LIBRARY_ROOT = "/data/library"
GATE_ENTRY = "/opt/gate/gate.ts"

# evals/: a skill's test cases (skill-creator); the agent under test must not read them.
_SKIP = {".env", "node_modules", "runs", ".venv", ".cache", "__pycache__", "evals"}


def _ignore(path: Path) -> bool:
    # Modal asks about every file, not only folders, so a file inside a skipped folder (.cache/sandbox-child.mjs,
    # which the dry run rewrites) must be caught by its folder too; otherwise the build fails when it changes mid-copy.
    return any(part in _SKIP for part in Path(path).parts) or Path(path).name.startswith(".env")


def image_layout() -> list[tuple[Path, str]]:
    """Host path and the absolute path it is copied to inside the image."""
    return [
        (REPO_ROOT / "apps" / "gate", GATE_ROOT),
        (REPO_ROOT / "apps" / "api" / "skills", SKILLS_ROOT),
        # The model library (82 MB): the dry run checks a module's assets.get(id) against its catalog, which
        # lists a model only when its GLB is there. /opt/gate/src/library.ts finds it at /data/library.
        (REPO_ROOT / "data" / "library", LIBRARY_ROOT),
    ]


def coder_image() -> modal.Image:
    image = (
        modal.Image.from_registry("node:22-bookworm-slim")
        # python3: the Deep Agents sandbox backend runs its file tools (write_file, edit_file, glob) through python3;
        # without it write_file fails and a coder that writes its module with it leaves no module at all.
        .apt_install("ca-certificates", "python3")
        .run_commands("npm install -g tsx@4")
    )
    for source, dest in image_layout():
        if source.is_dir():
            image = image.add_local_dir(str(source), dest, ignore=_ignore, copy=True)
        else:
            image = image.add_local_file(str(source), dest, copy=True)
    return image.run_commands(
        f"cd {GATE_ROOT} && npm ci --no-audit --no-fund && mkdir -p {WORK_ROOT} {GATE_ROOT}/.cache"
    )
