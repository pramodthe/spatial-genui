"""Write learning games with an outside coding agent, Claude Code in headless mode (`claude -p`), instead of the app's
own coder, and score them like scripts/play_bench.py: the ceiling a strong model reaches with our skills and checks.
For your own testing on your machine only (it uses the Claude Code login on this computer), never inside the app.

The agent gets the same instructions as the app's coder (app/agents/coder.py), with the sandbox paths mapped to local
folders: a copy of the skills (so it cannot change the real ones) and one work folder per game. It may use file tools
and `node` only. There is no headset runtime here, so it checks with the learning-game check and does not play-test.

Usage (from apps/api): .venv/bin/python scripts/claude_code_bench.py ../../bench/prompts/play-40.json --ids a,b
    [--name NAME] [--model claude-sonnet-5-5] [--concurrency 2] [--max-turns 80]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.config import REPO_ROOT  # noqa: E402
from play_bench import GATE, check_module, summarize  # noqa: E402

SKILLS = REPO_ROOT / "apps" / "api" / "skills"


def instructions(task: dict[str, Any], skills: Path, work: Path) -> str:
    # The app's coder instructions as the sandbox coder gets them (no media tools: none are offered here).
    os.environ["MEDIA_BASE_URL"] = ""
    from app.agents import coder

    return "\n\n".join([
        f"Paths on this computer: wherever the skills or these instructions say /skills, use {skills}; wherever they say "
        f"/work, use {work} (your working folder). Work only inside {work}. Read the skills you need under {skills} "
        "(start with play/learning-game/SKILL.md). Run scripts with node and these paths, for example "
        f"`node {skills}/play/learning-game/scripts/new-game.mjs <look> {work}/module.js`. There is no headset runtime "
        "here and no task() helpers: check with the learning-game check and skip the play-test. The network is off "
        "limits. Finish when the check prints game ok and a first-time player would know what to do.",
        coder._prompt("game"),
        f"The request: {task['prompt']}",
    ])


async def run_one(task: dict[str, Any], args: argparse.Namespace, out: Path, skills: Path, gate: asyncio.Semaphore) -> dict[str, Any]:
    work = out / "work" / task["id"]
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    env = {**os.environ, "GATE_TSX": str(GATE / "node_modules" / ".bin" / "tsx"), "GATE_ENTRY": str(GATE / "gate.ts")}
    command = ["claude", "-p", "--model", args.model, "--output-format", "json", "--max-turns", str(args.max_turns),
               "--permission-mode", "acceptEdits", "--add-dir", str(skills),
               "--allowedTools", "Read", "Write", "Edit", "Glob", "Grep", "Bash(node:*)", "Bash(ls:*)", "Bash(cat:*)"]
    async with gate:
        print(f"[{task['id']}] start", flush=True)
        started = time.time()
        proc = await asyncio.create_subprocess_exec(*command, cwd=work, env=env, stdin=asyncio.subprocess.PIPE,
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, stderr = await proc.communicate(instructions(task, skills, work).encode())
        seconds = round(time.time() - started, 1)
    (work / "agent-stdout.json").write_bytes(stdout)
    (work / "agent-stderr.txt").write_bytes(stderr)
    try:
        reply = json.loads(stdout.decode() or "{}")
    except ValueError:
        reply = {"is_error": True, "result": stdout.decode()[-300:]}
    # The latest game.js, built into module.js (the agent may have stopped after an edit).
    builder = skills / "play" / "learning-game" / "scripts" / "build-module.mjs"
    await (await asyncio.create_subprocess_exec("node", str(builder), str(work / "module.js"), stdout=asyncio.subprocess.DEVNULL)).wait()
    code = (work / "module.js").read_text() if (work / "module.js").exists() else ""
    if code:
        (out / "modules" / f"{task['id']}.js").write_text(code)
    row: dict[str, Any] = {
        "id": task["id"], "domain": task["domain"], "mode_asked": task["mode"],
        "mode": "world" if "const WORLD = true" in code else ("desk" if code else None),
        "ok": bool(code) and not reply.get("is_error"), "error": (reply.get("result") or "")[:300] if reply.get("is_error") else None,
        "seconds": seconds, "calls": reply.get("num_turns"), "cost_usd": round(float(reply.get("total_cost_usd") or 0), 3),
        "agent": f"claude-code {args.model}",
        **(check_module(code) if code else {"runs": False, "check": False, "fixes": [], "layout_fixes": None}),
    }
    with open(out / "results.jsonl", "a") as f:
        f.write(json.dumps(row) + "\n")
    print(f"[{task['id']}] done runs={row['runs']} check={row['check']} {seconds}s {row['calls']} turns", flush=True)
    return row


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("tasks", type=Path)
    parser.add_argument("--ids", default="")
    parser.add_argument("--name", default=time.strftime("cc-%Y%m%d-%H%M%S"))
    parser.add_argument("--model", default="claude-sonnet-5-5")
    parser.add_argument("--concurrency", type=int, default=2)
    parser.add_argument("--max-turns", type=int, default=80)
    args = parser.parse_args()
    tasks = json.loads(args.tasks.read_text())
    if args.ids:
        wanted = set(args.ids.split(","))
        tasks = [t for t in tasks if t["id"] in wanted]
    out = REPO_ROOT / "data" / "bench-play" / args.name
    (out / "modules").mkdir(parents=True, exist_ok=True)
    skills = out / "skills"
    if not skills.exists():
        shutil.copytree(SKILLS, skills, ignore=shutil.ignore_patterns("evals", "node_modules", "__pycache__"))
    done = {}
    if (out / "results.jsonl").exists():
        done = {row["id"]: row for row in map(json.loads, (out / "results.jsonl").read_text().splitlines()) if row.get("id")}
    todo = [t for t in tasks if t["id"] not in done]
    print(f"{len(tasks)} games with {args.model}, {len(done)} already scored, {len(todo)} to run; results in {out}", flush=True)
    gate = asyncio.Semaphore(max(1, args.concurrency))
    rows = await asyncio.gather(*(run_one(t, args, out, skills, gate) for t in todo))
    summarize([*done.values(), *rows], out, args.name)


if __name__ == "__main__":
    asyncio.run(main())
