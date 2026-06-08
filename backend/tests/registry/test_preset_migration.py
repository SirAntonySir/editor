from app.registry.loader import load_registry, reload_registry


def test_all_migrated_presets_load():
    reg = reload_registry()
    assert len(reg.presets) >= 30, f"expected ≥30 presets, got {len(reg.presets)}"
    for pid, preset in reg.presets.items():
        assert preset.ops, f"preset {pid} has no ops"
        for pop in preset.ops:
            assert pop.op_id in reg.ops, f"{pid} → unknown op {pop.op_id}"


def test_vintage_preset_present():
    reg = reload_registry()
    assert "vintage" in reg.presets
    assert reg.presets["vintage"].ops


def test_moody_preset_ops():
    reg = reload_registry()
    assert "moody" in reg.presets
    preset = reg.presets["moody"]
    op_ids = {op.op_id for op in preset.ops}
    assert "light" in op_ids
    assert "color" in op_ids


def test_preset_ops_reference_known_op_ids():
    """All preset op_ids reference a loaded registry op (loader validates this,
    but explicit assertion here makes failures readable)."""
    reg = reload_registry()
    for pid, preset in reg.presets.items():
        for pop in preset.ops:
            assert pop.op_id in reg.ops, (
                f"preset '{pid}' references op '{pop.op_id}' which is not in registry"
            )


def test_warm_grade_has_kelvin_op():
    reg = reload_registry()
    assert "warm_grade" in reg.presets
    preset = reg.presets["warm_grade"]
    op_ids = {op.op_id for op in preset.ops}
    assert "kelvin" in op_ids


def test_time_of_day_unfolded():
    reg = reload_registry()
    assert "time-of-day" in reg.presets
    preset = reg.presets["time-of-day"]
    op_ids = {op.op_id for op in preset.ops}
    # compound node should be unfolded into constituent ops
    assert "light" in op_ids
    assert "kelvin" in op_ids
