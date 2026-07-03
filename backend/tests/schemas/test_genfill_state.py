from app.schemas.widget import (
    GenfillError, GenfillResultInfo, GenfillState, Scope, Widget, WidgetOrigin,
)


def _widget(genfill: GenfillState) -> Widget:
    return Widget(
        id="w_g1",
        intent="Generative fill",
        scope=Scope.model_validate({"kind": "mask", "maskId": "m1"}),
        origin=WidgetOrigin(kind="tool_invoked"),
        genfill=genfill,
    )


def test_genfill_widget_round_trips_camel():
    w = _widget(GenfillState(
        status="ready", prompt="a red boat", negative_prompt=None, seed=42,
        mask_id="m1", image_node_id="in-default",
        result=GenfillResultInfo(asset_id="genfill-w_g1", width=1024, height=768),
    ))
    dumped = w.model_dump(mode="json", by_alias=True)
    g = dumped["genfill"]
    assert g["status"] == "ready"
    assert g["maskId"] == "m1"
    assert g["imageNodeId"] == "in-default"
    assert g["result"]["assetId"] == "genfill-w_g1"
    # Round-trip. (`opId` is dropped first: Widget.op_id's validation_alias
    # is AliasChoices("op_id", "fused_tool_id") which does not accept its own
    # serialization alias — a pre-existing quirk unrelated to genfill.)
    dumped.pop("opId", None)
    again = Widget.model_validate(dumped)
    assert again.genfill is not None and again.genfill.result.width == 1024


def test_widget_without_genfill_defaults_none():
    w = Widget(
        id="w_p", intent="x",
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_user_prompt"),
    )
    assert w.genfill is None
    assert w.model_dump(mode="json", by_alias=True)["genfill"] is None


def test_genfill_error_state():
    w = _widget(GenfillState(
        status="error", prompt="x", seed=1, mask_id="m1", image_node_id="in-default",
        error=GenfillError(kind="moderation", message="blocked"),
    ))
    g = w.model_dump(mode="json", by_alias=True)["genfill"]
    assert g["error"] == {"kind": "moderation", "message": "blocked"}
