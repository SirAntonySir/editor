from __future__ import annotations

from typing import Literal

from pydantic import ValidationError

from app.schemas.errors import ToolError, ToolResponseEnvelope
from app.services.session_store import SessionNotFound, SessionStore
from app.state.events import EventBus
from app.tools.base import BackendTool


def _err(code: str, message: str, retryable: bool = False, recovery_hint: str | None = None) -> ToolResponseEnvelope:
    return ToolResponseEnvelope(
        ok=False,
        error=ToolError(code=code, message=message, retryable=retryable, recovery_hint=recovery_hint),
    )


class BackendToolRegistry:
    def __init__(self, store: SessionStore, event_bus: EventBus) -> None:
        self._tools: dict[str, BackendTool] = {}
        self._store = store
        self._bus = event_bus

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
                "call analyze_image first",
                retryable=True,
                recovery_hint="call analyze_image",
            )

        # Acquire write lock for mutate/emit; query tools take no lock.
        if tool.kind in {"mutate", "emit"}:
            with self._store.with_document_lock(session_id) as doc:
                try:
                    output = await tool.handler(doc, parsed)
                except KeyError as exc:
                    ex_name = exc.__class__.__name__
                    code = "unknown_widget"
                    if ex_name == "_UnknownRegion":
                        code = "unknown_region"
                    elif ex_name == "_UnknownMask":
                        code = "unknown_mask"
                    elif ex_name == "_ScopeUnresolvable":
                        code = "scope_unresolvable"
                    return _err(code, str(exc), retryable=False)
                except Exception as exc:
                    return _err("internal_error", repr(exc), retryable=False)
                self._flush_history_to_bus(doc, session_id)
        else:
            doc = self._store.get_document(session_id)
            try:
                output = await tool.handler(doc, parsed)
            except KeyError as exc:
                ex_name = exc.__class__.__name__
                code = "unknown_widget"
                if ex_name == "_UnknownRegion":
                    code = "unknown_region"
                elif ex_name == "_UnknownMask":
                    code = "unknown_mask"
                elif ex_name == "_ScopeUnresolvable":
                    code = "scope_unresolvable"
                return _err(code, str(exc), retryable=False)
            except Exception as exc:
                return _err("internal_error", repr(exc), retryable=False)

        return ToolResponseEnvelope(ok=True, output=output.model_dump(mode="json"))

    # ---------------- internals ----------------

    def _flush_history_to_bus(self, doc, session_id: str) -> None:
        """Publish any history entries that haven't been published yet.

        We track the last-published index on the document via a runtime attribute.
        Uses object.__setattr__ to bypass Pydantic's extra="forbid" validation."""
        last_idx: int = getattr(doc, "_published_idx", 0)
        for ev in doc.history[last_idx:]:
            self._bus.publish(session_id, ev)
        object.__setattr__(doc, "_published_idx", len(doc.history))
