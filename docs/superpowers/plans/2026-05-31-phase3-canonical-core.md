# Phase 3 — Canonical State Core (Slice 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a canonical per-`(layer, op)` adjustment state the single source the op_graph is projected from, so two views of the same `(layer, op, param)` share one value (bidirectional sync).

**Architecture:** `SessionDocument` gains `canonical[layer_id][op][param] = value`. A `set_param` mutation writes it. `project_to_graph` is rewritten to emit one op_graph node per `(layer, op)` from canonical (dedup), instead of the union of widget-owned nodes. The existing widget write paths (`set_widget_param`, `_handle_tool_invoked`) are routed to populate canonical so the projection has data. Widget bindings still drive `panel_bindings`; widgets keep their `nodes` for now (made redundant — full "thin view" removal + fused/autonomous migration + frontend canonical hooks are **follow-on slices**, not this plan).

**Tech Stack:** Python/FastAPI + pytest (backend only in this slice).

**Scope (this slice):** backend canonical store + `set_param` + projection-from-canonical + routing `set_widget_param` and `propose_widget` (tool_invoked) into canonical. **Out of scope (later slices):** routing the fused-tool / autonomous-mint creation paths, removing `Widget.nodes` entirely, and the frontend canonical read/setter hooks. The app stays green throughout because canonical is populated by the routed paths before projection reads it.

**Canonical key = `node.type`** (the shader binding: `basic`, `kelvin`, `curves`, `levels`, `lut`). Light and Color both emit `basic`, so they merge into one canonical `basic` slot per layer — which is exactly one shader pass with the union of params. That is the intended "one adjustment slot per op per layer".

---

## File Structure

- Create: `backend/app/state/canonical.py` — the canonical type + pure helpers (`set_param_value`, `canonical_to_nodes`).
- Modify: `backend/app/state/document.py` — add the `canonical` field + a `set_param` mutation that emits an event.
- Modify: `backend/app/state/operations.py` — `project_to_graph` reads canonical.
- Modify: `backend/app/tools/widgets/set_widget_param.py` — route the write into canonical.
- Modify: `backend/app/tools/widgets/propose_widget.py` — seed canonical from a tool_invoked widget's node params.
- Tests: `backend/tests/state/test_canonical.py`, extend `backend/tests/state/test_operations.py`, extend the propose/set_widget_param tests.

---

## Task 1: Canonical type + pure helpers

**Files:**
- Create: `backend/app/state/canonical.py`
- Create: `backend/tests/state/test_canonical.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/state/test_canonical.py`:

```python
from app.state.canonical import set_param_value, canonical_to_nodes


def test_set_param_value_creates_nested_slots():
    canonical: dict = {}
    set_param_value(canonical, "layer_a", "basic", "exposure", 40)
    set_param_value(canonical, "layer_a", "basic", "contrast", -10)
    assert canonical == {"layer_a": {"basic": {"exposure": 40, "contrast": -10}}}


def test_set_param_value_overwrites_same_slot():
    canonical: dict = {}
    set_param_value(canonical, "layer_a", "basic", "exposure", 40)
    set_param_value(canonical, "layer_a", "basic", "exposure", 90)
    assert canonical["layer_a"]["basic"]["exposure"] == 90  # one value, not two


def test_canonical_to_nodes_one_node_per_layer_op():
    canonical = {
        "layer_a": {"basic": {"exposure": 40}, "kelvin": {"kelvin": 6200}},
        "layer_b": {"basic": {"contrast": 10}},
    }
    nodes = canonical_to_nodes(canonical)
    # one node per (layer, op); deterministic order by layer then op
    keys = [(n["layer_id"], n["type"]) for n in nodes]
    assert keys == [("layer_a", "basic"), ("layer_a", "kelvin"), ("layer_b", "basic")]
    a_basic = next(n for n in nodes if n["layer_id"] == "layer_a" and n["type"] == "basic")
    assert a_basic["params"] == {"exposure": 40}
    assert a_basic["id"] == "canon:layer_a:basic"  # stable id from (layer, op)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/state/test_canonical.py -q`
Expected: FAIL — `No module named 'app.state.canonical'`.

- [ ] **Step 3: Implement the helpers**

Create `backend/app/state/canonical.py`:

```python
"""Canonical per-(layer, op) adjustment state — the single source the op_graph
is projected from. `op` is the shader-binding node type (basic, kelvin, curves,
levels, lut). One slot per (layer, op); editing a param overwrites the one value.
"""
from __future__ import annotations

from typing import Any

# canonical: dict[layer_id][op][param_key] -> value
Canonical = dict[str, dict[str, dict[str, Any]]]


def set_param_value(canonical: Canonical, layer_id: str, op: str, param: str, value: Any) -> None:
    canonical.setdefault(layer_id, {}).setdefault(op, {})[param] = value


def canonical_to_nodes(canonical: Canonical) -> list[dict[str, Any]]:
    """Project the canonical state into op_graph node dicts — one node per
    (layer, op), params merged. Deterministic order: layer then op."""
    nodes: list[dict[str, Any]] = []
    for layer_id in sorted(canonical):
        for op in sorted(canonical[layer_id]):
            params = canonical[layer_id][op]
            if not params:
                continue
            nodes.append({
                "id": f"canon:{layer_id}:{op}",
                "type": op,
                "layer_id": layer_id,
                "params": dict(params),
            })
    return nodes
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/state/test_canonical.py -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/state/canonical.py backend/tests/state/test_canonical.py
git commit -m "feat(canonical): per-(layer,op) state type + projection helpers"
```

---

## Task 2: `canonical` field + `set_param` mutation on SessionDocument

**Files:**
- Modify: `backend/app/state/document.py`
- Create: `backend/tests/state/test_canonical_document.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/state/test_canonical_document.py`:

```python
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/state/test_canonical_document.py -q`
Expected: FAIL — `SessionDocument` has no `canonical` / `set_param`.

- [ ] **Step 3: Add the field + mutation**

In `backend/app/state/document.py`:

1. Add the import near the top (with the other `app.state` imports):

```python
from app.state.canonical import Canonical, set_param_value
```

2. Add the field to the `SessionDocument` model (next to `widgets`):

```python
    canonical: Canonical = Field(default_factory=dict)
```

3. Add the mutation method (next to the widget mutations, e.g. after `accept_widget`):

```python
    def set_param(self, layer_id: str, op: str, param: str, value: Any) -> list[StateEvent]:
        """Canonical write: the single source the op_graph projects from."""
        set_param_value(self.canonical, layer_id, op, param, value)
        return [self._emit("canonical.updated", {
            "layer_id": layer_id, "op": op, "param": param, "value": value,
            "operation_graph": self._op_graph_payload(),
        })]
```

(`_op_graph_payload()` already exists from Phase 1 Bug 3 — it embeds the projected op_graph so the frontend renderer updates live. `Any` is already imported in document.py.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/state/test_canonical_document.py -q`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/state/document.py backend/tests/state/test_canonical_document.py
git commit -m "feat(canonical): SessionDocument.canonical + set_param mutation"
```

---

## Task 3: Route `set_widget_param` into canonical

**Files:**
- Modify: `backend/app/tools/widgets/set_widget_param.py`
- Create: `backend/tests/tools/widgets/test_set_widget_param_canonical.py`

**Context:** `set_widget_param` currently writes `binding.value` + `node.params[param_key]` on the widget. This task ADDS a canonical write keyed by `(node.layer_id, node.type, target.param_key)`, so a slider drag populates canonical. (The widget node write stays for now — removed in a later slice.)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/tools/widgets/test_set_widget_param_canonical.py`:

```python
from fastapi.testclient import TestClient
from app.api import deps
from app.tools.widgets.set_widget_param import SetWidgetParamTool
from app.tools.widgets.propose_widget import ProposeWidgetTool


def _client():
    from app.main import app
    reg = deps.get_tool_registry()
    for t in (SetWidgetParamTool(), ProposeWidgetTool()):
        if t.name not in reg._tools:
            reg.register(t)
    return TestClient(app)


def _session_with_context(client) -> str:
    from io import BytesIO
    from PIL import Image
    from app.schemas.enriched_context import EnrichedImageContext
    buf = BytesIO(); Image.new("RGB", (16, 16), (50, 50, 100)).save(buf, format="JPEG")
    sid = client.post("/api/session", files={"image": ("a.jpg", buf.getvalue(), "image/jpeg")}).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.image_context = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm", candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )
    deps.get_session_store().set_context(sid, doc.image_context.model_dump(mode="json"))
    return sid


def test_set_widget_param_writes_canonical():
    client = _client()
    sid = _session_with_context(client)
    # spawn a Light (basic) tool_invoked widget on layer_a
    w = client.post("/api/tools/propose_widget", json={"session_id": sid, "input": {
        "intent": "Light", "scope": {"kind": "global"}, "fused_tool_id": "light",
        "layer_id": "layer_a", "origin": "tool_invoked",
    }}).json()["output"]["widget"]
    client.post("/api/tools/set_widget_param", json={"session_id": sid, "input": {
        "widget_id": w["id"], "param_key": "exposure", "value": 70,
    }})
    doc = deps.get_session_store().get_document(sid)
    assert doc.canonical["layer_a"]["basic"]["exposure"] == 70
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools/widgets/test_set_widget_param_canonical.py -q`
Expected: FAIL — `doc.canonical` is empty (set_widget_param doesn't write it yet).

- [ ] **Step 3: Add the canonical write**

In `backend/app/tools/widgets/set_widget_param.py`, the handler currently locates the binding + node and writes `node.params[...] = value`. Add a canonical write right after the node write. The current block:

```python
        binding.value = input.value
        node = next((n for n in w.nodes if n.id == binding.target.node_id), None)
        if node is not None:
            node.params[binding.target.param_key] = input.value
        w.revision += 1
        doc.update_widget(w)
```

becomes:

```python
        binding.value = input.value
        node = next((n for n in w.nodes if n.id == binding.target.node_id), None)
        if node is not None:
            node.params[binding.target.param_key] = input.value
            # Canonical write: the op_graph now projects from here.
            doc.set_param(node.layer_id, node.type, binding.target.param_key, input.value)
        w.revision += 1
        doc.update_widget(w)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools/widgets/test_set_widget_param_canonical.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/widgets/set_widget_param.py backend/tests/tools/widgets/test_set_widget_param_canonical.py
git commit -m "feat(canonical): set_widget_param writes the canonical slot"
```

---

## Task 4: Seed canonical when a tool_invoked widget spawns

**Files:**
- Modify: `backend/app/tools/widgets/propose_widget.py`
- Create: `backend/tests/tools/widgets/test_propose_seeds_canonical.py`

**Context:** A tool_invoked widget ships default node params (e.g. exposure 0). Seed those into canonical at spawn so the slot exists before any edit. (The fused / autonomous creation paths are seeded in a later slice — this slice covers the toolstore path that the accordion depends on.)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/tools/widgets/test_propose_seeds_canonical.py`:

```python
from fastapi.testclient import TestClient
from app.api import deps
from app.tools.widgets.propose_widget import ProposeWidgetTool


def _client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "propose_widget" not in reg._tools:
        reg.register(ProposeWidgetTool())
    return TestClient(app)


def _session(client) -> str:
    from io import BytesIO
    from PIL import Image
    from app.schemas.enriched_context import EnrichedImageContext
    buf = BytesIO(); Image.new("RGB", (16, 16), (50, 50, 100)).save(buf, format="JPEG")
    sid = client.post("/api/session", files={"image": ("a.jpg", buf.getvalue(), "image/jpeg")}).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.image_context = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm", candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z")
    deps.get_session_store().set_context(sid, doc.image_context.model_dump(mode="json"))
    return sid


def test_tool_invoked_seeds_canonical_slot():
    client = _client()
    sid = _session(client)
    client.post("/api/tools/propose_widget", json={"session_id": sid, "input": {
        "intent": "Light", "scope": {"kind": "global"}, "fused_tool_id": "light",
        "layer_id": "layer_a", "origin": "tool_invoked"}})
    doc = deps.get_session_store().get_document(sid)
    # the basic slot exists on layer_a with the tool's default params
    assert "basic" in doc.canonical.get("layer_a", {})
    assert "exposure" in doc.canonical["layer_a"]["basic"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools/widgets/test_propose_seeds_canonical.py -q`
Expected: FAIL — canonical not seeded on spawn.

- [ ] **Step 3: Seed canonical in `_handle_tool_invoked`**

In `backend/app/tools/widgets/propose_widget.py`, `_handle_tool_invoked` builds `nodes` then the `Widget`, and calls `doc.add_widget(widget)` at the end. Immediately before `doc.add_widget(widget)`, seed canonical from the nodes:

```python
        for nd in nodes:
            for pkey, pval in nd.params.items():
                doc.set_param(nd.layer_id, nd.type, pkey, pval)
        doc.add_widget(widget)
```

(`nodes` is the local `list[WidgetNode]` already built above; each has `.layer_id`, `.type`, `.params`.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools/widgets/test_propose_seeds_canonical.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/widgets/propose_widget.py backend/tests/tools/widgets/test_propose_seeds_canonical.py
git commit -m "feat(canonical): seed canonical slot when a tool_invoked widget spawns"
```

---

## Task 5: Project op_graph from canonical (the switch)

**Files:**
- Modify: `backend/app/state/operations.py`
- Modify: `backend/tests/state/test_operations.py`

**Context:** This is the pivot — `project_to_graph` builds nodes from `doc.canonical` (dedup by (layer, op)) instead of the union of widget nodes. `panel_bindings` + `user_goal` still come from the active widgets (views). This is why Tasks 3–4 had to seed canonical first: by the time projection flips, the toolstore write paths populate it.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/state/test_operations.py`:

```python
def test_projection_reads_canonical_and_dedups():
    doc = SessionDocument(session_id="s1")
    # two writes to the SAME (layer, op) slot — must dedup to one node
    doc.set_param("layer_a", "basic", "exposure", 40)
    doc.set_param("layer_a", "basic", "contrast", -10)
    doc.set_param("layer_a", "kelvin", "kelvin", 6200)
    graph = project_to_graph(doc)
    basic = [n for n in graph.nodes if n.layer_id == "layer_a" and n.type == "basic"]
    assert len(basic) == 1  # one node per (layer, op)
    assert basic[0].params == {"exposure": 40, "contrast": -10}
    assert any(n.type == "kelvin" and n.layer_id == "layer_a" for n in graph.nodes)


def test_projection_ignores_widget_owned_nodes_now():
    """After the switch, a widget's own nodes no longer drive projection —
    only canonical does. (Widgets keep nodes for now; they're just not the source.)"""
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget("w_1", "n_1", {"temperature": 6500}))  # writes no canonical
    graph = project_to_graph(doc)
    assert graph.nodes == []  # nothing in canonical → empty graph
```

(The existing `test_single_active_widget_projects_nodes_and_bindings` will now FAIL because widgets no longer drive nodes — update it: it should assert `panel_bindings` still come from the widget, and that `graph.nodes` is empty unless canonical was written. Change its node assertion to seed canonical first: `doc.set_param("legacy", "kelvin", "temperature", 6500)` then assert the node appears. Keep the binding assertion.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/state/test_operations.py -q`
Expected: FAIL — projection still reads widget nodes.

- [ ] **Step 3: Rewrite the node projection**

In `backend/app/state/operations.py`, import the helper and rewrite the node-building loop. Add at the top:

```python
from app.state.canonical import canonical_to_nodes
```

Replace the node-building portion of `project_to_graph` (the `for wid in doc.widget_order:` loop's node append) so nodes come from canonical while bindings/user_goal still come from widgets:

```python
def project_to_graph(doc: SessionDocument) -> OperationGraph:
    bindings: list[PanelBinding] = []
    user_goal_parts: list[str] = []
    for wid in doc.widget_order:
        w = doc.widgets.get(wid)
        if w is None or w.status not in {"active", "accepted"}:
            continue
        bindings.extend(_binding_to_panel_binding(w))
        user_goal_parts.append(w.intent)

    nodes = [
        Node(
            id=nd["id"],
            type=nd["type"],
            scope=_widget_scope_to_graph_scope(WidgetScope.model_validate({"kind": "global"})),
            params=nd["params"],
            inputs=[],
            layer_id=nd["layer_id"],
            layer_ids=None,
            widget_id=None,
        )
        for nd in canonical_to_nodes(doc.canonical)
    ]
    return OperationGraph(
        id=f"projected-{uuid.uuid4().hex[:8]}",
        user_goal="; ".join(user_goal_parts),
        reasoning=None,
        nodes=nodes,
        panel_bindings=bindings,
        metadata={"projection": "1"},
    )
```

(`WidgetScope` is already imported in operations.py as `Scope as WidgetScope`. Node scope is `global` for canonical nodes in this slice — per-region/node-scope canonical is a later slice.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/state/test_operations.py -q`
Expected: PASS (including the updated existing tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/state/operations.py backend/tests/state/test_operations.py
git commit -m "feat(canonical): project op_graph from canonical state (dedup by layer,op)"
```

---

## Task 6: Verification + bidirectional-sync integration test

**Files:**
- Create: `backend/tests/tools/widgets/test_canonical_bidirectional.py`

- [ ] **Step 1: Write the integration test**

Create `backend/tests/tools/widgets/test_canonical_bidirectional.py`:

```python
from fastapi.testclient import TestClient
from app.api import deps
from app.tools.widgets.propose_widget import ProposeWidgetTool
from app.tools.widgets.set_widget_param import SetWidgetParamTool
from app.state.operations import project_to_graph


def _client():
    from app.main import app
    reg = deps.get_tool_registry()
    for t in (ProposeWidgetTool(), SetWidgetParamTool()):
        if t.name not in reg._tools:
            reg.register(t)
    return TestClient(app)


def _session(client) -> str:
    from io import BytesIO
    from PIL import Image
    from app.schemas.enriched_context import EnrichedImageContext
    buf = BytesIO(); Image.new("RGB", (16, 16), (50, 50, 100)).save(buf, format="JPEG")
    sid = client.post("/api/session", files={"image": ("a.jpg", buf.getvalue(), "image/jpeg")}).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.image_context = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm", candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z")
    deps.get_session_store().set_context(sid, doc.image_context.model_dump(mode="json"))
    return sid


def test_two_basic_widgets_same_layer_share_one_canonical_node():
    """Two tool_invoked 'basic' widgets (e.g. Light + Color) on one layer must
    project to ONE basic node whose params are the union — the canonical dedup
    that makes the accordion and canvas share a value."""
    client = _client()
    sid = _session(client)
    for tool in ("light", "color"):
        client.post("/api/tools/propose_widget", json={"session_id": sid, "input": {
            "intent": tool, "scope": {"kind": "global"}, "fused_tool_id": tool,
            "layer_id": "layer_a", "origin": "tool_invoked"}})
    doc = deps.get_session_store().get_document(sid)
    graph = project_to_graph(doc)
    basic_nodes = [n for n in graph.nodes if n.layer_id == "layer_a" and n.type == "basic"]
    assert len(basic_nodes) == 1
    # union of light (exposure, contrast, highlights, shadows) + color (saturation, vibrance)
    keys = set(basic_nodes[0].params)
    assert {"exposure", "saturation"} <= keys
```

- [ ] **Step 2: Run + full backend regression**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools/widgets/test_canonical_bidirectional.py -q`
Expected: PASS.

Run the full backend suite:
`cd backend && source .venv/bin/activate && python -m pytest -q`
Expected: PASS except the pre-existing unrelated `tests/test_panel_endpoint.py::test_panel_reuses_cached_context` (missing `ANTHROPIC_API_KEY`). If any OTHER test fails, it is almost certainly a widget-projection test that assumed widgets drive nodes — update it to seed canonical first (the same fix as Task 5's existing-test update), or report it.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/tools/widgets/test_canonical_bidirectional.py
git commit -m "test(canonical): two same-op widgets share one canonical node"
```

---

## Self-Review Notes

- **Spec coverage (§4.B of the canonical-engine spec):** canonical per-(layer,op,param) state (Tasks 1–2); `set_param` writer (Task 2); op_graph projected from canonical (Task 5); dedup so views share a value (Tasks 5–6). Routing existing toolstore writes into canonical (Tasks 3–4) is the migration bridge. **Explicitly deferred to later slices** (logged, not silently dropped): routing the fused-tool + autonomous-mint creation paths into canonical, removing `Widget.nodes`, node-scope/per-region canonical, and the frontend canonical read/setter hooks.
- **Coupling risk:** Task 5 flips projection; Tasks 3–4 MUST land first so canonical is populated for the toolstore path. Any widget created via the fused/autonomous path (not yet routed) will stop projecting after Task 5 — acceptable for this slice (autonomous suggestions are visual-only until engaged), but it is the first thing the next slice fixes. This is called out so the executor expects some autonomous-widget projection tests to need the seed-canonical update.
- **Type consistency:** `canonical_to_nodes` returns node dicts with `id/type/layer_id/params`, consumed identically in Task 5's `project_to_graph`. `set_param(layer, op, param, value)` signature is identical in Tasks 2, 3, 4. Canonical key `op == node.type` is consistent across Tasks 1, 3, 4, 5.
- **No placeholders:** every step has concrete code/commands. The one judgement call (updating pre-existing widget-projection tests after the Task 5 switch) is described with the exact fix (seed canonical first).
