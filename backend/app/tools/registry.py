from __future__ import annotations

import asyncio
from typing import Literal

from pydantic import ValidationError

from app.config import get_app_config
from app.schemas.errors import ToolError, ToolResponseEnvelope
from app.services.session_store import SessionNotFound, SessionStore
from app.state.active_doc import reset_active_doc, set_active_doc
from app.state.events import EventBus
from app.tools.base import BackendTool

# Tools that bootstrap a new session — registry skips session resolution for these.
_BOOTSTRAP_TOOLS = {"create_session"}


def _compute_affected_widget_ids(before, after, parsed) -> list[str]:
    """Which widgets a user-action mutation touched, for per-widget history
    tagging. Two sources, in priority order:

      1. A `widget_id` on the parsed tool input (set_widget_param, refine_widget,
         accept/delete/restore_widget) — the authoritative target.
      2. A before/after diff of widget node params — catches tools that mutate
         widgets without naming one on input (widget creation, fused expansion)
         and any widget whose params changed as a side effect.

    `before`/`after` are app.session.history.Snapshot instances. Order is
    stable: the input's widget_id (if any) first, then diffed ids in iteration
    order, de-duplicated."""
    ids: list[str] = []
    seen: set[str] = set()

    wid = getattr(parsed, "widget_id", None)
    if isinstance(wid, str) and wid:
        ids.append(wid)
        seen.add(wid)

    all_ids = set(before.widgets) | set(after.widgets)
    bparams = before.extract_widget_params(list(all_ids))
    aparams = after.extract_widget_params(list(all_ids))
    for w in all_ids:
        if w in seen:
            continue
        if bparams.get(w) != aparams.get(w):
            ids.append(w)
            seen.add(w)
    return ids


def _err(code: str, message: str, retryable: bool = False, recovery_hint: str | None = None) -> ToolResponseEnvelope:
    return ToolResponseEnvelope(
        ok=False,
        error=ToolError(code=code, message=message, retryable=retryable, recovery_hint=recovery_hint),
    )


def _classify_exception(exc: Exception) -> ToolResponseEnvelope | None:
    """Map well-known exception subclass names to typed envelope errors.
    Returns None if the exception is not a registry-mapped one (caller
    should fall through to internal_error)."""
    if isinstance(exc, KeyError):
        ex_name = exc.__class__.__name__
        code = "unknown_widget"
        if ex_name == "_UnknownRegion":
            code = "unknown_region"
        elif ex_name == "_UnknownMask":
            code = "unknown_mask"
        elif ex_name == "_OrphanBinding":
            code = "orphan_binding"
        elif ex_name == "_ScopeUnresolvable":
            code = "scope_unresolvable"
        elif ex_name == "_FusedToolNotFound":
            code = "fused_tool_not_found"
        return _err(code, str(exc), retryable=False)
    cls_name = exc.__class__.__name__
    if cls_name == "_WidgetDismissed":
        return _err(
            "widget_dismissed", str(exc), retryable=False,
            recovery_hint="the widget was already closed — refetch the snapshot to resync",
        )
    if cls_name == "_SamFailed":
        return _err("sam_failed", str(exc), retryable=False)
    if cls_name == "_InvalidInput":
        return _err("invalid_input", str(exc), retryable=False)
    if cls_name == "_MissingContext":
        return _err("missing_context", str(exc), retryable=True, recovery_hint="call prepare_image then analyze_context")
    if cls_name == "_ProposalFailed":
        return _err("proposal_failed", str(exc), retryable=True, recovery_hint="rephrase the prompt and try again")
    return None


class BackendToolRegistry:
    def __init__(self, store: SessionStore, event_bus: EventBus) -> None:
        self._tools: dict[str, BackendTool] = {}
        self._store = store
        self._bus = event_bus

    @property
    def store(self) -> SessionStore:
        """Session store, exposed for tools that schedule background work
        (genfill) and must re-acquire the document lock after their handler
        returned."""
        return self._store

    @property
    def bus(self) -> EventBus:
        return self._bus

    # ---------------- registration ----------------

    def register(self, tool: BackendTool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"duplicate registration: {tool.name}")
        self._tools[tool.name] = tool

    def get(self, name: str) -> BackendTool:
        return self._tools[name]

    def list_for(self, transport: Literal["mcp", "rest"]) -> list[BackendTool]:
        attr = "expose_mcp" if transport == "mcp" else "expose_rest"
        return [t for t in self._tools.values() if getattr(t.permissions, attr)]

    # ---------------- invocation ----------------

    async def invoke(self, name: str, session_id: str, raw_input: dict) -> ToolResponseEnvelope:
        tool = self._tools.get(name)
        if tool is None:
            return _err("unknown_tool", f"no tool registered with name {name!r}")

        # Validate input
        try:
            parsed = tool.input_schema.model_validate(raw_input)
        except ValidationError as e:
            return _err("invalid_input", str(e), retryable=False)

        # Bootstrap-only path: skip session resolution + use a transient empty doc.
        if tool.name in _BOOTSTRAP_TOOLS:
            from app.state.document import SessionDocument
            doc = SessionDocument(session_id="", image_bytes=b"", mime_type="")
            try:
                output = await tool.handler(doc, parsed)
            except Exception as exc:
                return _err("internal_error", repr(exc), retryable=False)
            return ToolResponseEnvelope(ok=True, output=output.model_dump(mode="json", by_alias=True))

        # Resolve session
        try:
            record = self._store.get(session_id)
        except SessionNotFound:
            return _err(
                "missing_session",
                f"session {session_id} not found or expired",
                retryable=False,
            )

        # Permission checks
        if tool.permissions.requires_image and not record.image_bytes:
            return _err("missing_image", "session has no image", retryable=False)
        if tool.permissions.requires_context and record.context is None:
            return _err(
                "missing_context",
                "call prepare_image then analyze_context first",
                retryable=True,
                recovery_hint="call prepare_image then analyze_context",
            )

        # Acquire write lock for mutate/emit; query tools take no lock.
        if tool.kind in {"mutate", "emit"}:
            async with self._store.with_document_lock(session_id) as doc:
                # Stream events live as the handler emits them, rather than
                # flushing in one burst once it returns. Critical for
                # long-running handlers (analyze_context) whose progress stepper
                # would otherwise jump straight to done.
                doc._event_sink = lambda ev: self._bus.publish(session_id, ev)
                # Make the doc visible to deep call sites (anthropic_client
                # _log_cache_stats → mcp.usage events).
                doc_token = set_active_doc(doc)
                # Register the running task so POST /sessions/{sid}/cancel can
                # interrupt it. Only mutate/emit tools are cancellable — query
                # tools complete fast and aren't worth the bookkeeping.
                self._store.register_task(session_id, asyncio.current_task())
                # Phase 3: capture pre-state Snapshot for the history engine
                # when the tool advertises itself as a user-action. We do this
                # BEFORE the handler runs so a failed mutation doesn't poison
                # the undo stack.
                history_before = None
                if tool.is_user_action:
                    from app.session.history import Snapshot
                    history_before = Snapshot.capture(doc)
                try:
                    output = await tool.handler(doc, parsed)
                except asyncio.CancelledError:
                    # User-initiated cancel via the cancel endpoint. Emit a
                    # phase.cancelled event before re-raising so the frontend
                    # status bar can clear its in-progress state. Re-raise so
                    # FastAPI sees the cancellation.
                    try:
                        doc._emit_phase_cancelled()
                    except Exception:
                        pass
                    self._flush_history_to_bus(doc, session_id)
                    raise
                except Exception as exc:
                    classified = _classify_exception(exc)
                    if classified is not None:
                        return classified
                    return _err("internal_error", repr(exc), retryable=False)
                finally:
                    self._store.clear_task(session_id)
                    reset_active_doc(doc_token)
                    doc._event_sink = None
                # Push the undo entry only on a successful user-action handler.
                # Cancelled or errored handlers re-raise or short-circuit before
                # this point — see the early-return branches above.
                if history_before is not None:
                    from app.session.history import Snapshot
                    after = Snapshot.capture(doc)
                    cfg = get_app_config().runtime
                    affected = _compute_affected_widget_ids(history_before, after, parsed)
                    self._store.get_history(session_id).push(
                        label=tool.history_label(parsed, output),
                        before=history_before,
                        after=after,
                        affected_widget_ids=affected,
                        widget_params_before=history_before.extract_widget_params(affected),
                        widget_params_after=after.extract_widget_params(affected),
                        coalesce_key=tool.coalesce_key(parsed),
                        coalesce_window_s=cfg.history_coalesce_window_ms / 1000.0,
                    )
                self._flush_history_to_bus(doc, session_id)
        else:
            doc = self._store.get_document(session_id)
            try:
                output = await tool.handler(doc, parsed)
            except Exception as exc:
                classified = _classify_exception(exc)
                if classified is not None:
                    return classified
                return _err("internal_error", repr(exc), retryable=False)

        # Stamp the post-call document revision so the frontend can use any
        # tool response as an SSE-liveness probe (see ToolResponseEnvelope).
        return ToolResponseEnvelope(
            ok=True,
            output=output.model_dump(mode="json", by_alias=True),
            revision=doc.revision,
        )

    # ---------------- internals ----------------

    def _flush_history_to_bus(self, doc, session_id: str) -> None:
        """Publish any history entries that haven't been published yet, prune
        the event log to the configured history cap, GC dismissed widgets
        whose dismissal aged past the log floor, then mark the session
        dirty for the next checkpointer tick.

        Order matters:
          1. publish — never drop an unpublished event
          2. prune — keep the persisted doc small
          3. gc dismissed — hard-delete widgets whose dismissal scrolled off
          4. mark dirty — flush the post-cleanup state to disk
        """
        last_idx = doc._published_idx
        for ev in doc.history[last_idx:]:
            self._bus.publish(session_id, ev)
        doc._published_idx = len(doc.history)
        doc.prune_history(get_app_config().runtime.history_max_entries)
        doc.gc_dismissed_widgets()
        self._store.checkpointer.mark_dirty(doc)
