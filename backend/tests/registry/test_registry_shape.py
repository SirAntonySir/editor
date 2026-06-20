"""Sanity assertions about the SSoT registry's shape.

Migrated from tests/engine/test_registry.py, which tested the
now-removed engine/registry.py view layer. The assertions here walk
get_registry() directly and use the new accessor helpers."""

from app.registry.loader import (
    effective_tool_defaults,
    get_registry,
)


def test_registry_loads_all_ops():
    """get_registry().ops should contain exactly the ops defined in shared/registry/ops/."""
    reg = get_registry()
    assert set(reg.ops) == {
        "light", "color", "kelvin", "levels", "hsl", "sharpen", "blur", "clarity",
        "curves", "grain", "vignette", "splitTone", "time-of-day",
        "weather", "mood", "season", "age",
    }


def test_exposure_range_matches_registry():
    p = get_registry().ops["light"].params["exposure"]
    assert p.range == (-100, 100) and p.default == 0


def test_canonical_keys_no_legacy_aliases():
    reg = get_registry()
    kelvin_keys = set(reg.ops["kelvin"].params)
    levels_keys = set(reg.ops["levels"].params)
    assert "kelvin" in kelvin_keys and "temp" not in kelvin_keys
    assert "inBlack" in levels_keys and "black" not in levels_keys


def test_tool_defaults_curated_for_light():
    """light tool_defaults is the curated 4-param subset, not all 7 params."""
    light = get_registry().ops["light"]
    assert effective_tool_defaults(light) == ["exposure", "contrast", "highlights", "shadows"]


def test_tool_defaults_falls_back_to_bindings():
    """Ops without explicit tool_defaults fall back to all binding keys."""
    sharpen = get_registry().ops["sharpen"]
    assert effective_tool_defaults(sharpen) == ["amount"]


def test_step_present_for_kelvin():
    """kelvin param carries step=50 from the registry op JSON."""
    p = get_registry().ops["kelvin"].params["kelvin"]
    assert p.step == 50


def test_step_present_for_gamma():
    """gamma param carries step=0.01 from the registry op JSON."""
    p = get_registry().ops["levels"].params["gamma"]
    assert p.step == 0.01
