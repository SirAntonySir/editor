"""delete_mask: drops the matching MaskRecord and emits mask.deleted."""

from __future__ import annotations

import pytest

from app.schemas.widget import MaskRecord
from app.tools.atomic.delete_mask import DeleteMaskTool, _Input


def _seed_mask(doc, mask_id: str = "m1") -> None:
    doc.masks[mask_id] = MaskRecord(
        id=mask_id,
        width=4,
        height=4,
        png_b64="x",
        source="sam_point",
        label="thing",
        image_node_id="in-1",
    )


@pytest.mark.asyncio
async def test_delete_mask_happy_path(make_doc) -> None:
    doc = make_doc()
    _seed_mask(doc, "m1")

    out = await DeleteMaskTool().handler(doc, _Input(mask_id="m1"))

    assert out.mask_id == "m1"
    assert "m1" not in doc.masks
    kinds = [ev.kind for ev in doc.history]
    assert "mask.deleted" in kinds
    deleted_ev = next(ev for ev in doc.history if ev.kind == "mask.deleted")
    assert deleted_ev.payload == {"mask_id": "m1"}


@pytest.mark.asyncio
async def test_delete_mask_unknown_raises(make_doc) -> None:
    doc = make_doc()
    with pytest.raises(ValueError, match="unknown mask_id"):
        await DeleteMaskTool().handler(doc, _Input(mask_id="missing"))
