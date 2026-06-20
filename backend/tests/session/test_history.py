"""HistoryEngine — push/undo/redo/revert + bounded stack."""

from __future__ import annotations

import pytest

from app.session.history import HistoryEngine, Snapshot


def _snap(label: str) -> Snapshot:
    """Construct a Snapshot whose `canonical` carries a label so we can
    distinguish them in assertions."""
    return Snapshot(canonical={"_label": label})


def _eng(cap: int = 5) -> HistoryEngine:
    return HistoryEngine(max_entries=cap)


# ---------------- baseline state ----------------


def test_empty_engine_cannot_undo_or_redo():
    eng = _eng()
    assert eng.cursor == -1
    assert not eng.can_undo
    assert not eng.can_redo
    assert eng.undo() is None
    assert eng.redo() is None
    assert eng.revert_all() is None


# ---------------- push ----------------


def test_push_sets_cursor_to_last_entry():
    eng = _eng()
    a, b = _snap("a-before"), _snap("a-after")
    eng.push("set exposure", a, b)
    assert eng.cursor == 0
    assert eng.can_undo
    assert not eng.can_redo


def test_push_truncates_redo_branch():
    eng = _eng()
    eng.push("a", _snap("a0"), _snap("a1"))
    eng.push("b", _snap("b0"), _snap("b1"))
    eng.push("c", _snap("c0"), _snap("c1"))
    # Undo twice → cursor=0, can redo.
    eng.undo()
    eng.undo()
    assert eng.cursor == 0
    assert eng.can_redo

    # Push a new branch — the old b/c entries are forfeit.
    eng.push("d", _snap("d0"), _snap("d1"))
    assert eng.cursor == 1
    assert not eng.can_redo
    assert len(eng.entries) == 2


# ---------------- undo / redo ----------------


def test_undo_returns_before_and_moves_cursor():
    eng = _eng()
    eng.push("a", _snap("a-before"), _snap("a-after"))
    restored = eng.undo()
    assert restored is not None
    assert restored.canonical["_label"] == "a-before"
    assert eng.cursor == -1
    assert not eng.can_undo
    assert eng.can_redo


def test_redo_returns_after_and_moves_cursor():
    eng = _eng()
    eng.push("a", _snap("a-before"), _snap("a-after"))
    eng.undo()
    restored = eng.redo()
    assert restored is not None
    assert restored.canonical["_label"] == "a-after"
    assert eng.cursor == 0
    assert eng.can_undo
    assert not eng.can_redo


def test_undo_then_redo_walks_the_chain():
    eng = _eng()
    eng.push("a", _snap("a0"), _snap("a1"))
    eng.push("b", _snap("b0"), _snap("b1"))
    eng.push("c", _snap("c0"), _snap("c1"))
    # Each undo step returns the previous "before".
    assert eng.undo().canonical["_label"] == "c0"
    assert eng.undo().canonical["_label"] == "b0"
    assert eng.undo().canonical["_label"] == "a0"
    assert eng.undo() is None
    # Walking redo returns each "after" forward.
    assert eng.redo().canonical["_label"] == "a1"
    assert eng.redo().canonical["_label"] == "b1"
    assert eng.redo().canonical["_label"] == "c1"
    assert eng.redo() is None


# ---------------- revert ----------------


def test_revert_all_returns_initial_before_and_keeps_entries():
    eng = _eng()
    eng.push("a", _snap("a0"), _snap("a1"))
    eng.push("b", _snap("b0"), _snap("b1"))
    restored = eng.revert_all()
    assert restored is not None
    assert restored.canonical["_label"] == "a0"
    assert eng.cursor == -1
    # Entries survive — user can still redo after a revert.
    assert len(eng.entries) == 2
    assert eng.can_redo
    assert eng.redo().canonical["_label"] == "a1"


def test_revert_all_on_empty_returns_none():
    eng = _eng()
    assert eng.revert_all() is None


# ---------------- bounded stack ----------------


def test_push_over_cap_drops_oldest_and_shifts_cursor():
    eng = _eng(cap=3)
    for i in range(5):
        eng.push(f"step-{i}", _snap(f"b{i}"), _snap(f"a{i}"))
    # Cap is 3 — only the last 3 entries (steps 2, 3, 4) remain.
    assert len(eng.entries) == 3
    assert eng.cursor == 2
    # The oldest reachable undo step is step-2.
    assert eng.undo().canonical["_label"] == "b4"
    assert eng.undo().canonical["_label"] == "b3"
    assert eng.undo().canonical["_label"] == "b2"
    assert eng.undo() is None


def test_max_entries_must_be_positive():
    with pytest.raises(ValueError):
        HistoryEngine(max_entries=0)
    with pytest.raises(ValueError):
        HistoryEngine(max_entries=-1)


# ---------------- jump_to ----------------


def test_jump_to_forward():
    """Jump forward from cursor 0 to cursor 2."""
    eng = _eng()
    eng.push("a", _snap("a0"), _snap("a1"))
    eng.push("b", _snap("b0"), _snap("b1"))
    eng.push("c", _snap("c0"), _snap("c1"))
    # Undo twice so cursor=0.
    eng.undo()
    eng.undo()
    assert eng.cursor == 0
    result = eng.jump_to(2)
    assert result is not None
    assert result.canonical["_label"] == "c1"
    assert eng.cursor == 2


def test_jump_to_backward():
    """Jump backward from cursor 2 to cursor 0."""
    eng = _eng()
    eng.push("a", _snap("a0"), _snap("a1"))
    eng.push("b", _snap("b0"), _snap("b1"))
    eng.push("c", _snap("c0"), _snap("c1"))
    assert eng.cursor == 2
    result = eng.jump_to(0)
    assert result is not None
    assert result.canonical["_label"] == "a1"
    assert eng.cursor == 0


def test_jump_to_baseline():
    """Jump to -1 returns the before-snapshot of the first entry."""
    eng = _eng()
    eng.push("a", _snap("a0"), _snap("a1"))
    eng.push("b", _snap("b0"), _snap("b1"))
    result = eng.jump_to(-1)
    assert result is not None
    assert result.canonical["_label"] == "a0"
    assert eng.cursor == -1


def test_jump_to_invalid_index_returns_none():
    """Indexes out of range return None and leave the cursor unchanged."""
    eng = _eng()
    eng.push("a", _snap("a0"), _snap("a1"))
    # Too high.
    assert eng.jump_to(5) is None
    assert eng.cursor == 0
    # Too low (below -1).
    assert eng.jump_to(-2) is None
    assert eng.cursor == 0


def test_jump_to_current_cursor_returns_none():
    """No-op jump (target == cursor) returns None."""
    eng = _eng()
    eng.push("a", _snap("a0"), _snap("a1"))
    assert eng.cursor == 0
    assert eng.jump_to(0) is None
    assert eng.cursor == 0


def test_jump_to_baseline_no_op_when_already_at_baseline():
    """Cursor at -1, jump to -1 → no-op."""
    eng = _eng()
    eng.push("a", _snap("a0"), _snap("a1"))
    eng.revert_all()
    assert eng.cursor == -1
    assert eng.jump_to(-1) is None
