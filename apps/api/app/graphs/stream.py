"""NDJSON from a graph stream. Chunks are the v2 dict shape (`version="v2"`)."""

from __future__ import annotations

import json
from typing import Any

from app.graphs.lesson import compiled


async def lesson_events(graph_input: dict[str, Any] | None, config: dict[str, Any]):
    graph = compiled()
    async for chunk in graph.astream(graph_input, config, stream_mode=["updates", "custom"], version="v2"):
        yield json.dumps(chunk, ensure_ascii=False) + "\n"
