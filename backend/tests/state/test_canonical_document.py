from app.state.document import SessionDocument


def test_set_param_writes_canonical_and_emits_event():
    doc = SessionDocument(session_id="s1")
    events = doc.set_param("layer_a", "basic", "exposure", 55)
    assert doc.canonical["layer_a"]["basic"]["exposure"] == 55
    assert events[0].kind == "canonical.updated"
    assert events[0].payload["layer_id"] == "layer_a"
    assert events[0].payload["op"] == "basic"


def test_set_param_dedups_same_slot():
    doc = SessionDocument(session_id="s1")
    doc.set_param("layer_a", "basic", "exposure", 10)
    doc.set_param("layer_a", "basic", "exposure", 90)
    assert doc.canonical["layer_a"]["basic"] == {"exposure": 90}


def _kelvin_widget(wid: str, layer_id: str, temperature: int):
    from app.schemas.widget import (
        GlobalScope,
        Scope,
        Widget,
        WidgetNode,
        WidgetOrigin,
        WidgetPreview,
    )
    wn = WidgetNode(
        id=f"n_{wid}", type="kelvin",
        scope=Scope(root=GlobalScope(kind="global")),
        params={"temperature": temperature}, widget_id=wid, layer_id=layer_id,
    )
    return Widget(
        id=wid, intent="warmer",
        scope=Scope(root=GlobalScope(kind="global")),
        origin=WidgetOrigin(kind="mcp_autonomous"),
        preview=WidgetPreview(kind="none"), nodes=[wn],
    )


def test_dismiss_widget_resets_only_owned_canonical_params():
    """close/delete (Q2 'close → value resets') resets the param keys the
    widget owns and prunes the now-empty canonical slot — a sibling param on
    the same (layer, op) set by another view survives."""
    doc = SessionDocument(session_id="s1")
    # add_widget seeds canonical[layer_a][kelvin][temperature] = 5800.
    doc.add_widget(_kelvin_widget("w_1", "layer_a", 5800))
    # A different view contributes a sibling param on the same (layer, op).
    doc.set_param("layer_a", "kelvin", "tint", 12)
    assert doc.canonical["layer_a"]["kelvin"] == {"temperature": 5800, "tint": 12}

    doc.dismiss_widget("w_1")

    # Owned key gone; sibling survives; slot not pruned (tint remains).
    assert doc.canonical["layer_a"]["kelvin"] == {"tint": 12}


def test_dismiss_widget_prunes_empty_canonical_slot():
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_kelvin_widget("w_1", "layer_a", 5800))
    assert "layer_a" in doc.canonical

    doc.dismiss_widget("w_1")

    # The only owned param is gone → op and layer dicts pruned entirely.
    assert "layer_a" not in doc.canonical


def test_restore_widget_reseeds_owned_canonical_params():
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_kelvin_widget("w_1", "layer_a", 5800))
    doc.dismiss_widget("w_1")
    assert "layer_a" not in doc.canonical

    doc.restore_widget("w_1")

    # Restore brings the adjustment back from the widget's nodes.
    assert doc.canonical["layer_a"]["kelvin"]["temperature"] == 5800
