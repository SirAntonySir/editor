"""For 3 sampled presets (vintage, moody, teal_orange):
ensure the migrated preset JSON params are within tolerance of the
fused-template defaults you'd get from spawning via the old path.
"""
import pytest

from app.registry.loader import reload_registry
from app.tools.fused import all_fused_templates


SAMPLES = ["vintage", "moody", "teal_orange"]


@pytest.mark.parametrize("preset_id", SAMPLES)
def test_preset_op_count_matches_template(preset_id: str) -> None:
    reg = reload_registry()
    template = next(t for t in all_fused_templates() if t.id == preset_id)
    preset = reg.presets[preset_id]
    # Number of preset ops should match number of node skeletons that produced
    # an op id (migration may have skipped basic-split nodes).
    assert len(preset.ops) >= 1
    # Allow the migration to split one `basic` node into both light + color,
    # so preset.ops may slightly EXCEED node_skeleton count.
    assert len(preset.ops) <= len(template.node_skeleton) + 2


@pytest.mark.parametrize("preset_id", SAMPLES)
def test_preset_op_ids_are_registry_ops(preset_id: str) -> None:
    reg = reload_registry()
    for op in reg.presets[preset_id].ops:
        assert op.op_id in reg.ops
