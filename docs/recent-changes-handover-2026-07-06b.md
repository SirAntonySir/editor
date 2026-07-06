# Recent Changes — Handover (2026-07-06, part B)

> **Purpose.** Delta handover for everything that landed *after* the
> 2026-07-06 (part A) handover (`docs/recent-changes-handover-2026-07-06.md`,
> tip `2fd5cc4`). **10 commits, now on `main`, tip `22a05b7`** (a merge of
> `feat/atelier-palette-rework`), pushed to `origin/main`. Working tree clean.
>
> Same convention as the other dated handovers: this is the **delta** — what
> changed, why, and where to look. Ordered by importance; a chronological commit
> index closes the document.
>
> ⚠️ **The three live bugs in part A §8 (MobileSAM in-flight, analyze_context
> 500/CORS, open-file decode) are still NOT fixed.** They remain the highest-value
> follow-ups.

---

## 1 · `AI_access` rescoped: gates the AI **widget layer**, not "all AI" (`f70fbd9`, `d59a38c`)

The study's manipulated variable is now **widgets-vs-no-widgets**. SAM
segmentation AND generative fill stay in **both** conditions; only the
AI-composed **parametric widget layer** (and its pin/canvas manipulation) toggles.
The flag keeps its name (`AI_access` backend / `aiAccess` on the snapshot;
`src/lib/ai-access.ts`) — only its *meaning* changed. Docstring rewritten.

**What is gated OFF in the baseline (`aiAccess=false`)** — unchanged from before:
autonomous suggestions, the ⌘K "send as a prompt" AI row + `smart_match`,
`RegionExtractionApproval`, `ClientToolApproval`, `AiMenu`/`menu-actions` Analyze,
the Analyze CTA + `Cmd+Alt+A`.

**What moved INTO both conditions (the two deltas):**
- **Generative fill.** Dropped `genfill` from the palette mode-forcing guard;
  right-click genfill + `GenfillWidgetBody` accept/discard were already ungated.
  Confirmed backend `genfill_create`/`genfill_regenerate` are **not** permission-
  gated on `AI_access` (it only feeds `compute_snapshot`). Genfill produces pixels,
  not a parametric control, so it's exempt.
- **Canvas parametric widgets + pins are OFF in baseline.**
  `promoteToCanvas`/`promoteSingleParamToCanvas` (`inspector/adjustments/promote.ts`)
  now **defensively no-op** via `getAiAccess()` (the frontend never opts itself into
  the widget layer), and the Pin / "open on canvas" affordances are hidden
  (`ToolSection`, `PromoteOnlyBody`, `SliderPinMenu`, HSL button).
  In baseline the ⌘K **op/preset rows become a deterministic inspector launcher**:
  `src/lib/palette-inspector-route.ts` — `routeOpToInspector` opens + scrolls the
  op's Adjustments section (no side effect); `routePresetToInspector` writes the
  preset's params to **canonical** via `set_param` (mapping `op_id` →
  `registry.ops[id].engine.node_type`) and opens the touched sections. New store
  plumbing: `tool-slice` `expandSection` + `sectionScrollTarget`/`scrollToSection`/
  `consumeSectionScroll`; `preferences` `showAdjustments`; `AdjustmentsAccordion`
  scroll-into-view + `data-section-id` on each `ToolSection`; `resolveSpawnContext`
  exported from `toolrail-spawn`. When `aiAccess=true`, op/preset rows keep spawning
  widgets as before.

**Instrumentation — verified, no code change needed** (`d59a38c`). The study-measures
classifier (`backend/app/services/study_measures.py`) already counts
`canonical.updated` as the **manual** surface and does not require `widget.created`
to exist, so a baseline session (inspector-only editing, plus preset `set_param`)
yields `manual_edit_share ≈ 1.0`. A regression test locks this in.

> ⚠️ **Thesis-design note carried forward:** with "Ask" later un-gated (see §2),
> "no-AI" means precisely "no AI **widget layer**" — baseline users can still ask
> grounded questions and run generative fill; they cannot compose parametric
> widgets or pin to canvas. State this framing explicitly in the method section.

Spec: implicit in the task; the palette-routing design decision was confirmed
interactively (baseline = "open inspector section, no side effect"; presets also
write canonical).

---

## 2 · Atelier — command-palette rebrand, modes, scroll fix (`2301747`, `d073a33`, `b60172a`)

Spec: `docs/superpowers/specs/2026-07-06-atelier-palette-rework-design.md`.

**Branding.** The app + ⌘K palette are now **Atelier**. `index.html` `<title>` →
`Atelier`; the ⌘K trigger pill → **"Search Atelier…"** (no `aiAccess` branch, so it
never leaks the study condition); a quiet "Atelier" identity label sits in the
palette chrome. `useAiAccess` removed from `CommandTrigger` (now unused).

**Modes: Edit · Ask · Fill, identical in both conditions.**
- Renamed the default mode **"Agent" → "Edit"** — label *and* the internal
  `PaletteMode` id `'agent'`→`'edit'` everywhere (incl. `ImageNodeDrafting`'s
  "Edit with Agent" → "Edit with Atelier"). No `'agent'` mode-literal remains.
- **Ask is un-gated** (reverses the earlier §1 gate): the `ModeToggle` renders all
  three modes in **both** conditions, so the toggle no longer signals the
  condition. Removed the `aiAccess` prop from `ModeToggle` and the mode-forcing
  guard. What still differs by `aiAccess` lives *below* the toggle (Edit mode:
  widget-spawn vs inspector-route; the send-as-prompt row + `smart_match` stay
  gated). Edit placeholder → "Search adjustments or type an intent…".

**Scroll fix (the tricky one).** The results list wouldn't scroll at all. Root
cause: Radix `ScrollArea`'s Viewport sizes with `height:100%`, which only resolves
against an ancestor with a **definite** height — the palette shell has only
`max-height` (plus a Framer `layoutId` shared-layout animation), so the percentage
collapsed to content-height and the viewport never overflowed; `overflow-hidden`
just clipped it. (A first patch adding `max-h` to the results wrapper made it worse
— it kept the shell under its own cap.) **Fix:** replaced the Radix ScrollArea with
a plain **`overflow-y-auto` + `max-h` list** (`data-atelier-results`), which sizes
to content up to the cap then scrolls regardless of the ancestor chain; the
wheel-over-input handler now targets that element; added a thin `.atelier-scroll`
scrollbar style (`index.css`; macOS overlay scrollbars reserve no width).

> ⚠️ **Needs one real-app confirmation.** The scroll fix is correct by construction
> (native overflow doesn't depend on ancestor height) but was not visually verified
> in this session — open ⌘K in Edit mode with enough tools/presets to overflow and
> confirm wheel-over-list AND wheel-over-input both scroll.

---

## 3 · "Convert to Layer Mask" removed entirely (`4633c5f`)

Part **D** of the object/layer/adjustment UX cleanup spec (see §4). The feature had
no remaining use case. Removed: the 4 context-menu items, `convertObjectToLayerMask`
(`segmentation/object-actions.ts`), the `'convert-mask'` candidate verb, the
`convert_object_to_layer_mask` LLM tool (manifest file + registration +
`AGENT_LOOP_TOOLS` entry), the client-approval string, and all associated tests
(the registered-manifest count dropped 14→13).

> This batch was authored outside the session and committed here after its test was
> already updated; the tree was green.

---

## 4 · Specs written; partial implementation

- **Object/layer/adjustment UX cleanup** —
  `docs/superpowers/specs/2026-07-06-object-layer-adjustment-ux-cleanup-design.md`
  (`d723e5c`). Four parts: **A** Extract→Copy rename, **B** Move→Duplicate
  (non-destructive, converged layer menus), **C** visibility eye on the widget
  tether edge, **D** remove Convert to Layer Mask.
  **Only part D is implemented** (§3). **A, B, C are still open** — pick them up
  from the spec.
- **Atelier palette rework** — implemented in full (§2).

---

## Chronological commit index (2fd5cc4 → 22a05b7, newest first)

```
22a05b7 Merge branch 'feat/atelier-palette-rework'
b60172a fix(atelier): scroll the results list via native overflow, not Radix ScrollArea
d073a33 feat(atelier): brand palette as Atelier, Edit·Ask·Fill modes, scroll bound
2301747 docs: spec for Atelier palette rework (branding, modes, scroll)
4633c5f feat(objects): remove "Convert to Layer Mask" entirely
77adc91 Merge branch 'feat/copy-duplicate-ux-cleanup'
9045d61 Merge branch 'feat/aiaccess-widget-layer-gate'
d59a38c test(study): baseline (no widget layer) computes manual_edit_share=1.0
f70fbd9 feat(study): aiAccess gate isolates the AI widget layer, not "all AI"
d723e5c docs: spec for object/layer/adjustment UX cleanup
```
