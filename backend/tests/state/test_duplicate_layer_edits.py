"""duplicate_layer_edits clones the pixel-affecting state (canonical + active
widgets) from a source layer onto its paired target layer — backing the deep
image-node / group Duplicate. Independent clone: the copy gets its own canonical
and its own widgets so editing it never touches the original."""
from app.schemas.widget import (
    ControlBinding, NodeParamTarget, Scope, Widget, WidgetNode,
    WidgetOrigin, WidgetPreview,
)
from app.state.canonical import set_param_value
from app.state.document import SessionDocument


def _widget(wid: str, layer_id: str, op: str, params: dict) -> Widget:
    return Widget(
        id=wid, intent="x", scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_autonomous", prompt=None),
        op_id="warm_grade",
        nodes=[WidgetNode(
            id=f"n_{wid}", type=op, params=params,
            scope=Scope.model_validate({"kind": "global"}),
            inputs=[], widget_id=wid, layer_id=layer_id,
        )],
        bindings=[ControlBinding(
            param_key=next(iter(params)), label="P", control_type="slider",
            target=NodeParamTarget(node_id=f"n_{wid}", param_key=next(iter(params))),
            control_schema={"control_type": "slider", "min": -100, "max": 100, "step": 1},
            value=next(iter(params.values())), default=0,
        )],
        preview=WidgetPreview(kind="none", auto_before_after=False),
        status="active", revision=1,
    )


def test_copies_canonical_deeply():
    doc = SessionDocument(session_id="s1")
    set_param_value(doc.canonical, "a", "basic", "exposure", 0.5)
    doc.duplicate_layer_edits([{"from_layer_id": "a", "to_layer_id": "b"}])
    assert doc.canonical["b"] == doc.canonical["a"]
    assert doc.canonical["b"] is not doc.canonical["a"]  # deep copy
    # Mutating the copy does not leak back to the source.
    doc.canonical["b"]["basic"]["exposure"] = 0.9
    assert doc.canonical["a"]["basic"]["exposure"] == 0.5


def test_clones_active_widget_retargeted_to_new_layer():
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget("w_1", "a", "basic", {"exposure": 12}))
    doc.duplicate_layer_edits([{"from_layer_id": "a", "to_layer_id": "b"}])

    clones = [w for wid, w in doc.widgets.items() if wid != "w_1"]
    assert len(clones) == 1
    c = clones[0]
    assert c.id == "w_1-copy-1"
    assert c.status == "active"
    node = c.nodes[0]
    # Retargeted to the new layer only (single, independent target).
    assert node.layer_id == "b"
    assert node.layer_ids is None
    # Node id remapped and binding follows it.
    assert node.id == "n_w_1-copy-1"
    assert c.bindings[0].target.node_id == node.id
    # Original widget untouched.
    assert doc.widgets["w_1"].nodes[0].layer_id == "a"
    assert doc.widgets["w_1"].origin.kind == "mcp_autonomous"
    # Canonical seeded for the new layer.
    assert doc.canonical["b"]["basic"]["exposure"] == 12
    # A cloned adjustment is an APPLIED edit on the copy, NOT a fresh AI
    # suggestion. Its origin must not be autonomous — otherwise the frontend
    # marks it a pending suggestion and the renderer HIDES it, so the copy's
    # main composite renders raw (only its thumbnail catches the previewed grade).
    assert c.origin.kind == "tool_invoked"


def test_does_not_clone_widgets_targeting_other_layers():
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget("w_other", "z", "basic", {"exposure": 3}))
    doc.duplicate_layer_edits([{"from_layer_id": "a", "to_layer_id": "b"}])
    # No widget targeted layer 'a', so nothing is cloned.
    assert list(doc.widgets.keys()) == ["w_other"]


def test_no_state_still_emits_history_applied():
    doc = SessionDocument(session_id="s1")
    events = doc.duplicate_layer_edits([{"from_layer_id": "x", "to_layer_id": "y"}])
    assert [e.kind for e in events] == ["history.applied"]


def _region_widget(wid: str, layer_id: str) -> Widget:
    """Widget scoped to a named region ("sports car") — as the autonomous
    suggester mints them on the source image."""
    w = _widget(wid, layer_id, "basic", {"contrast": 14})
    region = Scope.model_validate({"kind": "named_region", "label": "sports car"})
    w.scope = region
    for n in w.nodes:
        n.scope = region
    return w


def test_clone_rescopes_region_widgets_to_global():
    """A cutout copy targets the new layer WHOLESALE — the layer IS the
    region. Copying a named_region scope verbatim leaves the clone claiming
    a region that only existed on the source image (stale chip, inverted
    semantics). The clone must be re-scoped to global; the original keeps
    its region scope."""
    doc = SessionDocument(session_id="s")
    doc.add_widget(_region_widget("w1", "src"))

    doc.duplicate_layer_edits([{"from_layer_id": "src", "to_layer_id": "dst"}])

    clones = [w for w in doc.widgets.values() if w.id != "w1"]
    assert len(clones) == 1
    clone = clones[0]
    assert clone.scope.root.kind == "global"
    assert all(n.scope.root.kind == "global" for n in clone.nodes)
    # Original untouched.
    assert doc.widgets["w1"].scope.root.kind == "named_region"


def test_excludes_pending_suggestions_from_clone_and_scrubs_their_canonical():
    """Accepting a region suggestion extracts a cutout while OTHER suggestions
    are still pending chips. Pending widgets are status=active and seeded into
    canonical (muted on the source by the frontend's pending filter), so a
    wholesale clone laundered them into APPLIED widgets on the cutout — the
    'phantom global widget' bug. The caller passes the pending ids; those
    widgets must not be cloned and their seeded params must not survive in
    the copied canonical."""
    doc = SessionDocument(session_id="s")
    doc.add_widget(_widget("w-real", "src", "basic", {"exposure": 10}))
    doc.add_widget(_widget("w-pending", "src", "color", {"saturation": 22}))

    doc.duplicate_layer_edits(
        [{"from_layer_id": "src", "to_layer_id": "dst"}],
        exclude_widget_ids=["w-pending"],
    )

    clones = [w for w in doc.widgets.values() if w.id not in ("w-real", "w-pending")]
    assert [c.origin.parent_widget_id for c in clones] == ["w-real"]
    # Canonical on the copy: the real edit survives, the pending one is gone.
    assert doc.canonical["dst"]["basic"]["exposure"] == 10
    assert "color" not in doc.canonical.get("dst", {})
    # Source stays untouched — the pending suggestion still previews there.
    assert doc.canonical["src"]["color"]["saturation"] == 22
