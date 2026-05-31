from app.tools.tool_defaults import TOOL_DEFAULTS


def _binding(tool: str, key: str) -> dict:
    return next(b for b in TOOL_DEFAULTS[tool]["bindings"] if b["param_key"] == key)


def test_light_exposure_uses_canonical_range():
    b = _binding("light", "exposure")
    assert b["control_schema"]["min"] == -100
    assert b["control_schema"]["max"] == 100
    # node param key matches the binding key
    assert "exposure" in TOOL_DEFAULTS["light"]["nodes"][0]["params"]
    # node.type is the shader binding
    assert TOOL_DEFAULTS["light"]["nodes"][0]["type"] == "basic"


def test_kelvin_uses_canonical_key_not_temp():
    keys = {b["param_key"] for b in TOOL_DEFAULTS["kelvin"]["bindings"]}
    assert "kelvin" in keys and "temp" not in keys
    assert "kelvin" in TOOL_DEFAULTS["kelvin"]["nodes"][0]["params"]


def test_kelvin_binding_keeps_unit_hint():
    b = _binding("kelvin", "kelvin")
    assert b["control_schema"]["unit"] == "K"


def test_levels_uses_inblack_not_black():
    keys = {b["param_key"] for b in TOOL_DEFAULTS["levels"]["bindings"]}
    assert "inBlack" in keys and "black" not in keys
