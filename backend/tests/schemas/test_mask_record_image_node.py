"""Tests for MaskRecord.image_node_id (multi-image-canvas Task 3).

The field is optional with default None so existing call sites and
serialised fixtures keep round-tripping unchanged. New call sites can
target a specific ImageNode by setting it.
"""

from app.schemas.widget import MaskRecord


def test_mask_record_defaults_image_node_id_to_none() -> None:
    """Backwards-compat: MaskRecord can be constructed without image_node_id."""
    m = MaskRecord(
        id="m_legacy",
        width=512,
        height=512,
        png_b64="aGVsbG8=",
        source="sam_point",
    )
    assert m.image_node_id is None


def test_mask_record_round_trips_image_node_id() -> None:
    """When set, image_node_id round-trips through model_dump/validate."""
    m = MaskRecord(
        id="m_targeted",
        width=64,
        height=64,
        png_b64="aGVsbG8=",
        source="sam_box",
        image_node_id="in-7",
    )
    assert m.image_node_id == "in-7"

    dumped = m.model_dump(mode="json", by_alias=True)
    restored = MaskRecord.model_validate(dumped)
    assert restored.image_node_id == "in-7"
