# AI Targeted Workflow — Design

**Date:** 2026-05-15
**Status:** Approved (brainstorm); pending implementation plan

## Problem

The current Cmd+K AI palette has three issues that block layer- and branch-aware editing:

1. **Implicit, hidden target.** The palette silently picks a preview source via `pickPreviewSource()` (selected graph node → composite → raw base image) and never surfaces this to the user. There is no way to deliberately direct AI work at a specific layer or branch.
2. **Context conflated with state.** `useImageContext` re-analyses whenever a hash of all non-AI layers changes. This costs a Claude vision call on common edits and obscures what the "context" actually represents.
3. **AI output is a layer, not a graph participant.** `addAiPanelLayer` materialises every AI invocation as a whole `ai-panel` layer with adjustments inside. The output cannot be appended after a specific node, spliced into an edge, or composed with other graph operations on the same chain.

This spec redesigns the workflow so AI invocations target a specific point in the document, ship the right snapshot to the model, and land as a real node in the graph.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Context model = source-anchored + per-call target snapshot | Keeps the ≥80% prompt-cache hit rate. Single ImageContext per document. Per-call snapshot gives AI per-branch awareness without N analyses. |
| 2 | Smart-default target chip in palette header | Selection already means "what I'm working on". The chip surfaces it and makes it overridable in one click. |
| 3 | Default insertion = append after target | Matches the common case ("continue editing from here"). Branch and splice are explicit alternatives. |
| 4 | `+` affordances on edges and node output ports | Two hover-revealed buttons in the graph. No `+` on layer rows. |
| 5 | AI output = `ai-step` graph node, not a whole layer | Required for append/splice. Existing `ai-panel` layers migrate on document load. |
| 6 | Variants, live preview, clarifying-question loop = deferred | Out of scope for this spec; tracked as future work. |

## Core model

### `TargetRef`

A stable handle to "where AI should look and where its output should land":

```ts
type TargetRef =
  | { kind: 'layer';     layerId: string }
  | { kind: 'node';      layerId: string; nodeId: string }
  | { kind: 'composite' }
```

Built once per palette invocation from this priority order:
1. Selected graph node (graph mode)
2. Active layer (layers panel)
3. Composite (fallback)

The same `TargetRef` is used for:
- The header chip in the palette
- Per-call target snapshot generation
- Insertion of the resulting `ai-step` node

It persists across regenerate/refine within the same palette session so AI keeps reasoning about the same anchor.

### Context model

**Source `ImageContext`** is analysed once from the base-image layer and cached in IndexedDB (as today, via `session-storage.ts`). It is invalidated only when the *base-image layer pixels themselves* change — opening a new image or replacing the source. Adjustments, new layers, AI panels, and graph edits do **not** invalidate it. This is the cache-marked prefix on every backend call and underpins the prompt-cache hit-rate target.

**Target snapshot** is a downscaled (e.g. 768 px long edge) blob of the composite state up to and including `TargetRef`. Generated on each AI call by `LayerCompositor` (extended) and attached to the user turn *after* the cache marker, so it is ephemeral and never cached. Cost: one extra small image per call (~10–30 KB).

The `lastAnalysedFingerprint` field collapses from a hash of every non-AI layer to a hash of the source-image pixels. The re-analyse-on-Cmd+K path (`reanalyseFromComposite`) is removed.

## Palette UX

The palette gains a target chip in its header:

```
┌──────────────────────────────────────────────────┐
│  🎯 Curves output      from selection ▾       ⌘K │
│  ┌────────────────────────────────────────────┐  │
│  │ make the sky more dramatic…                │  │
│  └────────────────────────────────────────────┘  │
│  @subject  @sky  @background   ⏎ generate         │
└──────────────────────────────────────────────────┘
```

- Chip text shows the human-readable target label (layer name, node label, or "Whole composite").
- "from selection" subtitle indicates source of the auto-pick; suppressed if user has manually overridden.
- Click opens a small dropdown of all eligible targets, grouped by layer with thumbnails; keyboard `⌘T` cycles forward.
- `@region` pills are unchanged from current behaviour: they scope the *prompt* to a candidate region, not the target.

`pickPreviewSource()` is replaced by reading `TargetRef`. The preview area below the prompt always reflects the composite state at the target (same code path as the target-snapshot generator).

## AI as a graph node

A new processing type is registered: `ai-step`.

```ts
// src/processing/ai-step.tsx
registerProcessing({
  id: 'ai-step',
  label: 'AI Step',
  // ...
  meta: {
    operationGraph: OperationGraph;
    panelBindings: PanelBinding[];
    aiSource: AiSource;
    originTargetRef: TargetRef;   // what the AI saw when it generated this
  }
})
```

Behaviour:
- One AI invocation produces one `ai-step` node.
- It renders in the graph editor as a single node, expandable to reveal its inner `OperationGraph` subgraph for inspection (read-only initially; expand-to-edit is future work).
- Inspector panel reuses today's `AiPanelSection` (sliders + reasoning + refine), now attached to a node instead of a layer.

### Insertion semantics

| `TargetRef.kind` | `insertionIntent` | Result |
|---|---|---|
| `layer` | `append` (default) | New `ai-step` appended at end of that layer's chain |
| `node` | `append` (default) | `ai-step` inserted immediately after the node; existing downstream nodes shift down |
| `node` | `splice` (edge `+`) | Same as append but explicitly tied to a specific outgoing edge |
| `composite` | `append` | `ai-step` appended to the topmost layer's chain |
| any | `branch` (Alt+Enter) | Reserved for the deferred branching work; in this spec, `branch` falls back to `append` with a console warning |

### Coexistence with existing `ai-panel` layers

The current `ai-panel` layer type is a top-level layer with no recorded host. There is no reliable way to auto-pick "where the node should live" without guessing, so this spec does **not** auto-convert old layers. Instead:

1. `ai-panel` layer rendering, inspector, and serialization stay in place (read-compat).
2. All **new** AI invocations produce `ai-step` nodes via the new code path.
3. Refining an existing `ai-panel` layer continues to produce a sibling `ai-panel` layer (unchanged). Refining an `ai-step` node produces a downstream `ai-step` node via the new path.
4. A future spec may add an explicit "Convert AI panel to graph node" action in the layer context menu, where the user picks the host layer.

Files touched:
- `addAiPanelLayer` stays for the legacy layer path.
- `addAiStepNode` (new) is the entry point for new AI invocations.
- `refineAiPanelLayer` stays; `refineAiStepNode` (new) handles the node path.

## `+` affordances

Two hover-revealed buttons in the graph editor; no `+` on layer rows.

**Output-port `+`** — appears adjacent to any node's output port on hover.
- Click opens the palette with `TargetRef = { kind:'node', layerId, nodeId }` and `insertionIntent = 'append'`.
- Equivalent to selecting the node and pressing Cmd+K, but faster.

**Edge `+`** — appears at the midpoint of an edge on hover.
- Click opens the palette with `TargetRef = { kind:'node', layerId, nodeId: <upstream end> }` and `insertionIntent = 'splice'`.
- On commit, the new `ai-step` node splits the edge: `A → AI → B`.

Both buttons reuse the same `AiCommandPalette`; they pass `TargetRef` and `insertionIntent` as props/seed state. The palette renders identically regardless of how it was opened.

## Backend API

`POST /api/panel` request shape changes:

```ts
// before
{ sessionId: string, userGoal: string }

// after
{
  sessionId: string,
  userGoal: string,
  targetSnapshot: Blob,            // PNG/JPEG, multipart
  targetRef: TargetRef,
  insertionIntent: 'append' | 'splice' | 'branch',
}
```

Backend changes:
- The cached `ImageContext` remains the prompt-cache-marked prefix on the Claude call.
- `targetSnapshot` is included in the user turn *after* the cache marker (ephemeral, no cache_control).
- `targetRef` and `insertionIntent` are passed as structured context to help the model reason about scope and downstream operations (e.g. "this output will be appended after a Curves node; do not duplicate global contrast work").
- The response shape is unchanged: `OperationGraph + PanelBinding[]`.

`POST /api/analyze`:
- Only called when the source-image fingerprint changes.
- Removed callers: `reanalyseFromComposite` and the Cmd+K re-analyse trigger.

`POST /api/refine` is unchanged shape-wise but its server-side context now reflects the refined `ai-step` node rather than an `ai-panel` layer.

## Component touchpoints

| Path | Change |
|---|---|
| `src/types/ai-target.ts` *(new)* | `TargetRef`, `InsertionIntent` types |
| `src/lib/target-ref.ts` *(new)* | `resolveSmartTarget(state)`, `renderTargetSnapshot(ref)`, `humanLabelFor(ref)` |
| `src/components/AiCommandPalette.tsx` | Adds chip header, target dropdown, `⌘T` cycling, removes `pickPreviewSource()` |
| `src/components/graph/` | Edge `+` and output-port `+` hover affordances |
| `src/processing/ai-step.tsx` *(new)* | `ai-step` ProcessingDefinition |
| `src/processing/index.ts` | Register `ai-step` |
| `src/store/ai-panel-actions.ts` | Keep legacy functions; add `addAiStepNode`, `refineAiStepNode` (or split into a sibling `ai-step-actions.ts`) |
| `src/components/inspector/AiPanelSection.tsx` | Keep for legacy layers; add `AiStepSection.tsx` for the node case (same UI, different binding) |
| `src/hooks/useImageContext.ts` | Drop `reanalyseFromComposite`; simplify fingerprint to source-pixel hash |
| `src/lib/ai-client.ts` | Updated `/api/panel` payload shape with `targetSnapshot`, `targetRef`, `insertionIntent` |

## Out of scope (future work)

These were discussed during brainstorming and explicitly deferred:

- **3-up variants** with Regenerate / Variants (`⇧⏎`) — adds cost, needs dedicated UI
- **Live before/after preview** inside the palette and as a canvas ghost
- **Clarifying-question loop** — AI returns a question with quick-reply chips instead of a graph when uncertain
- **Tweak-before-commit** slider stage between AI return and graph mutation
- **Branch insertion intent** rendered as a real parallel graph path (currently falls back to `append`)
- **`@layer` cross-branch references** in prompts (e.g. "match the tones of @Layer-B")
- **Expand-to-edit** for `ai-step` subgraph (initially read-only)

## Success criteria

1. Opening Cmd+K with a graph node selected and submitting "warm up the sky" produces an `ai-step` node appended after the selected node, with the source-image `ImageContext` reused (prompt cache hit on backend) and the per-call target snapshot reflecting the composite at that node.
2. Hovering a graph edge reveals a `+`; clicking it opens the palette pre-targeted to that insertion point; submitting splices an `ai-step` node into the edge.
3. Loading an `.edp` file authored against the current (pre-spec) format still works: existing `ai-panel` layers render and behave unchanged; new invocations use the `ai-step` node path.
4. `useImageContext` no longer re-analyses on adjustment changes; the source `ImageContext` survives across all targeted AI invocations within a session.
