# Adjustments Accordion — Design

**Date:** 2026-05-31
**Status:** Approved design, pre-implementation
**Author:** Anton + Claude (brainstorming session)
**Depends on:** Canonical Engine Phase 3 (see `2026-05-31-canonical-engine-control-unification-design.md` §4.B). The accordion is a *view* over the canonical per-`(layer, op, param)` state; it cannot ship before Phase 3.

## 1. Problem & Context

The `Adjustments` inspector tab today renders only a `SuggestionsSection` (autonomous AI
widgets as engage-rows → tether to canvas) + a `LayersSection`. The toolstore tools
(Light, Color, Kelvin, Curves, Levels, Filters) have **no presence here** — they exist only
as widget shells spawned on the React Flow canvas. The user wants the tab to become a
**Lightroom-style develop panel**: a single accordion listing every toolstore tool, with the
AI-generated adjustments pinned on top, all directly editable.

Current files: `src/components/inspector/InspectorPanel.tsx` (renders Suggestions + Layers),
`src/components/inspector/SuggestionsSection.tsx`, `src/components/inspector/LayersSection.tsx`.

## 2. Goals & Non-Goals

**Goals**
- The `Adjustments` tab is one continuous accordion: AI sections on top, then the six fixed
  toolstore sections, all always present and directly editable (Lightroom feel).
- Every section is a **view over the canonical state** of the **active layer**; editing a
  section and editing the matching canvas widget move the same value (bidirectional sync,
  for free, via Phase 3).
- AI sections are full, immediately-editable sections (reasoning + controls + Refine/Why) —
  **no separate "engage" step**. They still coexist as canvas shells.

**Non-Goals**
- Building the canonical state itself — that is Phase 3 (separate spec + plan, prerequisite).
- The Layers panel: it moves to its **own tab** and is re-introduced later (Layers are
  currently non-functional). Out of scope here beyond removing it from the Adjustments tab.
- Replacing the canvas widget shells — they coexist (the user chose coexistence).

## 3. Key Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Accordion ↔ canvas widgets | **Coexist, shared value** (two views of one canonical adjustment) |
| D2 | Section presence | **All six toolstore sections always visible & editable** (Lightroom-style) |
| D3 | AI widgets | **Full editable sections pinned on top** (reasoning + controls + Refine/Why); no engage step |
| D4 | Scope | **Active layer** (tool sections bind to the active layer; AI sections per their own scope) |
| D5 | Data model | **Canonical Phase-3 state** per `(layer, op, param)` — build Phase 3 first |
| D6 | Layers | **Own tab** (deferred); Adjustments tab becomes pure accordion |

## 4. Architecture

### 4.A Surface & components

```
AdjustmentsTab (was InspectorPanel "adjustments" branch)
└─ AdjustmentsAccordion
   ├─ AI group       → AccordionSection[variant=ai]    (0..n, ordered on top)
   └─ Tools group    → AccordionSection[variant=tool]   (exactly 6, fixed order)
```

- **`AdjustmentsAccordion`** (new, `src/components/inspector/adjustments/`) — reads the active
  layer + the canonical state + the AI widget list; renders the two groups. Owns no adjustment
  data; pure composition + open/closed UI state.
- **`AccordionSection`** (new) — one primitive, two variants:
  - **tool variant:** icon + name; collapsed shows a value summary (e.g. "Sat −10") + a dirty
    dot; expanded shows the op's controls + a Reset.
  - **ai variant:** AI badge + intent + scope chip; expanded shows a reasoning row, the
    controls, and a footer with Refine / Why / Reset / Apply.
- **Controls are reused, not reinvented:** each section body renders the existing
  `BindingRow` → `SliderControl` / `CurveControl` / … primitives (from Phase 2a). The section
  feeds them values from the canonical state and an `onChange` that writes canonical state.

The six tool sections come from the **engine registry** (`shared/engine-registry.json`,
Phase 1) — one section per op, in registry order: Light, Color, Kelvin, Curves, Levels,
Filters. Adding a registry op later automatically adds a section.

### 4.B Data flow (over Phase 3 canonical state)

- **Read:** a tool section for op `O` reads the active layer's canonical params for `O`
  (`canonicalState[activeLayer][O]`). Collapsed → derive the value summary + dirty flag from
  them; expanded → feed them to the controls.
- **Write:** a control's `onChange` calls the Phase-3 canonical setter
  (`setParam(activeLayer, O, paramKey, value)`). This is the *same* setter the canvas widget
  uses → both views reflect the change immediately (the bidirectional sync from Phase 3 §4.B).
- **AI sections:** rendered from the active/accepted `mcp_*` widgets in the snapshot, ordered
  on top; each binds to its widget's canonical nodes. Refine/Why/Apply reuse the existing
  `WidgetShell` backend calls.
- **Active-layer reactivity:** switching the active layer re-points the tool sections at the
  new layer's canonical state; the section values update.

### 4.C Behavior

- Multiple sections open at once (Lightroom). Per-section open/closed state persisted in
  UI-only store state (keyed by section id), so it survives re-renders and layer switches.
- Tool order is fixed (registry order). AI sections ordered by recency/scope above tools.
- A tool section with no edits shows neutral/default control values (the canonical state's
  defaults) — it is always editable; the first edit simply writes a non-default canonical
  value (Phase 3 owns whether that lazily materializes a node/canvas shell).

## 5. Build Order (critical)

1. **Phase 3 — Canonical engine state** (prerequisite; design already approved in the
   canonical-engine spec §4.B). Its own implementation plan, built first.
2. **Adjustments Accordion** (this spec). Its own plan, built on top of Phase 3.

The accordion plan must not start until Phase 3 lands, because every section binds to the
canonical state and setter Phase 3 introduces.

## 6. Components & Responsibilities (isolation)

| Unit | Responsibility | Depends on |
|---|---|---|
| `AdjustmentsAccordion` | Compose the two groups; own open/closed UI state | active layer, canonical state, AI widget list |
| `AccordionSection` (tool) | Render one op's header + summary + controls; bind to canonical | engine registry, `BindingRow`, canonical setter |
| `AccordionSection` (ai) | Render one AI widget's header + reasoning + controls + footer | snapshot widget, `BindingRow`, `WidgetShell` actions |
| section value-summary helper | Derive collapsed "Sat −10"-style text + dirty flag from canonical params | engine registry (labels), canonical params |

Each is independently testable: `AccordionSection` renders from props; the value-summary
helper is pure; `AdjustmentsAccordion` is composition.

## 7. Migration

- `InspectorPanel` "adjustments" branch swaps `SuggestionsSection` + `LayersSection` for
  `AdjustmentsAccordion`.
- `SuggestionsSection` is absorbed into the accordion's AI group (the engage-to-canvas row
  is replaced by a directly-editable AI section). The old component can be retired once the
  AI group covers its behavior.
- `LayersSection` is removed from this tab; Layers gets its own tab in a later, separate
  effort (the Layers panel itself is currently non-functional).

## 8. Testing Strategy

- **Value-summary helper:** unit tests — given canonical params, returns the right summary
  text + dirty flag (incl. the all-default → no-dirty case).
- **AccordionSection (tool):** renders the registry-defined controls for an op; an edit calls
  the canonical setter with `(activeLayer, op, paramKey, value)`.
- **AccordionSection (ai):** renders reasoning + controls; tool-origin vs AI-origin chrome
  (Refine/Why only on AI — consistent with the Phase-1 gating).
- **AdjustmentsAccordion:** AI sections render above the six fixed tool sections; switching
  active layer re-points tool sections.
- **Bidirectional sync (integration, after Phase 3):** editing a section and the matching
  canvas widget reflect one value.

## 9. Risks & Open Questions

- **Coexistence clutter:** with all six tools editable and coexistence on, touching every tool
  materializes a canvas shell per op. Acceptable per D1; Phase 3 may later make the canvas
  shell optional per view. Log if it becomes noisy.
- **AI section ordering/scope:** exact sort (recency vs scope vs severity) of the AI group is
  a small UX detail to finalize during implementation.
- **Phase 3 surface:** the canonical setter/reader signatures this spec assumes
  (`setParam(layer, op, param, value)`, `canonicalState[layer][op]`) are defined by the Phase 3
  plan; reconcile names when that plan lands.
