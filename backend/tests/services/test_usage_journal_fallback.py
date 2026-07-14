"""_log_cache_stats must never silently drop usage.

The active-doc contextvar is the normal reporting path (SSE + journal
mirror). When a call site loses the contextvar (worker thread without
copied context), usage must still land in the session journal so the
admin cockpit's cost sums stay complete — that's the fallback under test.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services import anthropic_client, event_journal
from app.state.active_doc import reset_active_doc, set_active_doc


def _fake_response():
    return SimpleNamespace(
        usage=SimpleNamespace(
            input_tokens=100,
            output_tokens=50,
            cache_creation_input_tokens=10,
            cache_read_input_tokens=20,
        ),
    )


def test_no_active_doc_journals_directly(monkeypatch):
    """No active doc + session_id → usage written straight to the journal."""
    written: list[tuple[str, str, dict]] = []
    monkeypatch.setattr(
        event_journal, "write_event",
        lambda sid, kind, payload: written.append((sid, kind, payload)),
    )
    anthropic_client._log_cache_stats("analyze", "sid-1", _fake_response())
    assert written == [(
        "sid-1",
        "mcp.usage",
        {
            "call": "analyze",
            "input_tokens": 100,
            "output_tokens": 50,
            "cache_create": 10,
            "cache_read": 20,
        },
    )]


def test_no_active_doc_no_session_id_writes_nothing(monkeypatch):
    """Without a session_id there is nowhere to journal — log only."""
    written: list = []
    monkeypatch.setattr(
        event_journal, "write_event",
        lambda *a: written.append(a),
    )
    anthropic_client._log_cache_stats("analyze", None, _fake_response())
    assert written == []


def test_active_doc_still_emits_through_doc(monkeypatch):
    """With an active doc the existing emit path is used — no direct
    journal write (the doc's event sink already mirrors to the journal)."""
    written: list = []
    monkeypatch.setattr(
        event_journal, "write_event",
        lambda *a: written.append(a),
    )
    doc = MagicMock()
    token = set_active_doc(doc)
    try:
        anthropic_client._log_cache_stats("analyze", "sid-1", _fake_response())
    finally:
        reset_active_doc(token)
    doc._emit_usage.assert_called_once_with(
        call="analyze",
        input_tokens=100,
        output_tokens=50,
        cache_create=10,
        cache_read=20,
    )
    assert written == []
