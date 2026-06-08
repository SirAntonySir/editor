import json
from pathlib import Path

import pytest

import app.registry.loader as _loader_mod
from app.registry.loader import load_registry


@pytest.fixture(autouse=True)
def _bust_cache():
    """Reset the singleton cache before every test in this module."""
    _loader_mod._cached = None
    yield
    _loader_mod._cached = None


@pytest.fixture
def user_preset_dir(tmp_path: Path, monkeypatch) -> Path:
    user_dir = tmp_path / "user_presets"
    user_dir.mkdir()
    monkeypatch.setenv("EDITOR_USER_PRESETS_DIR", str(user_dir))
    return user_dir


def test_loader_picks_up_user_preset(user_preset_dir):
    (user_preset_dir / "my_look.json").write_text(json.dumps({
        "id": "my_look",
        "display_name": "My Look",
        "source": "user",
        "description": "Anton's vintage variant.",
        "typical_use": "Personal preset.",
        "semantic_tags": ["user", "mood"],
        "ops": [{"op_id": "grain", "params": {"amount": 18}}],
    }))
    reg = load_registry()
    assert "my_look" in reg.presets
    assert reg.presets["my_look"].source == "user"


def test_user_preset_shadowing_disallowed(user_preset_dir):
    (user_preset_dir / "vintage.json").write_text(json.dumps({
        "id": "vintage",  # same id as builtin
        "display_name": "Vintage (custom)",
        "source": "user",
        "description": "...", "typical_use": "...",
        "semantic_tags": [], "ops": [{"op_id": "grain", "params": {}}],
    }))
    with pytest.raises(ValueError, match="duplicate preset id 'vintage'"):
        load_registry()
