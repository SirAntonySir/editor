import pytest
from app.state.document import SessionDocument
from app.schemas.widget import StateEvent


def _make_doc(session_id: str = "s_test") -> SessionDocument:
    doc = SessionDocument(
        session_id=session_id,
        image_bytes=b"\x89PNG\r\n\x1a\n",
        mime_type="image/png",
    )
    return doc


def test_emit_phase_started_publishes_event():
    doc = _make_doc()
    ev = doc._emit_phase_started("mechanical", index=1, total=5)
    assert isinstance(ev, StateEvent)
    assert ev.kind == "phase.started"
    assert ev.payload == {"phase": "mechanical", "index": 1, "total": 5}


def test_emit_phase_progress_publishes_event():
    doc = _make_doc()
    ev = doc._emit_phase_progress("mask_precompute", done=3, total=8)
    assert ev.kind == "phase.progress"
    assert ev.payload == {"phase": "mask_precompute", "done": 3, "total": 8}


def test_emit_phase_completed_publishes_event():
    doc = _make_doc()
    ev = doc._emit_phase_completed("ai_context", duration_ms=4200)
    assert ev.kind == "phase.completed"
    assert ev.payload == {"phase": "ai_context", "duration_ms": 4200}


def test_state_event_kind_includes_phase_kinds():
    StateEvent(revision=1, kind="phase.started", payload={"phase": "x", "index": 0, "total": 1})
    StateEvent(revision=1, kind="phase.progress", payload={"phase": "x", "done": 0, "total": 1})
    StateEvent(revision=1, kind="phase.completed", payload={"phase": "x", "duration_ms": 0})
