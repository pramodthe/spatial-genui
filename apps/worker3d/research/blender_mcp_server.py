"""Blender MCP server (stdio): an LLM agent builds 3D models in a sandboxed, headless Blender.

Usage: python research/blender_mcp_server.py --job <dir>
Unlike the popular Blender MCP add-on, which needs a Blender window open and a click to connect, this
server starts Blender in background mode inside the sandbox (sandbox.py), so many jobs can run in
parallel on a server. One server = one job = one persistent Blender scene.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from mcp.server.mcpserver import MCPServer

from sandbox import BLENDER, HERE, sandboxed

REPLY = "@@BRIDGE@@ "
EXEC_TIMEOUT_S = 90

parser = argparse.ArgumentParser()
parser.add_argument("--job", required=True, type=Path)
args = parser.parse_args()
JOB_DIR: Path = args.job.resolve()

mcp = MCPServer("blender")


class Bridge:
    """One headless Blender process running blender_bridge.py, restarted if it hangs or dies."""

    def __init__(self) -> None:
        self.proc: asyncio.subprocess.Process | None = None
        self.lock = asyncio.Lock()

    async def start(self) -> None:
        argv, env = sandboxed(JOB_DIR, [str(BLENDER), "-b", "--factory-startup", "--python-exit-code", "1",
                                        "--python", str(HERE / "blender_bridge.py")])
        self.proc = await asyncio.create_subprocess_exec(
            *argv, env=env, cwd=JOB_DIR, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, limit=16 * 1024 * 1024,
        )
        await asyncio.wait_for(self._read_reply(), timeout=60)  # the bridge says {"ready": true}

    async def _read_reply(self) -> dict:
        assert self.proc and self.proc.stdout
        while True:
            line = await self.proc.stdout.readline()
            if not line:
                raise RuntimeError("Blender exited.")
            text = line.decode("utf-8", "replace")
            if text.startswith(REPLY):
                return json.loads(text[len(REPLY):])

    async def request(self, payload: dict, timeout: float = EXEC_TIMEOUT_S) -> dict:
        async with self.lock:
            if not self.proc or self.proc.returncode is not None:
                await self.start()
            assert self.proc and self.proc.stdin
            self.proc.stdin.write((json.dumps(payload) + "\n").encode())
            await self.proc.stdin.drain()
            try:
                return await asyncio.wait_for(self._read_reply(), timeout=timeout)
            except (asyncio.TimeoutError, RuntimeError) as err:
                self.proc.kill()
                await self.proc.wait()
                self.proc = None
                reason = f"timed out after {timeout:.0f} s" if isinstance(err, asyncio.TimeoutError) else "crashed"
                return {"ok": False, "error": f"Blender {reason}; it was restarted and the scene is now empty."}


bridge = Bridge()


@mcp.tool()
async def execute_blender_code(code: str) -> str:
    """Run Python code in Blender (bpy is imported; variables persist between calls). Units are metres,
    Z is up. Returns the printed output, any error, and a summary of every object in the scene."""
    return json.dumps(await bridge.request({"op": "exec", "code": code}))


@mcp.tool()
async def get_scene_info() -> str:
    """List every object in the scene with its name, type, parent, location, size and triangle count."""
    return json.dumps(await bridge.request({"op": "scene"}))


@mcp.tool()
async def export_glb(filename: str = "model.glb") -> str:
    """Export the scene as GLB (Y up, modifiers applied) into the job directory, and return the scene summary."""
    name = Path(filename).name
    if not name.endswith(".glb"):
        name += ".glb"
    # The file is in the job directory, which the harness reads. Sending it back inline too (base64) broke
    # the stdio connection for a 4.5 MB textured model.
    return json.dumps(await bridge.request({"op": "export", "path": str(JOB_DIR / name), "inline": False}, timeout=120))


if __name__ == "__main__":
    mcp.run()
