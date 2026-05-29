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


class SessionDocument(BaseModel):
    """Authoritative per-session state. Owns widgets, masks, dismissals,
    notes, image context and an event log. All mutations bump `revision`
    and return the StateEvents they emitted."""

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    session_id: str
    image_bytes: bytes = b""
    mime_type: str = "image/jpeg"
    image_context: ImageContext | None = None
    masks: dict[str, MaskRecord] = Field(default_factory=dict)
    active_mask_id: str | None = None
    committed_mask_id: str | None = None
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

    def _emit_phase_started(self, phase: str, *, index: int, total: int) -> StateEvent:
        """Convenience for the analyze pipeline's phase tracking."""
        return self._emit("phase.started", {"phase": phase, "index": index, "total": total})

    def _emit_phase_progress(self, phase: str, *, done: int, total: int) -> StateEvent:
        """For phases with internal sub-counts (currently only mask_precompute)."""
        return self._emit("phase.progress", {"phase": phase, "done": done, "total": total})

    def _emit_phase_completed(self, phase: str, *, duration_ms: int) -> StateEvent:
        """Convenience for the analyze pipeline's phase tracking."""
        return self._emit("phase.completed", {"phase": phase, "duration_ms": duration_ms})

    # ---------------- widget mutations ----------------

    def add_widget(self, widget: Widget) -> list[StateEvent]:
        if widget.id in self.widgets:
            raise KeyError(f"widget {widget.id} already exists")
        self.widgets[widget.id] = widget
        self.widget_order.append(widget.id)
        return [self._emit("widget.created", {"widget": widget.model_dump(mode="json")})]

    def update_widget(self, widget: Widget) -> list[StateEvent]:
        if widget.id not in self.widgets:
            raise KeyError(widget.id)
        widget.updated_at = datetime.now(timezone.utc)
        self.widgets[widget.id] = widget
        return [self._emit("widget.updated", {"widget": widget.model_dump(mode="json")})]

    def dismiss_widget(self, widget_id: str, rule: DismissalRule | None = None) -> list[StateEvent]:
        if widget_id not in self.widgets:
            raise KeyError(widget_id)
        w = self.widgets[widget_id]
        w.status = "dismissed"
        w.updated_at = datetime.now(timezone.utc)
        events = [self._emit("widget.deleted", {"widget_id": widget_id})]
        if rule is not None:
            self.dismissals.append(rule)
            events.append(self._emit("dismissal.added", {"rule": rule.model_dump(mode="json")}))
        return events

    def restore_widget(self, widget_id: str) -> list[StateEvent]:
        if widget_id not in self.widgets:
            raise KeyError(widget_id)
        w = self.widgets[widget_id]
        w.status = "active"
        w.updated_at = datetime.now(timezone.utc)
        self.dismissals = [r for r in self.dismissals if r.source_widget_id != widget_id]
        return [self._emit("widget.restored", {"widget_id": widget_id})]

    def accept_widget(self, widget_id: str) -> list[StateEvent]:
        if widget_id not in self.widgets:
            raise KeyError(widget_id)
        w = self.widgets[widget_id]
        w.status = "accepted"
        w.updated_at = datetime.now(timezone.utc)
        return [self._emit("widget.accepted", {"widget_id": widget_id})]

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
        })]

    def emit_selection_changed(self, mask_id: str | None, state: str, label: str | None) -> list[StateEvent]:
        return [self._emit("selection.changed", {"mask_id": mask_id, "state": state, "label": label})]

    # ---------------- note mutations ----------------

    def emit_note_created(self, note: Note) -> list[StateEvent]:
        self.notes.append(note)
        return [self._emit("note.created", {"note_id": note.id})]
