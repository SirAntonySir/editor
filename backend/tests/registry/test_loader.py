from app.registry.loader import load_registry


def test_loader_finds_all_ops():
    reg = load_registry()
    expected = {"light", "color", "kelvin", "levels", "hsl", "sharpen",
                "blur", "clarity", "grain", "vignette", "splitTone", "curves"}
    assert set(reg.ops.keys()) == expected


def test_loader_op_is_typed():
    reg = load_registry()
    light = reg.ops["light"]
    assert light.display_name == "Light"
    assert light.params["exposure"].range == (-100, 100)
    assert light.engine.shader == "basic"


def test_loader_finds_no_presets_yet():
    # Presets directory exists but is empty before Task 6 runs.
    reg = load_registry()
    assert reg.presets == {}


def test_loader_rejects_duplicate_op_id(tmp_path, monkeypatch):
    # Drop two op files with same id into an isolated registry dir.
    ops_dir = tmp_path / "ops"
    ops_dir.mkdir()
    minimal = '''{
        "id": "dup", "display_name": "Dup",
        "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
        "params": {"a": {"type": "scalar", "range": [0, 1], "default": 0}},
        "bindings": [{"param_key": "a", "control_type": "slider", "label": "A"}],
        "engine": {"shader": "x", "render_order": 0, "node_type": "x"}
    }'''
    (ops_dir / "a.json").write_text(minimal)
    (ops_dir / "b.json").write_text(minimal)
    (tmp_path / "presets").mkdir()

    import pytest
    with pytest.raises(ValueError, match="duplicate op id"):
        load_registry(root=tmp_path)
