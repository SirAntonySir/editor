# Force Region Extraction in the Agent Turn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user attaches region chips in the command palette and runs an agent prompt, deterministically segment-and-extract each chip into its own image node *before* the LLM loop, and tell the LLM those nodes are its targets — so the agent always acts on the selection instead of the whole image.

**Architecture:** Move the "extract the selected object" decision out of the LLM's hands. In `runAgentTurn` (frontend), resolve each attached chip's `sourceId` to a concrete mask id (reusing the existing pure `resolveRegionMaskId`), extract each into a new image node (reusing `extractObjectToImageNode`), and send the resulting node ids to the backend as `forced_targets`. The backend seeds those into `node_layers` and the system prompt instructs the LLM to call `propose_adjustment_widgets` on each forced target and **not** on the original image. Chips that can't be resolved to a backing mask (AI-label regions with no `maskRef`) degrade gracefully — they ride along as `attached_objects` exactly as today.

**Tech Stack:** TypeScript/React (Vitest) frontend; FastAPI/Pydantic (pytest) backend. Anthropic tool-use loop in `backend/app/tools/agent_loop.py`.

## Global Constraints

- TypeScript strict mode; no inline-defined components; named Lucide imports only (`CLAUDE.md`).
- Frontend gate before commit: `npm run check` (`gen:types:check` + `tsc -b` + `eslint .` + `vitest`).
- Backend: `pytest`, `asyncio_mode=auto`.
- Pure logic must be unit-testable without store/DOM mutation — keep resolution/planning pure and isolate the mutating extraction calls.
- The deployed backend installs from `backend/pyproject.toml`; do not add dependencies.
- Reuse before invent: `resolveRegionMaskId` (`src/lib/segmentation/region-resolve.ts`) and `extractObjectToImageNode` (`src/lib/segmentation/object-actions.ts`) already exist — do not reimplement.

## Known tradeoffs (decided)

- **Undo granularity:** pre-extraction runs as frontend store ops *before* the agent turn, so extracting and the subsequent widget proposals are **separate** undo steps (extract = its own Cmd+Z). The "one history entry per agent turn" rule (`docs/superpowers/specs/2026-06-26-agentic-client-tool-loop-design.md`) still holds for the *adjustment* phase. Accepted for v1. The alternative — driving extraction through the backend's `request_client_tool` round-trip inside the turn to keep undo atomic — is deferred.
- **AI-label chips with no `maskRef`:** v1 does **not** run a fresh SAM decode to materialise a mask. Such chips fall back to `attached_objects` (agent may still act). Materialising AI regions deterministically is deferred.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/prompt-doc.ts` | Serialize the palette doc into agent-turn args | Add `chipSourceIds` to `serializePromptDoc` return |
| `src/lib/segmentation/forced-extraction.ts` | **New.** Pure planner: split chip sourceIds into extractable (sourceId+maskId) vs. fallback ids | Create |
| `src/lib/palette-actions.agent.ts` | Run the agent turn | Pre-extract forced targets, send `forced_targets` |
| `src/lib/backend-tools.ts` | `agentTurn` request body | Add `forced_targets` field |
| `src/components/CommandPalette.tsx` | Palette submit handler | Pass `chipSourceIds` to `runAgentTurn` |
| `backend/app/api/state.py` | `agent_turn` endpoint | `_AgentTurnBody.forced_targets`; seed `node_layers`; pass ids to loop |
| `backend/app/tools/agent_loop.py` | The LLM loop + system prompt | `run_agent_turn(forced_targets=…)`; rewrite `_build_system` |

Tests live beside each unit (`*.test.ts` / `backend/tests/...`).

---

### Task 1: `serializePromptDoc` also returns chip source ids

**Files:**
- Modify: `src/lib/prompt-doc.ts:54-75`
- Test: `src/lib/prompt-doc.test.ts`

**Interfaces:**
- Consumes: `PromptDoc`, `PromptSegment`, `extractObjectIds` (already in this file).
- Produces: `serializePromptDoc(doc, trayChips?) → { intent: string; attachedObjects: string[]; chipSourceIds: string[] }`. `chipSourceIds` is the deduped raw `sourceId` list (doc chips first, then tray chips), preserving the existing `attachedObjects` field unchanged.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/prompt-doc.test.ts`:

```ts
import { serializePromptDoc } from './prompt-doc';

it('returns deduped chip sourceIds, doc chips before tray chips', () => {
  const doc = [
    { kind: 'text' as const, text: 'brighten ' },
    { kind: 'chip' as const, label: 'Sky', sourceId: 'region:ai:sky' },
    { kind: 'text' as const, text: ' and ' },
    { kind: 'chip' as const, label: 'Shoes', sourceId: 'region:object:m1' },
  ];
  const tray = [{ sourceId: 'region:object:m1' }, { sourceId: 'region:object:m2' }];
  const { chipSourceIds } = serializePromptDoc(doc, tray);
  expect(chipSourceIds).toEqual(['region:ai:sky', 'region:object:m1', 'region:object:m2']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/prompt-doc.test.ts -t "chip sourceIds"`
Expected: FAIL — `chipSourceIds` is `undefined`.

- [ ] **Step 3: Implement**

In `src/lib/prompt-doc.ts`, change the return type and body of `serializePromptDoc`:

```ts
): { intent: string; attachedObjects: string[]; chipSourceIds: string[] } {
  const intent = docToPlainText(doc).trim();
  const chipSources: Array<{ sourceId?: string }> = [
    ...doc.filter((s): s is Extract<PromptSegment, { kind: 'chip' }> => s.kind === 'chip'),
    ...trayChips,
  ];
  const seen = new Set<string>();
  const attachedObjects: string[] = [];
  for (const id of extractObjectIds(chipSources)) {
    if (seen.has(id)) continue;
    seen.add(id);
    attachedObjects.push(id);
  }
  const seenSrc = new Set<string>();
  const chipSourceIds: string[] = [];
  for (const s of chipSources) {
    if (!s.sourceId || seenSrc.has(s.sourceId)) continue;
    seenSrc.add(s.sourceId);
    chipSourceIds.push(s.sourceId);
  }
  return { intent, attachedObjects, chipSourceIds };
}
```

Also update the doc-comment above to mention `chipSourceIds`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/prompt-doc.test.ts`
Expected: PASS (all existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompt-doc.ts src/lib/prompt-doc.test.ts
git commit -m "feat(palette): serializePromptDoc returns chip sourceIds"
```

---

### Task 2: Pure planner — split chips into extractable vs. fallback

**Files:**
- Create: `src/lib/segmentation/forced-extraction.ts`
- Test: `src/lib/segmentation/forced-extraction.test.ts`

**Interfaces:**
- Consumes: `resolveRegionMaskId` (`./region-resolve`), `extractObjectIds` (`@/lib/prompt-doc`), `CandidateRegion` (`@/types/image-context`).
- Produces:
  ```ts
  export interface ForcedExtractionPlan {
    extractable: Array<{ sourceId: string; maskId: string }>;
    fallbackIds: string[];
  }
  export function planForcedExtractions(
    chipSourceIds: ReadonlyArray<string>,
    candidateRegions: ReadonlyArray<CandidateRegion>,
    maskExists: (maskId: string) => boolean,
  ): ForcedExtractionPlan
  ```
  A chip is *extractable* when it resolves to a mask id that currently exists in the store (`maskExists` true). Everything else (unresolvable, or resolved but mask absent) becomes a `fallbackId` (the parsed object id, via `extractObjectIds`), preserving today's `attached_objects` behaviour.

- [ ] **Step 1: Write the failing test**

Create `src/lib/segmentation/forced-extraction.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { planForcedExtractions } from './forced-extraction';
import type { CandidateRegion } from '@/types/image-context';

const REGIONS = [
  { label: 'Sky', description: '', maskRef: 'mask-sky' },
  { label: 'Grass', description: '' }, // no maskRef → not extractable
] as unknown as CandidateRegion[];

describe('planForcedExtractions', () => {
  it('extracts committed objects and ai-regions with a backing mask', () => {
    const plan = planForcedExtractions(
      ['region:object:m1', 'region:ai:sky'],
      REGIONS,
      (id) => id === 'm1' || id === 'mask-sky',
    );
    expect(plan.extractable).toEqual([
      { sourceId: 'region:object:m1', maskId: 'm1' },
      { sourceId: 'region:ai:sky', maskId: 'mask-sky' },
    ]);
    expect(plan.fallbackIds).toEqual([]);
  });

  it('falls back when the mask is missing or the ai-region has no maskRef', () => {
    const plan = planForcedExtractions(
      ['region:object:gone', 'region:ai:grass'],
      REGIONS,
      () => false,
    );
    expect(plan.extractable).toEqual([]);
    // parsed object ids: committed → its mask id; ai → its label
    expect(plan.fallbackIds).toEqual(['gone', 'grass']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/segmentation/forced-extraction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/segmentation/forced-extraction.ts`:

```ts
import type { CandidateRegion } from '@/types/image-context';
import { resolveRegionMaskId } from './region-resolve';
import { extractObjectIds } from '@/lib/prompt-doc';

/** A plan for deterministically extracting attached region chips before the
 *  agent loop. `extractable` chips have a backing mask in the store and will be
 *  baked into their own image node; `fallbackIds` are the parsed object ids of
 *  the rest, passed to the backend as `attached_objects` (today's behaviour). */
export interface ForcedExtractionPlan {
  extractable: Array<{ sourceId: string; maskId: string }>;
  fallbackIds: string[];
}

export function planForcedExtractions(
  chipSourceIds: ReadonlyArray<string>,
  candidateRegions: ReadonlyArray<CandidateRegion>,
  maskExists: (maskId: string) => boolean,
): ForcedExtractionPlan {
  const extractable: Array<{ sourceId: string; maskId: string }> = [];
  const fallbackSources: Array<{ sourceId: string }> = [];
  for (const sourceId of chipSourceIds) {
    const maskId = resolveRegionMaskId(sourceId, candidateRegions);
    if (maskId && maskExists(maskId)) {
      extractable.push({ sourceId, maskId });
    } else {
      fallbackSources.push({ sourceId });
    }
  }
  return { extractable, fallbackIds: extractObjectIds(fallbackSources) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/segmentation/forced-extraction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/segmentation/forced-extraction.ts src/lib/segmentation/forced-extraction.test.ts
git commit -m "feat(agent): pure planner for forced region extraction"
```

---

### Task 3: Pre-extract in `runAgentTurn` and send `forced_targets`

**Files:**
- Modify: `src/lib/palette-actions.agent.ts`
- Modify: `src/lib/backend-tools.ts:281-296` (`agentTurn` body type)
- Modify: `src/components/CommandPalette.tsx:445,484`
- Test: `src/lib/palette-actions.agent.test.ts`

**Interfaces:**
- Consumes: `planForcedExtractions` (Task 2), `extractObjectToImageNode` (`@/lib/segmentation/object-actions`), `objectOwnership` (`@/lib/segmentation/object-ownership`), `maskStore` (`@/core/mask-store`), `useAiSession` (`@/hooks/useImageContext`), `useEditorStore`, `useBackendState`, `backendTools`.
- Produces: `runAgentTurn(prompt: string, chipSourceIds: string[]) → Promise<{ ok: boolean; toolCalls: number }>` (signature changes: second arg is now chip **sourceIds**, not parsed ids). `backendTools.agentTurn` body gains `forced_targets: { image_node_id: string; layer_ids: string[] }[]`.

- [ ] **Step 1: Write the failing test**

Create/extend `src/lib/palette-actions.agent.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const extractMock = vi.fn();
const agentTurnMock = vi.fn(async () => ({ ok: true, toolCalls: 1 }));

vi.mock('@/lib/segmentation/object-actions', () => ({
  extractObjectToImageNode: (...a: unknown[]) => extractMock(...a),
}));
vi.mock('@/lib/segmentation/object-ownership', () => ({
  objectOwnership: { get: () => 'node-src' },
}));
vi.mock('@/core/mask-store', () => ({
  maskStore: { has: (id: string) => id === 'm1' },
}));
vi.mock('@/hooks/useImageContext', () => ({
  useAiSession: { getState: () => ({ context: { candidateRegions: [] } }) },
}));
vi.mock('@/store', () => ({
  useEditorStore: { getState: () => ({ activeImageNodeId: 'node-src', imageNodes: { 'node-src': { layerIds: ['L0'] } } }) },
}));
vi.mock('@/store/backend-state-slice', () => ({
  useBackendState: { getState: () => ({ sessionId: 'sid-1' }) },
}));
vi.mock('@/lib/backend-tools', () => ({
  backendTools: { agentTurn: (...a: unknown[]) => agentTurnMock(...a) },
}));
vi.mock('@/lib/tool-manifest/serialize', () => ({ serializeForAgentLoop: () => [] }));

import { runAgentTurn } from './palette-actions.agent';

beforeEach(() => { extractMock.mockReset(); agentTurnMock.mockClear(); });

describe('runAgentTurn forced extraction', () => {
  it('extracts a committed object chip and sends it as a forced_target', async () => {
    extractMock.mockReturnValue({ imageNodeId: 'node-new', layerId: 'L1' });
    await runAgentTurn('make it pop', ['region:object:m1']);
    expect(extractMock).toHaveBeenCalledWith('m1', 'node-src');
    const [, body] = agentTurnMock.mock.calls[0] as [string, any];
    expect(body.forced_targets).toEqual([{ image_node_id: 'node-new', layer_ids: ['L1'] }]);
    expect(body.attached_objects).toEqual([]);
  });

  it('passes unresolvable chips through as attached_objects', async () => {
    await runAgentTurn('warm it up', ['region:object:missing']);
    expect(extractMock).not.toHaveBeenCalled();
    const [, body] = agentTurnMock.mock.calls[0] as [string, any];
    expect(body.forced_targets).toEqual([]);
    expect(body.attached_objects).toEqual(['missing']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/palette-actions.agent.test.ts`
Expected: FAIL — `runAgentTurn` still takes parsed ids and sends no `forced_targets`.

- [ ] **Step 3: Implement `runAgentTurn`**

Replace the body of `src/lib/palette-actions.agent.ts` (keep `AGENT_LOOP_TOOLS` unchanged):

```ts
import { serializeForAgentLoop } from '@/lib/tool-manifest/serialize';
import { backendTools } from '@/lib/backend-tools';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { useAiSession } from '@/hooks/useImageContext';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import { extractObjectToImageNode } from '@/lib/segmentation/object-actions';
import { planForcedExtractions } from '@/lib/segmentation/forced-extraction';

// ...AGENT_LOOP_TOOLS unchanged...

/** Run an agentic palette turn. Deterministically extracts each attached region
 *  chip into its own image node BEFORE the LLM loop, then tells the loop those
 *  nodes are its targets (see forced_targets). Chips with no backing mask fall
 *  back to `attached_objects`. */
export async function runAgentTurn(
  prompt: string,
  chipSourceIds: string[],
): Promise<{ ok: boolean; toolCalls: number }> {
  const sid = useBackendState.getState().sessionId;
  if (!sid) return { ok: false, toolCalls: 0 };

  const editor = useEditorStore.getState();
  const activeNodeId = editor.activeImageNodeId;
  const activeNode = activeNodeId ? editor.imageNodes[activeNodeId] : undefined;
  const candidateRegions = useAiSession.getState().context?.candidateRegions ?? [];

  const plan = planForcedExtractions(chipSourceIds, candidateRegions, (id) => maskStore.has(id));

  const forcedTargets: { image_node_id: string; layer_ids: string[] }[] = [];
  const fallbackIds = [...plan.fallbackIds];
  for (const { maskId } of plan.extractable) {
    const sourceNodeId = objectOwnership.get(maskId) ?? activeNodeId ?? undefined;
    const extracted = sourceNodeId ? extractObjectToImageNode(maskId, sourceNodeId) : null;
    if (extracted) {
      forcedTargets.push({ image_node_id: extracted.imageNodeId, layer_ids: [extracted.layerId] });
    } else {
      fallbackIds.push(maskId); // extraction failed → let the agent try
    }
  }

  const activeNodePayload =
    activeNodeId && activeNode
      ? { image_node_id: activeNodeId, layer_ids: activeNode.layerIds }
      : null;

  return backendTools.agentTurn(sid, {
    intent: prompt,
    attached_objects: fallbackIds,
    forced_targets: forcedTargets,
    client_tools: serializeForAgentLoop(AGENT_LOOP_TOOLS),
    active_node: activeNodePayload,
  });
}
```

- [ ] **Step 4: Extend the `agentTurn` body type**

In `src/lib/backend-tools.ts:281-287`, add `forced_targets` to the body:

```ts
  async agentTurn(
    sessionId: string,
    body: {
      intent: string; attached_objects: string[];
      forced_targets: { image_node_id: string; layer_ids: string[] }[];
      client_tools: unknown[];
      active_node: { image_node_id: string; layer_ids: string[] } | null;
    },
  ): Promise<{ ok: boolean; toolCalls: number }> {
```

- [ ] **Step 5: Update the palette call site**

In `src/components/CommandPalette.tsx`, the submit handler (~line 445) currently destructures `attachedObjects`; switch to `chipSourceIds` and pass it:

```ts
const { intent: submitted, chipSourceIds } = serializePromptDoc(doc, attachedContext);
// ...
const turn = await runAgentTurn(submitted, chipSourceIds);
```

(Leave the surrounding analyze/markAnalyzeComplete logic untouched.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/palette-actions.agent.test.ts src/components/CommandPalette.test.tsx`
Expected: PASS. If `CommandPalette.test.tsx` asserted the old `runAgentTurn(_, attachedObjects)` shape, update those expectations to the `chipSourceIds` arg.

- [ ] **Step 7: Commit**

```bash
git add src/lib/palette-actions.agent.ts src/lib/backend-tools.ts src/components/CommandPalette.tsx src/lib/palette-actions.agent.test.ts
git commit -m "feat(agent): deterministically extract attached region chips before the loop"
```

---

### Task 4: Backend — accept `forced_targets`, seed `node_layers`

**Files:**
- Modify: `backend/app/api/state.py:64-68` (`_AgentTurnBody`), `:114-165` (`state_agent_turn`)
- Test: `backend/tests/api/test_agent_turn.py`

**Interfaces:**
- Consumes: `run_agent_turn` (extended in Task 5 to accept `forced_targets`).
- Produces: `_AgentTurnBody.forced_targets: list[dict]` (each `{image_node_id, layer_ids}`); the endpoint merges them into `node_layers` and passes the list of forced node ids to `run_agent_turn(..., forced_targets=[...])`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/api/test_agent_turn.py` (mirror the existing test's client/session setup; capture the kwargs passed to `run_agent_turn`):

```python
async def test_forced_targets_seed_node_layers(monkeypatch, client, session_id):
    captured = {}

    async def fake_run_agent_turn(**kwargs):
        captured.update(kwargs)
        return {"ok": True, "tool_calls": 0}

    monkeypatch.setattr("app.api.state.run_agent_turn", fake_run_agent_turn)

    resp = client.post(
        f"/api/state/{session_id}/agent_turn",
        json={
            "intent": "make it pop",
            "attached_objects": [],
            "forced_targets": [{"image_node_id": "node-new", "layer_ids": ["L1"]}],
            "client_tools": [],
            "active_node": {"image_node_id": "node-src", "layer_ids": ["L0"]},
        },
    )
    assert resp.status_code == 200
    assert captured["node_layers"]["node-new"] == ["L1"]
    assert captured["forced_targets"] == ["node-new"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/api/test_agent_turn.py::test_forced_targets_seed_node_layers -v`
Expected: FAIL — `_AgentTurnBody` rejects `forced_targets` / `run_agent_turn` got no such kwarg.

- [ ] **Step 3: Implement**

In `backend/app/api/state.py`, extend the body model:

```python
class _AgentTurnBody(BaseModel):
    intent: str
    attached_objects: list[str] = []
    forced_targets: list[dict] = []
    client_tools: list[dict] = []
    active_node: dict | None = None
```

In `state_agent_turn`, after the existing `node_layers` seeding block (around line 132), merge forced targets and collect their ids:

```python
    forced_target_ids: list[str] = []
    for ft in body.forced_targets:
        node_id = ft.get("image_node_id")
        if not node_id:
            continue
        node_layers[node_id] = list(ft.get("layer_ids", []))
        forced_target_ids.append(node_id)
```

Then pass it into the loop call (around line 159):

```python
    return await run_agent_turn(
        agent_step=anthropic.agent_message,
        sid=sid, intent=body.intent, attached_objects=body.attached_objects,
        client_tools=body.client_tools, node_layers=node_layers,
        forced_targets=forced_target_ids,
        propose_fn=propose_fn, client_tool_fn=client_tool_fn,
        image_context=image_context,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && pytest tests/api/test_agent_turn.py -v`
Expected: PASS (existing agent-turn tests still green).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/state.py backend/tests/api/test_agent_turn.py
git commit -m "feat(agent): agent_turn accepts forced_targets and seeds node_layers"
```

---

### Task 5: Backend — force the LLM onto the targets in the system prompt

**Files:**
- Modify: `backend/app/tools/agent_loop.py:63-82` (`_build_system`), `:90-114` (`run_agent_turn` signature + system build)
- Test: `backend/tests/tools/test_agent_loop_dispatch.py` (or a focused `test_build_system` there)

**Interfaces:**
- Consumes: `forced_targets: list[str]` from Task 4.
- Produces: `run_agent_turn(..., forced_targets: list[str] = [])`; `_build_system(attached_objects, node_ids, forced_targets)` emits a mandatory directive when `forced_targets` is non-empty.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/tools/test_agent_loop_dispatch.py`:

```python
from app.tools.agent_loop import _build_system


def test_build_system_forces_proposal_on_extracted_targets():
    sys = _build_system([], ["node-a"], ["node-new1", "node-new2"])
    assert "node-new1" in sys and "node-new2" in sys
    # mandatory, and explicitly off the original image
    assert "MUST" in sys
    low = sys.lower()
    assert "propose_adjustment_widgets" in low
    assert "whole image" in low or "original image" in low


def test_build_system_without_forced_targets_is_unchanged_shape():
    sys = _build_system([], ["the active image node"], [])
    assert "propose_adjustment_widgets" in sys
    assert "already" not in sys.lower()  # no extraction-done preamble
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && pytest tests/tools/test_agent_loop_dispatch.py -k build_system -v`
Expected: FAIL — `_build_system` takes only two args.

- [ ] **Step 3: Implement**

In `backend/app/tools/agent_loop.py`, change `_build_system`:

```python
def _build_system(
    attached_objects: list[str],
    node_ids: list[str],
    forced_targets: list[str] | None = None,
) -> str:
    forced_targets = forced_targets or []
    targets = ", ".join(node_ids) if node_ids else "the active image node"
    base = (
        "You are an editing agent for a photo editor. The user gives an editing "
        "request; you fulfil it by CALLING TOOLS, not by replying in prose.\n\n"
        "To apply any tonal/colour adjustment (contrast, warmth, exposure, mood, "
        "etc.) you MUST call propose_adjustment_widgets with target_image_node_id "
        f"set to an existing node id ({targets}) and a short intent describing the "
        "change. To put an object on its own layer first, call "
        "extract_object_to_image_node, then propose_adjustment_widgets on the "
        "image_node_id it returns. Do not stop until you have called at least one "
        "tool that satisfies the request."
    )
    if forced_targets:
        ids = ", ".join(forced_targets)
        base += (
            "\n\nThe user selected one or more regions, and they have ALREADY been "
            f"extracted onto their own image nodes: {ids}. You MUST apply the "
            "request by calling propose_adjustment_widgets on EACH of these node "
            "ids. Do NOT call extract_object_to_image_node again for them, and do "
            "NOT apply the adjustment to the whole/original image — only to these "
            "extracted target nodes."
        )
    elif attached_objects:
        base += (
            "\n\nThe user pinned these object/mask ids as context: "
            + ", ".join(attached_objects)
            + ". Prefer acting on them."
        )
    return base
```

Then update `run_agent_turn` — add the parameter and thread it into the system build:

```python
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
    image_context: dict | None = None,
    max_tool_calls: int = 10,
) -> dict[str, Any]:
    ...
    system = _build_system(attached_objects, list(node_layers.keys()), forced_targets)
```

(The `forced_targets` node ids are already present in `node_layers` because Task 4 seeded them, so `propose_fn` resolves their layer ids.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && pytest tests/tools/test_agent_loop_dispatch.py -v`
Expected: PASS (existing dispatch tests still green).

- [ ] **Step 5: Commit**

```bash
git add backend/app/tools/agent_loop.py backend/tests/tools/test_agent_loop_dispatch.py
git commit -m "feat(agent): force propose onto pre-extracted targets in the system prompt"
```

---

### Task 6: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Frontend gate**

Run: `npm run check`
Expected: PASS — `gen:types:check` + `tsc -b` + `eslint .` + `vitest`, 0 errors. Fix any type drift in `CommandPalette.tsx` / `agentTurn` callers surfaced here.

- [ ] **Step 2: Backend suite**

Run: `cd backend && pytest`
Expected: PASS (the one known `test_prune_disk_removes_old_records` time/FS flake aside).

- [ ] **Step 3: Manual smoke (document result)**

1. Open an image, segment an object (or accept an AI region chip).
2. In Cmd+K agent mode, attach the chip and prompt "make it dramatic".
3. Expect: a new image node appears with the cutout, and the proposed widgets land **on that node**, not the original.
4. Repeat with two chips → two extracted nodes, each receiving widgets.

- [ ] **Step 4: Commit (if any verification fixes were needed)**

```bash
git add -A && git commit -m "test(agent): verify forced region extraction end to end"
```

---

## Self-Review

**Spec coverage:**
- "Resolve chip → mask" → Task 2 (`resolveRegionMaskId` reuse). ✓
- "Extract before the loop" → Task 3 (`extractObjectToImageNode`). ✓
- "AI-label chip with no mask degrades to attached_objects" → Task 2 fallback + Task 3 (`fallbackIds`). ✓
- "Tell the LLM the targets, forbid whole-image" → Task 5 (`_build_system`). ✓
- "Backend seeds node_layers so propose resolves" → Task 4. ✓
- Undo-atomicity tradeoff and AI-region materialisation are explicitly deferred (top of plan). ✓

**Type consistency:** `forced_targets` is `{ image_node_id, layer_ids }[]` on the wire (frontend `backend-tools.ts` ↔ backend `_AgentTurnBody`); the backend converts to a `list[str]` of node ids before `run_agent_turn(forced_targets=…)`. `runAgentTurn(prompt, chipSourceIds)` ↔ `serializePromptDoc(...).chipSourceIds`. `planForcedExtractions` returns `{ extractable, fallbackIds }` consumed verbatim in Task 3. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓
</content>
