from app.engine.registry import ENGINE_OPS, op_param


def test_registry_loads_scalar_ops():
    assert set(ENGINE_OPS) == {
        "light", "color", "kelvin", "levels", "hsl", "sharpen", "blur", "clarity",
    }


def test_exposure_range_and_scale_match_frontend():
    p = op_param("light", "exposure")
    assert p["min"] == -100 and p["max"] == 100 and p["scale"] == 100


def test_canonical_keys_no_legacy_aliases():
    kelvin_keys = set(ENGINE_OPS["kelvin"]["params"])
    levels_keys = set(ENGINE_OPS["levels"]["params"])
    assert "kelvin" in kelvin_keys and "temp" not in kelvin_keys
    assert "inBlack" in levels_keys and "black" not in levels_keys
