"""suggest_widgets MCP tool — Claude suggest_fused + N × resolve_fused.

The previous mega-tool ran this synchronously at the end of analyze_image,
blocking the user-visible return. As a standalone tool the frontend can
fire-and-forget it: analyze_context returns what the user is actually
waiting for; widget suggestions can arrive asynchronously via SSE.
"""

from __future__ import annotations

import time

from pydantic import BaseModel

from app.api import deps
from app.schemas._camel import camel_config
from app.schemas.enriched_context import EnrichedImageContext
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    layer_id: str = "legacy"


class _Output(BaseModel):
    model_config = camel_config(extra="forbid")
    widget_ids: list[str]


class SuggestWidgetsTool(BackendTool[_Input, _Output]):
    name = "suggest_widgets"
    kind = "mutate"
    description = (
        "Pick fused tools that fit the current grade character, resolve each "
        "in parallel, and mint a Widget per resolved suggestion. Streams "
        "widget.created SSE events as each completes."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=True)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        if not isinstance(doc.image_context, EnrichedImageContext):
            # No context → no suggestions. Still emit the widget_mint phase so
            # the frontend status bar can resolve to "complete" instead of
            # spinning forever on a no-op call.
            doc._emit_phase_started("widget_mint", index=5, total=5)
            doc._emit_phase_completed("widget_mint", duration_ms=0)
            return _Output(widget_ids=[])
        from app.services.autonomous_suggestions import mint_autonomous_suggestions

        client = deps.get_anthropic_client()
        # widget_mint is the terminal analyze phase. The frontend flips
        # `mcpAnalyzeComplete` on its completion event and dismisses the
        # BackendStatusBar after a brief "Analysis complete" hold. Without
        # these emits the status pill spins forever after suggestions land.
        doc._emit_phase_started("widget_mint", index=5, total=5)
        started_ms = time.monotonic_ns() // 1_000_000
        before = set(doc.widgets.keys())
        try:
            await mint_autonomous_suggestions(
                doc, doc.image_context, client, input.layer_id,
            )
        finally:
            duration_ms = (time.monotonic_ns() // 1_000_000) - started_ms
            doc._emit_phase_completed("widget_mint", duration_ms=duration_ms)
        after = set(doc.widgets.keys())
        return _Output(widget_ids=sorted(after - before))
