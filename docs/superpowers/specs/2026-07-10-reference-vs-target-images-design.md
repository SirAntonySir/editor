# Reference vs. Target Images — Design

**Date:** 2026-07-10
**Status:** Approved

## Problem

"Edit image1 so it looks like image2" edits **both** images. Root cause: the
editor has no concept of a *reference* image. Every image attached to a Cmd+K
prompt becomes a `forced_target`, and `agent_loop._build_system` then instructs
the model to "apply the request by calling propose_adjustment_widgets on EACH
of these node ids" — so image2 (meant as a look reference) gets edited too.
Separately, the agent only ever receives `DEFAULT_IMAGE_NODE_ID`'s context, so
even conceptually it cannot "see" image2 to match it.

## Decision

Introduce a **target vs. reference role** for attached image/layer chips
(approved: full scope — reference is excluded from edits AND its appearance is
fed to the model so "look like" is genuinely matched; per-chip toggle UX).

Reference appearance is conveyed as a **mechanical summary** (cheap-pass:
cast_direction, estimated_white_point, palette, median_luma, dominant tones) —
always available regardless of whether the reference was analyzed, and it plugs
directly into the measurement-derived param resolution from the
grounded-suggestions feature. Feeding raw reference pixels to vision is a
possible later enhancement, explicitly out of scope here.

## Frontend

1. **Source-id role.** Add `reference:node:<id>` / `reference:layer:<id>`
   alongside `target:*`. New `parseReferenceSourceId` in `prompt-doc.ts` mirrors
   `parseTargetSourceId`; a shared `parseAttachmentSourceId` returns
   `{ role: 'target' | 'reference', ref }` to avoid duplication.
2. **Chip toggle.** An attached target/reference chip in the palette gets a
   Target ⇄ Reference toggle; flipping it rewrites the chip's `sourceId` prefix.
   The active image node stays the implicit target; a chip explicitly marked
   Reference is read-only.
3. **`runAgentTurn` (`palette-actions.agent.ts`).** Split `chipSourceIds` into
   region / target / reference. Target ids → `forcedTargets` (unchanged).
   Reference ids → new `referenceTargets: {image_node_id, layer_ids}[]`, deduped
   and **subtracted** from `forcedTargets` (a node can't be both). Passed to
   `backendTools.agentTurn` as `reference_targets`.
4. A reference must never also be the `active_node` target: if the only chip is
   a reference and the active node is image1, image1 remains the sole target.

## Backend

5. **`api/state.py`.** Parse `reference_targets`. Reference node ids are kept
   OUT of the editable `node_layers` target set and out of `forced_target_ids`.
   For each reference node, build an appearance summary from
   `compute_cheap_pass(decode(node_bytes))` (+ its `image_context` if present):
   `{ image_node_id, cast_direction, estimated_white_point, palette,
   median_luma, dominant_tones, grade_character? }`. Pass the list into
   `run_agent_turn`.
6. **`agent_loop._build_system`.** New REFERENCE section when references exist:
   names the reference node ids, states "these are references — do NOT edit
   them," and inlines each appearance summary with the instruction to move the
   TARGET toward the reference's measured character when the intent is
   match/look-like. Reference ids are never listed among the valid
   `target_image_node_id`s.
7. **Dispatch guard.** `dispatch_propose_adjustment` / `propose_fn` refuse a
   `target_image_node_id` that is a reference (defensive: the prompt already
   forbids it) — journaled, not fatal.
8. **Matching.** The reference summary is threaded into the target's propose
   intent/context so the measurement-derived resolution (cast_direction,
   white-point → kelvin/tint; tone → exposure) pushes the target toward the
   reference. Reuses the resolve-prompt measurement block already added for
   grounded suggestions.

## Error handling

All best-effort: a reference whose bytes can't be decoded contributes no
summary (logged), the targeting exclusion still holds. No new fatal paths.

## Testing

- **Frontend.** `parseReferenceSourceId` / role parsing; `runAgentTurn` routes
  reference chips to `reference_targets` and excludes them from `forced_targets`
  (including the both-attached dedupe); active-node target preserved when only a
  reference is attached; chip toggle rewrites the sourceId.
- **Backend.** `state.py` keeps reference nodes out of the target set and builds
  a summary; `_build_system` emits the REFERENCE section and omits reference ids
  from the target list; dispatch guard rejects a reference target.
- **Integration.** An agent turn with image1 active + image2 as reference mints
  a widget only on image1 and never on image2.

## Files

| Area | File |
|---|---|
| FE parse | `src/lib/prompt-doc.ts` (+ test) |
| FE turn | `src/lib/palette-actions.agent.ts` (+ test) |
| FE chip UI | `src/components/CommandPalette.tsx` (chip toggle) |
| FE payload | `src/lib/backend-tools.ts` (agentTurn `reference_targets`) |
| BE turn | `backend/app/api/state.py`, `backend/app/tools/agent_loop.py` |
| BE summary | reuse `app/state/context_stats.compute_cheap_pass` |

## Out of scope

- Feeding raw reference pixels to a vision block (summary-only for now).
- Auto-analyzing the reference image (summary is computed on demand).
- Multi-reference blending semantics beyond "move toward the union of cues".
