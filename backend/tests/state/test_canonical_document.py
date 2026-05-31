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
