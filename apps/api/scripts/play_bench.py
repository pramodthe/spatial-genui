"""Run a set of learning-game requests through the app's whole game pipeline (design, plan pictures, coder, check,
play-test, grader) and score every game the same way, so a change to the app can be measured on many games at once.

Each game is scored on:
- runs: the module passes the app's gate and dry run (comparable to "ran without errors" in other XR code benchmarks);
- check: the learning-game check prints "game ok" (gate, hands, look and play rules, layout must-fixes);
- layout: the layout must-fixes measured on the built scene (apps/gate/src/layout.ts);
- cost: the coder's model calls, its spend by the cost meter, the time;
- judge: the app's model looks at the game as it opens (the run's final-view.png) and the game's code and rates, 1 to 5, whether it
  teaches the idea by playing, is clear to a first-time player in five seconds, looks good, and is played by hand.

Results go to data/bench-play/<name>/ (results.jsonl, one game a line; modules/; summary.md). A run that stops can be
started again with the same --name: games already scored are kept.

Usage (from apps/api): .venv/bin/python scripts/play_bench.py ../../bench/prompts/play-40.json [--ids a,b]
    [--name NAME] [--concurrency 8] [--no-judge]
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import REPO_ROOT  # noqa: E402

API = REPO_ROOT / "apps" / "api"
GATE = REPO_ROOT / "apps" / "gate"
CHECK = API / "skills" / "play" / "learning-game" / "scripts" / "check.mjs"
STUDIO = Path(os.environ.get("STUDIO_DIR") or REPO_ROOT / "data" / "studio")

JUDGE_PROMPT = """You judge a mixed-reality learning game for players aged about 9 to adult, from its request, the idea it should teach, the picture a first-time player sees (a play-test screenshot in the headset app), and its code. Rate each from 1 (poor) to 5 (excellent):
- teaches: playing it well needs the idea; the moves and the challenge depend on it, and the game says why.
- clear: from the picture alone, a first-time player knows within five seconds what the game is and what to touch first.
- looks: one cohesive look, things at sensible sizes, not cluttered, nothing huge in the player's face, text readable.
- hands: the main action is done with the hands on the 3D things, not only by pressing panel buttons.
Reply with only JSON: {"teaches": n, "clear": n, "looks": n, "hands": n, "note": "one short sentence on the biggest problem, or what is best"}"""


def check_module(code: str) -> dict[str, Any]:
    """The learning-game check on a copy of the module: gate and dry run, then the play and layout rules."""
    with tempfile.TemporaryDirectory() as tmp:
        module = Path(tmp) / "module.js"
        module.write_text(code)
        env = {**os.environ, "GATE_TSX": str(GATE / "node_modules" / ".bin" / "tsx"), "GATE_ENTRY": str(GATE / "gate.ts")}
        run = subprocess.run(["node", str(CHECK), str(module)], capture_output=True, text=True, env=env, timeout=300)
    out = run.stdout + run.stderr
    lines = out.splitlines()
    return {
        "runs": any(line.startswith("gate ok") for line in lines),
        "check": "game ok" in lines,
        "fixes": [line[5:] for line in lines if line.startswith("FIX: ")],
        "layout_fixes": sum(line.startswith("FIX: Layout:") for line in lines),
        "gate_error": next((line for line in lines if "not ok" in line), None),
    }


def last_screenshot(run_id: str) -> Path | None:
    """The game as it opens (final-view.png, taken by the coder at the end of the run), else its last play-test shot."""
    final = STUDIO / run_id / "files" / "final-view.png"
    if final.exists():
        return final
    shots = sorted((STUDIO / run_id / "files" / "playtest").glob("view-*.png"), key=lambda p: int(p.stem.split("-")[1]))
    return shots[-1] if shots else None


async def judge(task: dict[str, Any], code: str, shot: Path | None) -> dict[str, Any]:
    from langchain_core.messages import HumanMessage, SystemMessage

    from app.agents.coder import agent_model

    at = code.find("export default function")
    game = code[at:] if at >= 0 else code
    content: list[dict[str, Any]] = [{"type": "text", "text": (
        f"Request: {task['prompt']}\nThe idea it should teach: {task['idea']}\n\nThe game's own code (from export default, "
        f"first 12000 characters):\n{game[:12000]}\n\nThe play-test screenshot:" if shot else
        f"Request: {task['prompt']}\nThe idea it should teach: {task['idea']}\n\nThe game's own code:\n{game[:12000]}\n\nNo play-test screenshot was taken: rate clear and looks from the code, at most 3.")}]
    if shot:
        content.append({"type": "image", "base64": base64.b64encode(shot.read_bytes()).decode(), "mime_type": "image/png"})
    reply = await agent_model().ainvoke([SystemMessage(JUDGE_PROMPT), HumanMessage(content=content)])
    text = reply.content if isinstance(reply.content, str) else " ".join(b.get("text", "") for b in reply.content if isinstance(b, dict))
    try:
        scores = json.loads(text[text.index("{"): text.rindex("}") + 1])
    except ValueError:
        return {"error": text[:300]}
    return {k: scores.get(k) for k in ("teaches", "clear", "looks", "hands", "note")}


async def coder_state(saver: Any, run_id: str) -> dict[str, Any]:
    found = await saver.aget_tuple({"configurable": {"thread_id": f"coder-{run_id}"}})
    values = found.checkpoint["channel_values"] if found else {}
    return {"calls": values.get("thread_model_call_count"), "cost_usd": round(float(values.get("cost_usd") or 0), 3),
            "grader_rounds": values.get("_rubric_iterations"), "grader_status": values.get("_rubric_status")}


async def run_one(task: dict[str, Any], args: argparse.Namespace, saver: Any, out: Path, gate: asyncio.Semaphore) -> dict[str, Any]:
    from app.graphs import game as game_graph

    async with gate:
        started = time.time()
        print(f"[{task['id']}] start", flush=True)
        try:
            result = await game_graph.run_game(task["prompt"], thread_id=f"bench-{args.name}-{task['id']}")
        except Exception as exc:  # one game's failure is a result, not the end of the run
            result = {"ok": False, "error": f"{type(exc).__name__}: {exc}"[:500]}
        seconds = round(time.time() - started, 1)
    run_id = result.get("id")
    code = result.get("code") or ""
    if code:
        (out / "modules" / f"{task['id']}.js").write_text(code)
    design = {}
    if run_id and (STUDIO / run_id / "files" / "design.json").exists():
        design = json.loads((STUDIO / run_id / "files" / "design.json").read_text())
    row: dict[str, Any] = {
        "id": task["id"], "domain": task["domain"], "mode_asked": task["mode"], "mode": design.get("mode"),
        "title": design.get("title"), "ok": bool(result.get("ok")), "error": (result.get("error") or "")[:300] or None,
        "seconds": seconds, "tokens": sum((a.get("promptTokens") or 0) + (a.get("completionTokens") or 0) for a in result.get("attempts") or []),
        "studio": run_id,
        **(await coder_state(saver, run_id) if run_id else {}),
        **(check_module(code) if code else {"runs": False, "check": False, "fixes": [], "layout_fixes": None}),
    }
    shot = last_screenshot(run_id) if run_id else None
    row["screenshot"] = str(shot) if shot else None
    if code and not args.no_judge:
        try:
            row["judge"] = await judge(task, code, shot)
        except Exception as exc:
            row["judge"] = {"error": f"{type(exc).__name__}: {exc}"[:200]}
    with open(out / "results.jsonl", "a") as f:
        f.write(json.dumps(row) + "\n")
    print(f"[{task['id']}] done ok={row['ok']} runs={row['runs']} check={row['check']} {seconds}s ${row.get('cost_usd')}", flush=True)
    return row


def summarize(rows: list[dict[str, Any]], out: Path, name: str) -> None:
    def rate(key: str) -> str:
        return f"{sum(bool(r.get(key)) for r in rows)}/{len(rows)}"

    def median(key: str) -> str:
        values = [r[key] for r in rows if isinstance(r.get(key), (int, float))]
        return f"{statistics.median(values):.1f}" if values else "-"

    def mean_judge(key: str) -> str:
        values = [r["judge"][key] for r in rows if isinstance((r.get("judge") or {}).get(key), (int, float))]
        return f"{statistics.mean(values):.2f}" if values else "-"

    lines = [
        f"# Learning-game benchmark: {name}", "",
        f"{len(rows)} games. Runs (gate and dry run pass): {rate('runs')}. Game check passes: {rate('check')}. "
        f"Pipeline ok: {rate('ok')}. Games with no layout must-fix: {sum(r.get('layout_fixes') == 0 for r in rows)}/{len(rows)}.", "",
        f"Median: {median('seconds')} s, {median('calls')} model calls, ${median('cost_usd')} (cost meter). "
        f"Judge means (1-5): teaches {mean_judge('teaches')}, clear {mean_judge('clear')}, looks {mean_judge('looks')}, hands {mean_judge('hands')}.", "",
        "| game | mode | runs | check | layout fix | calls | $ | s | teaches | clear | looks | hands | note |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in sorted(rows, key=lambda r: r["id"]):
        j = r.get("judge") or {}
        lines.append(f"| {r['id']} | {r.get('mode') or '-'} | {'yes' if r.get('runs') else 'NO'} | {'yes' if r.get('check') else 'no'} | "
                     f"{r.get('layout_fixes', '-')} | {r.get('calls', '-')} | {r.get('cost_usd', '-')} | {r.get('seconds', '-')} | "
                     f"{j.get('teaches', '-')} | {j.get('clear', '-')} | {j.get('looks', '-')} | {j.get('hands', '-')} | {(j.get('note') or r.get('error') or '')[:90]} |")
    (out / "summary.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines[:5]))


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("tasks", type=Path)
    parser.add_argument("--ids", default="")
    parser.add_argument("--name", default=time.strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--no-judge", action="store_true")
    args = parser.parse_args()
    tasks = json.loads(args.tasks.read_text())
    if args.ids:
        wanted = set(args.ids.split(","))
        tasks = [t for t in tasks if t["id"] in wanted]
    out = REPO_ROOT / "data" / "bench-play" / args.name
    (out / "modules").mkdir(parents=True, exist_ok=True)
    done = {}
    if (out / "results.jsonl").exists():
        done = {row["id"]: row for row in map(json.loads, (out / "results.jsonl").read_text().splitlines()) if row.get("id")}
    todo = [t for t in tasks if t["id"] not in done]
    print(f"{len(tasks)} games, {len(done)} already scored, {len(todo)} to run; results in {out}", flush=True)

    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

    from app.agents import coder
    from app.graphs import lesson as lesson_graph

    async with AsyncSqliteSaver.from_conn_string(str(out / "history.sqlite")) as saver:
        coder.set_checkpointer(saver)
        lesson_graph.set_checkpointer(saver)
        gate = asyncio.Semaphore(max(1, args.concurrency))
        rows = await asyncio.gather(*(run_one(t, args, saver, out, gate) for t in todo))
    summarize([*done.values(), *rows], out, args.name)


if __name__ == "__main__":
    asyncio.run(main())
