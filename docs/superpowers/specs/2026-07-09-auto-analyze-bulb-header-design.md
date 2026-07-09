# Auto-analyze on load + bulb-first image node header

**Date:** 2026-07-09
**Status:** Approved

## Goal

Make image analysis automatic and invisible, and make the image node header lead with
the opt-in AI affordance ("Suggest something") instead of the plumbing step
("Analyze with AI"). Analysis context persists with the image for the life of the
session; suggestions stay strictly opt-in.

## Background (current state)

- `TopMarginalia.tsx:155-165` renders a Sparkles "Analyze with AI" header button,
  gated on `aiAccess && !offline && !isAnalysed`, calling `analyseImageLayer(id)`.
- The menu (`ImageNodeDrafting.tsx renderMenuItems`) already contains
  "Analyze with AI" when `!isAnalysed` (lines 315-324) and a Lightbulb
  "Suggest something" item (lines 351-359) calling `suggestForImageNode(id)`.
- `analyze_context` runs mechanical (cv2), SAM embed, semantic (Claude →
  `ImageContext`), and soft fields including problems — and does **not** mint
  suggestions. `suggest_widgets` is a separate opt-in tool with a 5s cooldown.
- `image_context_by_node` is persisted to `.sessions/{sid}/document.v1.json`,
  revived on backend startup, and rehydrated into the frontend snapshot. Context
  already survives app reload; `analyze_context` short-circuits on cached context.
- Gap: frontend `isAnalysed` derives from the in-memory `analysedImageNodeIds`
  array (`useImageContext.ts:33,472`), which is empty after an app reload even
  when the snapshot carries context.

## Design

### 1. Header button swap (`TopMarginalia.tsx`)

Replace the Sparkles "Analyze with AI" header button with a Lightbulb
**"Suggest something"** button → `suggestForImageNode(id)`.

- Visibility: `aiAccess && !offline`. **Not** gated on `isAnalysed` — suggest
  self-serves analysis when context is missing.
- "Analyze with AI" remains menu-only when `!isAnalysed` (no change to the menu).
- Bulb shows a subtle busy state while its suggest run (or an awaited in-flight
  analyze) is active.

### 2. Auto-analyze on user load (`document.ts`)

- `openImage`: after the backend session bootstrap resolves (existing
  fire-and-forget chain), call `analyseImageLayer(nodeId)` **without**
  `{suggest: true}` — mechanical + semantic + problems only, no widget minting.
- `addImage`: same, after the per-node image upload resolves.
- Gate: `aiAccess && !offline`, checked after the first snapshot arrives so
  baseline-condition participants never trigger Claude calls.
- Non-blocking and failure-tolerant: on failure, `isAnalysed` stays false and the
  menu's "Analyze with AI" is the retry path. No new error UI.
- App reload triggers nothing: no `openImage` runs; context rehydrates from the
  persisted session document via the snapshot.

### 3. Fix stale `isAnalysed` (`useImageContext.ts`)

Derive `isAnalysed` per node from context presence in the snapshot, unioned with
the local `analysedImageNodeIds`. This makes the reload state correct and is a
prerequisite for auto-analyze not looking broken.

### 4. In-flight guard (`useImageContext.ts`)

Track in-flight analyses per node. If suggest is requested mid-analysis, await the
in-flight run and then call `suggest_widgets` directly — never start a second
analyze. The backend 5s suggest cooldown remains the double-click backstop.

### 5. Context inheritance for extracted nodes (backend extract tool)

On extraction, copy the source node's `EnrichedImageContext` into the new node's
`image_context_by_node` entry. Inherited context counts as analyzed (Ask / Edit /
Suggest live immediately; menu shows post-analysis items). Persisted like any
other context.

Known trade-off: global fields (histogram problems, white point, palette) describe
the whole source image, not the crop. Accepted for now; a per-crop "re-analyze"
affordance is deferred until testing shows it is needed (YAGNI).

## Out of scope

- Re-analyze affordance for inherited contexts.
- Auto-suggest of any kind — suggestions remain strictly opt-in via the bulb.
- Changes to the baseline study condition (auto-analyze is simply gated off).

## Testing

- Frontend: `isAnalysed` derivation from snapshot (reload case); in-flight dedup
  (suggest during analyze fires exactly one analyze + one suggest); bulb
  visibility/busy states; auto-analyze gating on `aiAccess`/`offline`.
- Backend: extraction copies context to the new node; persistence round-trips the
  inherited context; `analyze_context` cached short-circuit still holds.
