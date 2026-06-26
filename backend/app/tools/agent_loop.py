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


_PROPOSE_TOOL_NAME = "propose_adjustment_widgets"

# The propose_adjustment_widgets tool the backend adds to the Anthropic tools
# list (the client tools come serialized from the frontend).
PROPOSE_ADJUSTMENT_TOOL = {
    "name": _PROPOSE_TOOL_NAME,
    "description": (
        "Propose a stack of adjustment widgets for an intent on a specific image "
        "node. Use after any structural setup (e.g. extracting an object). The "
        "widgets stream to the canvas; you get back a count."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "target_image_node_id": {"type": "string", "description": "Image node to edit."},
            "intent": {"type": "string", "description": "What to change, e.g. 'make it dramatic'."},
        },
        "required": ["target_image_node_id", "intent"],
    },
}


def _build_system(attached_objects: list[str]) -> str:
    base = (
        "You are an editing agent for a photo editor. Use the provided tools to "
        "fulfil the user's request. Call propose_adjustment_widgets to apply "
        "adjustments to an image node. Stop when the request is satisfied."
    )
    if attached_objects:
        base += (
            "\n\nThe user pinned these object/mask ids as context: "
            + ", ".join(attached_objects)
            + ". Prefer acting on them."
        )
    return base


def _json(obj: Any) -> str:
    import json
    return json.dumps(obj)


async def run_agent_turn(
    *,
    agent_step,
    sid: str,
    intent: str,
    attached_objects: list[str],
    client_tools: list[dict],
    node_layers: dict[str, list[str]],
    propose_fn,
    client_tool_fn,
    max_tool_calls: int = 10,
) -> dict[str, Any]:
    """Run the multi-turn Anthropic tool-use loop. Holds NO write-lock.

    - agent_step(system, messages, tools) -> response (one Anthropic turn)
    - propose_fn(target_image_node_id, intent) -> dict  (dispatch to propose_stack)
    - client_tool_fn(name, input) -> dict               (Plan 1 round-trip)
    """
    system = _build_system(attached_objects)
    tools = [*client_tools, PROPOSE_ADJUSTMENT_TOOL]
    messages: list[dict[str, Any]] = [{"role": "user", "content": intent}]
    tool_calls = 0

    while tool_calls < max_tool_calls:
        response = agent_step(system, messages, tools)
        if getattr(response, "stop_reason", None) != "tool_use":
            break

        # Record the assistant's tool_use turn verbatim so the follow-up
        # tool_result messages correlate.
        tool_uses = [b for b in response.content if getattr(b, "type", None) == "tool_use"]
        messages.append({
            "role": "assistant",
            "content": [
                {"type": "tool_use", "id": b.id, "name": b.name, "input": b.input}
                for b in tool_uses
            ],
        })

        results: list[dict[str, Any]] = []
        for block in tool_uses:
            tool_calls += 1
            if block.name == _PROPOSE_TOOL_NAME:
                node = (block.input or {}).get("target_image_node_id", "")
                layer_ids = node_layers.get(node)
                if layer_ids is None:
                    result = {"ok": False, "error": f"unknown image node {node!r}"}
                else:
                    result = await propose_fn(node, (block.input or {}).get("intent", intent))
            else:
                envelope = await client_tool_fn(block.name, block.input or {})
                # Unwrap the round-trip envelope: the tool's own return is under
                # `output`. Feed THAT to the LLM, and thread any new image node
                # so a later propose_adjustment_widgets can target it.
                output = envelope.get("output") if isinstance(envelope, dict) else None
                result = output if output is not None else envelope
                if isinstance(output, dict):
                    new_node = output.get("image_node_id")
                    new_layers = output.get("layer_ids")
                    if isinstance(new_node, str) and new_node and isinstance(new_layers, list):
                        node_layers[new_node] = new_layers
            results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": _json(result),
            })
            if tool_calls >= max_tool_calls:
                break

        messages.append({"role": "user", "content": results})

    return {"ok": True, "tool_calls": tool_calls}
