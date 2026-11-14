"""Spatial GenUI 3D backend on Modal: CadQuery jobs and Blender MCP sessions in Modal Sandboxes.

Deploy:  modal deploy research/modal_app.py   (needs the Modal secret "genui-worker3d" with WORKER3D_TOKEN)
Routes (all need `Authorization: Bearer $WORKER3D_TOKEN`):
  POST /cadquery  {"script": "..."}  -> {"ok", "parts", "glb_base64"} or {"ok": false, "error"}
  /mcp            Blender MCP server (streamable HTTP); each MCP session gets its own Blender sandbox
  GET  /health

Agent-written code never runs in this web container: each CadQuery script and each Blender session
runs in its own Modal Sandbox (gVisor) with networking blocked and no secrets, and is torn down
after use. The web container only relays requests and holds the API token.
"""

# No `from __future__ import annotations`: MCP reads the tool functions' annotations at runtime
# (it must see the real Context type to inject the request context).

import asyncio
import json
import os
import time
from pathlib import Path

import modal

BLENDER_VERSION = "5.2.3"
HERE = Path(__file__).parent

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install(
        "curl", "xz-utils",
        # Shared libraries Blender and VTK (CadQuery) load even when running headless.
        "libx11-6", "libxi6", "libxxf86vm1", "libxfixes3", "libxrender1", "libxkbcommon0", "libsm6",
        "libice6", "libgl1", "libegl1", "libglib2.0-0", "libgomp1",
    )
    .run_commands(
        f"curl -fsSL https://download.blender.org/release/Blender{BLENDER_VERSION.rsplit('.', 1)[0]}/"
        f"blender-{BLENDER_VERSION}-linux-x64.tar.xz | tar -xJ -C /opt",
        f"ln -s /opt/blender-{BLENDER_VERSION}-linux-x64/blender /usr/local/bin/blender",
    )
    .pip_install("cadquery==2.8.0", "mcp==2.3.0")
    # Baked into the image (copy=True): Sandboxes don't get the files Modal adds at container start.
    .add_local_file(HERE / "cadquery_runner.py", "/worker/cadquery_runner.py", copy=True)
    .add_local_file(HERE / "blender_bridge.py", "/worker/blender_bridge.py", copy=True)
)

app = modal.App("spatial-genui-3d", image=image)

REPLY = "@@BRIDGE@@ "
# Sandboxes don't inherit the app's image, so it is passed explicitly.
SANDBOX = dict(image=image, block_network=True, cpu=2.0, memory=4096)
CADQUERY_TIMEOUT_S = 150
EXEC_TIMEOUT_S = 90
SESSION_IDLE_S = 600  # a Blender session nobody has used for this long is shut down


class BlenderSandbox:
    """One headless Blender (running blender_bridge.py) in its own sandbox; one per MCP session."""

    def __init__(self) -> None:
        self.sb: modal.Sandbox | None = None
        self.buffer = ""
        self.lock = asyncio.Lock()
        self.last_used = time.monotonic()

    async def start(self) -> None:
        self.sb = await modal.Sandbox.create.aio(
            "blender", "-b", "--factory-startup", "--python-exit-code", "1", "--python", "/worker/blender_bridge.py",
            app=app, timeout=3600, idle_timeout=SESSION_IDLE_S, **SANDBOX,
        )
        self.buffer = ""
        await asyncio.wait_for(self._read_reply(), timeout=120)  # {"ready": true}

    async def _read_reply(self) -> dict:
        assert self.sb
        while True:
            while "\n" in self.buffer:
                line, self.buffer = self.buffer.split("\n", 1)
                if line.startswith(REPLY):
                    return json.loads(line[len(REPLY):])
            # __anext__ (not `async for`) keeps one stream open across requests; an abandoned
            # `async for` iterator closes the stream and could drop output.
            try:
                chunk = await self.sb.stdout.__anext__()
            except StopAsyncIteration:
                raise RuntimeError("Blender exited.") from None
            self.buffer += chunk.decode() if isinstance(chunk, bytes) else chunk

    async def request(self, payload: dict, timeout: float = EXEC_TIMEOUT_S) -> dict:
        async with self.lock:
            self.last_used = time.monotonic()
            if self.sb is None:
                await self.start()
            assert self.sb
            self.sb.stdin.write((json.dumps(payload) + "\n").encode())
            await self.sb.stdin.drain.aio()
            try:
                return await asyncio.wait_for(self._read_reply(), timeout=timeout)
            except (asyncio.TimeoutError, RuntimeError) as err:
                await self.close()
                reason = f"timed out after {timeout:.0f} s" if isinstance(err, asyncio.TimeoutError) else "crashed"
                return {"ok": False, "error": f"Blender {reason}; it was restarted and the scene is now empty."}

    async def close(self) -> None:
        if self.sb is not None:
            try:
                await self.sb.terminate.aio()
            except Exception:
                pass
            self.sb = None


@app.function(secrets=[modal.Secret.from_name("genui-worker3d")], max_containers=1, scaledown_window=900, timeout=3600)
@modal.concurrent(max_inputs=64)
@modal.asgi_app()
def api():
    # One container serves every request so MCP sessions (kept in memory) always find their Blender.
    from mcp.server.mcpserver import Context, MCPServer
    from mcp.server.transport_security import TransportSecuritySettings
    from starlette.requests import Request
    from starlette.responses import JSONResponse

    token = os.environ["WORKER3D_TOKEN"]
    mcp = MCPServer("blender")
    sessions: dict[str, BlenderSandbox] = {}

    def session_key(ctx: Context) -> str:
        # The MCP session id header is stable for a whole session (the session object is per request).
        # It's only a lookup key: every request is already authenticated by the bearer token.
        return (ctx.headers or {}).get("mcp-session-id") or f"request-{ctx.request_id}"

    def blender_for(ctx: Context) -> BlenderSandbox:
        return sessions.setdefault(session_key(ctx), BlenderSandbox())

    async def reap_idle() -> None:
        while True:
            await asyncio.sleep(60)
            for key, sandbox in list(sessions.items()):
                if time.monotonic() - sandbox.last_used > SESSION_IDLE_S:
                    sessions.pop(key, None)
                    await sandbox.close()

    @mcp.tool()
    async def execute_blender_code(code: str, ctx: Context) -> str:
        """Run Python code in Blender (bpy is imported; variables persist between calls). Units are metres,
        Z is up. Returns the printed output, any error, and a summary of every object in the scene."""
        return json.dumps(await blender_for(ctx).request({"op": "exec", "code": code}))

    @mcp.tool()
    async def get_scene_info(ctx: Context) -> str:
        """List every object in the scene with its name, type, parent, location, size and triangle count."""
        return json.dumps(await blender_for(ctx).request({"op": "scene"}))

    @mcp.tool()
    async def export_glb(ctx: Context) -> str:
        """Export the scene as GLB (Y up, modifiers applied); the file comes back base64-encoded."""
        return json.dumps(await blender_for(ctx).request({"op": "export"}, timeout=120))

    @mcp.tool()
    async def close_session(ctx: Context) -> str:
        """Shut down this session's Blender."""
        sandbox = sessions.pop(session_key(ctx), None)
        if sandbox:
            await sandbox.close()
        return json.dumps({"ok": True})

    @mcp.custom_route("/cadquery", methods=["POST"])
    async def cadquery(request: Request) -> JSONResponse:
        script = (await request.json()).get("script", "")
        sb = await modal.Sandbox.create.aio(
            "python", "/worker/cadquery_runner.py", "-", "-", app=app, timeout=CADQUERY_TIMEOUT_S, **SANDBOX,
        )
        try:
            sb.stdin.write(script.encode())
            sb.stdin.write_eof()
            await sb.stdin.drain.aio()
            out = await sb.stdout.read.aio()
            err = await sb.stderr.read.aio()
            await sb.wait.aio(raise_on_termination=False)
        finally:
            await sb.terminate.aio()
        lines = [line for line in out.splitlines() if line.startswith("{")]
        if lines:
            return JSONResponse(json.loads(lines[-1]))
        if sb.returncode is None or sb.returncode < 0:
            return JSONResponse({"ok": False, "error": f"The script ran longer than {CADQUERY_TIMEOUT_S} s (too complex, or an endless loop)."})
        tail = " ".join(err.strip().splitlines()[-3:])[:800]
        return JSONResponse({"ok": False, "error": f"The script crashed (exit {sb.returncode}): {tail}"})

    @mcp.custom_route("/health", methods=["GET"])
    async def health(request: Request) -> JSONResponse:
        return JSONResponse({"ok": True, "blenderSessions": len(sessions)})

    # Behind Modal's proxy the Host header is the *.modal.run domain; the bearer token protects the API.
    inner = mcp.streamable_http_app(
        streamable_http_path="/mcp", session_idle_timeout=SESSION_IDLE_S,
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )

    reaper: list[asyncio.Task] = []

    async def asgi(scope, receive, send):
        if scope["type"] == "lifespan":
            if not reaper:
                reaper.append(asyncio.create_task(reap_idle()))
            return await inner(scope, receive, send)
        if scope["type"] == "http":
            headers = dict(scope.get("headers") or [])
            if headers.get(b"authorization", b"").decode() != f"Bearer {token}":
                response = JSONResponse({"error": "unauthorized"}, status_code=401)
                return await response(scope, receive, send)
        return await inner(scope, receive, send)

    return asgi
