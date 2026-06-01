from app.tools.tool_defaults import TOOL_DEFAULTS

BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"]


def _keys(tool: str) -> list[str]:
    return [b["param_key"] for b in TOOL_DEFAULTS[tool]["bindings"]]


def test_all_bands_hsl_exposes_24_params_on_an_hsl_node():
    d = TOOL_DEFAULTS["hsl"]
    keys = _keys("hsl")
    assert len(keys) == 24
    assert "blue_sat" in keys
    node = d["nodes"][0]
    assert node["type"] == "hsl"  # shader binding, shared HSL pass
    assert node["params"]["blue_sat"] == 0
    b = next(b for b in d["bindings"] if b["param_key"] == "blue_sat")
    assert b["control_schema"]["min"] == -100 and b["control_schema"]["max"] == 100


def test_single_band_hsl_blue_carries_only_blue_params():
    d = TOOL_DEFAULTS["hsl_blue"]
    assert set(_keys("hsl_blue")) == {"blue_hue", "blue_sat", "blue_lum"}
    node = d["nodes"][0]
    assert node["type"] == "hsl"  # same shared pass, NOT a per-band op type
    # node carries ONLY blue params, so seeding canonical never clobbers other bands
    assert set(node["params"].keys()) == {"blue_hue", "blue_sat", "blue_lum"}


def test_every_band_has_a_single_band_tool_with_three_sliders():
    for band in BANDS:
        tool = f"hsl_{band}"
        assert tool in TOOL_DEFAULTS, f"missing {tool}"
        assert _keys(tool) == [f"{band}_hue", f"{band}_sat", f"{band}_lum"]
