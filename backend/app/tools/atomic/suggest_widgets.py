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
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument
from app.tools.base import BackendTool, ToolPermissions

# Recency dedup window. After a successful suggest_widgets run, further
# invocations on the same session within this window no-op. Catches the
# audit-H11 cases — a double-clicked "Analyze with AI" button, rapid
# SSE-storm retriggers, frontend chained-then race — without spending
# another full Anthropic round-trip per fused-template resolver. The
# write_lock already serialises the handler, but it can't tell whether
# the queued work is redundant; this check can.
#
# Module-level dict keyed by session_id. Stale entries are GC'd
# opportunistically below: on every check we drop any entry older than
# 10× the cooldown so abandoned sessions don't pile up.
_SUGGEST_COOLDOWN_S = 5.0
_last_run_ts: dict[str, float] = {}


def _recent_run(sid: str, now: float) -> bool:
    """True iff a successful suggest_widgets ran for `sid` within
    `_SUGGEST_COOLDOWN_S`. Also GCs stale entries opportunistically."""
    stale_cutoff = now - 10 * _SUGGEST_COOLDOWN_S
    for k in list(_last_run_ts.keys()):
        if _last_run_ts[k] < stale_cutoff:
            _last_run_ts.pop(k, None)
    last = _last_run_ts.get(sid)
    return last is not None and (now - last) < _SUGGEST_COOLDOWN_S


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    layer_id: str = "legacy"
    # Object-mode (suggest on an extracted cutout): mint only problems whose
    # region matches this label, scoped global — the cutout IS the region.
    object_label: str | None = None


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
        # In-flight / recency guard. Drops back-to-back invocations within
        # the cooldown window so a double-clicked CTA or SSE-storm retrigger
        # doesn't bill another fan-out of Anthropic resolvers.
        now = time.monotonic()
        if _recent_run(doc.session_id, now):
            doc._emit_phase_started("widget_mint", index=5, total=5)
            doc._emit_phase_completed("widget_mint", duration_ms=0)
            return _Output(widget_ids=[])

        ctx = doc.get_image_context(DEFAULT_IMAGE_NODE_ID)
        if not isinstance(ctx, EnrichedImageContext):
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
                doc, ctx, client, input.layer_id, object_label=input.object_label,
            )
        finally:
            duration_ms = (time.monotonic_ns() // 1_000_000) - started_ms
            doc._emit_phase_completed("widget_mint", duration_ms=duration_ms)
        _last_run_ts[doc.session_id] = time.monotonic()
        after = set(doc.widgets.keys())
        return _Output(widget_ids=sorted(after - before))
