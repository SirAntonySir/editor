"""Study measures aggregation — turns the event journal into per-part measures.

Pure function; the admin cockpit + export call it. The headline is the share of
edits made through the MANUAL surface during an AI-on part.
"""

from __future__ import annotations

from app.services.study_measures import compute_study_measures


def _ev(ts: float, kind: str, payload: dict | None = None) -> dict:
    return {"ts": ts, "iso": "", "kind": kind, "payload": payload or {}}


def _widget(origin_kind: str) -> dict:
    return {"widget": {"origin": {"kind": origin_kind}}}


def _timeline() -> list[dict]:
    return [
        _ev(100, "study.block", {"block": 1, "part": "corrective", "condition": "ai_on", "action": "start"}),
        _ev(101, "widget.created", _widget("mcp_autonomous")),   # ai edit + coexistent +1
        _ev(102, "canonical.updated"),                           # manual edit (inspector slider)
        _ev(103, "widget.accepted"),                             # ai edit
        _ev(104, "widget.updated"),                              # ai edit (refine)
        _ev(105, "canonical.updated"),                           # manual edit
        _ev(106, "history.applied"),                             # revert
        _ev(107, "telemetry.interaction", {"element": "eye-toggle", "action": "toggle"}),
        _ev(110, "study.block", {"block": 1, "part": "creative", "condition": "ai_on", "action": "start"}),
        _ev(111, "widget.created", _widget("tool_invoked")),     # manual edit (toolrail)
        _ev(112, "mask.renamed", {"mask_id": "m1", "label": "sky"}),  # rename
        _ev(120, "study.block", {"block": 1, "part": "creative", "action": "end"}),
    ]


def _by_part(result: dict) -> dict[str, dict]:
    return {p["part"]: p for p in result["parts"]}


def test_segments_into_parts_by_markers():
    parts = _by_part(compute_study_measures(_timeline()))
    assert set(parts) == {"corrective", "creative"}
    assert parts["corrective"]["block"] == 1
    assert parts["corrective"]["condition"] == "ai_on"


def test_manual_edit_share_counts_by_surface():
    parts = _by_part(compute_study_measures(_timeline()))
    c = parts["corrective"]
    # manual: 2× canonical.updated ; ai: created(ai) + accepted + updated = 3
    assert c["manual_edits"] == 2
    assert c["ai_edits"] == 3
    assert c["manual_edit_share"] == 0.4


def test_manual_only_part_is_full_share():
    parts = _by_part(compute_study_measures(_timeline()))
    cr = parts["creative"]
    assert cr["manual_edits"] == 1  # tool_invoked spawn
    assert cr["ai_edits"] == 0
    assert cr["manual_edit_share"] == 1.0


def test_refines_reverts_toggles_renames_and_duration():
    parts = _by_part(compute_study_measures(_timeline()))
    c = parts["corrective"]
    assert c["refines"] == 1            # widget.updated
    assert c["reverts"] == 1            # history.applied
    assert c["visibility_toggles"] == 1  # eye-toggle interaction
    assert c["coexistent_widgets_max"] == 1
    assert c["duration_s"] == 10        # 110 - 100 (next marker)
    assert _by_part(compute_study_measures(_timeline()))["creative"]["renames"] == 1


def test_baseline_no_widget_layer_yields_full_manual_share():
    """Widget-layer gated off (aiAccess=false): all editing flows through the
    inspector as canonical.updated (sliders + preset set_param) with NO
    tool_invoked / mcp widget.created events. manual_edit_share must be 1.0 —
    the classifier must not assume manual edits arrive as widgets."""
    evs = [
        _ev(200, "study.block", {"block": 2, "part": "corrective", "condition": "ai_off", "action": "start"}),
        _ev(201, "canonical.updated"),  # inspector slider
        _ev(202, "canonical.updated"),  # preset applied to canonical via set_param
        _ev(203, "canonical.updated"),  # another inspector edit
        _ev(210, "study.block", {"block": 2, "part": "corrective", "action": "end"}),
    ]
    part = _by_part(compute_study_measures(evs))["corrective"]
    assert part["condition"] == "ai_off"
    assert part["manual_edits"] == 3
    assert part["ai_edits"] == 0
    assert part["manual_edit_share"] == 1.0
    assert part["coexistent_widgets_max"] == 0


def test_share_is_none_when_no_edits():
    evs = [
        _ev(1, "study.block", {"block": 1, "part": "sky", "condition": "ai_off", "action": "start"}),
        _ev(2, "telemetry.interaction", {"element": "history", "action": "open"}),
        _ev(3, "study.block", {"block": 1, "part": "sky", "action": "end"}),
    ]
    sky = _by_part(compute_study_measures(evs))["sky"]
    assert sky["manual_edits"] == 0 and sky["ai_edits"] == 0
    assert sky["manual_edit_share"] is None
