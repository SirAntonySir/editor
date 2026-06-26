"""Agentic palette turn: a multi-turn Anthropic tool-use loop.

The orchestrator (run_agent_turn) holds NO session write-lock — it dispatches
sub-mutations INTO registry.invoke (which acquires the lock per call) and client
tools into request_client_tool (no lock). This avoids the deadlock that would
occur if the loop ran inside one long-held lock.

propose_adjustment_widgets is not a separate tool: it builds an image_node
scope and reuses the existing propose_stack tool wholesale.
"""

from __future__ import annotations

from typing import Any


async def dispatch_propose_adjustment(
    registry: Any,
    sid: str,
    *,
    target_image_node_id: str,
    layer_ids: list[str],
    intent: str,
) -> dict[str, Any]:
    """Propose adjustment widgets on a specific image node by invoking the
    existing propose_stack tool with an image_node scope. Returns a compact
    result for the LLM (full widget JSON streams to the client via SSE)."""
    scope = {"kind": "image_node", "image_node_id": target_image_node_id, "layer_ids": layer_ids}
    envelope = await registry.invoke(
        "propose_stack",
        sid,
        {"intent": intent, "scope": scope, "origin": "mcp_user_prompt", "prompt": intent},
    )
    if not envelope.ok:
        message = ""
        if isinstance(envelope.error, dict):
            message = envelope.error.get("message", "")
        return {"ok": False, "error": message or "propose_stack failed"}
    widgets = (envelope.data or {}).get("widgets", []) if isinstance(envelope.data, dict) else []
    return {"ok": True, "widget_count": len(widgets)}
