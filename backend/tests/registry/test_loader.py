from app.registry.loader import load_registry, reload_registry


def test_loader_finds_all_ops():
    reg = load_registry()
    expected = {"light", "color", "kelvin", "levels", "hsl", "sharpen",
                "blur", "clarity", "grain", "vignette", "splitTone", "curves",
                "time-of-day"}
    assert set(reg.ops.keys()) == expected


def test_loader_op_is_typed():
    reg = load_registry()
    light = reg.ops["light"]
    assert light.display_name == "Light"
    assert light.params["exposure"].range == (-100, 100)
    assert light.engine.shader == "basic"


def test_loader_finds_presets():
    # After Task 6 the presets directory is populated.
    reg = load_registry()
    assert len(reg.presets) >= 30


def test_all_ops_have_category():
    reg = load_registry()
    expected_categories = {"tone", "color", "detail", "texture", "effect"}
    for op_id, op in reg.ops.items():
        assert op.category is not None, f"op {op_id} missing category"
        assert op.category in expected_categories, (
            f"op {op_id} category {op.category!r} not in {expected_categories}"
        )


def test_time_of_day_op_loads_with_compound():
    reg = reload_registry()
    op = reg.ops.get("time-of-day")
    assert op is not None
    assert op.compound is not None
    assert op.compound.driver == "position"
    assert len(op.compound.anchors) == 5
    names = [a.name for a in op.compound.anchors]
    assert names == ["dawn", "noon", "golden", "blue", "night"]


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
