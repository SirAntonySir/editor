# Thesis Prototype Implementation — Design Spec

**Date:** 2026-05-11
**Author:** Anton Rockenstein
**Status:** Draft — awaiting user review
**Scope:** Code only — implementation gap between the written thesis ("Dynamic Interfaces for AI-Guided Image Editing") and the current `editor` codebase. User study, thesis writing, and defense prep are out of scope for this spec.

---

## 1. Context

The thesis is written through Chapter 6 (Implementation). The Implementation chapter describes the prototype in past tense, but the codebase only contains the editor foundation; the AI layer, tree-structured history, hybrid segmentation, and branching UI are largely unbuilt. Chapters 7–9 (Evaluation, Discussion, Conclusion) are empty and depend on the prototype being feature-complete enough to run the planned n≈12 evaluation.

**Timeline:** commenced 2026-03-05; completion 2026-09-05. Today is 2026-05-11; ~17 weeks remain. Reserving the final ~3 weeks for user study + writing leaves ~13 weeks of coding time.

### 1.1 What already exists

Per `CLAUDE.md` and direct inspection:

- Dual-registry pattern (`ProcessingRegistry` + `ToolRegistry`).
- WebGL 2 ping-pong adjustment pipeline.
- Non-destructive editing including crop (`CropMeta`).
- Zustand stores (`useEditorStore`, `useGraphStore`).
- `PixelStore` keyed by layer ID (source + working OffscreenCanvas pairs).
- Graph mode with React Flow + ELK layout + bidirectional sync.
- `.edp` project format (ZIP container, fflate).
- IndexedDB session auto-save.
- Custom `HistoryManager` (flat undo/redo, 50-entry / 500 MB budget).
- Component primitives (`GlassPanel`, `Kbd`, `Empty`) + design tokens in `src/index.css`.

### 1.2 What is missing

- No `src/ai/` or `backend/` directory; no FastAPI, no Anthropic integration.
- No Operation Graph schema (Zod or Pydantic).
- No Cmd+K palette, no `ai-panel` layer type, no `aiSource` provenance.
- `HistoryManager` is a flat undo/redo stack pair — thesis commits to tree structure with named milestones and branches.
- No ONNX SAM integration.
- No split-canvas comparison view.
- No reasoning badges, three revert granularities, or two-region inspector layout.
- No image context pre-computation pipeline (added requirement, see §3).

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Build a **thin end-to-end vertical slice first** (Phase 1) | Surfaces Anthropic + prompt-caching integration issues earliest. |
| D2 | **Refactor `HistoryManager` to a tree immediately after the thin slice** (Phase 2) | Only Phase-1 consumers depend on history at that point; refactoring later means re-plumbing every AI feature. |
| D3 | **Phase order:** thin slice → tree history → AI completeness → SAM → branching UI → polish | Front-loads the three external risks (Anthropic, ONNX SAM perf, history refactor) across Phases 1, 2, and 4. |
| D4 | **Pre-compute image context on load** as part of the AI loop from day one | Pre-cached scene context makes subsequent Cmd+K calls more precise *and* cheaper via Anthropic prompt caching. See §3. |
| D5 | **Strict 3-tier component architecture** (primitives → level-2 → page scaffolds) with no inline component declarations | Codified in `CLAUDE.md`; enforced via custom ESLint rule (D6). See `design.md` for visual register. |
| D6 | **Enforcement:** custom ESLint rule + `npm run check` script + pre-commit hook | Lightweight, catches the real failure mode, no test-runner dependency. |
| D7 | **Visual style frozen** by `design.md` (project root) — no new colours, motion curves, or radii without first proposing the token | Keeps Apple HIG glass register consistent across editor + AI surfaces. |

---

## 3. Image Context Pre-Computation Architecture

This is a deliberate addition on top of the thesis's prompt-caching design.

**Flow:**

1. User opens an image. Frontend downscales to 1024 px max edge, JPEG q85 (~50–200 KB).
2. Frontend calls `POST /api/session` with the bytes; backend stores them in an in-memory cache keyed by session ID with a 30-minute idle TTL. Backend returns `{ sessionId }`.
3. Backend fires `/api/analyze` (or returns context inline if the additional latency is acceptable). The analyze call asks Claude for a structured scene description:

```ts
interface ImageContext {
  subjects: string[];          // ["person", "snow"]
  lighting: 'flat' | 'backlit' | 'side' | 'rim' | 'mixed';
  dominantTones: ('shadows' | 'midtones' | 'highlights')[];
  mood: string;                 // one-sentence
  candidateRegions: Array<{
    label: string;              // "sky", "subject", "foliage"
    description: string;        // localisation hint
  }>;
  modelName: string;
  modelVersion: string;
  generatedAt: string;          // ISO timestamp
}
```

4. Context is stored against the session. Frontend reflects status (analysing / ready) unobtrusively.
5. Every subsequent `/api/panel` and `/api/refine` call composes the prompt as `[system, image, context, goal]`. The `[system, image, context]` segment is marked cacheable; subsequent calls within the 5-min cache TTL incur cache-read pricing only.

**Fallback:** if context isn't ready when the user invokes Cmd+K, the panel call proceeds image-only. This avoids blocking the editor on the analyze pass.

**Why both precision and speed:** the analyze pass produces a stable, semantic summary Claude can rely on at panel time. "Make it warmer" against a known backlit snowy portrait yields a scoped edit (skin + shadows), not a global kelvin shift that also warms the snow. The cache makes the iteration loop affordable.

---

## 4. Phase Plan

13 coding weeks. Six phases. Each phase below lists deliverables, scope cuts, and exit criteria.

### Phase 1 — Thin AI Slice (May 11 → May 25, 2 weeks)

**Goal:** Real Claude round-trip end-to-end with image-context pre-computation.

**Deliverables:**

- **Component-architecture enforcement** (do this first, week 1 day 1):
  - Custom ESLint rule `no-nested-component-definition` in `eslint.config.js` (or `tools/eslint-rules/`).
  - `"check": "tsc -b && eslint ."` script in `package.json`.
  - Pre-commit hook (simple shell script in `.git/hooks/pre-commit` or via `simple-git-hooks` if a dep is acceptable).
- **Operation Graph contract:**
  - `src/types/operation-graph.ts` — TypeScript types.
  - `src/lib/operation-graph-schema.ts` — Zod schemas.
  - Mirrored `backend/app/schemas/operation_graph.py` — Pydantic models.
  - Shape: `{ id, userGoal, reasoning?, nodes: Node[], panelBindings: Binding[], metadata }`.
- **Backend scaffold:** `backend/` Python project, FastAPI app, three endpoints:
  - `POST /api/session` — accepts image bytes, returns `sessionId`.
  - `POST /api/analyze` — accepts `sessionId`, returns `ImageContext`.
  - `POST /api/panel` — accepts `sessionId` + goal text, returns Operation Graph.
  - `/api/refine` stubbed for Phase 3.
- **Anthropic SDK integration:**
  - Opus class, structured tool use only (no free-text generation).
  - System prompt + image cached at prompt prefix.
  - Validation retry (≤2 retries) on Pydantic failure.
- **Frontend AI plumbing (primitives + level-2 only — no inline components):**
  - `src/components/ui/CommandPalette.tsx` — primitive, generic palette (Cmd+K).
  - `src/components/inspector/AiPanelSection.tsx` — level-2, renders an `ai-panel` layer's controls.
  - `useImageContext` hook — auto-fires `/api/session` + `/api/analyze` on image load (extends `useFileIO`).
  - `ai-panel` layer type registered in the layer model. A new processing definition keyed `ai-panel` is registered in `ProcessingRegistry`; its `Panel` component reads the layer's `operationGraph` + `panelBindings` and renders each binding as a labelled control via existing primitive sliders/pickers. No new control types — bindings reuse the existing `AdjustmentSlider` and friends.
- **One revertable adjustment** via existing pipeline (kelvin or exposure, bound by the model).
- **Bootstrap:** `.env.example`, `backend/README.md`, `npm run dev:backend` script (or instruct to run `uvicorn` separately).

**Exit criteria:**
- Loading an image triggers a visible "analysing…" indicator that flips to "ready" within a few seconds.
- Cmd+K → typing "make it warmer" → glass panel appears with a labelled control (e.g. "warm cast") inside ~3 s.
- Dragging the control updates the image. Cmd+Z undoes the AI step.
- `npm run check` passes; ESLint rule rejects a deliberate nested-component violation in a test fixture.

**Scope cuts:** SAM, reasoning badges, provenance, branching, multi-panel, refine endpoint, "reset to suggestion".

---

### Phase 2 — Tree-History Refactor (May 25 → Jun 8, 2 weeks)

**Goal:** Replace flat undo/redo with a tree structure. Only the Phase-1 thin slice consumes history at this point; refactor cost is bounded.

**Deliverables:**

- Rewrite `src/core/history.ts`:
  - Node: `{ id, parentId | null, childIds, milestoneLabel?, metadataSnapshot, pixelSnapshots, createdAt }`.
  - Tree: `{ nodeMap, currentPointer, branchHeads: { main: nodeId, [name]: nodeId } }`.
  - API: `commit()`, `undo()`, `redo()`, `branchFrom(nodeId, name?)`, `switchBranch(name)`, `setMilestone(nodeId, label)`, `getCurrentPath()`.
- **Eviction:** 50-entry / 500 MB budget; evict oldest non-milestone first; milestones preserved as long as the budget can be respected by other evictions.
- **Transaction system preserved:** `transaction.begin(label, layerIds)` / `commit()` capture pre-state metadata + WebP pixel snapshots (q0.85, 20–50 KB/layer).
- **Debounce constants unchanged:** `ACTION_DEBOUNCE_MS = 250 ms`, 2 s slider auto-commit window, on-pointer-release early commit.
- **`.edp` migration:**
  - Extend manifest with tree structure + branches + currentPointer.
  - Migration loader: existing flat `.edp` files load as a linear `main` branch.
  - Migration test fixtures: ≥3 historical `.edp` files round-trip without loss.
- **Consumer updates:**
  - `src/components/panels/HistoryPanel.tsx` reads from the tree API (UI rework deferred to Phase 5; for now, render the current linear path).
  - Undo/redo shortcuts in `MenuBar` and `KeyboardShortcuts` updated.
- **Session auto-save:** IndexedDB serialiser handles tree structure.

**Exit criteria:**
- Existing user flows (open, edit, undo, redo, save, reload, restore) are unchanged from a user perspective.
- A unit-level test fixture demonstrates: commit → branch → switch → commit → switch back → undo works correctly.
- `npm run check` passes; no nested-component violations.

**Scope cuts:** Branching UI, comparison view, milestone-naming UI.

---

### Phase 3 — AI Completeness (Jun 8 → Jun 29, 3 weeks)

**Goal:** All T2 and T3 commitments from the thesis.

**Deliverables:**

- **`InspectorPanel` two-region layout** (`src/components/inspector/`):
  - Top region: existing per-tool panel (`processingDef.Panel` or `toolDef.OptionsPanel`).
  - Bottom region: `AiPanelSection` stack — one `ai-panel` layer per accepted suggestion.
  - Both visible simultaneously; user composes by toggling or ignoring either.
- **Multi-panel coexistence:** each `/api/panel` call creates a new `ai-panel` layer (never overwrites). Layer-level visibility + opacity from `LayersPanel` control suggestion effect.
- **`aiSource` provenance** on `Adjustment` records:
  - `{ graphId, nodeId, label, reasoning, modelName, modelVersion, generatedAt }`.
  - Round-trips through history snapshots and `.edp` persistence.
- **Reasoning badge primitive:** `src/components/ui/ReasoningBadge.tsx` — Lucide `Sparkles` chip with Radix Tooltip on hover (reasoning, model name + version, timestamp).
- **Three revert granularities:**
  - Single control → reset to processing-definition default.
  - Panel layer → toggle `visible: false` on the `ai-panel` layer.
  - History step → standard undo through the tree.
- **Goal-relevant labels:** panel-binding labels carry the model-provided user-facing string ("warm cast"), not raw param keys.
- **`/api/refine` endpoint:** accepts prior graph ID + refinement instruction, returns updated graph; new layer created on accept.
- **"Reset to model suggestion"** action on each `ai-panel` layer — replays the immutable proposal graph (since slider adjustments don't re-run the model).
- **Image context reuse verified:** Anthropic response headers logged for cache-hit confirmation across subsequent panel calls within the same session.

**Exit criteria:**
- Two AI panels visible simultaneously; toggling each independently changes the image.
- Hover any AI control: tooltip shows reasoning and model identity.
- Reset-control / hide-panel / undo all work and do different things.
- Cache-hit rate ≥80 % across 5 sequential panel requests in the same session (measured via response headers).
- `npm run check` passes.

**Scope cuts:** SAM / regions, comparison view, milestone naming UI.

---

### Phase 4 — Hybrid Segmentation (Jun 29 → Jul 13, 2 weeks)

**Goal:** Region-aware edits via SAM ViT-B running in-browser.

**Spike (Day 1):** Confirm SAM ViT-B quantized inference completes in ≤1 s on contemporary laptops (thesis claims ~0.5 s). If not, fall back to backend-hosted SAM and revise the latency contract.

**Deliverables:**

- **ONNX Runtime Web + SAM ViT-B checkpoint** — lazy-fetched on first selection action, cached in IndexedDB (~100 MB).
- **Image embedding worker** — runs the encoder once per loaded image, off main thread, embedding reused across clicks.
- **Explicit selection path:**
  - New tool `select-region` (`src/tools/select-region-tool.ts`).
  - Click on image → polygon mask → labeled overlay ("detected: subject").
  - Produces a `segment.click` node available to scope downstream operations.
- **Implicit / proposed-mask path:**
  - Model emits scope `mask:proposed` with `{ label, confidence, representativePoint }`.
  - Client-side SAM runs the point → preview overlay with label ("proposed: sky").
  - Accept / refine / override flow; on accept becomes a `segment.click` node downstream.
- **Region-scoped Operation Graph nodes** wired into existing layer-mask machinery; non-destructive.
- **Mask refinement:** brush tool can paint into AI-produced masks (extends existing brush, no new tool needed).
- **Image context becomes actionable:** the `candidateRegions[]` already returned by `/api/analyze` in Phase 1 are now consumed by `/api/panel` to emit `mask:proposed` scopes; previously they were informational only.

**Exit criteria:**
- Click on image → mask preview appears within ~1 s after first invocation (after model load).
- AI can return `mask:proposed` scope and the proposed mask renders correctly.
- A region-scoped edit ("darken the sky") visibly affects only the masked area.
- `npm run check` passes.

**Scope cuts:** Branching UI, comparison view.

---

### Phase 5 — Branching UI + Comparison View (Jul 13 → Jul 27, 2 weeks)

**Goal:** Surface the T4 commitments built in Phase 2.

**Deliverables:**

- **History panel rewrite** (`src/components/panels/HistoryPanel.tsx`):
  - Vertical timeline of milestones + branch heads.
  - Current pointer highlighted.
  - Click a node → jump to that state.
  - Visual representation of branches (indentation or column shift).
- **Context menu** (Radix Context Menu, via primitive in `ui/`):
  - "Name this milestone…" (opens a small naming popover).
  - "Branch from here" (creates a new branch, prompts for name, switches current pointer).
  - "Delete branch" (only on branch heads other than `main`).
- **Branch switching** updates `currentPointer`, replays the path from nearest common ancestor.
- **Split-canvas comparison view** (`src/components/canvas/ComparisonCanvas.tsx`):
  - Two side-by-side `EditorCanvas` instances bound to two different branch heads.
  - Each side is independently zoomable, pannable, and interactive.
  - "Promote to main" action on either side replaces the `main` branch head.
- **Shortcuts:** Cmd+\` opens comparison view; Cmd+B opens history panel; arrows navigate branch heads when history panel is focused.

**Exit criteria:**
- A user can: create a milestone → branch from it → edit on the branch → open comparison → see two states side by side → promote one → close comparison.
- Branch switching feels snappy (<500 ms for typical 10-step branches).
- `npm run check` passes.

**Scope cuts:** Deep-tree performance tuning; undo-of-branching (treated as out-of-scope per thesis).

---

### Phase 6 — Polish (Jul 27 → Aug 10, 2 weeks)

**Goal:** Production-grade for the n≈12 evaluation runs.

**Deliverables:**

- **OffscreenCanvas migration** — layer pipelines render off main thread.
- **WebP encoding** of pixel snapshots in history (q0.85), memory budget enforcement validated under load.
- **Error handling:**
  - Backend validation failure retries (≤2) — already in Phase 1, verified end-to-end.
  - Graceful degradation when Anthropic unreachable; non-blocking surface error.
  - Frontend Zod validation failure → fall back to last valid panel + surfaced toast.
- **Loading skeletons** for AI panel generation; analyse status indicator polished.
- **Keyboard shortcuts** verified: Cmd+K, Cmd+\`, Cmd+B, Cmd+Z / Cmd+Shift+Z, branch nav arrows.
- **Visual register pass** against `design.md`: every new component uses tokens; no hardcoded values.
- **Bug bash:** exercise crash recovery via IndexedDB session auto-save with the new tree history.
- **Performance budget:** sub-100 ms response on slider drag; sub-3 s from Cmd+K to panel render (incl. cached prompt).

**Exit criteria:**
- A 30-minute scripted session (open → edit → ask → refine → branch → compare → save → reload) completes without errors.
- `npm run check` passes; lint clean; type errors zero.
- The visual register matches `design.md` (manual audit + a representative screenshot diff).

**Buffer:** Aug 10 → Sep 5 — user study + writing chapters 7–9 (out of scope for this spec).

---

## 5. Consolidated TODO List

Grouped by area; numbered for cross-reference.

### Backend (new Python project)
1. FastAPI scaffold + health endpoint.
2. Pydantic Operation Graph schema.
3. Image context analysis pass + storage in session.
4. Anthropic SDK integration with structured tool use.
5. Prompt caching (image + system prompt + context as cached prefix segments).
6. Session lifecycle (30-min TTL, image bytes cache, context cache).
7. `/api/refine` end-to-end.
8. Validation retry policy (≤2 retries).

### Frontend AI integration
9. Zod Operation Graph schema mirroring Pydantic.
10. `CommandPalette` primitive in `ui/`.
11. `useImageContext` hook (auto-triggers on image load).
12. Toolbar AI button (level-2 in `toolbar/`).
13. `ai-panel` layer type registration + minimal processing definition.
14. Panel-binding renderer (label, control type, range, reasoning badge).
15. `InspectorPanel` two-region layout.
16. `ReasoningBadge` primitive in `ui/`.
17. Three revert granularities wired through layer model.

### History (largest internal refactor)
18. Tree-structured `HistoryManager` rewrite.
19. Eviction policy with milestone preservation.
20. Transaction system preserved.
21. `.edp` migration: flat → tree, with fixtures.
22. Consumer updates (`HistoryPanel`, shortcuts, auto-save).
23. History panel UI (timeline, branch heads, context menu).
24. Split-canvas comparison view.

### Segmentation
25. ONNX Runtime Web setup + checkpoint fetching/caching.
26. Image embedding worker.
27. `select-region` tool (`segment.click`).
28. Proposed-mask preview flow (`segment.proposed`).
29. Mask refinement (brush extension).

### Provenance + serialisation
30. `aiSource` field on `Adjustment`.
31. Operation Graph stored on `ai-panel` layer (immutable proposal).
32. `.edp` export includes graphs + provenance.
33. Session auto-save compatible with new layer type + tree history.

### Tooling, polish, enforcement
34. ESLint custom rule `no-nested-component-definition`.
35. `npm run check` script + pre-commit hook.
36. OffscreenCanvas migration.
37. Loading states + error handling end-to-end.
38. Keyboard shortcuts pass.
39. Visual register audit against `design.md`.

---

## 6. Component Architecture Contract

Codified in `CLAUDE.md` and `design.md`. Summarised here for spec completeness.

**Tiers:**

1. **Primitives** — `src/components/ui/` + `panels/GlassPanel.tsx`. Atomic, presentational, no app state.
2. **Level-2 (topic folders)** — `canvas/`, `graph/`, `inspector/`, `panels/`, `toolbar/`. Compose primitives; read stores.
3. **Page scaffolds** — root of `src/components/`. Wire level-2 into surfaces.

**Hard rules:**

- No inline-defined components (no `function X() { return <…/> }` declared inside another component body).
- Reuse before invent: search `ui/` and the relevant topic folder before writing JSX.
- Cross-domain primitives belong in `ui/`; topic-local sub-components stay in their topic folder.
- Style only via tokens defined in `src/index.css`. See `design.md` for the canonical token tables.

**Enforcement:** custom ESLint rule + `npm run check` (`tsc -b && eslint .`) + pre-commit hook. Lint must pass before any commit.

---

## 7. Risks & Dependencies

| Risk | Phase | Mitigation |
|---|---|---|
| Anthropic API access (key + billing) not in place | P1 | Set up week 1 day 1; blocking. |
| Anthropic cost runaway during dev | P1, P3 | Prompt caching makes iteration cheap; first session call is the expensive one. Monitor via response headers. |
| ONNX SAM ViT-B in-browser perf below ~1 s | P4 | Day-1 spike; fallback to backend-hosted SAM if needed. |
| `.edp` flat→tree migration loses old project data | P2 | Fixture suite of representative historical `.edp` files; round-trip test as exit criterion. |
| Image context schema underspecified or unstable | P1 | Lock schema in P1; bump version in `metadata` if it changes in P3 / P4. |
| Tree-history refactor surfaces hidden consumers | P2 | Audit all callers of `HistoryManager` before starting; codemod existing call sites in one commit. |
| Component-architecture rule discovered to be too strict | ongoing | The rule is mechanical; if a justified exception arises, add it as an ESLint disable with a one-line justification. Don't silently break the rule. |

---

## 8. Out of Scope (Explicit)

- User study execution (n≈12 evaluation).
- Writing chapters 7 (Evaluation), 8 (Discussion), 9 (Conclusion).
- Multi-session persistent project history (single-session only per thesis §5.5).
- Generative image-creation features (inpaint, remove-bg, upscale) — these were in the earlier `phase-5-ai.md` agent but are not in the thesis scope.
- Production deployment of the backend (local `uvicorn` only).
- Defense prep.

---

## 9. Open Items

- **Anthropic model exact ID** — thesis says "Opus class"; pick at Phase 1 start (likely `claude-opus-4-7` since it's the current Opus and is the model running this spec).
- **Pre-commit hook mechanism** — bare shell script vs. `simple-git-hooks` vs. `husky`. Default to bare shell for zero deps; revisit if pain.
- **Image context refresh policy** — currently fires once per session. Open: refresh after destructive crop or large rotation? Defer to Phase 3 once the loop is real.
