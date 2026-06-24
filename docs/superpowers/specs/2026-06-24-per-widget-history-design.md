# Per-Widget History — Design Spec

**Date:** 2026-06-24
**Status:** Approved (pending spec review)
**Scope:** Frontend (`src/`) + local backend (`backend/`)

## 1. Summary

Today the editor has a single **global** history surface (`HistoryDropdown`) backed by
the backend's session-wide undo stack. This feature adds a **per-widget history**: a
tethered canvas node, opened from an adjustment widget, that shows the timeline of
changes to *that widget* and lets the user click any past entry to **restore that
widget's params** — recorded as a new forward action in the global history.

The per-widget timeline is a **filtered lens over the one global history**, not a second
stack. There is a single source of truth (the backend history engine); the node simply
reads a widget-scoped projection of it.

## 2. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| What an entry does | Click → restore that widget's params; lands as a **new global history entry** (synced, not a divergent stack). |
| Physical form | A **tethered canvas node** rendered via the `.overlay` chrome (InfoWidgetShell family), connected to its parent widget. |
| Row detail | **Label + changed-param deltas** (e.g. `Exposure 0.5 → 0.3`). No thumbnails/previews. |
| Where history lives | **Backend** (`editor/backend`), alongside the existing history engine. Tagged, single source of truth. |
| Entry points | **Both** a history button in the widget header **and** right-click on the widget. |

### Out of scope (YAGNI for v1)
- Per-entry preview thumbnails.
- Cross-widget compare / "compare with current".
- Branching/non-linear history.
- Persisting per-widget history across reloads beyond what the existing in-memory
  history engine already provides.

## 3. Architecture

### 3.1 Single source of truth

The backend `HistoryEngine` already stores a full before/after `Snapshot` per entry.
It does **not** currently expose *which* widget each entry touched. We add that tagging.
Restores go through the normal mutation path, so they appear in the global history and
trigger the usual SSE — the per-widget node and the global `HistoryDropdown` stay
consistent off the same revision counter.

### 3.2 Data flow

```
user clicks a past row in a history node
   → backendTools.restoreWidgetToRevision(sid, widgetId, entryId)
   → POST /state/{sid}/restore-widget/{widgetId}/{entryId}
   → backend re-applies entry.params_after for that widget via set_param/update_widget
   → new HistoryEntry pushed (label "Restored <widget> to earlier state")
   → revision bumps, SSE emitted
   → frontend snapshot.revision changes
   → useWidgetHistory + useHistoryLog refetch; current-row marker updates
```

## 4. Backend changes (`editor/backend`)

### 4.1 `HistoryEntry` tagging — `app/session/history.py`

Extend the entry model:

```python
class HistoryEntry(BaseModel):
    id: str
    ts: float
    label: str
    before: Snapshot
    after: Snapshot
    coalesce_key: str | None = None
    # NEW:
    affected_widget_ids: list[str] = Field(default_factory=list)
    widget_params_before: dict[str, dict[str, dict[str, Any]]] = Field(default_factory=dict)
    widget_params_after: dict[str, dict[str, dict[str, Any]]] = Field(default_factory=dict)
```

`widget_params_*` are keyed `widget_id → node_id → {param_key → value}` and populated
**only for affected widgets** (keeps entries small).

Add a helper on `Snapshot`:

```python
def extract_widget_params(self, widget_ids: list[str]) -> dict[str, dict[str, dict[str, Any]]]:
    out = {}
    for wid in widget_ids:
        w = self.widgets.get(wid)
        if w is None:
            continue
        out[wid] = {node.id: dict(node.params) for node in w.nodes}
    return out
```

### 4.2 Compute affected ids at push time — `app/tools/registry.py`

When a `is_user_action` tool finishes and history is pushed (the existing block ~lines
166–176), compute affected widget ids and the param snapshots:

- Widget-targeted tools (`set_widget_param`, `refine_widget`, `accept_widget`,
  `delete_widget`, `restore_widget`, `repeat_widget`) expose `widget_id` on their parsed
  input → use directly.
- `set_param` (canonical write) and any other tool → diff `before` vs `after` widget
  params to find changed widget ids.

Add a small helper `_compute_affected_widget_ids(before, after, parsed) -> list[str]`,
then pass `affected_widget_ids`, `widget_params_before`, `widget_params_after` into
`history.push(...)`. The coalescing path must carry the same fields when it updates an
existing slot's `after`.

### 4.3 Widget-scoped history endpoint — `app/api/state.py`

```
GET /state/{sid}/widget-history/{widget_id}
```

Response:

```json
{
  "entries": [
    { "id": "…", "ts": 0.0, "label": "Setting exposure = 0.3",
      "params_before": { "node_id": { "exposure": 0.5 } },
      "params_after":  { "node_id": { "exposure": 0.3 } } }
  ],
  "current_entry_id": "…",
  "can_restore": true
}
```

- `entries` = global entries filtered to those whose `affected_widget_ids` contains
  `widget_id`, in chronological order, each carrying that widget's `params_before/after`.
- `current_entry_id` = the latest widget entry at or before the live cursor (lets the
  frontend mark the "current" row without knowing the global cursor math).
- `can_restore` mirrors session writability.

The global `GET /state/{sid}/history` is unchanged (it MAY additionally include
`affected_widget_ids` per entry — backward-compatible, frontend ignores until used).

### 4.4 Restore endpoint — `app/api/state.py`

```
POST /state/{sid}/restore-widget/{widget_id}/{entry_id}
```

Under the document write lock:
1. Look up the target entry; 404 if absent.
2. Read `entry.widget_params_after[widget_id]`; 404 if the widget isn't in that entry.
3. Capture a pre-restore `Snapshot`.
4. For each `node_id → params` in the stored snapshot: if the node still exists on the
   live widget, apply each param via `doc.set_param(node.layer_id, node.type, key, value)`
   and update `node.params`. **Skip** missing nodes/params defensively.
5. `widget.revision += 1; doc.update_widget(widget)`.
6. Push a new `HistoryEntry` (label `Restored <widget intent> to earlier state`,
   `coalesce_key=None`, affected = `[widget_id]`, with fresh before/after param snapshots).
7. Emit SSE the same way other mutations do; bump revision.

Returns `{ "revision": N, "applied": "restore_widget_params" }`.

## 5. Frontend changes (`src/`)

### 5.1 Types — `src/types/workspace.ts`

```ts
export interface HistoryNodeState {
  id: string;
  position: Point;
  size: Size;
  targetWidgetId: string;   // the adjustment widget this timeline tracks
}
```

### 5.2 Store — `src/store/workspace-slice.ts`

- Add `historyNodes: Record<string, HistoryNodeState>` to `WorkspaceSlice`.
- Actions: `addHistoryNode(targetWidgetId, options?) → id`,
  `removeHistoryNode(id)`, `setHistoryNodePosition(id, position)`.
- Include `historyNodes` in `captureState` / `restoreState` / `resetWorkspace` and in the
  `statesChanged` comparison (so it rides frontend undo + `.edp` save like `infoNodes`).
- `addHistoryNode` allocates id `history-${_nextNodeSeq++}` and computes a spawn position
  via `nextSpawnPositionFor` relative to the target widget node, collision-aware against
  existing nodes.

### 5.3 Document facade — `src/core/document.ts`

Wrap store actions in `recordSnapshot('Open history' / 'Close history', …)`, exposed
under `editorDocument.workspace.*` consistent with `addInfoNode`.

### 5.4 Canvas wiring — `src/components/workspace/CanvasWorkspace.tsx`

- Register node type: `nodeTypes = { …, history: HistoryNode }`.
- Derive React Flow nodes from `historyNodes` (`type: 'history'`, `dragHandle`,
  `data: { historyNodeId }`), mirroring the `infos` derivation.
- Auto-derive a tether edge from each history node to its **target widget node**
  (`source: history.id`, `target: history.targetWidgetId`, `type: 'tether'`,
  `selectable: false`), guarded by the target widget node still existing — mirrors the
  info→image auto-edge.
- **Cleanup reconciliation:** prune any `historyNode` whose `targetWidgetId` is no longer
  an active widget (deleted/accepted), in the same effect spirit as `layer-lifecycle`.

### 5.5 Node + shell — `src/components/workspace/HistoryNode.tsx`, `src/components/widget/HistoryWidgetShell.tsx`

- `HistoryNode` follows `InfoNode`: positioned wrapper, 4 invisible tether handles,
  ResizeObserver to keep handles pinned; renders `HistoryWidgetShell`.
- `HistoryWidgetShell` follows `InfoWidgetShell`: shared `.overlay` chrome, header
  `History · {count}` + close button (calls `removeHistoryNode`), body = `HistoryList`.
  No footer in v1.
- **Note:** the adjustment `WidgetShell` is NOT reused — it is hardwired to binding/slider
  bodies. The history node uses the InfoWidgetShell chrome family for visual consistency.

### 5.6 Data hook — `src/hooks/useWidgetHistory.ts`

`useWidgetHistory(widgetId)` — fetches `backendTools.widgetHistory(sessionId, widgetId)`,
refetches on `snapshot.revision` change (same pattern as `useHistoryLog`). Returns
`{ entries, currentEntryId, canRestore } | null`.

### 5.7 Row rendering — `HistoryList` + `HistoryRow`

- `HistoryRow` (topic-local primitive): label, relative time (reuse the formatter from
  `HistoryDropdown`), and param deltas computed from `params_before/after`
  (`Exposure 0.5 → 0.3`). Filled dot on `currentEntryId`; future/past rows styled like
  `HistoryDropdown` (future at reduced opacity).
- Click a non-current row → `backendTools.restoreWidgetToRevision(sid, widgetId, entryId)`.
- Disabled when `!canRestore` or `sseStatus !== 'open'`.

### 5.8 Backend tools — `src/lib/backend-tools.ts`

```ts
widgetHistory(sessionId, widgetId): Promise<WidgetHistoryLog | null>
restoreWidgetToRevision(sessionId, widgetId, entryId): Promise<{ revision: number; applied: string } | null>
```

### 5.9 Entry points

**Header button** — `WidgetShellHeader`:
- Add an always-visible `History` (clock) ghost button, threaded via a new
  `onToggleHistory` prop from `WidgetShell` (which knows its `widget.id`).
- `e.stopPropagation()` like the other header buttons.

**Right-click** — `WidgetNode`:
- Wrap the shell in a Radix `ContextMenu.Root` (precedent: `ImageNodeObjectsLayer`) with a
  *Show history / Hide history* item (label reflects current state). Room for future items.

**Shared toggle** — one history node per widget:
- If a `historyNode` with `targetWidgetId === widget.id` exists → `removeHistoryNode`.
- Else → `addHistoryNode(widget.id)` (spawns + auto-tethers).

## 6. Sync & lifecycle

- **Sync:** restore is a real forward mutation → appears in the global `HistoryDropdown`;
  global undo/redo/jump bumps `snapshot.revision` → `useWidgetHistory` refetches and the
  current-row marker tracks the live cursor. One cursor, one truth.
- **Cleanup:** deleting/accepting the parent widget prunes its history node + auto-tether
  (5.4 reconciliation).
- **Offline (`sseStatus !== 'open'`):** restore disabled; node renders last-known timeline
  read-only — consistent with the rest of the tool gating.

## 7. Testing

**Backend (pytest):**
- Affected-id tagging per user-action tool (`set_widget_param`, `set_param`,
  `refine_widget`, `accept/delete/restore_widget`).
- `widget-history` projection: filtering, chronological order, `current_entry_id`
  computation, param payloads.
- `restore-widget`: re-applies params as a new forward entry; appears in global history;
  skips missing nodes/params without error.

**Frontend:**
- `useWidgetHistory` fetch + refetch on revision change.
- Toggle creates/removes the history node and its tether (both entry points).
- `HistoryRow` delta rendering and current-row marking.
- Cleanup on parent widget deletion.

## 8. Files touched

**Backend**
- `app/session/history.py` — `HistoryEntry` fields + `Snapshot.extract_widget_params`.
- `app/tools/registry.py` — `_compute_affected_widget_ids` + enriched `push`.
- `app/api/state.py` — `GET /widget-history/{widget_id}`, `POST /restore-widget/...`.

**Frontend**
- `src/types/workspace.ts` — `HistoryNodeState`.
- `src/store/workspace-slice.ts` — `historyNodes` + actions + undo/reset wiring.
- `src/core/document.ts` — facade wrappers.
- `src/components/workspace/CanvasWorkspace.tsx` — node type, derivation, auto-tether, cleanup.
- `src/components/workspace/HistoryNode.tsx` — new.
- `src/components/workspace/WidgetNode.tsx` — right-click context menu.
- `src/components/widget/HistoryWidgetShell.tsx` — new (+ `HistoryList`/`HistoryRow`).
- `src/components/widget/WidgetShellHeader.tsx`, `WidgetShell.tsx` — header button + prop.
- `src/hooks/useWidgetHistory.ts` — new.
- `src/lib/backend-tools.ts` — `widgetHistory`, `restoreWidgetToRevision`.
