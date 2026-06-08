from app.engine.registry import ENGINE_OPS, op_param


def test_registry_loads_all_ops():
    """ENGINE_OPS should contain exactly the ops defined in shared/registry/ops/."""
    assert set(ENGINE_OPS) == {
        "light", "color", "kelvin", "levels", "hsl", "sharpen", "blur", "clarity",
        "curves", "grain", "vignette", "splitTone", "time-of-day",
    }


def test_exposure_range_matches_registry():
    p = op_param("light", "exposure")
    assert p["min"] == -100 and p["max"] == 100 and p["default"] == 0


def test_canonical_keys_no_legacy_aliases():
    kelvin_keys = set(ENGINE_OPS["kelvin"]["params"])
    levels_keys = set(ENGINE_OPS["levels"]["params"])
    assert "kelvin" in kelvin_keys and "temp" not in kelvin_keys
    assert "inBlack" in levels_keys and "black" not in levels_keys


def test_tool_defaults_curated_for_light():
    """light toolDefaults is the curated 4-param subset, not all 7 params."""
    assert ENGINE_OPS["light"]["toolDefaults"] == ["exposure", "contrast", "highlights", "shadows"]


def test_tool_defaults_falls_back_to_bindings():
    """Ops without explicit tool_defaults fall back to all binding keys."""
    sharpen = ENGINE_OPS["sharpen"]
    assert sharpen["toolDefaults"] == ["amount"]


def test_step_present_for_kelvin():
    """kelvin param carries step=50 from the registry op JSON."""
    p = op_param("kelvin", "kelvin")
    assert p["step"] == 50


def test_step_present_for_gamma():
    """gamma param carries step=0.01 from the registry op JSON."""
    p = op_param("levels", "gamma")
    assert p["step"] == 0.01
