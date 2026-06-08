"""End-to-end MCP wire test.

Walks the full MCP loop over the real /mcp endpoint with a fake AnthropicClient:
session bootstrap -> initialize -> tools/list -> analyze_image -> propose_stack
-> refine_widget -> delete_widget. Verifies the dismissal rule lands in the
session document at the end.
"""
from __future__ import annotations

import io
import json

import pytest
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.api import deps


class _FakeClaude:
    """Minimal stub of AnthropicClient — only the methods the loop hits.

    Shapes mirror the real returns:
      - analyze_image -> ImageContext
      - augment_context_soft_fields -> _ContextSoftFields
      - name_pick_fused_tool -> str | None
      - resolve_fused_tool -> dict matching the warm_grade response_schema
      - flesh_out_binding -> dict with 'binding' (ControlBinding shape, using
        the real 'control_schema' field name) plus 'additional_nodes'.
    """

    def analyze_image(self, image_bytes, mime_type, session_id=None):
        from app.schemas.image_context import ImageContext

        return ImageContext(
            subjects=["scene"],
            lighting="flat",
            dominant_tones=["midtones"],
            mood="calm",
            candidate_regions=[],
            model_name="fake",
            model_version="0",
            generated_at="2026-05-21T00:00:00Z",
        )

    def augment_context_soft_fields(
        self,
        image_bytes,
        mime_type,
        base_context_json,
        cheap_pass_summary,
        session_id=None,
    ):
        from app.services.anthropic_client import _ContextSoftFields

        return _ContextSoftFields(
            estimated_white_point=(255, 255, 255),
            wb_neutral_confidence=0.7,
            grade_character="neutral",
            problems=[],
            region_soft_fields=[],
        )

    def plan_widget_stack(self, *, intent, scope, image_context, existing_widgets, registry, session_id=None):
        # Return a single light op plan so we get deterministic panel_bindings.
        return {
            "plan": [{"op_id": "light", "rationale": "make it warmer"}],
            "overall_rationale": "light adjustment",
        }

    def resolve_widget_params(self, *, op, intent, rationale, starting_params, image_context, session_id=None):
        return {k: p.default for k, p in op.params.items()}

    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        # Still needed by refine_widget which calls the fused framework on re-tune.
        return {
            "values": {
                "temperature": 600,
                "highlight_warmth": 8,
                "saturation_lift": 3,
            },
            "reasoning": "",
        }

    def name_pick_fused_tool(self, intent, candidates, session_id=None):
        return "warm_grade"

    def suggest_fused_tools_for_character(self, *, grade_character, lighting, dominant_tones, subjects, exclude, n, session_id=None):
        return []

    def flesh_out_binding(self, request, widget, response_schema=None, session_id=None):
        # ControlBinding has `control_schema` (not `schema`) and forbids extras.
        # additional_nodes need {type, params, scope} so refine_widget can build
        # a WidgetNode from each entry.
        return {
            "binding": {
                "param_key": "skin_protect",
                "label": "Skin protect",
                "control_type": "toggle",
                "target": {"node_id": "n_extra", "param_key": "skin_protect"},
                "control_schema": {
                    "control_type": "toggle",
                    "on_label": "Protect",
                    "off_label": "Off",
                },
                "value": True,
                "default": True,
            },
            "additional_nodes": [
                {"type": "basic", "params": {"skin_protect": True}, "scope": {"kind": "global"}},
            ],
        }


async def _mcp(ac: AsyncClient, sid: str, method: str, params: dict, req_id: int) -> dict:
    response = await ac.post(
        "/mcp",
        headers={"x-editor-session-id": sid, "content-type": "application/json"},
        json={"jsonrpc": "2.0", "id": req_id, "method": method, "params": params},
    )
    return response.json()


@pytest.mark.asyncio
async def test_full_mcp_loop_create_propose_refine_delete() -> None:
    from app.main import app

    original = deps._anthropic_client
    deps._anthropic_client = _FakeClaude()  # type: ignore[assignment]
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            # 1. Bootstrap a session with a real JPEG.
            buf = io.BytesIO()
            Image.new("RGB", (64, 64), (50, 80, 120)).save(buf, format="JPEG")
            files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
            sid = (await ac.post("/api/session", files=files)).json()["session_id"]

            # 2. MCP initialize.
            init = await _mcp(
                ac,
                sid,
                "initialize",
                {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name": "test", "version": "1"},
                },
                1,
            )
            assert init["result"]["serverInfo"]["name"] == "editor-mcp"

            # 3. tools/list contains the headline widget tools.
            listing = (await _mcp(ac, sid, "tools/list", {}, 2))["result"]["tools"]
            names = {t["name"] for t in listing}
            assert {"propose_stack", "propose_widget", "refine_widget", "repeat_widget", "delete_widget"}.issubset(names)

            # 4. analyze_image via MCP — sets record.context satisfying
            # propose_stack's requires_context permission.
            env = (await _mcp(ac, sid, "tools/call", {
                "name": "analyze_image", "arguments": {},
            }, 3))["result"]
            outer = json.loads(env["content"][0]["text"])
            assert outer["ok"] is True

            # 5. propose_stack via MCP (migrated from propose_widget for LLM path).
            envp = (await _mcp(ac, sid, "tools/call", {
                "name": "propose_stack",
                "arguments": {
                    "intent": "warmer",
                    "scope": {"kind": "global"},
                },
            }, 4))["result"]
            prop = json.loads(envp["content"][0]["text"])
            assert prop["ok"] is True
            wid = prop["output"]["widgets"][0]["id"]

            # 6. refine_widget — add a skin-protect toggle.
            envr = (await _mcp(ac, sid, "tools/call", {
                "name": "refine_widget",
                "arguments": {
                    "widget_id": wid,
                    "edits": [],
                    "additions": [{"request": "add a skin-protect toggle"}],
                },
            }, 5))["result"]
            refined = json.loads(envr["content"][0]["text"])
            assert refined["ok"] is True
            keys = [b["param_key"] for b in refined["output"]["widget"]["bindings"]]
            assert "skin_protect" in keys

            # 7. delete_widget — suppress similar autonomous suggestions.
            envd = (await _mcp(ac, sid, "tools/call", {
                "name": "delete_widget",
                "arguments": {"widget_id": wid, "suppress_similar": True},
            }, 6))["result"]
            deleted = json.loads(envd["content"][0]["text"])
            assert deleted["ok"] is True

            doc = deps.get_session_store().get_document(sid)
            assert doc.widgets[wid].status == "dismissed"
            assert len(doc.dismissals) == 1
    finally:
        deps._anthropic_client = original
