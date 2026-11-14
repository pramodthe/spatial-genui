"""Run one agent-written CadQuery script in the sandbox and print the result as one JSON line.

Usage: python research/cadquery_job.py <job_dir> <script.py> <out.glb>
This wrapper is trusted code; only cadquery_runner.py (and the script it executes) is sandboxed.
"""

import json
import subprocess
import sys
from pathlib import Path

from sandbox import HERE, VENV_PYTHON, sandboxed

TIMEOUT_S = 120


def main() -> None:
    job_dir, script, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    argv, env = sandboxed(job_dir, [str(VENV_PYTHON), str(HERE / "cadquery_runner.py"), str(script), str(out)])
    try:
        proc = subprocess.run(argv, env=env, cwd=job_dir, capture_output=True, text=True, timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired:
        print(json.dumps({"ok": False, "error": f"The script ran longer than {TIMEOUT_S} s (too complex, or an endless loop)."}))
        return
    lines = [line for line in proc.stdout.splitlines() if line.startswith("{")]
    if lines:
        print(lines[-1])
    else:
        tail = (proc.stderr or proc.stdout).strip().splitlines()[-3:]
        print(json.dumps({"ok": False, "error": f"The script crashed (exit {proc.returncode}): {' '.join(tail)[:1000]}"}))


if __name__ == "__main__":
    main()
