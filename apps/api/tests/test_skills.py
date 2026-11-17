"""Every baked skill must load: Deep Agents skips a SKILL.md whose front matter fails to parse, without an error."""

from pathlib import Path

import pytest
from deepagents.middleware.skills import _parse_skill_metadata
from app.core.config import SKILLS_DIR

SKILLS = SKILLS_DIR


@pytest.mark.parametrize("path", sorted(SKILLS.rglob("SKILL.md")), ids=lambda p: str(p.relative_to(SKILLS)))
def test_skill_loads(path: Path) -> None:
    # An unquoted ": " in a description made voxel's front matter invalid YAML; the agent never saw the skill.
    assert _parse_skill_metadata(path.read_text(encoding="utf-8"), f"/skills/{path.relative_to(SKILLS)}", path.parent.name)
