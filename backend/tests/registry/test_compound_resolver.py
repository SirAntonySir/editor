import pytest

from app.registry.compound_resolver import resolve_compound
from app.registry.loader import reload_registry


def test_resolve_compound_returns_derived_values_at_anchor():
    reg = reload_registry()
    op = reg.ops["time-of-day"]
    class StubWidget:
        locked_params: list[str] = []
    # At position 0.30 (noon anchor), should return noon's values for non-driver keys.
    result = resolve_compound(StubWidget(), op, 0.30)
    assert result["kelvin.kelvin"] == pytest.approx(7500, abs=1)
    assert "position" not in result   # driver excluded


def test_resolve_compound_skips_locked_keys():
    reg = reload_registry()
    op = reg.ops["time-of-day"]
    class StubWidget:
        locked_params: list[str] = ["light.exposure"]
    result = resolve_compound(StubWidget(), op, 0.30)
    assert "light.exposure" not in result
    assert "kelvin.kelvin" in result


def test_resolve_compound_returns_empty_for_non_compound_op():
    reg = reload_registry()
    op = reg.ops["grain"]   # no compound block
    class StubWidget:
        locked_params: list[str] = []
    assert resolve_compound(StubWidget(), op, 0.5) == {}
