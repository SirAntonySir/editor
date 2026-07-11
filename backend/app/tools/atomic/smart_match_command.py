"""Palette typing-time smart-match — typing a query in Cmd+K may call this
tool when the deterministic synonym match is sparse. Returns 0..3 ranked
op/preset ids that fit BOTH the query and the current image's context.

Runs on the latency tier (Haiku 4.5 via AnthropicClient._fast_model). The
op + preset catalog and the image_context are sent as cache-ephemeral
blocks so every call after the first within a session is mostly cache-hit
— only the typed query is fresh. Output capped at 60 tokens.

Why an atomic tool and not a special endpoint:
- Sharing the BackendTool envelope keeps rate-limiting, permission gates
  (requires_image=True, requires_context=True), and error-envelope codes
  consistent with every other tool the frontend already calls.
- The catalog projection lives here (not in the AnthropicClient) so the
  ergonomics of the wire payload stay close to the consumer.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.api.deps import get_anthropic_client
from app.registry.loader import get_registry
from app.schemas._camel import camel_config
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument
from app.tools.base import BackendTool, ToolPermissions

# Hard cap on the number of picks the LLM may return. The palette UI shows
# a dense 1-line row per pick; more than this crowds out the deterministic
# section that already had primary hits.
_MAX_PICKS = 3


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    query: str = Field(min_length=1, max_length=200)


class _Pick(BaseModel):
    model_config = camel_config(extra="forbid")
    kind: Literal["op", "preset"]
    id: str
    reason: str


class _Output(BaseModel):
    model_config = camel_config(extra="forbid")
    picks: list[_Pick] = Field(default_factory=list)


def _op_catalog_entry(op) -> dict:
    """Tight per-op summary for the LLM — id, what it does, and its semantic
    tags (user-language synonyms). Description + typical_use intentionally
    compact: the catalog goes into a cached block, but we still pay for the
    first call."""
    return {
        "id": op.id,
        "category": op.category,
        "summary": op.llm.description,
        "tags": op.llm.semantic_tags,
    }


def _preset_catalog_entry(p) -> dict:
    return {
        "id": p.id,
        "summary": p.description,
        "tags": p.semantic_tags,
    }


class SmartMatchCommandTool(BackendTool[_Input, _Output]):
    name = "smart_match_command"
    kind = "query"
    description = (
        "Rank op/preset ids that fit a typed palette query AND the current "
        "image. Returns 0..3 picks. Fast tier; cache-friendly."
    )
    input_schema = _Input
    output_schema = _Output
    # Context is required: the whole point is to bias picks by the image.
    # Frontend keeps the call gated until `analyze_context` has run anyway.
    permissions = ToolPermissions(requires_image=True, requires_context=True)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        registry = get_registry()
        ops_catalog = [_op_catalog_entry(op) for op in registry.ops.values()]
        presets_catalog = [_preset_catalog_entry(p) for p in registry.presets.values()]

        # Slim the context to the fields the LLM can act on — drop
        # mask_png_base64, paths, and the 256-bin histograms. The smart-
        # match call is debounced to fire on each typing pause, so every
        # token shipped uncached compounds across keystrokes.
        from app.services.llm_context import image_context_for_llm
        ctx = doc.get_image_context(DEFAULT_IMAGE_NODE_ID)
        ctx_dict = image_context_for_llm(
            ctx.model_dump(mode="json", by_alias=True) if ctx is not None else None,
        )

        picks_raw = get_anthropic_client().smart_match(
            query=input.query,
            image_context=ctx_dict,
            ops_catalog=ops_catalog,
            presets_catalog=presets_catalog,
            max_picks=_MAX_PICKS,
            session_id=doc.session_id,
        )

        # Filter out picks whose id isn't actually in the registry — Claude
        # occasionally hallucinates a near-miss id. Better to drop silently
        # than surface a row that can't be executed.
        op_ids = set(registry.ops.keys())
        preset_ids = set(registry.presets.keys())
        out_picks: list[_Pick] = []
        for p in picks_raw:
            kind = p.get("kind")
            pid = p.get("id", "")
            if kind == "op" and pid in op_ids:
                out_picks.append(_Pick(kind="op", id=pid, reason=p.get("reason", "")))
            elif kind == "preset" and pid in preset_ids:
                out_picks.append(_Pick(kind="preset", id=pid, reason=p.get("reason", "")))
        return _Output(picks=out_picks)
