from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr

from app.schemas.image_context import ImageContext
from app.schemas.widget import (
    DismissalRule,
    MaskRecord,
    Note,
    StateEvent,
    Widget,
)
from app.state.canonical import Canonical, clear_param_value, set_param_value

# Reserved image-node id for the "primary" image — the one carried by the
# legacy singleton fields (image_bytes, image_context, etc). All call sites
# that don't yet know which ImageNode they target use this id so the
# accessors fall back to the singleton.
DEFAULT_IMAGE_NODE_ID = "in-default"

ImageNodeTransform = dict[str, Any]  # {"layer_ids": list[str], "crop": dict|None, "rotate": dict|None}


def _deep_copy(obj: Any) -> Any:
    """Structural copy for canonical/transforms dicts (primitives + dicts +
    lists by construction). Avoids pulling in `copy.deepcopy` for the hot
    snapshot-restore path."""
    if isinstance(obj, dict):
        return {k: _deep_copy(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_deep_copy(v) for v in obj]
    return obj


class SessionDocument(BaseModel):
    """Authoritative per-session state. Owns widgets, masks, dismissals,
    notes, image context and an event log. All mutations bump `revision`
    and return the StateEvents they emitted."""

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    session_id: str
    # Legacy singletons — kept as the "primary image" carrier while call
    # sites migrate to the per-image-node accessors below. New readers
    # should call get_image_bytes(image_node_id) / get_mime_type(image_node_id).
    image_bytes: bytes = b""
    mime_type: str = "image/jpeg"
    # Per-ImageNode storage. `in-default` is reserved for the singleton's
    # backing image until the bootstrap path is migrated; unmigrated callers
    # still read .image_bytes directly.
    image_bytes_by_node: dict[str, bytes] = Field(default_factory=dict)
    mime_type_by_node: dict[str, str] = Field(default_factory=dict)
    image_context: ImageContext | None = None
    # Cached output of the prepare_image tool (PrepareResult dataclass from
    # app.tools.atomic._analyze_phases). Typed as Any to avoid a circular
    # import — document.py → _analyze_phases.py → document.py.
    prepare_result: Any = None
    # Per-ImageNode storage for image_context and prepare_result. Mirrors the
    # image_bytes_by_node / mime_type_by_node pattern: `in-default` falls back
    # to the legacy singleton on read so call sites can migrate piecewise.
    image_context_by_node: dict[str, ImageContext] = Field(default_factory=dict)
    prepare_result_by_node: dict[str, Any] = Field(default_factory=dict)
    masks: dict[str, MaskRecord] = Field(default_factory=dict)
    active_mask_id: str | None = None
    committed_mask_id: str | None = None
    canonical: Canonical = Field(default_factory=dict)
    image_node_transforms: dict[str, ImageNodeTransform] = Field(default_factory=dict)
    widgets: dict[str, Widget] = Field(default_factory=dict)
    widget_order: list[str] = Field(default_factory=list)
    dismissals: list[DismissalRule] = Field(default_factory=list)
    notes: list[Note] = Field(default_factory=list)
    history: list[StateEvent] = Field(default_factory=list)
    revision: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    _published_idx: int = PrivateAttr(default=0)
    # Optional live publish hook, set by the tool registry for the duration of a
    # tool invocation. When present, each emitted event is published immediately
    # (rather than flushed in one burst after the handler returns), so
    # long-running handlers like analyze_image stream phase events live.
    _event_sink: "Callable[[StateEvent], None] | None" = PrivateAttr(default=None)

    # ---------------- helpers ----------------

    def _emit(self, kind: str, payload: dict[str, Any]) -> StateEvent:
        self.revision += 1
        self.updated_at = datetime.now(timezone.utc)
        ev = StateEvent(revision=self.revision, kind=kind, payload=payload)  # type: ignore[arg-type]
        self.history.append(ev)
        sink = self._event_sink
        if sink is not None:
            sink(ev)
            self._published_idx = len(self.history)
        return ev

    def apply_snapshot(self, snap: "Any") -> StateEvent:
        """Restore the doc's mutable state from a Snapshot in-place. Bumps
        revision and emits one `history.applied` event carrying the new
        operation_graph and snapshot summary.

        Used by the undo/redo/revert endpoints. The snapshot is constructed
        in app/session/history.py — typed as Any here to avoid a cycle
        (history.py imports SessionDocument for type hints).
        """
        from app.schemas.image_context import ImageContext
        from app.schemas.widget import DismissalRule, MaskRecord, Widget

        self.canonical = _deep_copy(snap.canonical)
        self.widgets = {wid: Widget.model_validate(w) for wid, w in snap.widgets.items()}
        self.widget_order = list(snap.widget_order)
        self.masks = {mid: MaskRecord.model_validate(m) for mid, m in snap.masks.items()}
        self.image_node_transforms = _deep_copy(snap.image_node_transforms)
        self.dismissals = [DismissalRule.model_validate(d) for d in snap.dismissals]
        # Per-image-node image_context: restore exactly what was captured.
        # The legacy singleton is cleared so apply_snapshot leaves a doc
        # that satisfies the per-node-only doctrine. image_bytes / mime_type /
        # prepare_result are NOT in Snapshot (huge / regenerable) — there's
        # nothing to restore and nothing to clear for them here.
        self.image_context_by_node = {
            k: ImageContext.model_validate(v)
            for k, v in snap.image_context_by_node.items()
        }
        self.image_context = None
        return self._emit("history.applied", {
            "operationGraph": self._op_graph_payload(),
            "widgets": [self.widgets[wid].model_dump(mode="json", by_alias=True)
                        for wid in self.widget_order if wid in self.widgets],
            "widgetIds": list(self.widget_order),
            "masksIndex": [
                {"id": m.id, "width": m.width, "height": m.height,
                 "source": m.source, "label": m.label,
                 "imageNodeId": m.image_node_id}
                for m in self.masks.values()
            ],
            # Per-image-node image_context restored above. Carry it on the
            # event so the frontend's history.applied handler can sync
            # s.snapshot.imageContext without a full snapshot refetch.
            # Frontend pickup lands in a separate FE-only commit; until then
            # this is a no-op on the wire (extra field is ignored).
            "imageContextByNode": {
                k: v.model_dump(mode="json", by_alias=True)
                for k, v in self.image_context_by_node.items()
            },
        })

    def prune_history(self, max_entries: int) -> int:
        """FIFO-drop oldest history entries beyond `max_entries`. Returns the
        count dropped. Adjusts `_published_idx` so the next flush picks up at
        the right place after trim.

        Called from the tool registry at the end of an invocation, AFTER
        `_flush_history_to_bus`, so we only trim already-published events.
        Within a single tool invocation history is unbounded — pruning between
        invocations is enough to keep the persisted document small.
        """
        if len(self.history) <= max_entries:
            return 0
        drop = len(self.history) - max_entries
        self.history = self.history[drop:]
        self._published_idx = max(0, self._published_idx - drop)
        return drop

    def _emit_phase_started(self, phase: str, *, index: int, total: int) -> StateEvent:
        """Convenience for the analyze pipeline's phase tracking."""
        return self._emit("phase.started", {"phase": phase, "index": index, "total": total})

    def _emit_phase_progress(self, phase: str, *, done: int, total: int) -> StateEvent:
        """For phases with internal sub-counts (currently only mask_precompute)."""
        return self._emit("phase.progress", {"phase": phase, "done": done, "total": total})

    def _emit_phase_completed(self, phase: str, *, duration_ms: int) -> StateEvent:
        """Convenience for the analyze pipeline's phase tracking."""
        return self._emit("phase.completed", {"phase": phase, "duration_ms": duration_ms})

    def _emit_phase_cancelled(self, phase: str | None = None) -> StateEvent:
        """Emitted by the tool registry when an in-flight analyze task is
        cancelled via POST /sessions/{sid}/cancel. The optional `phase` is the
        phase that was active when the cancellation landed (best-effort)."""
        return self._emit("phase.cancelled", {"phase": phase} if phase else {})

    def _emit_usage(
        self,
        *,
        call: str,
        input_tokens: int,
        output_tokens: int,
        cache_create: int,
        cache_read: int,
    ) -> StateEvent:
        """Emitted after each Anthropic call so the frontend status bar can
        show live token counts. Frontend accumulates over an analyze run."""
        return self._emit("mcp.usage", {
            "call": call,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cache_create": cache_create,
            "cache_read": cache_read,
        })

    # ---------------- widget mutations ----------------

    def _op_graph_payload(self) -> dict[str, Any]:
        """Projected operation_graph as a JSON dict, embedded in every widget
        lifecycle event. The frontend renderer only knows op_graph nodes, so it
        needs the fresh projection on each widget change — otherwise newly
        created/edited widgets never reach the canvas until a full re-fetch.

        Imported lazily: operations.py imports SessionDocument, so a top-level
        import here would be circular."""
        from app.state.operations import project_to_graph
        return project_to_graph(self).model_dump(mode="json", by_alias=True)

    def _seed_canonical_from_widget(self, widget: Widget) -> None:
        """Write every (layer, op, param) the widget's nodes carry into
        canonical. Silent (no events) — callers emit a single lifecycle event
        whose op_graph payload already reflects the seeded canonical."""
        for node in widget.nodes:
            for pkey, pval in node.params.items():
                set_param_value(self.canonical, node.layer_id, node.type, pkey, pval)

    def _reset_canonical_from_widget(self, widget: Widget) -> None:
        """Inverse of _seed_canonical_from_widget: clear exactly the param keys
        the widget owns, pruning emptied slots. A sibling param on the same
        (layer, op) set by another view survives."""
        for node in widget.nodes:
            for pkey in node.params:
                clear_param_value(self.canonical, node.layer_id, node.type, pkey)

    def add_widget(self, widget: Widget) -> list[StateEvent]:
        if widget.id in self.widgets:
            raise KeyError(f"widget {widget.id} already exists")
        self.widgets[widget.id] = widget
        self.widget_order.append(widget.id)
        # Seed canonical from the widget's nodes — covers ALL creation paths
        # (tool_invoked, fused/LLM, autonomous) so the widget projects to the
        # op_graph immediately.
        self._seed_canonical_from_widget(widget)
        return [self._emit("widget.created", {
            "widget": widget.model_dump(mode="json", by_alias=True),
            "operationGraph": self._op_graph_payload(),
        })]

    def update_widget(self, widget: Widget) -> list[StateEvent]:
        if widget.id not in self.widgets:
            raise KeyError(widget.id)
        widget.updated_at = datetime.now(timezone.utc)
        self.widgets[widget.id] = widget
        return [self._emit("widget.updated", {
            "widget": widget.model_dump(mode="json", by_alias=True),
            "operationGraph": self._op_graph_payload(),
        })]

    def dismiss_widget(self, widget_id: str, rule: DismissalRule | None = None) -> list[StateEvent]:
        if widget_id not in self.widgets:
            raise KeyError(widget_id)
        w = self.widgets[widget_id]
        # Snapshot the pre-dismiss status — accepted widgets have committed
        # their bindings into canonical (see accept_widget), so closing the
        # widget afterwards must NOT roll those values back. Only un-accepted
        # widgets (status == "active") reset canonical on close, matching the
        # "user cancelled before applying" semantics.
        was_accepted = w.status == "accepted"
        w.status = "dismissed"
        w.updated_at = datetime.now(timezone.utc)
        if not was_accepted:
            # Close (×) on an active widget discards the adjustment: reset
            # the canonical params this widget owns before emitting, so the
            # widget.deleted op_graph payload already reflects the removed
            # node.
            self._reset_canonical_from_widget(w)
        events = [self._emit("widget.deleted", {
            "widgetId": widget_id,
            "operationGraph": self._op_graph_payload(),
        })]
        # Stamp the dismissal AFTER _emit so we record the post-event
        # revision — gc_dismissed_widgets compares against the history floor.
        w.dismissed_at_revision = self.revision
        if rule is not None:
            self.dismissals.append(rule)
            events.append(self._emit("dismissal.added", {"rule": rule.model_dump(mode="json", by_alias=True)}))
        return events

    def restore_widget(self, widget_id: str) -> list[StateEvent]:
        if widget_id not in self.widgets:
            raise KeyError(widget_id)
        w = self.widgets[widget_id]
        w.status = "active"
        w.updated_at = datetime.now(timezone.utc)
        w.dismissed_at_revision = None
        self.dismissals = [r for r in self.dismissals if r.source_widget_id != widget_id]
        # Restore re-applies the adjustment dismiss() discarded.
        self._seed_canonical_from_widget(w)
        return [self._emit("widget.restored", {
            "widgetId": widget_id,
            "operationGraph": self._op_graph_payload(),
        })]

    def gc_dismissed_widgets(self) -> int:
        """Hard-delete any dismissed widget whose `dismissed_at_revision` is
        older than the oldest event still in history. Returns the count
        removed. The user can't reasonably restore something whose dismissal
        event has scrolled off the bounded log, so keeping the widget object
        just costs memory + a slot in the persisted doc.

        Called from the tool registry alongside prune_history. Active and
        accepted widgets are never touched.
        """
        if not self.history:
            return 0
        floor = self.history[0].revision
        to_drop = [
            wid for wid, w in self.widgets.items()
            if w.status == "dismissed"
            and w.dismissed_at_revision is not None
            and w.dismissed_at_revision < floor
        ]
        for wid in to_drop:
            del self.widgets[wid]
            if wid in self.widget_order:
                self.widget_order.remove(wid)
        return len(to_drop)

    def accept_widget(self, widget_id: str) -> list[StateEvent]:
        if widget_id not in self.widgets:
            raise KeyError(widget_id)
        w = self.widgets[widget_id]
        w.status = "accepted"
        w.updated_at = datetime.now(timezone.utc)
        # Reconcile binding → canonical. add_widget already seeded canonical
        # from node.params at create time, but the autonomous mint path
        # resolves binding values via the LLM after the node skeleton is
        # built and doesn't guarantee the chosen value lands on the matching
        # node.params entry. When binding.value drifts from node.params,
        # canonical carries the stale node.params and the per-tool slider
        # in the adjustments sidebar sits at the template default instead
        # of the AI-chosen value. Walking bindings here closes that gap so
        # accepting a suggestion = the adjustment panel reflecting it.
        for binding in w.bindings:
            node = next((n for n in w.nodes if n.id == binding.target.node_id), None)
            if node is None or node.layer_id is None:
                continue
            # Mirror set_widget_param: keep node.params in sync so a later
            # tool reading the widget node sees the same value canonical does.
            node.params[binding.target.param_key] = binding.value
            set_param_value(
                self.canonical,
                node.layer_id,
                node.type,
                binding.target.param_key,
                binding.value,
            )
        return [self._emit("widget.accepted", {
            "widgetId": widget_id,
            "operationGraph": self._op_graph_payload(),
        })]

    def set_param(self, layer_id: str, op: str, param: str, value: Any) -> list[StateEvent]:
        """Canonical write: the single source the op_graph projects from."""
        set_param_value(self.canonical, layer_id, op, param, value)
        return [self._emit("canonical.updated", {
            "layer_id": layer_id, "op": op, "param": param, "value": value,
            "operationGraph": self._op_graph_payload(),
        })]

    # ---------------- per-image-node accessors ----------------
    #
    # DOCTRINE — per-image-node addressing is the canonical storage. The
    # legacy `image_bytes` / `mime_type` / `image_context` / `prepare_result`
    # singleton fields exist solely to load older persisted documents and are
    # emptied on revive by `_promote_singletons_to_per_node()`. New code MUST
    # write through these `set_*(image_node_id, …)` accessors and read through
    # `get_*(image_node_id)`. `prepare_result_by_node` is regenerable from
    # `image_bytes_by_node` via PrepareImageTool — it is intentionally not
    # persisted and not snapshotted.

    def set_image_bytes(self, image_node_id: str, data: bytes, *, mime_type: str) -> None:
        """Store image bytes + MIME under a specific image-node id.

        Does NOT touch the legacy `image_bytes`/`mime_type` singletons even
        when `image_node_id == "in-default"`, so unmigrated readers keep
        seeing the original primary image until they migrate."""
        self.image_bytes_by_node[image_node_id] = data
        self.mime_type_by_node[image_node_id] = mime_type

    def get_image_bytes(self, image_node_id: str) -> bytes:
        """Return image bytes for `image_node_id`. Falls back to the legacy
        singleton when asked for `in-default` and no explicit entry exists,
        so migrating readers can swap from `doc.image_bytes` to
        `doc.get_image_bytes('in-default')` without a coordinated upload-path
        change."""
        if image_node_id in self.image_bytes_by_node:
            return self.image_bytes_by_node[image_node_id]
        if image_node_id == DEFAULT_IMAGE_NODE_ID:
            return self.image_bytes
        return b""

    def get_mime_type(self, image_node_id: str) -> str:
        """Mirror of `get_image_bytes`: falls back to the singleton MIME for
        `in-default`, defaults to `image/jpeg` for unknown ids."""
        if image_node_id in self.mime_type_by_node:
            return self.mime_type_by_node[image_node_id]
        if image_node_id == DEFAULT_IMAGE_NODE_ID:
            return self.mime_type
        return "image/jpeg"

    def set_image_context(self, image_node_id: str, ctx: ImageContext) -> None:
        """Store an ImageContext under a specific image-node id.

        Does NOT touch the legacy `image_context` singleton even when
        `image_node_id == "in-default"`, so unmigrated readers keep seeing
        whatever the singleton already held."""
        self.image_context_by_node[image_node_id] = ctx

    def get_image_context(self, image_node_id: str) -> ImageContext | None:
        """Return the ImageContext for `image_node_id`. Falls back to the
        legacy singleton when asked for `in-default` and no explicit entry
        exists, so migrating readers can swap from `doc.image_context` to
        `doc.get_image_context('in-default')` without coordinating an
        analyze-path change."""
        if image_node_id in self.image_context_by_node:
            return self.image_context_by_node[image_node_id]
        if image_node_id == DEFAULT_IMAGE_NODE_ID:
            return self.image_context
        return None

    def set_prepare_result(self, image_node_id: str, result: Any) -> None:
        """Store a PrepareResult under a specific image-node id.

        Does NOT touch the legacy `prepare_result` singleton even when
        `image_node_id == "in-default"`."""
        self.prepare_result_by_node[image_node_id] = result

    def get_prepare_result(self, image_node_id: str) -> Any:
        """Return the PrepareResult for `image_node_id`. Falls back to the
        legacy singleton for `in-default`, returns None for unknown ids."""
        if image_node_id in self.prepare_result_by_node:
            return self.prepare_result_by_node[image_node_id]
        if image_node_id == DEFAULT_IMAGE_NODE_ID:
            return self.prepare_result
        return None

    def _promote_singletons_to_per_node(self) -> None:
        """One-shot migration: lift any legacy singleton image-data into the
        `in-default` per-image-node slot and clear the singleton. Idempotent.

        Called by revive after model_validate. The per-image-node dicts are
        the canonical storage; the singleton fields exist only to load older
        persisted documents written before this migration landed.

        Rule when both sides are populated: per-node wins (it was the more
        recent write); the singleton is just cleared. See the docstring
        block at the top of this section for the full doctrine.
        """
        # image_bytes / mime_type
        if self.image_bytes and DEFAULT_IMAGE_NODE_ID not in self.image_bytes_by_node:
            self.image_bytes_by_node[DEFAULT_IMAGE_NODE_ID] = self.image_bytes
            self.mime_type_by_node[DEFAULT_IMAGE_NODE_ID] = self.mime_type
        self.image_bytes = b""
        self.mime_type = "image/jpeg"

        # image_context
        if self.image_context is not None and DEFAULT_IMAGE_NODE_ID not in self.image_context_by_node:
            self.image_context_by_node[DEFAULT_IMAGE_NODE_ID] = self.image_context
        self.image_context = None

        # prepare_result
        if self.prepare_result is not None and DEFAULT_IMAGE_NODE_ID not in self.prepare_result_by_node:
            self.prepare_result_by_node[DEFAULT_IMAGE_NODE_ID] = self.prepare_result
        self.prepare_result = None

    def set_image_node_transform(
        self,
        image_node_id: str,
        layer_ids: list[str],
        crop: dict | None,
        rotate: dict | None,
    ) -> list[StateEvent]:
        """Upsert crop/rotate for an image node. If both are None, remove the
        entry entirely so the projection emits no nodes."""
        if crop is None and rotate is None:
            self.image_node_transforms.pop(image_node_id, None)
        else:
            self.image_node_transforms[image_node_id] = {
                "layer_ids": list(layer_ids),
                "crop": crop,
                "rotate": rotate,
            }
        return [self._emit("image_node_transform.updated", {
            "image_node_id": image_node_id,
            "operationGraph": self._op_graph_payload(),
        })]

    # ---------------- mask mutations ----------------

    def add_mask(self, mask: MaskRecord) -> list[StateEvent]:
        """Append a mask and emit mask.created with full metadata + png bytes."""
        self.masks[mask.id] = mask
        return [self._emit("mask.created", {
            "mask_id": mask.id,
            "source": mask.source,
            "label": mask.label,
            "width": mask.width,
            "height": mask.height,
            "png_b64": mask.png_b64,
            "image_node_id": mask.image_node_id,
        })]

    def remove_mask(self, mask_id: str) -> list[StateEvent]:
        """Drop a mask and emit mask.deleted so the frontend can filter masks_index."""
        self.masks.pop(mask_id, None)
        return [self._emit("mask.deleted", {"mask_id": mask_id})]

    def rename_mask(self, mask_id: str, label: str) -> list[StateEvent]:
        """Update a mask's label in-place and emit mask.renamed."""
        mask = self.masks.get(mask_id)
        if mask is None:
            return []
        mask.label = label
        return [self._emit("mask.renamed", {"mask_id": mask_id, "label": label})]

    def emit_selection_changed(self, mask_id: str | None, state: str, label: str | None) -> list[StateEvent]:
        return [self._emit("selection.changed", {"mask_id": mask_id, "state": state, "label": label})]

    # ---------------- note mutations ----------------

    def emit_note_created(self, note: Note) -> list[StateEvent]:
        self.notes.append(note)
        return [self._emit("note.created", {"note_id": note.id})]
