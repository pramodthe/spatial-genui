"""The classic prompts are the published ones, byte for byte.

prompt_text.json was frozen from prompt.ts, which now lives in the benchmark harness (apps/gate/src/prompt.ts).
Two checks: the frozen text against recorded fingerprints (the benchmark and the paper use SYSTEM_PROMPT, so any
change to it, or to the game, review and repair prompts, has to be deliberate), and live against the harness.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from app.prompt import EXAMPLE_MODULE, GAME_SYSTEM_PROMPT, REVIEW_MESSAGE, SYSTEM_PROMPT, repair_message

FROZEN = json.loads((Path(__file__).resolve().parents[1] / "app" / "prompt_text.json").read_text(encoding="utf-8"))

FINGERPRINTS = {
    "SYSTEM_PROMPT": "c4d6eb52a0bdbc630dcf7a603244833bf1603601b08f5a0b61891ba7fb72cbee",
    "GAME_SYSTEM_PROMPT": "6ae6bf7db23b94089253bec6f0919bafde86ea05d6178afdc062d87893d34260",
    "REVIEW_MESSAGE": "c7999289b8f5b8597d99e1a25de48e4a2c8d39c2c58d34a2d369d6c42a8001ac",
    "repairSample": "0c26c02d4869a8b548b903a1106de5aaa8f91de35d890cd43d9a722b5da89159",
}


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def test_frozen_prompts_match_the_swaps() -> None:
    assert SYSTEM_PROMPT == FROZEN["SYSTEM_PROMPT"]
    assert GAME_SYSTEM_PROMPT == FROZEN["GAME_SYSTEM_PROMPT"]
    assert REVIEW_MESSAGE == FROZEN["REVIEW_MESSAGE"]
    assert repair_message("Boom at line 1") == FROZEN["repairSample"]
    assert "export default function build" in EXAMPLE_MODULE


def test_published_prompts_are_unchanged() -> None:
    assert _sha(SYSTEM_PROMPT) == FINGERPRINTS["SYSTEM_PROMPT"]
    assert _sha(GAME_SYSTEM_PROMPT) == FINGERPRINTS["GAME_SYSTEM_PROMPT"]
    assert _sha(REVIEW_MESSAGE) == FINGERPRINTS["REVIEW_MESSAGE"]
    assert _sha(repair_message("Boom at line 1")) == FINGERPRINTS["repairSample"]


ROOT = Path(__file__).resolve().parents[3]
TSX = ROOT / "apps" / "gate" / "node_modules" / ".bin" / "tsx"


def test_live_typescript_prompts() -> None:
    """The benchmark harness (apps/gate/src/prompt.ts) and the API send the same prompts, byte for byte."""
    import subprocess

    from app.library import library_section

    if not TSX.exists():
        return
    completed = subprocess.run(
        [str(TSX), str(Path(__file__).with_name("export_prompts.mjs"))],
        cwd=ROOT / "apps" / "api" / "tests",
        check=True,
        capture_output=True,
        text=True,
    )
    live = json.loads(completed.stdout)
    assert live["SYSTEM_PROMPT"] == SYSTEM_PROMPT
    assert live["GAME_SYSTEM_PROMPT"] == GAME_SYSTEM_PROMPT
    assert live["REVIEW_MESSAGE"] == REVIEW_MESSAGE
    assert live["repair"] == repair_message("Boom at line 1")
    assert live["library"] == library_section(None)
