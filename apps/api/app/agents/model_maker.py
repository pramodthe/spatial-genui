"""Isolated model-maker subagent. It inherits nothing, so the spec sets its own tools and limits."""

from __future__ import annotations

from langchain.agents.middleware import ModelCallLimitMiddleware, TodoListMiddleware, ToolCallLimitMiddleware
from pydantic import BaseModel

from app.agents.middleware import CostMeterMiddleware
from app.llm import agent_model
from app.tools.host import library_lookup, real_size

MODEL_CALLS = 20
TOOL_CALLS = 30


class ModelMade(BaseModel):
    path: str
    function_name: str
    dry_run_ok: bool
    triangles: int


def model_maker_spec() -> dict:
    model = agent_model()
    return {
        "name": "model-maker",
        "description": "Build the lesson's main realistic 3D object as a function in /work and report the path.",
        "system_prompt": (
            "You build one realistic 3D object for a lesson. Read /skills/model/lesson-craft/SKILL.md and "
            "/skills/common/kit/SKILL.md first. Write a JavaScript function the parent can call, save it under "
            "/work, and run the dry-run skill on it. You have no network and no API keys. "
            "A later call does not remember this one: the parent must pass the path and the error again."
        ),
        "skills": ["/skills/common/", "/skills/model/"],
        "tools": [library_lookup, real_size],
        "middleware": [
            TodoListMiddleware(),
            ModelCallLimitMiddleware(run_limit=MODEL_CALLS),
            ToolCallLimitMiddleware(run_limit=TOOL_CALLS),
            CostMeterMiddleware(budget_usd=1.0, model_id=getattr(model, "model_name", None) or "muse-spark-1.3-contributor", key="model_maker_cost_usd"),
        ],
        "model": model,
        "response_format": ModelMade,
        "mode": "isolated",
    }
