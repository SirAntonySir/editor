"""HistoryEngine — snapshot-based, backend-owned undo/redo.

Phase 3 of the SSOT refactor. Replaces the frontend's 20-deep
client-only history stack with a per-session engine that captures
SessionDocument snapshots at every user-action boundary.

Why snapshots, not event-sourced inverses:
  Reversibility becomes a property of the engine, not of each op. When
  a new tool ships, undo works the moment it's registered — there's no
  "remember to define the inverse" foot-gun.

  Snapshot size is small (KBs, not MBs): we capture only the canonical
  state + the widgets/masks/transforms metadata + per-image-node
  image_context. Pixel data, image bytes, prepare_result (regenerable),
  and the event log itself are excluded.

What lives where:
  - One HistoryEngine per SessionRecord (in-memory; not persisted today).
  - Snapshots captured by the tool registry BEFORE/AFTER any tool whose
    `is_user_action` is True.
  - apply_snapshot() lives on SessionDocument so the undo/redo/revert
    endpoints share one rehydration path.

Per-image-node doctrine (see app/state/document.py):
  - image_context_by_node IS captured and restored.
  - image_bytes_by_node and prepare_result_by_node are NOT captured —
    bytes are huge and identical across snapshots; prepare_result is
    regenerable on demand via PrepareImageTool.
  - apply_snapshot clears the legacy singleton image_context so a
    post-undo document satisfies the per-node-only doctrine.
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

    Intentionally INCLUDED:
      - canonical, widgets, masks, image_node_transforms, dismissals
        (user-action-mutable; per the operations layer)
      - image_context_by_node (per-image-node analysis result; mutated by
        analyze_context / precompute_regions, which ARE user actions)

    Intentionally EXCLUDED:
      - image_bytes / image_bytes_by_node (multi-MB; identical across snapshots)
      - prepare_result / prepare_result_by_node (regenerable by prepare_image)
      - history (event log; its own ledger, would compound quickly)
      - image_context (legacy singleton; the per-node dict is the SSoT)
      - revision / updated_at (rebuilt on apply)
    """

    model_config = ConfigDict(arbitrary_types_allowed=True, extra="forbid")

    canonical: dict[str, Any] = Field(default_factory=dict)
    widgets: dict[str, Any] = Field(default_factory=dict)
    widget_order: list[str] = Field(default_factory=list)
    masks: dict[str, Any] = Field(default_factory=dict)
    image_node_transforms: dict[str, Any] = Field(default_factory=dict)
    dismissals: list[Any] = Field(default_factory=list)
    image_context_by_node: dict[str, Any] = Field(default_factory=dict)

    @classmethod
    def capture(cls, doc: "SessionDocument") -> "Snapshot":
        """Deep-copy the doc's mutable state into a Snapshot. Use `mode='python'`
        on widgets/masks/dismissals/image_context so apply_snapshot can
        model_validate them back to their typed shapes without round-tripping
        through JSON."""
        return cls(
            canonical=_deep_copy_jsonable(doc.canonical),
            widgets={k: w.model_dump(mode="python") for k, w in doc.widgets.items()},
            widget_order=list(doc.widget_order),
            masks={k: m.model_dump(mode="python") for k, m in doc.masks.items()},
            image_node_transforms=_deep_copy_jsonable(doc.image_node_transforms),
            dismissals=[r.model_dump(mode="python") for r in doc.dismissals],
            image_context_by_node={
                k: v.model_dump(mode="python")
                for k, v in doc.image_context_by_node.items()
            },
        )

    def extract_widget_params(
        self, widget_ids: list[str]
    ) -> dict[str, dict[str, dict[str, Any]]]:
        """Project this snapshot's widget params to `{widget_id → {node_id →
        {param_key → value}}}` for the requested widgets. Unknown widget ids
        are skipped (a widget that didn't exist at this revision contributes
        nothing). Used to tag history entries so a per-widget timeline can
        render param deltas and a restore can re-apply a past param set.

        `widgets` holds `model_dump(mode="python")` dicts (see `capture`), so
        we walk dict form; we also tolerate live model objects defensively."""
        out: dict[str, dict[str, dict[str, Any]]] = {}
        for wid in widget_ids:
            w = self.widgets.get(wid)
            if w is None:
                continue
            nodes = w["nodes"] if isinstance(w, dict) else w.nodes
            node_map: dict[str, dict[str, Any]] = {}
            for node in nodes:
                nid = node["id"] if isinstance(node, dict) else node.id
                params = node["params"] if isinstance(node, dict) else node.params
                node_map[nid] = dict(params)
            out[wid] = node_map
        return out


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
    model_config = ConfigDict(arbitrary_types_allowed=True)
    id: str
    ts: float
    label: str
    before: Snapshot
    after: Snapshot
    # Coalesce key, if any. When the next push() matches this key within
    # the configured window, the engine updates this entry's `after`
    # instead of pushing a new slot. None means this entry never coalesces.
    coalesce_key: str | None = None
    # Per-widget tagging for the per-widget history feature. `affected_widget_ids`
    # lists the widgets this entry mutated; `widget_params_*` carry those widgets'
    # node params at the before/after boundary (`{widget_id → {node_id →
    # {param → value}}}`) so the widget-scoped timeline can render deltas and a
    # restore can re-apply a past param set as a new forward action.
    affected_widget_ids: list[str] = Field(default_factory=list)
    widget_params_before: dict[str, dict[str, dict[str, Any]]] = Field(default_factory=dict)
    widget_params_after: dict[str, dict[str, dict[str, Any]]] = Field(default_factory=dict)
    # True for entries created by a per-widget restore. They still belong to the
    # global stack (undoable, shown in the global history), but the per-widget
    # timeline excludes them so the stepper walks the original adjustments
    # rather than its own restore trail.
    is_restore: bool = False


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

    def widget_timeline(self, widget_id: str) -> list[HistoryEntry]:
        """Project the global stack to the entries that touched `widget_id`, in
        chronological order. Restore-generated entries are excluded so the
        per-widget timeline shows the original adjustments, not the trail of
        restores stepping through them produced. The caller derives which entry
        is "current" by matching the widget's live params (a restore appends a
        new entry but lands the widget back on an existing entry's state)."""
        return [
            e for e in self._entries
            if widget_id in e.affected_widget_ids and not e.is_restore
        ]

    # ---------------- mutation ----------------

    def push(
        self,
        label: str,
        before: Snapshot,
        after: Snapshot,
        *,
        affected_widget_ids: list[str] | None = None,
        widget_params_before: dict[str, dict[str, dict[str, Any]]] | None = None,
        widget_params_after: dict[str, dict[str, dict[str, Any]]] | None = None,
        is_restore: bool = False,
        coalesce_key: str | None = None,
        coalesce_window_s: float = 0.0,
    ) -> HistoryEntry:
        """Append a new entry. Truncates any redo-able entries past the
        cursor — once the user picks a new branch, the old redo path is
        forfeit (standard undo-stack semantics).

        If `coalesce_key` matches the last entry's key AND that entry is
        within `coalesce_window_s` seconds, this push updates the last
        entry's `after` instead of allocating a new slot. Used to merge
        a stream of slider commits (one debounced set_param per pause)
        into a single undoable step.

        Coalesce only fires when the cursor is at the tip — once the
        user has hit undo, the next push starts a fresh branch (the
        cursor moves forward by one), and that's a discrete action.
        """
        affected_widget_ids = affected_widget_ids or []
        widget_params_before = widget_params_before or {}
        widget_params_after = widget_params_after or {}
        now = time.time()
        if (
            coalesce_key is not None
            and coalesce_window_s > 0
            and self._cursor >= 0
            and self._cursor == len(self._entries) - 1
            and self._entries[self._cursor].coalesce_key == coalesce_key
            and (now - self._entries[self._cursor].ts) <= coalesce_window_s
        ):
            tip = self._entries[self._cursor]
            tip.after = after
            tip.ts = now
            # Carry the latest after-params; union the affected-id set so a
            # coalesced run still names every widget it touched.
            tip.widget_params_after = widget_params_after
            for wid in affected_widget_ids:
                if wid not in tip.affected_widget_ids:
                    tip.affected_widget_ids.append(wid)
            return tip

        self._entries = self._entries[: self._cursor + 1]
        entry = HistoryEntry(
            id=uuid.uuid4().hex,
            ts=now,
            label=label,
            before=before,
            after=after,
            coalesce_key=coalesce_key,
            affected_widget_ids=affected_widget_ids,
            widget_params_before=widget_params_before,
            widget_params_after=widget_params_after,
            is_restore=is_restore,
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

    def jump_to(self, target_cursor: int) -> Snapshot | None:
        """Seek the cursor to `target_cursor` (-1 = pre-history baseline,
        0..len-1 = the entry at that index applied). Returns the snapshot
        to apply (the `after` of the new cursor entry, or the `before` of
        entry 0 when seeking back to baseline). Returns None for invalid
        targets or no-op moves (current cursor already at target).
        """
        if target_cursor == self._cursor:
            return None
        if target_cursor < -1 or target_cursor >= len(self._entries):
            return None
        self._cursor = target_cursor
        if target_cursor == -1:
            # Baseline. Use the before-snapshot of the first entry.
            if not self._entries:
                return None
            return self._entries[0].before
        return self._entries[target_cursor].after
