"""AskAboutImageTool — the palette Ask-mode tool.

Tool-level contract:
  - Permissions: requires_image=True, requires_context=True, REST-only.
  - Editor-state summary captures touched widgets + active mask label.
  - Attached chips ride through to the LLM call.
  - The markdown response round-trips on the output envelope.

The Anthropic call is patched. A separate unit on
`AnthropicClient.ask_about_image` covers the prompt-shape side.
"""
from __future__ import annotations

from typing import Any

import pytest

from app.api import deps
from app.tools.atomic.ask_about_image import AskAboutImageTool


@pytest.fixture
def tool() -> AskAboutImageTool:
    return AskAboutImageTool()


@pytest.fixture
def patched_client(monkeypatch):
    captured: dict[str, Any] = {}

    def _fake_ask(**kwargs):
        captured.update(kwargs)
        return captured.get("_response", "# Answer\n\nLooks good.")

    client = deps.get_anthropic_client()
    monkeypatch.setattr(client, "ask_about_image", _fake_ask)
    return captured


def test_permissions(tool) -> None:
    """Ask requires image + completed analyze. It's REST-only — the LLM
    never reaches this through MCP because Ask is a human flow."""
    assert tool.permissions.requires_image is True
    assert tool.permissions.requires_context is True
    assert tool.permissions.expose_mcp is False
    assert tool.permissions.expose_rest is True


def test_input_rejects_empty_query(tool) -> None:
    """Pydantic min_length=1 catches a stale debounced timer that fires
    on an empty input. Same guard pattern as smart_match."""
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        tool.input_schema(query="")


@pytest.mark.asyncio
async def test_returns_markdown_envelope(tool, make_doc, patched_client) -> None:
    doc = make_doc(with_image_context=True)
    patched_client["_response"] = "## Lighting\n\nFlat and overcast."
    out = await tool.handler(doc, tool.input_schema(query="what's the lighting like?"))
    assert out.markdown == "## Lighting\n\nFlat and overcast."
    assert patched_client["query"] == "what's the lighting like?"


@pytest.mark.asyncio
async def test_passes_image_context_to_client(
    tool, make_doc, patched_client,
) -> None:
    """The slim image_context block is the cache-friendly grounding signal —
    same role it plays in smart_match. Must reach the client call."""
    doc = make_doc(with_image_context=True)
    await tool.handler(doc, tool.input_schema(query="why is the mood neutral?"))
    assert patched_client["image_context"] is not None
    assert "subjects" in patched_client["image_context"]


@pytest.mark.asyncio
async def test_passes_attached_chips_through(
    tool, make_doc, patched_client,
) -> None:
    """Chips the user dropped onto Cmd+K are the conversational anchor — the
    same plumbing the Agent flow uses. They land in the LLM call as a
    typed list of {label, value, source_id?} dicts."""
    doc = make_doc(with_image_context=True)
    chips = [
        {"label": "Median luma", "value": "0.42"},
        {"label": "Region", "value": "sky", "sourceId": "mech:sky_luma"},
    ]
    await tool.handler(
        doc,
        tool.input_schema(query="explain the cast", attached_chips=chips),
    )
    sent = patched_client["attached_chips"]
    assert isinstance(sent, list) and len(sent) == 2
    # Wire shape is camelCase via the schema alias generator.
    assert sent[0]["label"] == "Median luma"
    assert sent[1]["sourceId"] == "mech:sky_luma"


@pytest.mark.asyncio
async def test_editor_state_summary_empty_when_no_widgets(
    tool, make_doc, patched_client,
) -> None:
    """A clean session emits an empty active_widgets list — the LLM sees
    the user hasn't started editing yet."""
    doc = make_doc(with_image_context=True)
    await tool.handler(doc, tool.input_schema(query="anything to fix?"))
    state = patched_client["editor_state"]
    assert state["active_widgets"] == []
    assert state["active_widgets_truncated"] == 0
    assert state["active_mask_label"] is None
