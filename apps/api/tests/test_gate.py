"""The example module passes the Node gate twice, with the same stats."""

from __future__ import annotations

import pytest

from app.pipeline import gate
from app.pipeline.prompts import EXAMPLE_MODULE


@pytest.mark.asyncio
async def test_example_module_passes_the_gate() -> None:
    first = await gate.check_module(EXAMPLE_MODULE, [])
    second = await gate.check_module(EXAMPLE_MODULE, [])
    assert first["ok"] is True
    assert second["stats"] == first["stats"]
    banned = await gate.check_module("export default function build() { return fetch('https://example.test') }", [])
    assert banned["ok"] is False
