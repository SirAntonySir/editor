"""SmartMatchCommandTool — the palette typing-time matcher.

These tests focus on the *tool-level* contract:

  - Permission gate (`requires_image=True`, `requires_context=True`).
  - Catalog projection passes ops + presets into the AnthropicClient call.
  - Output is filtered against the live registry — hallucinated ids drop.
  - Empty `picks` from the client → empty `picks` on the wire (the
    frontend keeps the deterministic section visible in that case).

The Anthropic call itself is monkeypatched. There's a separate unit on
`AnthropicClient.smart_match` for the prompt-shape / cache-block parts.
"""
from __future__ import annotations

from typing import Any

import pytest

from app.api import deps
from app.tools.atomic.smart_match_command import SmartMatchCommandTool


@pytest.fixture
def tool() -> SmartMatchCommandTool:
    return SmartMatchCommandTool()


@pytest.fixture
def patched_client(monkeypatch):
    """Monkeypatch the singleton anthropic client's `smart_match` so the
    test can assert what was sent and stub the response."""
    captured: dict[str, Any] = {}

    def _fake_smart_match(**kwargs):
        captured.update(kwargs)
        return captured.get("_response", [])

    client = deps.get_anthropic_client()
    monkeypatch.setattr(client, "smart_match", _fake_smart_match)
    return captured


def test_permissions(tool) -> None:
    """Smart-match requires both an image AND completed analyze. Without
    image_context there's nothing to bias picks by, so the LLM call would
    just consume tokens to return generic guesses."""
    assert tool.permissions.requires_image is True
    assert tool.permissions.requires_context is True


@pytest.mark.asyncio
async def test_input_rejects_empty_query(tool, make_doc) -> None:
    """A 0-length query bypasses the Pydantic min_length=1 guard. Without
    this the frontend's 4-char gate could be bypassed by a stale debounced
    timer and burn tokens on an empty prompt."""
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        tool.input_schema(query="")


@pytest.mark.asyncio
async def test_returns_picks_with_catalog_in_prompt(
    tool, make_doc, patched_client,
) -> None:
    """The Anthropic call receives ops + presets catalogs and the typed
    query, and the picks come back through the output envelope."""
    doc = make_doc(with_image_context=True)
    patched_client["_response"] = [
        {"kind": "op", "id": "kelvin", "reason": "warmth fits 'warm'"},
        {"kind": "preset", "id": "warm_grade", "reason": "matches mood"},
    ]
    out = await tool.handler(doc, tool.input_schema(query="make it warmer"))
    ids = [(p.kind, p.id) for p in out.picks]
    assert ("op", "kelvin") in ids
    # The preset id is registry-dependent; just assert at least one survives.
    assert len(out.picks) >= 1
    # Catalog was passed to the LLM call.
    assert patched_client["query"] == "make it warmer"
    assert isinstance(patched_client["ops_catalog"], list)
    assert any(e["id"] == "kelvin" for e in patched_client["ops_catalog"])


@pytest.mark.asyncio
async def test_drops_hallucinated_ids(tool, make_doc, patched_client) -> None:
    """Claude occasionally invents near-miss op ids ('warmth', 'temperature').
    The tool drops anything that doesn't exist in the live registry rather
    than surfacing a row the user can't execute."""
    doc = make_doc(with_image_context=True)
    patched_client["_response"] = [
        {"kind": "op", "id": "warmth", "reason": "not a real op"},
        {"kind": "op", "id": "kelvin", "reason": "real op"},
        {"kind": "preset", "id": "made_up_preset", "reason": "not real"},
    ]
    out = await tool.handler(doc, tool.input_schema(query="warmer"))
    ids = [p.id for p in out.picks]
    assert "warmth" not in ids
    assert "made_up_preset" not in ids
    assert "kelvin" in ids


@pytest.mark.asyncio
async def test_empty_response_returns_empty_picks(
    tool, make_doc, patched_client,
) -> None:
    """When the LLM has nothing useful to say (the deterministic palette
    section already covers it), zero picks ride through to the wire."""
    doc = make_doc(with_image_context=True)
    patched_client["_response"] = []
    out = await tool.handler(doc, tool.input_schema(query="exposure"))
    assert out.picks == []


@pytest.mark.asyncio
async def test_passes_image_context_dict_to_client(
    tool, make_doc, patched_client,
) -> None:
    """The image_context block is the cache-friendly bias signal for the
    LLM. Assert it lands in the call shape."""
    doc = make_doc(with_image_context=True)
    patched_client["_response"] = []
    await tool.handler(doc, tool.input_schema(query="moody"))
    assert patched_client["image_context"] is not None
    assert "subjects" in patched_client["image_context"]
