"""Pins for the problem-vocabulary hybrid (spec 2026-07-02).

The augment tool schema and prompt must keep: the `other` escape hatch, the
free-text display_label/description fields, and the severity calibration
anchors — these are what turn canned problem names into image-specific card
titles and make vocabulary growth empirical instead of guesswork.
"""
from app.schemas.enriched_context import Problem
from app.services.anthropic_client import _AUGMENT_PROMPT, _SOFT_FIELDS_TOOL


def _problem_props() -> dict:
    return _SOFT_FIELDS_TOOL["input_schema"]["properties"]["problems"]["items"]["properties"]


def test_tool_schema_enum_matches_problem_kind_vocabulary():
    """The hand-rolled enum must mirror ProblemKind (the schema comment says
    'keep the two lists in sync' — this test enforces it)."""
    from typing import get_args
    from app.schemas.enriched_context import ProblemKind
    assert set(_problem_props()["kind"]["enum"]) == set(get_args(ProblemKind))


def test_tool_schema_has_escape_hatch_and_free_text_fields():
    props = _problem_props()
    assert "other" in props["kind"]["enum"]
    assert props["display_label"]["type"] == ["string", "null"]
    assert props["description"]["type"] == ["string", "null"]


def test_problem_schema_accepts_hybrid_fields():
    p = Problem(kind="other", severity=0.6,
                display_label="Tilted horizon", description="slopes right")
    assert p.display_label == "Tilted horizon"
    # Camel aliases for the frontend/journal dumps.
    dumped = p.model_dump(mode="json", by_alias=True)
    assert dumped["displayLabel"] == "Tilted horizon"


def test_augment_prompt_carries_hybrid_instructions():
    assert "display_label" in _AUGMENT_PROMPT
    # Escape-hatch rule: report, don't force a wrong kind.
    assert 'kind="other"' in _AUGMENT_PROMPT
    assert "never force a wrong kind" in _AUGMENT_PROMPT
    # Severity anchors: 0.5 is the mint gate's action threshold.
    assert "0.5 is the action threshold" in _AUGMENT_PROMPT
