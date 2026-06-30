# Region Extraction Approval — ask before selecting/extracting an attached region, choose node vs layer

**Date:** 2026-06-30
**Status:** Design — approved, pending spec review
**Area:** agent submit flow (`runAgentTurn`), client-tool approval dock

## Problem

When the user attaches an `@region` chip and submits a prompt, `runAgentTurn`
**deterministically** segments/selects each attached region and extracts it to a
**new image node** — before the agent loop runs, with **no prompt and no choice**.
The user wants:

1. To be **asked before** a region is selected/extracted (not have it happen silently).
2. To **choose** whether the extraction lands in a **new image node** or a **new layer**.

The agent's own in-loop tools (`select_object`, `extract_object_to_image_node`,
`convert_object_to_layer_mask`) are already gated behind Allow/Deny chips
(`ClientToolApproval`, `client-tool-approval-slice`). The gap is the **deterministic
pre-extraction** path, which bypasses approval entirely; and the in-loop extract chip
only offers "node" (no "layer").

## Goal

Gate the attached-region pre-extraction with a **3-way chip** per region in the bottom
dock: **`→ New image node` / `→ New layer` / `Deny`**. The agent turn fires only after
all attached regions are resolved. A single chip covers both asks — **Deny** rejects the
selection; **Node/Layer** approves it and picks where it lands. For consistency, upgrade
the in-loop `extract_object_to_image_node` chip to the same 3-way choice.

## Non-Goals

- No change to plain prompts (no `@region`) — they behave exactly as today.
- No change to `select_object` / `convert_object_to_layer_mask` in-loop gates.
- No backend change — the layer path returns the same `{ image_node_id, layer_ids }`
  contract (node = source node, layer = the new layer).
- Removing the deterministic pre-extraction (rejected: the Render path has no server-side
  SAM, so attached regions must be segmented client-side and force-targeted; handing that
  to the LLM would change behavior and risk correctness).

## Design

### Decision type

```ts
export type ExtractChoice = 'node' | 'layer' | 'deny';
```

### A. Region-extraction approval store

`src/store/region-extraction-approval.ts` — a small store + module-level resolver map
(Promises aren't stored in Zustand state; only render data is).

```ts
interface PendingRegion { id: string; label: string }
interface RegionApprovalState {
  pending: PendingRegion[];
  // request() pushes a pending entry and returns a promise resolved by the dock UI.
  request(label: string): Promise<ExtractChoice>;
  resolve(id: string, choice: ExtractChoice): void;
  reset(): void;
}
```
`request` generates an id, stores `{id,label}` in `pending`, stashes the resolver in a
module `Map<id, (c) => void>`, and returns the promise. `resolve(id, choice)` calls the
stashed resolver, removes the entry. `reset()` resolves any stragglers to `'deny'` and
clears (used on session close / turn abort).

### B. Dock UI

`src/components/ui/RegionExtractionApproval.tsx` — mirrors `ClientToolApproval`'s slot in
`FloatingDock` (rendered just above it). One chip per pending region:

> `sky`  [→ New image node] [→ New layer] [Deny]

Buttons call `useRegionExtractionApproval.getState().resolve(id, choice)`. Hidden when
`!aiAccess` or `pending.length === 0` (same gating as `ClientToolApproval`).

### C. Refactor pre-extraction → `resolveAttachedRegions`

Pull the pre-extraction body out of `runAgentTurn` (`src/lib/palette-actions.agent.ts`)
into:

```ts
async function resolveAttachedRegions(
  regionSourceIds: string[],
  getChoice: (label: string) => Promise<ExtractChoice>,
): Promise<{ forcedTargets: ForcedTarget[]; fallbackIds: string[] }>
```

For each extractable/segmentable region (from `planForcedExtractions`):
- `getChoice(label)`:
  - `'deny'` → skip (drop the region entirely).
  - `'node'` → `extractObjectToImageNode(maskId, ownerNode)` → `{ image_node_id, layer_ids:[layerId] }`.
  - `'layer'` → `extractObjectToLayer(maskId, ownerNode)` → `{ image_node_id: ownerNode, layer_ids:[newLayerId] }`.
- Segmentable regions only run `segmentRegionFromPoint` (client SAM) **after** a non-deny
  choice — denied regions are never segmented.
- A region whose extraction fails falls back to `attached_objects` (current behavior).

`runAgentTurn` keeps splitting region vs explicit `target:*` chips, calls
`resolveAttachedRegions(regionSourceIds, getChoice)`, merges with explicit target chips,
dedupes, and fires `agentTurn`. `getChoice` defaults to the approval store's `request`;
tests inject a stub.

The `label` for a region comes from its chip — extend `planForcedExtractions` /
the resolve step to carry the human label (objects have a label; AI regions carry one;
fall back to the sourceId tail).

### D. In-loop extract chip → 3-way

`src/components/ui/ClientToolApproval.tsx` — when `req.name === 'extract_object_to_image_node'`,
render `→ New image node` / `→ New layer` / `Deny` instead of Allow/Deny. On:
- node → `LlmToolRegistry.invoke(name, input)` (unchanged).
- layer → resolve source node (`input.imageNodeId ?? objectOwnership.get(maskId) ??
  activeImageNodeId`), run `extractObjectToLayer(maskId, sourceNode)`, post
  `{ ok:true, image_node_id: sourceNode, layer_ids:[newLayer] }`.
- deny → post `{ ok:false, denied:true }`.
All three still go through `backendTools.postToolResult`. `select_object` and
`convert_object_to_layer_mask` keep plain Allow/Deny.

### Data flow

```
submit (@region attached)
  → close palette, pill spins
  → submitAgentPrompt → (analyze?) → runAgentTurn
      resolveAttachedRegions(regionSourceIds, store.request)
        → per region: enqueue dock chip → await user choice
            deny  → drop
            node  → extractObjectToImageNode → forced_target
            layer → extractObjectToLayer    → forced_target (source node + new layer)
      → agentTurn(forced_targets, …) → proposals stream onto canvas
```

## Edge cases

- **No attached regions** → `resolveAttachedRegions` enqueues nothing; turn proceeds
  immediately (today's behavior for plain prompts).
- **Deny all** → no forced targets; the turn still runs (active node + intent).
- **Multiple regions** → one chip each; the turn awaits all before firing `agentTurn`.
- **Maskless region, no point** (fallback) → no chip; passes as `attached_objects`
  (agent's in-loop gate covers any server-side action).
- **Session close / abort mid-approval** → `reset()` resolves pending to `'deny'`.
- **Extraction failure** after a non-deny choice → region falls back to `attached_objects`.

## Files

**New**
- `src/store/region-extraction-approval.ts`
- `src/components/ui/RegionExtractionApproval.tsx`

**Edited**
- `src/lib/palette-actions.agent.ts` — `resolveAttachedRegions`; `runAgentTurn` awaits it.
- `src/lib/segmentation/forced-extraction.ts` — carry region `label` through the plan.
- `src/components/ui/ClientToolApproval.tsx` — 3-way extract chip.
- `src/components/ui/FloatingDock.tsx` — mount `RegionExtractionApproval`.

## Testing

- `resolveAttachedRegions` (unit, stub `getChoice`, mock `extractObjectToImageNode` /
  `extractObjectToLayer` / `segmentRegionFromPoint`): node → image-node target; layer →
  source-node + new-layer target; deny → dropped (and never segmented); extraction failure
  → fallback id.
- `region-extraction-approval` store (unit): `request` returns a promise that `resolve`
  settles with the chosen value; `reset` denies stragglers.
- `ClientToolApproval` extract 3-way (unit/component): layer click calls
  `extractObjectToLayer` and posts the node+layer output; deny posts `denied`.
- `RegionExtractionApproval` (component): renders a chip per pending region; clicking a
  button resolves it and removes the chip.

## Open questions

None blocking. Pill phase text while awaiting approvals ("Waiting for your choice…") is
optional polish, deferred to avoid coupling `runAgentTurn` to `usePaletteRuntime`.
