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
            "layer_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Optional subset of the target node's layers to scope this "
                    "proposal to. Omit to affect the whole node. Pass the id(s) of "
                    "the specific labelled layer(s) when the request describes "
                    "different edits for different regions on one node."
                ),
            },
        },
        "required": ["target_image_node_id", "intent"],
    },
}


def _build_system(
    attached_objects: list[str],
    node_ids: list[str],
    forced_targets: list[str] | None = None,
    references: list[dict] | None = None,
    node_layers: dict[str, list[str]] | None = None,
    layer_labels: dict[str, str] | None = None,
) -> str:
    forced_targets = forced_targets or []
    references = references or []
    node_layers = node_layers or {}
    layer_labels = layer_labels or {}
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
        lines = []
        for nid in forced_targets:
            layers = node_layers.get(nid, [])
            if layers:
                labelled = ", ".join(
                    f"{lid} ('{layer_labels[lid]}')" if lid in layer_labels else lid
                    for lid in layers
                )
                lines.append(f"  - {nid} (layers: {labelled})")
            else:
                lines.append(f"  - {nid}")
        base += (
            "\n\nThe user selected one or more regions, and they have ALREADY been "
            "extracted onto their own image nodes/layers:\n"
            + "\n".join(lines)
            + "\nYou MUST apply the request by calling propose_adjustment_widgets on "
            "EACH of these targets. When the request describes DIFFERENT edits for "
            "different regions and a node lists multiple labelled layers, pass "
            "layer_ids to scope each proposal to only the matching layer(s); omit "
            "layer_ids to affect the whole node. Do NOT call copy_object_to_image_node "
            "again for them, and do NOT apply the adjustment to the whole/original "
            "image — only to these extracted targets."
        )
    elif attached_objects:
        base += (
            "\n\nThe user pinned these object/mask ids as context: "
            + ", ".join(attached_objects)
            + ". Prefer acting on them."
        )
    if references:
        lines = "\n".join(
            f"  - {r.get('image_node_id')}: {r.get('summary', '')}" for r in references
        )
        base += (
            "\n\nThe following image nodes are REFERENCES, not targets — the user "
            "wants the target to LOOK LIKE them. You MUST NOT edit these nodes "
            "(never call propose_adjustment_widgets or copy_object_to_image_node "
            "with their ids). Use their appearance summaries to choose the "
            "adjustments you apply to the TARGET (e.g. shift the target's white "
            "balance and exposure toward the reference's cast / white point / "
            "median luma):\n" + lines
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
    references: list[dict] | None = None,
    layer_labels: dict[str, str] | None = None,
    image_context: dict | None = None,
    max_tool_calls: int = 10,
) -> dict[str, Any]:
    """Run the multi-turn Anthropic tool-use loop. Holds NO write-lock.

    - agent_step(system, messages, tools) -> response (one Anthropic turn)
    - propose_fn(target_image_node_id, intent, layer_ids) -> dict  (dispatch to propose_stack)
    - client_tool_fn(name, input) -> dict               (Plan 1 round-trip)
    - references: appearance summaries of read-only reference nodes (match, don't edit)
    - layer_labels: layer id → human name, surfaced so the model can scope by layer
    """
    system = _build_system(
        attached_objects, list(node_layers.keys()), forced_targets, references,
        node_layers=node_layers, layer_labels=layer_labels,
    )
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
                node_intent = (block.input or {}).get("intent", intent)
                known = node_layers.get(node)
                requested = (block.input or {}).get("layer_ids")
                if known is None:
                    result = {"ok": False, "error": f"unknown image node {node!r}"}
                elif isinstance(requested, list) and requested:
                    # Scope to the requested layers, dropping any that don't
                    # belong to this node. All-invalid → reject (don't silently
                    # widen to the whole node, which is the bug this guards).
                    scoped = [lid for lid in requested if lid in known]
                    if scoped:
                        result = await propose_fn(node, node_intent, scoped)
                    else:
                        result = {"ok": False, "error": f"layer_ids {requested!r} are not layers of {node!r}"}
                else:
                    result = await propose_fn(node, node_intent, list(known))
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
