# Study logging + admin measures

**Date:** 2026-07-02
**Status:** Approved — surface rule locked. Implementing in phases.
**Scope:** Extend the event journal + admin cockpit to compute the main-study measures.

**Surface rule (locked):** classify each edit by the **surface the action goes through**, not the
artifact's provenance. An inspector-slider edit is a **manual-surface edit even when the widget was
AI-proposed** — the headline measures manual-surface *usage* ("AI is additive, never necessary").

## Goal

Make the per-session event journal + admin cockpit the measurement apparatus for:
- **Per part** (Corrective / Creative / Sky): time, ops, (workload from survey), objective quality (survey).
- **Treatment-only (from the journal):** proposal acceptance, refines, reverts, coexistent widgets,
  visibility toggles.
- **Headline behavioral measure:** the **share of edits made through the manual surface during the
  AI block** — tests "AI is additive, never necessary."
- **Explicitly requested logging additions:** renames, AI information in every form, and
  per-element interaction timing (which element type, when).

## 1. Segmentation — explicit part markers

New journaled event `study.block`, written by an **admin-cockpit control** (interviewer-driven):

```json
{ "kind": "study.block",
  "payload": { "block": 1, "part": "corrective" | "creative" | "sky",
               "condition": "ai_on" | "ai_off", "action": "start" | "end" } }
```

- New route `POST /admin/sessions/{sid}/block` (gated like the rest of admin), writes the event.
- Cockpit: a small control per session — pick block + part; condition auto-filled from the current
  `ai_access`. "Start part" / "End part" buttons.
- All measures are computed **between markers**; events before the first marker are "unsegmented."
- The existing `session.ai_access` toggles remain the source of truth for AI-on/off; `study.block`
  adds the part granularity the fused task needs.

## 2. Manual-vs-AI edit classification (the headline)

Each result-changing event is classified `surface: manual | ai`. **Derived in the admin
aggregation** from event kind + `widget.origin.kind` (no per-event tagging needed for most):

| Event | Surface | Rationale |
|---|---|---|
| `widget.created`, origin `tool_invoked` / `user_palette` | manual | toolrail / palette-as-launcher |
| `widget.created`, origin `mcp_user_prompt` / `mcp_autonomous` / `fused_expansion` / `repeat` | ai | AI-proposed |
| `canonical.updated` | manual | inspector slider (the manual surface) |
| `widget.updated` (refine / repeat) | ai | AI refine |
| `widget.accepted` | ai | engaging an AI proposal |
| `image_node_transform.updated` (crop/rotate) | manual | manual transform |
| `mask.created`, `selection.changed` (scoped adjust) | manual | manual segmentation |
| layer visibility / opacity / blend (telemetry) | manual | manual layer control |

**Headline:** `manual_edit_share(block) = manual_edits / (manual_edits + ai_edits)` over events whose
timestamp falls in an **AI-on** block's part markers.

> ⚠ This table is the study definition of "an edit through the manual surface." It must be confirmed
> before implementation — misclassification biases the headline measure.

## 3. Rename events

- **Object** rename: already `mask.renamed` (journaled). No change.
- **Layer / image-node** rename: frontend-only today → emit telemetry
  `rename` `{ element: 'layer' | 'imageNode', from, to }`.

## 4. AI information "in every form"

Ensure every AI output is in the journal:
- Widget **reasoning** — already in `widget.created`. ✓
- **Ask-mode answers** (`ask_about_image`) → journal `ai.answer` `{ query, markdown_len, model }`
  (store the answer text; it's already returned).
- **Smart-match** picks → journal `ai.smart_match` `{ query, picks: [{kind,id,reason}] }`.
- **Refine instructions** (`refine_widget` input) → journal `ai.refine` `{ widgetId, instruction }`.
- Prompt text — already `prompt.entered` (`intent`, `prompt`). ✓

## 5. Per-element interaction timing

Expand frontend telemetry (`track()` → `/api/telemetry`) to emit an `interaction` event on every
meaningful UI interaction:

```json
{ "kind": "telemetry.interaction",
  "payload": { "element": "inspector-slider" | "toolrail-button" | "palette" | "suggestion-chip" |
                          "widget-shell" | "eye-toggle" | "blend-dropdown" | "crop" | "layer-thumb" |
                          "object-marker" | "history" | "compare" | ...,
               "action": "click" | "drag-commit" | "toggle" | "open" | ...,
               "surface": "manual" | "ai", "ts": 0 } }
```

- Debounced for continuous gestures (slider = one `drag-commit` per gesture, not per frame).
- Gives "times of interaction with which element type" and feeds the manual/ai split for
  interactions the backend never sees (visibility toggles, tab switches, etc.).

## 6. Coexistent widgets / visibility toggles / refines / reverts

- **Coexistent widgets:** admin walks the timeline maintaining the active-widget set
  (`widget.created` +1, `widget.deleted`/`widget.accepted` bake-out per rules) → report **max
  concurrent active** per part.
- **Visibility toggles:** count `telemetry.interaction` with `element:'eye-toggle'` (+ suggestion
  preview toggles) per part.
- **Refines:** count `ai.refine` (or `widget.updated` from refine) per part.
- **Reverts:** count `history.applied` per part (undo/redo/revert).

## 7. Admin tool

- **Per-session summary** gains: per-part breakdown (duration, manual_edits, ai_edits,
  manual_edit_share, ops), refines, reverts, coexistent_widgets_max, visibility_toggles, renames,
  and a per-element interaction table (`element` → count, first/last ts).
- **Aggregate** gains the headline (mean manual_edit_share in AI blocks) + per-part rollups.
- **Export** (`export.json` / `export.csv`) includes all per-part measures so the data is analyzable
  offline. The raw events already export in `export.json`.

## 8. Testing

- Pure Python aggregation is the bulk and is TDD'd: feed a synthetic event list (with markers,
  widget origins, canonical.updated, telemetry) → assert per-part durations, manual_edit_share,
  refines, reverts, coexistent-max, toggle counts, rename counts.
- Backend route tests for `POST /admin/.../block` (writes the event) and the AI-info journaling
  (`ai.answer`, `ai.smart_match`, `ai.refine`).
- Frontend: telemetry emission on the key interactions (unit tests where the handler is testable).

## Out of scope

- Survey-sourced measures (NASA-TLX, SUS, CSI, objective quality, sky believability) — those live in
  SoSci, joined to the journal by Participant ID offline.
- Real-time dashboards; this is post-hoc analysis via export.
