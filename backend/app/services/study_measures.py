"""Study measures aggregation over the per-session event journal.

Pure, side-effect-free. Segments the event stream into study parts (bracketed by
``study.block`` markers) and computes the main-study behavioural measures per
part — headline: the share of edits made through the MANUAL surface.

Surface rule (locked, see the design spec): classify each edit by the SURFACE
the action goes through, not the artefact's provenance. An inspector-slider edit
is a manual-surface edit even when the edited widget was AI-proposed.
"""

from __future__ import annotations

from typing import Any

# Widget origins that mean the spawn came through the manual surface
# (toolrail / palette-as-launcher) vs the AI surface.
_MANUAL_ORIGINS = {"tool_invoked", "user_palette"}
_AI_ORIGINS = {"mcp_user_prompt", "mcp_autonomous", "fused_expansion", "repeat", "refine"}


def _widget_origin(ev: dict) -> str | None:
    origin = ((ev.get("payload") or {}).get("widget") or {}).get("origin") or {}
    return origin.get("kind")


def _edit_surface(ev: dict) -> str | None:
    """Return 'manual' | 'ai' when this event is a result-changing edit, else None."""
    kind = ev.get("kind")
    if kind == "widget.created":
        origin = _widget_origin(ev)
        if origin in _MANUAL_ORIGINS:
            return "manual"
        if origin in _AI_ORIGINS:
            return "ai"
        return "ai"  # unknown-origin spawns are AI-surface by default
    if kind == "canonical.updated":
        return "manual"  # inspector slider — the manual surface
    if kind == "image_node_transform.updated":
        return "manual"  # crop / rotate
    if kind == "mask.created":
        return "manual"  # manual segmentation
    if kind == "widget.updated":
        return "ai"  # refine / repeat
    if kind == "widget.accepted":
        return "ai"  # engaging an AI proposal
    return None


def _blank_part(marker: dict) -> dict[str, Any]:
    p = marker.get("payload") or {}
    return {
        "block": p.get("block"),
        "part": p.get("part"),
        "condition": p.get("condition"),
        "start_ts": marker.get("ts"),
        "end_ts": marker.get("ts"),
        "manual_edits": 0,
        "ai_edits": 0,
        "refines": 0,
        "reverts": 0,
        "renames": 0,
        "visibility_toggles": 0,
        "_active_widgets": 0,
        "coexistent_widgets_max": 0,
        "interactions": {},  # element -> {count, first_ts, last_ts}
    }


def _tally(part: dict[str, Any], ev: dict) -> None:
    kind = ev.get("kind")
    ts = ev.get("ts")
    part["end_ts"] = ts

    surface = _edit_surface(ev)
    if surface == "manual":
        part["manual_edits"] += 1
    elif surface == "ai":
        part["ai_edits"] += 1

    if kind == "widget.updated":
        part["refines"] += 1
    elif kind == "history.applied":
        part["reverts"] += 1
    elif kind == "mask.renamed":
        part["renames"] += 1
    elif kind == "widget.created":
        part["_active_widgets"] += 1
        part["coexistent_widgets_max"] = max(part["coexistent_widgets_max"], part["_active_widgets"])
    elif kind in ("widget.deleted", "widget.accepted"):
        part["_active_widgets"] = max(0, part["_active_widgets"] - 1)

    if kind == "telemetry.interaction":
        payload = ev.get("payload") or {}
        element = payload.get("element") or "unknown"
        if element == "eye-toggle":
            part["visibility_toggles"] += 1
        if element == "rename":
            part["renames"] += 1
        slot = part["interactions"].setdefault(element, {"count": 0, "first_ts": ts, "last_ts": ts})
        slot["count"] += 1
        slot["last_ts"] = ts


def _finalize(part: dict[str, Any]) -> dict[str, Any]:
    part.pop("_active_widgets", None)
    start = part.get("start_ts") or 0
    end = part.get("end_ts") or start
    part["duration_s"] = round(end - start, 3)
    edits = part["manual_edits"] + part["ai_edits"]
    part["ops"] = edits
    part["manual_edit_share"] = round(part["manual_edits"] / edits, 4) if edits else None
    return part


def compute_study_measures(events: list[dict]) -> dict[str, Any]:
    """Segment ``events`` by ``study.block`` start markers and compute per-part
    measures. Events before the first marker land in ``unsegmented``.

    A ``study.block`` start marker opens a part; it closes at the next start
    marker (or the end of the stream). ``end`` markers are treated as boundaries
    too but carry no new part.
    """
    ordered = sorted(events, key=lambda e: e.get("ts") or 0)

    parts: list[dict[str, Any]] = []
    unsegmented = {
        "part": None, "block": None, "condition": None,
        "manual_edits": 0, "ai_edits": 0, "refines": 0, "reverts": 0,
        "renames": 0, "visibility_toggles": 0, "coexistent_widgets_max": 0,
        "_active_widgets": 0, "start_ts": None, "end_ts": None, "interactions": {},
    }
    current: dict[str, Any] | None = None

    for ev in ordered:
        if ev.get("kind") == "study.block":
            # A part runs until the NEXT marker, so its duration spans the whole
            # bracket even if the last logged event landed earlier.
            if current is not None:
                current["end_ts"] = ev.get("ts")
            action = (ev.get("payload") or {}).get("action")
            current = _blank_part(ev) if action == "start" else None
            if current is not None:
                parts.append(current)
            continue
        target = current if current is not None else unsegmented
        if target is unsegmented and target["start_ts"] is None:
            target["start_ts"] = ev.get("ts")
        _tally(target, ev)

    return {
        "parts": [_finalize(p) for p in parts],
        "unsegmented": _finalize(unsegmented),
    }
