# Autonomous region extraction on accept

**Date:** 2026-07-05
**Status:** Design — pending user review

## Problem

When the AI autonomously analyzes an image and detects a *local* problem, it
spawns a suggestion widget that carries the affected region only as a **chip**
(e.g. a chip labeled "hanging sneakers") with `scope.kind === 'named_region'`.
The adjustments apply to the masked region in place on the source image node.

By contrast, when the user asks for the same thing through the **Cmd+K command
palette**, the region chip is run through SAM: the object is segmented and
**extracted into its own image node**, and the agent then re-plans adjustments
scoped to that extracted node (`forced_targets` → `image_node` scope).

We want the autonomous path to be able to do the same thing — turn the detected
region into an actual SAM-segmented image node — reusing the existing palette
extraction machinery rather than inventing a parallel one.

## Decision summary

- **Trigger:** on **accept (✓)** of an autonomous suggestion widget. The
  suggestion stays a chip until the user commits to it; extraction happens
  exactly then. (Not at analysis time, not on expand.)
- **Behavior:** faithful mirror of the palette path (**Approach A**). Accept =
  extract the region (reusing the existing Extract → Node/Layer/✕ chooser and
  extraction helpers) + re-run the agent on the extracted node with the widget's
  own intent. The original in-place widget is superseded.
- **Params:** re-plan is acceptable — dialed-in slider values on the suggestion
  card are **not** preserved (they are replaced by the agent's fresh proposal on
  the isolated object). Confirmed with the user.
- **Reuse, don't reinvent:** the palette already exposes the entire spine
  (`resolveAttachedRegions` → `agentTurn`, gated by the
  `useRegionExtractionApproval` chooser). We route a single `region:ai:<label>`
  chip through it.

## How the palette path works today (reference)

`src/lib/palette-actions.agent.ts`:

- `runAgentTurn(prompt, chipSourceIds, getChoice)` splits chips, then calls
  `resolveAttachedRegions(regionSourceIds, candidateRegions, activeNodeId,
  getChoice)`.
- `resolveAttachedRegions` runs `planForcedExtractions` to bucket each chip as
  **extractable** (backing mask exists — from `precompute_regions` +
  `registerRegionPaths`), **segmentable** (maskless AI region with a
  `representativePoint` → client-side MobileSAM via `segmentRegionFromPoint`), or
  **fallback**. For each non-`deny` choice it calls `extractObjectToImageNode`
  (Node) or `extractObjectToLayer` (Layer), producing a
  `forcedTarget = { image_node_id, layer_ids }`.
- `getChoice` defaults to `useRegionExtractionApproval.getState().request(label)`
  — **this is the store that renders the "Extract … → Node / Layer / ✕" chooser**
  in the screenshot.
- Finally `backendTools.agentTurn({ intent, forced_targets, attached_objects,
  client_tools, active_node })` — the agent loop re-proposes an adjustment stack
  scoped to the extracted `image_node`.

## Design

### Entry point — WidgetShell accept

`src/components/widget/WidgetShell.tsx` `handleApply()` (currently: flush pending
`set_widget_param` timers, then `backendTools.accept_widget`).

New branch, taken only when `widget.scope.kind === 'named_region'`:

1. Flush pending param timers as today.
2. Call a new exported helper `runAgentTurnForRegion(intent, label)` (see below).
3. If it reports `extracted === true`: the region became its own node and the
   agent re-planned on it → **supersede** the original in-place widget via
   `backendTools.delete_widget(sid, { widgetId, suppressSimilar: false })`.
4. If it reports `extracted === false` (user chose ✕/deny, or extraction failed,
   or the region could not be resolved): **fall back** to the existing
   `backendTools.accept_widget` — the region stays adjusted in place. No dead
   ends, no pointless agent turn.

Widgets whose scope is not `named_region` (global, image_node, mask, …) keep
today's plain `accept_widget` behavior untouched.

### New helper — `runAgentTurnForRegion`

Add to `src/lib/palette-actions.agent.ts` (co-located with the code it reuses so
the chip-split / dedupe / `agentTurn` logic stays in one place):

```ts
export async function runAgentTurnForRegion(
  intent: string,
  label: string,
  getChoice: RegionChoiceFn = (l) => useRegionExtractionApproval.getState().request(l),
): Promise<{ extracted: boolean; ok: boolean; toolCalls: number }>
```

Behavior:

1. Resolve `sid`, `activeImageNodeId`, `candidateRegions` (same as `runAgentTurn`).
2. Build the chip id `region:ai:${label}` and run the **existing**
   `resolveAttachedRegions([chipId], candidateRegions, activeNodeId, getChoice)`.
   This pops the same chooser and performs the same extract/segment work.
3. If `forcedTargets.length === 0` → return `{ extracted: false, ok: true,
   toolCalls: 0 }` (covers deny **and** silent extraction failure — in both
   cases we do not want an agent turn on the whole node).
4. Otherwise call `backendTools.agentTurn(sid, { intent, attached_objects:
   fallbackIds, forced_targets: dedupeForcedTargets(forcedTargets), client_tools:
   serializeForAgentLoop(AGENT_LOOP_TOOLS), active_node })` and return
   `{ extracted: true, ...result }`.

`runAgentTurn` and `runAgentTurnForRegion` share `resolveAttachedRegions` and
`dedupeForcedTargets` (already module-private). No new extraction logic.

### Region resolution

The accepted widget's `scope.label` is matched against
`useAiSession.getState().context?.candidateRegions` by lowercased label — the
region object supplies `maskRef` (precomputed → extractable) or
`representativePoint` (→ segmentable). Because autonomous suggestions are minted
in the same analyze pass that produced `candidateRegions`, the region is
normally present. If it is absent (context cleared/reanalyzed), step 3's
empty-`forcedTargets` path fires and we fall back to in-place accept.

### Owner node

v1 uses `activeImageNodeId` as the owner node (same as `runAgentTurn`, which
already keys extraction off the active node). Autonomous suggestions anchor to
the analyzed node, which is the active node at accept time. Resolving the widget's
true owning node independently of the active selection is a future refinement,
noted below.

## Data flow

```
WidgetShell.handleApply (scope=named_region)
  └─ runAgentTurnForRegion(widget.intent, widget.scope.label)
       ├─ resolveAttachedRegions(['region:ai:<label>'], candidateRegions, activeNodeId, getChoice)
       │    ├─ planForcedExtractions → extractable | segmentable | fallback
       │    ├─ getChoice(label)  ⇒  Extract "<label>" → Node / Layer / ✕   (useRegionExtractionApproval)
       │    ├─ (segmentable) segmentRegionFromPoint → MobileSAM → propose_mask
       │    └─ extractObjectToImageNode | extractObjectToLayer  ⇒ forcedTarget
       ├─ forcedTargets empty?  → return { extracted:false }  → accept_widget (in place)
       └─ agentTurn({ intent, forced_targets, ... })  → agent re-proposes on extracted node
  └─ extracted? → delete_widget(original)   // superseded by the new node's widget(s)
```

## Error handling / edge cases

- **Deny (✕):** `resolveAttachedRegions` drops the region → empty `forcedTargets`
  → in-place `accept_widget`. The suggestion is simply accepted as before.
- **Extraction/segmentation failure:** same empty-`forcedTargets` path →
  in-place accept. (`resolveAttachedRegions` already toasts on extract failure.)
- **Region not in `candidateRegions`:** `planForcedExtractions` yields no
  extractable/segmentable entry → empty `forcedTargets` → in-place accept.
- **Offline / no session:** `handleApply` already early-returns when
  `!sessionId || offline`; unchanged.
- **Double application:** avoided by `delete_widget` on the original once the
  agent has re-proposed on the extracted node.

## Non-goals

- Preserving dialed-in slider params across extraction (Approach B) — explicitly
  out of scope per the user's decision.
- Extraction at analysis time or on widget expand.
- A new backend rescope/move-widget tool.
- Changing non-region widget accept behavior.

## Future refinements (not in this change)

- Resolve the widget's true owning image node instead of relying on
  `activeImageNodeId`.
- Optionally preserve params via a future `rescope_widget` tool (Approach B).

## Testing

- **`runAgentTurnForRegion` unit tests** (mirror existing `runAgentTurn` tests):
  - extractable region + Node choice → `agentTurn` called with one
    `forced_targets` entry pointing at the new node; returns `extracted:true`.
  - Layer choice → `forced_targets` points at owner node + new layer.
  - Deny (✕) → no `agentTurn`; returns `extracted:false`.
  - Region label absent from `candidateRegions` → no `agentTurn`;
    `extracted:false`.
  - Segmentable region (no mask, has point) → `segmentRegionFromPoint` invoked
    before extraction.
- **WidgetShell accept branch:** `named_region` scope + `extracted:true` →
  `delete_widget` called on the original; `extracted:false` → `accept_widget`
  called instead. Non-`named_region` scope → `accept_widget` unchanged.
- Manual: autonomous suggestion → accept → chooser appears → Node → object
  becomes its own node with a fresh adjustment widget; original suggestion gone.
```
