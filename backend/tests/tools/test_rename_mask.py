"""rename_mask: updates MaskRecord.label and emits mask.renamed."""

from __future__ import annotations

import pytest

from app.schemas.widget import MaskRecord
from app.tools.atomic.rename_mask import RenameMaskTool, _Input


def _seed_mask(doc, mask_id: str = "m1", label: str = "old") -> None:
    doc.masks[mask_id] = MaskRecord(
        id=mask_id,
        width=4,
        height=4,
        png_b64="x",
        source="sam_point",
        label=label,
        image_node_id="in-1",
    )


@pytest.mark.asyncio
async def test_rename_mask_happy_path(make_doc) -> None:
    doc = make_doc()
    _seed_mask(doc, "m1", "old")

    out = await RenameMaskTool().handler(doc, _Input(mask_id="m1", label="new"))

    assert out.mask_id == "m1"
    assert out.label == "new"
    assert doc.masks["m1"].label == "new"
    kinds = [ev.kind for ev in doc.history]
    assert "mask.renamed" in kinds
    renamed_ev = next(ev for ev in doc.history if ev.kind == "mask.renamed")
    assert renamed_ev.payload == {"mask_id": "m1", "label": "new"}


@pytest.mark.asyncio
async def test_rename_mask_unknown_raises(make_doc) -> None:
    doc = make_doc()
    with pytest.raises(ValueError, match="unknown mask_id"):
        await RenameMaskTool().handler(doc, _Input(mask_id="missing", label="x"))
