# Extract → New-Node Targeting — Implementation Plan (Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the agentic loop end-to-end — when the LLM extracts an object into a new image node, it learns that node's id + layer id and can then target it with `propose_adjustment_widgets`, so the prompted edits land on the extracted node.

**Architecture:** Plan 3 of 3 (spec `docs/superpowers/specs/2026-06-26-agentic-client-tool-loop-design.md` §3.D/E). **Simplification discovered during planning:** `propose_stack` does NOT use or validate `image_node_id` — it stamps each widget's `layer_id` from the scope's `layer_ids` (frontend layer UUIDs). So a node is targeted purely by its **layer id**; the heavyweight backend cutout-upload in spec §3.D is unnecessary for this flow. We use **consistent frontend ids**: `extract_object_to_image_node` returns `{image_node_id, layer_ids}`; the agent loop threads any tool result that carries those into `node_layers`; `propose_adjustment_widgets(target)` resolves `layer_ids` from `node_layers` and builds an `image_node` scope. The active node's real ids seed `node_layers` (replacing Plan 2's `DEFAULT_IMAGE_NODE_ID` stand-in).

**Tech Stack:** React + Zustand + Zod (frontend), FastAPI + asyncio (backend), vitest + pytest.

## Global Constraints

- TypeScript strict; named Lucide imports; design tokens only — per `CLAUDE.md`.
- Gate passes before each commit: `npm run check` + backend `pytest`.
- Builds on Plan 1 (transport) + Plan 2 (agent loop), both on `main`.
- The agent-loop round-trip result shape is `{ok, output, error, denied}` where a client tool's own return is under `output` (see Plan 1's `runClientTool`/`postToolResult`). The loop reads `output` to thread `node_layers` and to feed the LLM.
- Deviation from spec §3.D (backend cutout upload): omitted — justified because `propose_stack` ignores `image_node_id`. Documented here.

## CARE POINT (live verification)

The unit tests below fully cover the id-threading mechanics, but the **visual end-to-end** (widgets actually rendering on the extracted node) depends on the frontend WebGL pipeline matching widget `layer_id` to the new node's layer — which can't be asserted in jsdom. After this plan, smoke-test live: prompt "extract the sky to its own layer and make it dramatic", approve the extract, and confirm the adjustment widget appears on the new node.

---

## File Structure

- `src/lib/segmentation/object-actions.ts` — `extractObjectToImageNode` returns `{imageNodeId, layerId}` (was `void`).
- `src/lib/tool-manifest/tools/extract-object-to-image-node.ts` — output schema + handler return the ids.
- `backend/app/tools/agent_loop.py` — `run_agent_turn` threads client-tool `output` ids into `node_layers`.
- `src/lib/palette-actions.agent.ts` — `runAgentTurn` sends the active node's `{image_node_id, layer_ids}`.
- `backend/app/api/state.py` — `_AgentTurnBody.active_node`; seed `node_layers` from it.
- Tests alongside each.

---

### Task 1: `extractObjectToImageNode` returns the new ids

**Files:**
- Modify: `src/lib/segmentation/object-actions.ts` (`extractObjectToImageNode`, ~lines 110-164)
- Modify: `src/lib/segmentation/object-actions.test.ts` (add a return-value assertion)

**Interfaces:**
- Produces: `extractObjectToImageNode(maskId, sourceImageNodeId): { imageNodeId: string; layerId: string } | null` — returns the new workspace node id + baked layer id, or `null` on any early-out (missing mask/layer). Existing manual callers (`ImageNodeObjectsLayer`, `ImageNodeDrafting`, `ObjectMarkers`) ignore the return — no change needed there.

- [ ] **Step 1: Write the failing test**

In `src/lib/segmentation/object-actions.test.ts`, find the existing `extractObjectToImageNode` describe block (it currently asserts the side effects). Add a test:

```ts
it('returns the new image-node id and baked layer id', () => {
  // (Reuse the block's existing setup that registers a mask + source node;
  //  mirror the variable names already used in this file — `maskRef`, `srcId`.)
  const result = extractObjectToImageNode(maskRef, srcId);
  expect(result).not.toBeNull();
  expect(typeof result!.imageNodeId).toBe('string');
  expect(typeof result!.layerId).toBe('string');
  // The returned layer id is the active node's first layer after extraction.
  const activeNodeId = useEditorStore.getState().activeImageNodeId;
  expect(result!.imageNodeId).toBe(activeNodeId);
});
```

> If the existing block's setup vars differ, read the top of that describe block (around `object-actions.test.ts:37`) and reuse its exact `maskRef`/`srcId` (or equivalent) setup so the mask + source node exist.

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/lib/segmentation/object-actions.test.ts`
Expected: FAIL — `result` is `undefined` (function returns void).

- [ ] **Step 3: Implement the returns**

In `src/lib/segmentation/object-actions.ts`, change `extractObjectToImageNode`'s signature and add returns. The early-outs become `return null`; the success path returns the ids. The current body sets `newLayerId` (from `extractLayerFromMask`) and `newNodeId` (from `editor.addImageNode`). Update:

```ts
export function extractObjectToImageNode(
  maskId: string,
  sourceImageNodeId: string,
): { imageNodeId: string; layerId: string } | null {
```

Replace each early-out `return;` (the `!mask`, `!srcNode`, `!sourceLayerId`, and `catch` paths) with `return null;`, and at the end of the success path (right after `editor.setActiveImageNode(newNodeId);`) add:

```ts
    editor.setActiveImageNode(newNodeId);
    return { imageNodeId: newNodeId, layerId: newLayerId };
```

(The `catch (err)` block: keep the toast, then `return null;`.)

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run src/lib/segmentation/object-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck (callers ignore the return) + commit**

Run: `npx tsc -b`
Expected: exit 0 (manual callers discard the value — valid).

```bash
git add src/lib/segmentation/object-actions.ts src/lib/segmentation/object-actions.test.ts
git commit -m "feat(extract): extractObjectToImageNode returns {imageNodeId, layerId}"
```

---

### Task 2: Extract LLM tool returns the ids

**Files:**
- Modify: `src/lib/tool-manifest/tools/extract-object-to-image-node.ts`
- Modify: `src/lib/tool-manifest/tools/extract-object-to-image-node.test.ts`

**Interfaces:**
- Consumes: `extractObjectToImageNode(...) -> {imageNodeId, layerId} | null` (Task 1).
- Produces: the `extract_object_to_image_node` tool's output is `{ ok: boolean; image_node_id?: string; layer_ids?: string[]; message?: string }`. On success it carries `image_node_id` (the new node) + `layer_ids` (`[layerId]`) — the agent loop reads these to thread `node_layers`.

- [ ] **Step 1: Write the failing test**

In `src/lib/tool-manifest/tools/extract-object-to-image-node.test.ts`, the existing tests mock `extractObjectToImageNode`. Update the success mock to return ids and assert they surface. Add/adjust:

```ts
it('returns the new image_node_id and layer_ids on success', () => {
  (extractObjectToImageNode as ReturnType<typeof vi.fn>).mockReturnValue({
    imageNodeId: 'in-3', layerId: 'layer-uuid',
  });
  // (reuse the existing maskStore/objectOwnership setup that resolves the node)
  const result = extractObjectToImageNodeTool.handler({ maskId });
  expect(result).toMatchObject({ ok: true, image_node_id: 'in-3', layer_ids: ['layer-uuid'] });
});

it('returns ok:false when the extract is a no-op (null)', () => {
  (extractObjectToImageNode as ReturnType<typeof vi.fn>).mockReturnValue(null);
  const result = extractObjectToImageNodeTool.handler({ maskId });
  expect(result.ok).toBe(false);
});
```

> Mirror the existing test's setup (it already mocks `@/lib/segmentation/object-actions` and resolves a source node via `objectOwnership`/`maskStore`). Keep the existing "missing mask" test.

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/lib/tool-manifest/tools/extract-object-to-image-node.test.ts`
Expected: FAIL — result lacks `image_node_id` (handler returns the old ack shape).

- [ ] **Step 3: Implement**

In `src/lib/tool-manifest/tools/extract-object-to-image-node.ts`, replace the `ackSchema` output + handler with a richer output. Update the imports (drop `ackSchema`, add `z` if not present) and the manifest:

```ts
import { z } from 'zod';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import { extractObjectToImageNode } from '@/lib/segmentation/object-actions';
import type { ToolManifest } from '../types';

const input = z.object({
  maskId: z.string().describe('Object/mask id, from list_objects.'),
  imageNodeId: z.string().optional().describe('Source image-node. Defaults to the Object\'s recorded owner.'),
});

const output = z.object({
  ok: z.boolean(),
  image_node_id: z.string().optional().describe('The new image node carrying the cutout.'),
  layer_ids: z.array(z.string()).optional().describe('Layer ids of the new node (pass to propose_adjustment_widgets).'),
  message: z.string().optional(),
});

export const extractObjectToImageNodeTool: ToolManifest<typeof input, typeof output> = {
  name: 'extract_object_to_image_node',
  kind: 'mutate',
  description:
    'Bake the masked region of the Object into a new image-node placed next to the source. '
    + 'Returns the new image_node_id + layer_ids — pass them to propose_adjustment_widgets to edit it.',
  inputSchema: input,
  outputSchema: output,
  handler: ({ maskId, imageNodeId }) => {
    if (!maskStore.has(maskId)) {
      return { ok: false, message: `No Object with id "${maskId}".` };
    }
    const sourceImageNodeId =
      imageNodeId ?? objectOwnership.get(maskId) ?? useEditorStore.getState().activeImageNodeId ?? undefined;
    if (!sourceImageNodeId) {
      return { ok: false, message: 'Could not resolve source image-node for the Object.' };
    }
    const extracted = extractObjectToImageNode(maskId, sourceImageNodeId);
    if (!extracted) {
      return { ok: false, message: `Could not extract Object "${maskId}".` };
    }
    return { ok: true, image_node_id: extracted.imageNodeId, layer_ids: [extracted.layerId] };
  },
};
```

- [ ] **Step 4: Run, verify pass + commit**

Run: `npx vitest run src/lib/tool-manifest/tools/extract-object-to-image-node.test.ts`
Expected: PASS.

```bash
git add src/lib/tool-manifest/tools/extract-object-to-image-node.ts src/lib/tool-manifest/tools/extract-object-to-image-node.test.ts
git commit -m "feat(extract): LLM tool returns new image_node_id + layer_ids"
```

---

### Task 3: Agent loop threads new nodes into `node_layers`

**Files:**
- Modify: `backend/app/tools/agent_loop.py` (`run_agent_turn` loop body)
- Modify: `backend/tests/tools/test_agent_loop_run.py` (add a test)

**Interfaces:**
- Produces: in `run_agent_turn`, after a client tool returns, its `output` (the tool's own return, unwrapped from the `{ok, output, ...}` round-trip envelope) is fed to the LLM, and when that `output` carries `image_node_id` + a `layer_ids` list, `node_layers[image_node_id] = layer_ids` so a later `propose_adjustment_widgets(target=that node)` resolves.

- [ ] **Step 1: Write the failing test**

In `backend/tests/tools/test_agent_loop_run.py`, add:

```python
@pytest.mark.asyncio
async def test_loop_threads_extracted_node_then_proposes_on_it():
    llm = _ScriptedLLM([
        _Resp("tool_use", [_Block("tool_use", "extract_object_to_image_node",
                                  {"maskId": "m1"}, "tu_1")]),
        _Resp("tool_use", [_Block("tool_use", "propose_adjustment_widgets",
                                  {"target_image_node_id": "in-9", "intent": "dramatic"}, "tu_2")]),
        _Resp("end_turn", [_Block("text")]),
    ])
    proposed = []

    async def propose_fn(target_image_node_id, intent):
        proposed.append((target_image_node_id, intent))
        return {"ok": True, "widget_count": 1}

    async def client_tool_fn(name, input):
        # Round-trip envelope: the tool's own return sits under `output`.
        return {"ok": True, "output": {"ok": True, "image_node_id": "in-9", "layer_ids": ["l-9"]}}

    out = await run_agent_turn(
        agent_step=llm, sid="sid-1", intent="extract sky and make it dramatic",
        attached_objects=[], client_tools=[], node_layers={"in-1": ["l-1"]},
        propose_fn=propose_fn, client_tool_fn=client_tool_fn,
    )
    assert out == {"ok": True, "tool_calls": 2}
    # The extracted node in-9 was threaded, so propose targeted it (not rejected).
    assert proposed == [("in-9", "dramatic")]
```

- [ ] **Step 2: Run, verify fail**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools/test_agent_loop_run.py::test_loop_threads_extracted_node_then_proposes_on_it -q`
Expected: FAIL — `in-9` is unknown (not threaded), so propose returns an error and `proposed` stays empty.

- [ ] **Step 3: Implement the threading**

In `backend/app/tools/agent_loop.py`, in `run_agent_turn`'s per-block loop, replace the `else:` client-tool branch (currently `result = await client_tool_fn(block.name, block.input or {})`) with:

```python
            else:
                envelope = await client_tool_fn(block.name, block.input or {})
                # Unwrap the round-trip envelope: the tool's own return is under
                # `output`. Feed THAT to the LLM, and thread any new image node
                # so a later propose_adjustment_widgets can target it.
                output = envelope.get("output") if isinstance(envelope, dict) else None
                result = output if output is not None else envelope
                if isinstance(output, dict):
                    node = output.get("image_node_id")
                    layers = output.get("layer_ids")
                    if isinstance(node, str) and node and isinstance(layers, list):
                        node_layers[node] = layers
```

(The `if block.name == _PROPOSE_TOOL_NAME:` branch is unchanged — `result` is the propose_fn return.)

- [ ] **Step 4: Run, verify pass (incl. existing Plan-2 loop tests)**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/tools/test_agent_loop_run.py -q`
Expected: PASS (4 tests — the 3 from Plan 2 still pass; the unwrap is compatible with their list/dict outputs).

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/agent_loop.py backend/tests/tools/test_agent_loop_run.py
git commit -m "feat(agent): thread extracted image nodes into node_layers"
```

---

### Task 4: Seed `node_layers` from the active node

**Files:**
- Modify: `src/lib/palette-actions.agent.ts` (`runAgentTurn` sends `active_node`)
- Modify: `src/lib/palette-actions.agent.test.ts`
- Modify: `backend/app/api/state.py` (`_AgentTurnBody.active_node`; seed `node_layers`)
- Modify: `backend/tests/api/test_agent_turn.py`

**Interfaces:**
- Consumes: `useEditorStore` (`activeImageNodeId`, `imageNodes[id].layerIds`).
- Produces:
  - `runAgentTurn` request body gains `active_node: { image_node_id: string; layer_ids: string[] } | null`.
  - `_AgentTurnBody.active_node: dict | None`; the endpoint seeds `node_layers` from it (replacing the `DEFAULT_IMAGE_NODE_ID` stand-in), so `propose_adjustment_widgets` on the *original* node resolves with real layer ids.

- [ ] **Step 1: Write the failing frontend test**

In `src/lib/palette-actions.agent.test.ts`, extend the existing test (or add one) so the active node is sent:

```ts
it('includes the active node id + layer ids', async () => {
  const { useEditorStore } = await import('@/store');
  const nodeId = useEditorStore.getState().addImageNode(['l-1', 'l-2']);
  useEditorStore.getState().setActiveImageNode(nodeId);
  await runAgentTurn('x', []);
  const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
  const body = JSON.parse((init as RequestInit).body as string);
  expect(body.active_node).toEqual({ image_node_id: nodeId, layer_ids: ['l-1', 'l-2'] });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run src/lib/palette-actions.agent.test.ts`
Expected: FAIL — `body.active_node` is undefined.

- [ ] **Step 3: Implement frontend `active_node`**

In `src/lib/palette-actions.agent.ts`, update `backendTools.agentTurn`'s body type (in `src/lib/backend-tools.ts` — add the field) and `runAgentTurn`:

In `src/lib/backend-tools.ts`, widen the `agentTurn` body param type:

```ts
    body: {
      intent: string; attached_objects: string[]; client_tools: unknown[];
      active_node: { image_node_id: string; layer_ids: string[] } | null;
    },
```

In `src/lib/palette-actions.agent.ts`, build `active_node` from the store and pass it:

```ts
import { serializeForAgentLoop } from '@/lib/tool-manifest/serialize';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';

export const AGENT_LOOP_TOOLS: string[] = [
  'get_image_context',
  'list_objects',
  'get_active_selection',
  'select_object',
  'extract_object_to_image_node',
  'convert_object_to_layer_mask',
];

export async function runAgentTurn(
  prompt: string,
  attachedObjects: string[],
): Promise<{ ok: boolean; toolCalls: number }> {
  const sid = useBackendState.getState().sessionId;
  if (!sid) return { ok: false, toolCalls: 0 };
  const editor = useEditorStore.getState();
  const nodeId = editor.activeImageNodeId;
  const node = nodeId ? editor.imageNodes[nodeId] : undefined;
  const activeNode = node ? { image_node_id: nodeId as string, layer_ids: node.layerIds } : null;
  return backendTools.agentTurn(sid, {
    intent: prompt,
    attached_objects: attachedObjects,
    client_tools: serializeForAgentLoop(AGENT_LOOP_TOOLS),
    active_node: activeNode,
  });
}
```

- [ ] **Step 4: Run, verify frontend pass**

Run: `npx vitest run src/lib/palette-actions.agent.test.ts`
Expected: PASS. (The original Plan-2 test asserts a subset of the body, so it still passes.)

- [ ] **Step 5: Write the failing backend test**

In `backend/tests/api/test_agent_turn.py`, extend the success test to assert seeding:

```python
def test_agent_turn_seeds_node_layers_from_active_node():
    client = TestClient(app)
    store = deps.get_session_store()
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    captured = {}

    async def fake_run_agent_turn(**kwargs):
        captured["node_layers"] = kwargs["node_layers"]
        return {"ok": True, "tool_calls": 0}

    with patch("app.api.state.run_agent_turn", fake_run_agent_turn):
        resp = client.post(
            f"/api/state/{sid}/agent_turn",
            json={
                "intent": "x", "attached_objects": [], "client_tools": [],
                "active_node": {"image_node_id": "in-2", "layer_ids": ["l-a", "l-b"]},
            },
        )
    assert resp.status_code == 200
    assert captured["node_layers"] == {"in-2": ["l-a", "l-b"]}
```

- [ ] **Step 6: Run, verify backend fail**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/api/test_agent_turn.py::test_agent_turn_seeds_node_layers_from_active_node -q`
Expected: FAIL — `node_layers` is the `DEFAULT_IMAGE_NODE_ID` stand-in, not `{"in-2": ...}`.

- [ ] **Step 7: Implement backend seeding**

In `backend/app/api/state.py`, add `active_node` to the body model:

```python
class _AgentTurnBody(BaseModel):
    intent: str
    attached_objects: list[str] = []
    client_tools: list[dict] = []
    active_node: dict | None = None
```

In `state_agent_turn`, replace the stand-in:

```python
    # Seed node_layers from the active node the frontend sent (real layer ids).
    # Falls back to the default node when none was supplied (e.g. empty canvas).
    if body.active_node and body.active_node.get("image_node_id"):
        node_layers = {body.active_node["image_node_id"]: list(body.active_node.get("layer_ids", []))}
    else:
        node_layers = {DEFAULT_IMAGE_NODE_ID: [DEFAULT_IMAGE_NODE_ID]}
```

- [ ] **Step 8: Run, verify backend pass**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/api/test_agent_turn.py -q`
Expected: PASS (3 tests).

- [ ] **Step 9: Full gate + commit**

Run: `npm run check`
Expected: green.

```bash
git add src/lib/palette-actions.agent.ts src/lib/backend-tools.ts src/lib/palette-actions.agent.test.ts backend/app/api/state.py backend/tests/api/test_agent_turn.py
git commit -m "feat(agent): seed node_layers from the active node"
```

---

## Final verification

- [ ] **Backend:** `cd backend && source .venv/bin/activate && python -m pytest tests/ -q` — all pass except the pre-existing `test_prune_disk_removes_old_records`.
- [ ] **Frontend:** `npm run check` — exit 0.
- [ ] **CARE POINT — live smoke test:** prompt "extract the sky to its own layer and make it dramatic", approve the extract chip, confirm the adjustment widget lands on the new image node.

## Self-review notes (coverage vs spec §3.D/E)

- §3.D extract returns a targetable node: Task 1 (function) + Task 2 (tool) + Task 3 (loop threads it). The backend cutout-upload is intentionally omitted (propose_stack ignores image_node_id; widgets target via layer_ids) — documented deviation. ✔
- §3.E real per-node layer ids: Task 4 (active node seeds node_layers; extracted nodes threaded in Task 3). ✔
- §3.F tool set unchanged from Plan 2. ✔

## Feature complete

With Plans 1–3 merged, the full USP flow works: object chip → LLM extracts to a new node (user-approved) → LLM edits that node — the agentic client-tool loop end to end.
