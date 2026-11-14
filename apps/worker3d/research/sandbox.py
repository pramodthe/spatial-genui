"""Run agent-written Python (CadQuery scripts, Blender bpy code) in a locked-down macOS sandbox.

The code comes from an LLM, so it gets: no network, no environment variables (API keys live in the
parent's environment and the repo's .env), no reads of anything under /Users except this worker's
own code and Python environment, and writes only inside its job directory. Linux/Docker hosting
replaces this with a container in Phase 6.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent  # research/: the sandboxed runner and bridge scripts
WORKER_DIR = HERE.parent  # apps/worker3d: its code and Python environment, which the sandbox may read
VENV_PYTHON = WORKER_DIR / ".venv" / "bin" / "python3"
BLENDER = Path(os.environ.get("BLENDER_BIN", "/Applications/Blender.app/Contents/MacOS/Blender"))


def _profile(job_dir: Path) -> str:
    # A rule for a specific operation (file-read-data) beats a wildcard (file-read*) whatever the order,
    # so the job directory must name file-read-data explicitly to undo the /Users deny.
    python_base = Path(sys.base_prefix).resolve()
    return f"""(version 1)
(allow default)
(deny network*)
(deny file-write* (subpath "/Users"))
(deny file-read-data (subpath "/Users"))
(allow file-read-data (subpath "{WORKER_DIR}") (subpath "{python_base}"))
(allow file-read* file-read-data file-write* (subpath "{job_dir.resolve()}"))
"""


def sandboxed(job_dir: Path, argv: list[str]) -> tuple[list[str], dict[str, str]]:
    """The command line and environment that run `argv` inside the sandbox, with `job_dir` as home."""
    job_dir.mkdir(parents=True, exist_ok=True)
    profile = job_dir / ".sandbox.sb"
    profile.write_text(_profile(job_dir))
    env = {"PATH": "/usr/bin:/bin", "HOME": str(job_dir.resolve()), "TMPDIR": str(job_dir.resolve())}
    return ["/usr/bin/sandbox-exec", "-f", str(profile), *argv], env
