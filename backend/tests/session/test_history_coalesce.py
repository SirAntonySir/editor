"""HistoryEngine — coalesce semantics for repeated slider commits."""

from __future__ import annotations

import time
from unittest.mock import patch

from app.session.history import HistoryEngine, Snapshot


def _snap(label: str) -> Snapshot:
    return Snapshot(canonical={"_label": label})


def test_coalesce_merges_consecutive_pushes_with_same_key():
    eng = HistoryEngine(max_entries=10)
    # First push lands a fresh entry.
    eng.push("set exposure", _snap("v0"), _snap("v1"),
             coalesce_key="set_param:L:basic:exposure", coalesce_window_s=2.0)
    assert len(eng.entries) == 1
    # Second push within window with same key merges into the first.
    eng.push("set exposure", _snap("v0"), _snap("v2"),
             coalesce_key="set_param:L:basic:exposure", coalesce_window_s=2.0)
    assert len(eng.entries) == 1
    assert eng.entries[0].after.canonical["_label"] == "v2"
    # Before is still the original starting point — that's the undo target.
    assert eng.entries[0].before.canonical["_label"] == "v0"


def test_coalesce_different_keys_push_separate_entries():
    eng = HistoryEngine(max_entries=10)
    eng.push("exposure", _snap("a0"), _snap("a1"),
             coalesce_key="set_param:L:basic:exposure", coalesce_window_s=2.0)
    eng.push("contrast", _snap("b0"), _snap("b1"),
             coalesce_key="set_param:L:basic:contrast", coalesce_window_s=2.0)
    assert len(eng.entries) == 2


def test_coalesce_window_expired_pushes_new_entry():
    eng = HistoryEngine(max_entries=10)
    eng.push("exposure", _snap("a0"), _snap("a1"),
             coalesce_key="set_param:L:basic:exposure", coalesce_window_s=0.05)
    time.sleep(0.06)
    eng.push("exposure", _snap("a1"), _snap("a2"),
             coalesce_key="set_param:L:basic:exposure", coalesce_window_s=0.05)
    assert len(eng.entries) == 2


def test_coalesce_after_undo_starts_fresh_entry():
    """After the user undoes, the cursor isn't at the tip. The next
    push must NOT merge with the (still-present) tail entry — that
    would silently delete redo information."""
    eng = HistoryEngine(max_entries=10)
    eng.push("a", _snap("a0"), _snap("a1"),
             coalesce_key="k", coalesce_window_s=2.0)
    eng.undo()  # cursor: -1, entry tail still present
    eng.push("b", _snap("b0"), _snap("b1"),
             coalesce_key="k", coalesce_window_s=2.0)
    # The undo's original "a" entry was truncated (standard semantics);
    # "b" landed as a fresh entry.
    assert len(eng.entries) == 1
    assert eng.entries[0].after.canonical["_label"] == "b1"


def test_coalesce_disabled_when_window_is_zero():
    eng = HistoryEngine(max_entries=10)
    eng.push("x", _snap("0"), _snap("1"), coalesce_key="k", coalesce_window_s=0.0)
    eng.push("x", _snap("1"), _snap("2"), coalesce_key="k", coalesce_window_s=0.0)
    assert len(eng.entries) == 2


def test_coalesce_disabled_when_key_is_none():
    eng = HistoryEngine(max_entries=10)
    eng.push("x", _snap("0"), _snap("1"), coalesce_key=None, coalesce_window_s=2.0)
    eng.push("x", _snap("1"), _snap("2"), coalesce_key=None, coalesce_window_s=2.0)
    assert len(eng.entries) == 2


def test_coalesced_entry_undo_returns_original_before():
    """The key user-facing invariant: undoing the coalesced entry
    restores the snapshot from BEFORE the very first push in the
    coalesce window. Without the merge, the user would need N undos
    to walk back N debounced commits."""
    eng = HistoryEngine(max_entries=10)
    # Simulate 10 slider ticks merging into one entry.
    eng.push("exposure", _snap("pristine"), _snap("0.05"),
             coalesce_key="k", coalesce_window_s=2.0)
    for v in (0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50):
        eng.push("exposure", _snap("ignored-becomes-tip"), _snap(f"{v:.2f}"),
                 coalesce_key="k", coalesce_window_s=2.0)

    assert len(eng.entries) == 1
    restored = eng.undo()
    assert restored is not None
    # ONE undo took us all the way back to the pristine baseline.
    assert restored.canonical["_label"] == "pristine"
