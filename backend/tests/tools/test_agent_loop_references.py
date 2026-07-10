"""Reference images are matched, never edited: _build_system must name them as
references (not targets) and inline their appearance summaries."""

from __future__ import annotations

from app.tools.agent_loop import _build_system


def test_reference_section_names_refs_and_forbids_editing():
    system = _build_system(
        attached_objects=[],
        node_ids=["in-1"],  # only the target is a valid target id
        forced_targets=None,
        references=[{
            "image_node_id": "in-2",
            "summary": "warm (b*=+18), median_luma 150, palette amber/cream",
        }],
    )
    assert "in-2" in system
    # It must be described as a reference and explicitly not editable.
    low = system.lower()
    assert "reference" in low
    assert "not" in low and "edit" in low
    # The appearance summary is inlined so "look like" can be matched.
    assert "median_luma 150" in system


def test_no_reference_section_when_none():
    system = _build_system(attached_objects=[], node_ids=["in-1"], forced_targets=None, references=None)
    assert "reference" not in system.lower()


def test_reference_id_is_not_offered_as_a_target():
    # node_ids is the target whitelist; a reference id must never appear there.
    system = _build_system(
        attached_objects=[], node_ids=["in-1"], forced_targets=None,
        references=[{"image_node_id": "in-2", "summary": "x"}],
    )
    # The "set target_image_node_id to an existing node id (…)" list names in-1
    # only; in-2 appears solely in the reference section.
    target_clause = system.split("reference", 1)[0].lower()
    assert "in-2" not in target_clause
