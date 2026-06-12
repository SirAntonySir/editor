"""HistoryEngine — snapshot-based, backend-owned undo/redo.

Phase 3 of the SSOT refactor. Replaces the frontend's 20-deep
client-only history stack with a per-session engine that captures
SessionDocument snapshots at every user-action boundary.

Why snapshots, not event-sourced inverses:
  Reversibility becomes a property of the engine, not of each op. When
  a new tool ships, undo works the moment it's registered — there's no
  "remember to define the inverse" foot-gun.

  Snapshot size is small (KBs, not MBs): we capture only the canonical
  state + the widgets/masks/transforms metadata. Pixel data, image
  bytes, and the event log itself are excluded.

What lives where:
  - One HistoryEngine per SessionRecord (in-memory; not persisted today).
  - Snapshots captured by the tool registry BEFORE/AFTER any tool whose
    `is_user_action` is True.
  - apply_snapshot() lives on SessionDocument so the undo/redo/revert
    endpoints share one rehydration path.
"""

from __future__ import annotations

import time
import uuid
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from app.state.document import SessionDocument


class Snapshot(BaseModel):
    """Subset of SessionDocument captured at a user-action boundary.

    Intentionally excludes:
      - image_bytes        (multi-MB; identical across all snapshots)
      - prepare_result     (regenerable)
      - history (event log; its own ledger, would compound quickly)
      - image_context      (only widgets/canonical change per user action;
                            context_updated is a separate audit event)
      - revision/updated_at (rebuilt on apply)
    """

    model_config = ConfigDict(arbitrary_types_allowed=True, extra="forbid")

    canonical: dict[str, Any] = Field(default_factory=dict)
    widgets: dict[str, Any] = Field(default_factory=dict)
    widget_order: list[str] = Field(default_factory=list)
    masks: dict[str, Any] = Field(default_factory=dict)
    image_node_transforms: dict[str, Any] = Field(default_factory=dict)
    dismissals: list[Any] = Field(default_factory=list)

    @classmethod
    def capture(cls, doc: "SessionDocument") -> "Snapshot":
        """Deep-copy the doc's mutable state into a Snapshot. Use `mode='python'`
        on widgets/masks/dismissals so apply_snapshot can model_validate them
        back to their typed shapes without round-tripping through JSON."""
        return cls(
            canonical=_deep_copy_jsonable(doc.canonical),
            widgets={k: w.model_dump(mode="python") for k, w in doc.widgets.items()},
            widget_order=list(doc.widget_order),
            masks={k: m.model_dump(mode="python") for k, m in doc.masks.items()},
            image_node_transforms=_deep_copy_jsonable(doc.image_node_transforms),
            dismissals=[r.model_dump(mode="python") for r in doc.dismissals],
        )


def _deep_copy_jsonable(obj: Any) -> Any:
    """Recursive copy for the canonical/transforms dicts. They contain only
    primitives + dicts + lists by construction, so a structural walk is
    enough — no need for the full `copy.deepcopy` machinery."""
    if isinstance(obj, dict):
        return {k: _deep_copy_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_deep_copy_jsonable(v) for v in obj]
    return obj


class HistoryEntry(BaseModel):
    """One slot in the per-session undo stack."""
    id: str
    ts: float
    label: str
    before: Snapshot
    after: Snapshot


class HistoryEngine:
    """Bounded undo/redo stack. Cursor sits ON the last-applied entry;
    -1 means we're at the pre-history baseline.

    Layout for entries [a, b, c] with cursor == 2:
        a    b    c
        ^^^^^^^^^^^^  applied
                  ^   cursor
    After undo() → cursor=1, restored snapshot = c.before == b.after.
    After undo() → cursor=0, restored = b.before == a.after.
    After undo() → cursor=-1, restored = a.before (the initial state).
    """

    def __init__(self, max_entries: int) -> None:
        if max_entries < 1:
            raise ValueError("max_entries must be >= 1")
        self._max = max_entries
        self._entries: list[HistoryEntry] = []
        self._cursor: int = -1

    # ---------------- read-only queries ----------------

    @property
    def cursor(self) -> int:
        return self._cursor

    @property
    def entries(self) -> list[HistoryEntry]:
        return list(self._entries)

    @property
    def can_undo(self) -> bool:
        return self._cursor >= 0

    @property
    def can_redo(self) -> bool:
        return self._cursor < len(self._entries) - 1

    # ---------------- mutation ----------------

    def push(self, label: str, before: Snapshot, after: Snapshot) -> HistoryEntry:
        """Append a new entry. Truncates any redo-able entries past the
        cursor — once the user picks a new branch, the old redo path is
        forfeit (standard undo-stack semantics)."""
        self._entries = self._entries[: self._cursor + 1]
        entry = HistoryEntry(
            id=uuid.uuid4().hex,
            ts=time.time(),
            label=label,
            before=before,
            after=after,
        )
        self._entries.append(entry)
        self._cursor = len(self._entries) - 1
        if len(self._entries) > self._max:
            drop = len(self._entries) - self._max
            self._entries = self._entries[drop:]
            self._cursor -= drop
        return entry

    def undo(self) -> Snapshot | None:
        """Step back one entry. Returns the snapshot to restore, or None
        when already at the pre-history baseline."""
        if not self.can_undo:
            return None
        snap = self._entries[self._cursor].before
        self._cursor -= 1
        return snap

    def redo(self) -> Snapshot | None:
        """Step forward one entry. Returns the snapshot to restore, or None
        when the cursor is already at the newest entry."""
        if not self.can_redo:
            return None
        self._cursor += 1
        return self._entries[self._cursor].after

    def revert_all(self) -> Snapshot | None:
        """Restore the pre-history baseline (the `before` of the first entry).
        Returns None when the stack is empty.

        Unlike undo(), revert keeps the entries around so the user can
        redo if they change their mind — cursor jumps to -1.
        """
        if not self._entries:
            return None
        self._cursor = -1
        return self._entries[0].before
