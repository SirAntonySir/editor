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
        message = envelope.error.message if envelope.error is not None else ""
        return {"ok": False, "error": message or "propose_stack failed"}
    widgets = (envelope.output or {}).get("widgets", [])
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


def _build_system(
    attached_objects: list[str],
    node_ids: list[str],
    forced_targets: list[str] | None = None,
) -> str:
    forced_targets = forced_targets or []
    targets = ", ".join(node_ids) if node_ids else "the active image node"
    base = (
        "You are an editing agent for a photo editor. The user gives an editing "
        "request; you fulfil it by CALLING TOOLS, not by replying in prose.\n\n"
        "To apply any tonal/colour adjustment (contrast, warmth, exposure, mood, "
        "etc.) you MUST call propose_adjustment_widgets with target_image_node_id "
        f"set to an existing node id ({targets}) and a short intent describing the "
        "change. To put an object on its own layer first, call "
        "copy_object_to_image_node, then propose_adjustment_widgets on the "
        "image_node_id it returns. Do not stop until you have called at least one "
        "tool that satisfies the request."
    )
    if forced_targets:
        ids = ", ".join(forced_targets)
        base += (
            "\n\nThe user selected one or more regions, and they have ALREADY been "
            f"extracted onto their own image nodes: {ids}. You MUST apply the "
            "request by calling propose_adjustment_widgets on EACH of these node "
            "ids. Do NOT call copy_object_to_image_node again for them, and do "
            "NOT apply the adjustment to the whole/original image — only to these "
            "extracted target nodes."
        )
    elif attached_objects:
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
    forced_targets: list[str] | None = None,
    image_context: dict | None = None,
    max_tool_calls: int = 10,
) -> dict[str, Any]:
    """Run the multi-turn Anthropic tool-use loop. Holds NO write-lock.

    - agent_step(system, messages, tools) -> response (one Anthropic turn)
    - propose_fn(target_image_node_id, intent) -> dict  (dispatch to propose_stack)
    - client_tool_fn(name, input) -> dict               (Plan 1 round-trip)
    """
    system = _build_system(attached_objects, list(node_layers.keys()), forced_targets)
    tools = [*client_tools, PROPOSE_ADJUSTMENT_TOOL]
    opening = intent
    if image_context:
        opening = f"Image context:\n{_json(image_context)}\n\nRequest: {intent}"
    messages: list[dict[str, Any]] = [{"role": "user", "content": opening}]
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
