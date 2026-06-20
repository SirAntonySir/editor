# Design + UX Handover Brief

> **Purpose.** Companion to `implementation-architecture-handover.md`. Where
> that brief explains *what* exists, this one explains *why the user-facing
> design is the way it is*. Every load-bearing decision is labelled
> **Entscheidung** with the argument that produced it — most are lifted
> directly from the approved specs under `docs/superpowers/specs/`.
>
> Audience: a second agent writing a thesis chapter on the editor's
> interaction design, or a designer onboarding to the project.

---

## 0 · Design thesis in one paragraph

The editor is a **photo workspace, not a chrome-heavy app**. The image is the
visual centre; every panel, button, slider, label, and edge recedes until the
user needs it. AI affordances follow the same rule: **subtle and optional**,
never showy. The visual register is **minimal flat Vercel / Radix** — solid
surfaces, 1 px hairlines, no blur, no `backdrop-filter`, no springs, no
scale-pop. Movement is communicative, not decorative. The interaction model
is **keyboard-first with fuzzy search as the primary command surface**;
mouse-only flows are first-class but secondary.

---

## 1 · Visual register: the Vercel / Radix flat redesign

Until 2026-05-29 the editor used an **Apple-HIG glass / translucent** look
(`backdrop-filter: blur(20px)`, layered shadows, springy entrances, frosted
cards). That register was replaced wholesale; spec:
`docs/superpowers/specs/2026-05-29-ui-makeover-vercel-flat-design.md`.

What changed:

- **Surfaces.** Two kinds only — **docked chrome** (`bg-surface` + 1 px
  `--color-separator` edge, no shadow, no blur) and **floating overlays**
  (`.overlay` utility: same `bg-surface`, 1 px `--color-border-strong` edge,
  `--shadow-overlay`).
- **Radii.** Tightened: `--radius-panel 12 → 8 px`, `--radius-button 8 → 6`,
  `--radius-sm 6 → 4`. User-tunable in Preferences (`small / medium / large /
  full`).
- **Motion.** Framer default flipped from `{ type: 'spring' }` to a tween
  `{ duration: 0.16, ease: [0.2, 0, 0, 1] }`. `whileHover` scale-pop and the
  `layoutId` sliding-tab indicator were removed. Entrances are
  `opacity + 4 px translate` at `--duration-normal` (160 ms) — *not* spring.
- **Typography.** Geist Sans (UI) + Geist Mono (every number). A `.num`
  utility class enforces `tabular-nums` so digits don't jitter during a drag.
- **Iconography.** Lucide React only, named imports. Sizes: 16 px in
  toolbars, 14 px inline with text, 12 px badges, 8 px in dense kbd-style
  chips.
- **Theme.** `data-theme="dark"` on `<html>`. Light is default.

The spec also deleted dead code (`HistoryPanel`, the `LeftSidebar` it lived
in, every consumer of `--shadow-panel`) so the makeover was a *reduction*,
not an additive layer.

#### Entscheidung 1 — Why drop the glass aesthetic?

- **The photograph is the subject.** A frosted, blurred panel competes with
  the image for attention even when it is "out of focus". A flat hairlined
  panel does not.
- **Performance.** `backdrop-filter: blur(20px)` is expensive at editor zoom
  levels — every panel forces a full composite of everything behind it. A
  React Flow workspace with 5–20 nodes plus a docked chrome already moves a
  lot of layers; blur multiplies that cost.
- **Brand-fit for the thesis.** The editor's pitch is "AI as a quiet
  collaborator." A flashy register undermines that pitch tonally.
- **Token churn was avoided** by keeping the *names* of semantic tokens
  (`--color-surface`, `--color-text-primary`) and only renaming the
  glass-specific tokens. ~45 mechanical edits were saved.

#### Entscheidung 2 — Two surface kinds (docked vs floating), not one

- A flat aesthetic erases the visual cue "this is layered above that". With
  only one rule, panels and overlays would read as the same surface.
- The split is explicit: **docked surfaces never have shadow.** Only the
  `.overlay` utility carries `--shadow-overlay`. Borders also split:
  `--color-separator` (faint, for docked dividers and input borders) vs
  `--color-border-strong` (visible, for floating-surface perimeters). This is
  documented in `design.md` §2 and enforced by code review.

#### Entscheidung 3 — Restrained motion, no springs

- Springs imply *delight*; this editor's affordances are tools, not toys. A
  slider that bounces feels imprecise.
- **Motion is informational.** A 160 ms opacity + 4 px translate communicates
  "a thing appeared". A spring communicates "look at me!". The thesis claim
  about AI affordances being subtle requires the same restraint everywhere —
  the AI badge cannot be calm if the surrounding UI is loud.
- A `prefers-reduced-motion` block in `index.css` further damps everything.

---

## 2 · Layout topology

```
┌────────────────────────────────────────────────────────────────┐
│  MenuBar (Radix Menubar) — File · Edit · View · Image · …      │ docked, 22 px
├────────────────────────────────────────────────────────────────┤
│                                          │                     │
│                                          │                     │
│       CanvasWorkspace (React Flow)       │  RightSidebar       │ docked,
│       infinite, pannable, zoomable,      │  · Inspector tabs   │ resizable,
│       ImageNodes + WidgetNodes +         │    Adjustments      │ collapsible,
│       TetherEdges                        │    Info             │ unmounts when
│                                          │    Crop             │ no image
│                                          │                     │
├────────────────────────────────────────────────────────────────┤
│  Status bar — BackendStatusBar (phase, token usage, toasts)    │ docked
└────────────────────────────────────────────────────────────────┘
  Floating overlays: CommandPalette (⌘K), MenuBar dropdowns,
  Tooltip, ContextMenu, WidgetShell (on canvas), Toast
```

#### Entscheidung 4 — Three permanent regions only

- The early UI had a **left vertical toolrail (44 px)** with six abstract
  tool icons (Light / Color / WB / Curves / Levels / Filters). It was deleted
  in the 2026-05-31 Command Palette rework.
- Reasons: the icons were undiscoverable; the rail took permanent space; the
  spawn behaviour was unpredictable. See `2026-05-31-command-palette-tool-opening-design.md`.
- The right sidebar **unmounts** when there are no layers (the empty editor
  has nothing to inspect) — this is a UX choice, not a perf one: a docked
  panel of disabled rows reads as "broken UI." The sidebar reappears the
  instant the user opens an image.
- The status bar replaces a separate "console" or "history panel" — phases,
  toasts, and token usage all surface there.

#### Entscheidung 5 — Why no permanent toolbar/toolrail?

- The new spawn surface is `⌘K`. A toolrail would now be a *second* way to
  invoke the same set of actions, dividing user attention.
- A toolrail's discoverability problem (icons users have to learn) is solved
  by the palette's labelled, fuzzy-searchable rows.
- The two paths are **not** mutually exclusive in architecture — both call
  `propose_widget` with `origin: 'tool_invoked'`. The palette is just the
  *only* user-facing surface.

---

## 3 · Command Palette (Cmd+K)

Spec: `2026-05-31-command-palette-tool-opening-design.md`. Implemented in
`src/components/CommandPalette.tsx` + `src/lib/command-palette.tsx`.

### 3.1 What it replaces

- The 6-button **toolrail** (Light, Color, WB, Curves, Levels, Filters).
- A separate **Preferences** modal (theme, accent, radius). Preferences live
  as palette commands too — "theme dark", "accent purple", "radius small".
- The Menu-bar entries are *also* indexed (Open, Undo, Redo, Zoom,
  Export, …) so the user can keep one fuzzy surface in muscle memory.

### 3.2 Invocation

- **Keyboard:** `⌘K` (`Ctrl+K` on Windows/Linux).
- **Mouse:** a `CommandTrigger` button sits in the bottom-left where the
  toolrail used to be — discreet, low contrast.
- **Gates:**
  - `useBackendState.sseStatus !== 'open'` → palette disabled (Engine-SSoT
    rule; nothing local to write to).
  - No image node in workspace → toast: "Open an image first."
- The palette positions itself **centered over the canvas column**, not the
  full viewport, so it doesn't sit on top of the right sidebar.

### 3.3 Sections, in order

1. **Adjustments · Tone / Color / Detail / Mood / Texture / Effect** — every
   registry op (`shared/registry/ops/*.json`), grouped by category and
   sorted within each by `engine.render_order`. Generated, not hand-written.
2. **Presets · Tone / Color / B&W / Film / Detail / Mood / Looks** — same
   for `shared/registry/presets/*.json`.
3. **Preferences** — theme, accent, radius, visual-style commands.
4. **Menu actions** — Undo, Redo, Open, Zoom in/out, Export, …, grouped by
   their menu-bar group (File, Edit, View, Image, …) and tagged with a `Kbd`
   chip so the user re-learns the shortcut.
5. **AI** — when the query is non-empty, a synthesised row "*<query>* —
   Send as a prompt" appears *between* primary and secondary matches.

### 3.4 Fuzzy search

`src/lib/command-palette.tsx#fuzzyScore` implements field-tiered scoring:

- **Title match** (display name) → ×100 weight. *Primary* result.
- **Synonym match** (op id, preset id, aliases) → ×10. Also *primary*.
- **Description match** → ×1. *Secondary* — placed *below* the AI row.

Within each field, scoring tries — in order — prefix, substring,
subsequence, then Levenshtein up to a small max distance. So `"levl"` still
hits "Levels" via subsequence; `"levesl"` still hits via Levenshtein 1.

#### Entscheidung 6 — Why field-tiered scoring with primary/secondary partition?

- A bare `"light"` query must surface **the Light adjustment**, not "Decrease
  highlights" because the latter merely *mentions* light in its description.
- Description matches still have value (they help with intent — "warmer",
  "fade") but should not crowd out direct tool matches.
- The partition is *visual*: primary rows appear above the AI row, secondary
  below. That signals "we have a direct match" vs "we found something
  related".

#### Entscheidung 7 — Why include menu actions in the palette?

- Two surfaces for "Open file" would be redundant for keyboard users.
- The user's mental model becomes: **everything is a command, the palette
  finds it**. The menu bar is a discovery aid; the palette is the workhorse.
- Menu actions carry their shortcut chip in the row, so when the user picks
  one by search they incidentally re-learn the shortcut.

### 3.5 Target chip

The search row shows a `→ Foto.jpg` chip indicating which `ImageNode` the
widget will attach to. `Tab` cycles through workspace image nodes (sets
`activeImageNodeId`). If only one image exists it's auto-selected; if none
exists the gate fires the toast.

#### Entscheidung 8 — Why an explicit target chip?

- The old toolrail's "spawn somewhere on the canvas" was the worst pain
  point: users couldn't predict where the widget would land or what it would
  affect.
- The chip makes the binding **visible before commit**. The user sees the
  target, can change it (Tab), and only then presses Enter.

### 3.6 AI row execution

`↵` on a tool row → `propose_widget(origin: 'tool_invoked')` (fast, no
LLM). `⌘↵` on the AI row → `proposeFromPalette(text, scope)` with
`origin: 'mcp_user_prompt'`. Both paths share `workspace-tether.ts` for
placement.

While the AI flow is in flight, the input placeholder transitions through
`'analyze' → 'propose'` sub-phases ("Analysing image…" → "Composing
widgets…") so the user knows which step is running. An attached-context UI
lets the user **drop chips** (a region, a colour, a problem) onto Cmd+K so
the prompt carries structured grounding.

#### Entscheidung 9 — Two execution paths from one palette row

- Pressing Enter must always do the obvious thing: select the row.
- Sending a prompt is *different* from picking a tool — it triggers an LLM
  call. Putting them on the same key would conflate them.
- `⌘↵` is the universal "this is the destructive / committing variant" key;
  reusing it for AI prompts means the user doesn't learn a new chord.

---

## 4 · MenuBar

`src/components/toolbar/MenuBar.tsx`. Built on Radix Menubar primitives so
keyboard navigation, focus management, sub-menu opening, and ARIA roles come
for free. The menu groups are **File · Edit · View · Image · Selection · Tools
· Help**.

Visual:

- Trigger buttons: `text-[11px] text-text-secondary`, no background until
  `data-state=open` flips them to `bg-surface-secondary` + `text-text-primary`.
- Menu content: `min-w-[190px] rounded-[var(--radius-panel)] bg-surface
  border border-border-strong shadow-overlay`.
- Items: 22 px tall, `text-[11px]`, accent-on-highlight, `Kbd` chip on the
  right.

#### Entscheidung 10 — Keep a Mac-style MenuBar inside the app?

- Two reasons. (1) The app ships as both **Electron desktop** and **web**.
  An in-app menu bar guarantees the same surface across both targets without
  diverging on macOS's native menu vs nothing on web. (2) It serves as a
  visible *index* of available actions — newcomers find Undo, Export, Add
  image. The palette handles power use; the menu serves discovery.
- Tooltips on menu triggers fire on the right side instead of below — a
  small touch from the 2026-05-28 restyle so the tooltip doesn't cover the
  menu content if it opens.

---

## 5 · Kbd chip

`src/components/ui/kbd.tsx`. A 14 × ≥14 px chip rendering one or more keys.

- **Platform-aware glyphs.** On macOS: `⌘ ⇧ ⌥ ⌃ ⌫ ↩ ⇥`. On
  Windows/Linux: `Ctrl Shift Alt Ctrl Del Enter Tab`. The mapping is one
  line of code, dispatched on `navigator.userAgent`.
- **Style.** 10 px font, `tracking-wide`, `text-text-secondary`,
  `bg-surface-secondary/60`, 2 px radius (`rounded-[2px]`).
- `pointer-events-none ml-auto` — chips never receive clicks and always sit
  flush to the right edge of the parent row.

Used in: palette rows, MenuBar items, tooltip footers, the BackendStatusBar
hint, the empty-state hint on the empty editor.

#### Entscheidung 11 — Why a single, platform-aware Kbd primitive?

- Every keyboard hint in the editor should look identical. The chip is the
  visual unit of "this is a shortcut."
- Platform-aware glyphs are non-negotiable for macOS feel (the Cmd glyph is
  iconic; "Cmd" written out reads wrong).
- The chip is `pointer-events-none` so it cannot interfere with the parent
  row's click target — critical for palette navigation.

---

## 6 · Animations and motion

`design.md` §2 ("Motion") + the makeover spec §6 are authoritative.

| Token | Value | Used for |
|---|---|---|
| `--ease-apple` | `cubic-bezier(0.2, 0, 0, 1)` | default ease for all CSS transitions |
| `--duration-fast` | 120 ms | hover, focus ring, tooltip fade |
| `--duration-normal` | 160 ms | panel entrance, overlay enter, view switch |

Framer Motion canonical tween:

```ts
{ opacity: [0, 1], y: [4, 0], duration: 0.16, ease: [0.2, 0, 0, 1] }
```

(Framer can't read CSS vars, so the cubic-bezier is the one allowed
hardcoded design value.)

#### Entscheidung 12 — Why opacity + 4 px translate (instead of scale)?

- A scale-pop animation makes the element feel like it's emerging from the
  surface. We deliberately don't want that — the panel was always there in
  intent; the animation just signals state change.
- 4 px translate is *visible without being theatrical*. The eye picks it up
  in peripheral vision without breaking focus on the image.
- 160 ms is the upper end of "feels instant" for a content swap. Faster
  reads as a flash; slower reads as deliberate.

#### Entscheidung 13 — No `layoutId` shared-element animations

- The toolbar's old active-tab indicator slid via `layoutId`. It was pretty
  but introduced cross-component animation coupling and slowed tab switches.
- The replacement is a *colour fade* (120 ms) on the active button. Slower
  visually but cheaper computationally and easier to reason about.

#### Entscheidung 14 — `AnimatePresence mode="wait"` for content swaps

- Avoids the two-children-rendered-at-once flicker.
- Matches the user's mental model: "this *is* the panel, content swaps
  inside."
- Exit tween mirrors entrance (`y: [0, -4]`) so the dismissal is symmetrical.

A respects-`prefers-reduced-motion` block in `index.css` damps everything to
near-zero duration for users who set the OS preference.

---

## 7 · Inspector

`src/components/inspector/InspectorPanel.tsx`. Lives in the
`RightSidebar`. Three tabs:

- **Adjustments** — the Lightroom-style accordion.
- **Info** — read-only view of `image_context` (semantic, histograms,
  colour, regions, problems).
- **Crop** — the dedicated crop panel.

### 7.1 Adjustments accordion

Spec: `2026-05-31-adjustments-accordion-design.md`.

Two groups, in order:

1. **AI sections** — pinned on top. One section per active AI-spawned widget
   on the active layer. Each section is **immediately editable** — no engage
   step. Reasoning, controls, and Refine/Why are inline.
2. **Tool sections** — exactly the six adjustments (Light · Color · White
   Balance · Curves · Levels · Filters → in `--render_order`). Always
   present; always editable.

Every section is a **view over the same canonical state** as the matching
canvas widget. Editing one moves the other for free — the editor cannot
fall out of sync because there is only one number to move.

Sections are visually labelled by a small icon (Material symbol from the op
JSON), title, scope chip, dirty dot, chevron. Click row → expand inline.

#### Entscheidung 15 — Why Lightroom-style accordion (vs floating widgets only)?

- Two views of the same edit serve different working postures: a user with
  the inspector open is *grinding* (precise, repeated tweaks); a user with
  canvas widgets only is *exploring* (AI suggestions, overview). Both must
  edit the same value.
- The accordion's always-on visibility is a *map* of the develop state —
  the user can scan and see "I touched Light, Color, and the AI Sky widget,
  nothing else."
- Sharing the data path also means there is **no synchronisation code**.
  The canonical state is the only state; both surfaces read from it.

### 7.2 Info tab

Spec: `2026-05-29-image-info-panel-design.md`. Read-only.

Sections: **Semantic** (subjects, dominant tones, lighting, mood, grade
character) · **Histograms** (luma + RGB, clipping percentages, median luma,
contrast) · **Color** (palette swatches sized by weight, estimated white
point, cast a*/b* dot) · **Regions & problems** (mask thumbnails,
problems with severity bars).

All primitives are tiny inline SVG (`Histogram`, `Swatch`, `PercentBar`) —
no charting library. The Info tab is a window into what the LLM is also
looking at; it lets the user judge whether the AI's analysis is
trustworthy.

#### Entscheidung 16 — Why surface backend `image_context` to the user?

- Trust calibration. If the AI says "the sky is overexposed" but the
  histogram shows no clipping, the user spots the disagreement.
- Educational value. The user *learns* image analysis vocabulary by seeing
  the labels next to the picture.
- Zero new backend work — the data was already computed for the LLM.

---

## 8 · React Flow workspace UX

Specs: `2026-05-30-canvas-workspace-design.md`,
`2026-06-02-image-node-styling-zoom-invariance-design.md`,
`2026-06-09-zoom-aware-scaling-design.md`.

### 8.1 Why React Flow

- Infinite pan / zoom, multi-selection, edge routing, keyboard handlers all
  come pre-built. Reimplementing it would take months for no value-add.
- The **WidgetNode** abstraction maps the thesis USP exactly: an
  AI-composed widget is *a node on the canvas, tethered to the image it
  affects*.
- Tradeoff: React Flow renders nodes as DOM. We pay layout cost per drag,
  but every node's *body* is either `<canvas>` (ImageNode) or a styled DOM
  card (WidgetNode); neither suffers.

### 8.2 Tether edges — attribution only

A `TetherEdge` is a bezier curve in `--color-accent`, with 3 px endpoints.

- **Solid stroke** — layer-scope (the widget edits a single layer).
- **Dashed** (`stroke-dasharray="3 3"`) — node-scope (the widget edits the
  whole composite of an image node).
- **No arrowhead.** Tethers are not data-flow; they are visual attribution.

#### Entscheidung 17 — Why tethers carry attribution only, not DAG semantics?

- Previous iterations explored a real node graph (`graph-mode`). It
  failed the user-research test: photographers do not think in DAGs, they
  think "edit this image."
- Attribution-only tethers preserve the *visual* benefit of the connection
  (you see what edits what) without the *cognitive* cost of a node-graph
  model.
- The Operation Graph (the actual DAG) lives in the backend snapshot and
  the user never sees it.

### 8.3 Zoom-aware scaling (Figma model)

Spec: `2026-06-09-zoom-aware-scaling-design.md`.

Earlier iterations counter-scaled chrome (widgets stayed screen-sized while
the image zoomed). That felt wrong: widgets looked detached from the image
at high zoom and dwarfed it at low zoom.

**The shipped model:**
- Widgets, image-node chrome, and tether edges live in **canvas space** —
  they scale with zoom, like the image bitmap does.
- At very low zoom (`useChromeVisible` returns false), widget bodies
  collapse to a small coloured `MarkerDot` to reduce clutter and skip
  expensive render passes.
- Real UI chrome outside React Flow (MenuBar, RightSidebar, StatusBar)
  stays screen-fixed.

#### Entscheidung 18 — Why drop the counter-scale (Figma model)?

- Widgets ARE the user's working surface, not chrome. They should belong to
  the image canvas, not the page.
- This matches the Figma mental model: frames, shapes, text scale with zoom;
  only handles, selection indicators, and panel labels stay screen-fixed.
- Code reduction: `useChromeScale` and its consumers all disappeared.

### 8.4 Selection glow

Spec: `2026-06-02-image-node-styling-zoom-invariance-design.md`.

One colour rule:
- **Violet (`--color-ai`)** is reserved for AI identity. Only AI-composed
  widgets glow violet.
- **Accent blue (`--color-accent`)** carries selection state for everything
  else. Image nodes and tool-invoked widgets get the same accent glow when
  selected.

The glow is a layered shadow (1 px ring + soft 14 px bloom), with all
radii passed through `--chrome-scale` so the bloom doesn't shrink to nothing
at high zoom.

#### Entscheidung 19 — Violet for AI only, accent for selection — never both

- A single colour language. The user always knows what violet means.
- Avoids the "AI widget that's also selected" case looking purple-blue.
- AI widgets keep their violet identity even when selected; the violet
  simply dominates.

### 8.5 Auto-layout for spawn

Spec: `2026-06-08-workspace-spawn-layout-design.md` (alluded to in §10 of
`design.md`).

New widget and image nodes spawn via `nextSpawnPositionFor`: one slot to the
right of the target with a 24 px gap, shifting down to clear occupied slots.
After placement, users drag freely.

#### Entscheidung 20 — Soft auto-layout, manual override

- A blank canvas with a "drag me to position me" affordance is hostile.
- A locked auto-layout takes the user's agency.
- The compromise: place sensibly *once*, then never move it again. The
  position is part of the workspace state and survives until the user moves
  it.

---

## 9 · Widget Shell

Specs: `2026-05-30-widget-shell-design.md`, `2026-06-02-widget-visibility-and-compare-design.md`.

### 9.1 Anatomy

**Collapsed** (default render state, 226 × 30 px):

```
┌───────────────────────────────────────────────────┐
│ [AI]  Warm up shadows   •   [● Sky]      ›        │
└───────────────────────────────────────────────────┘
  badge  intent          dirty scope chip      chevron
```

**Expanded** adds: reasoning row · preview slot · bindings region (the
6-block kit) · footer (`↻ Refine · ? Why? · Reset · Apply`).

### 9.2 Variant badge

- **AI badge** (`Sparkles` + "AI", violet) for `origin.kind` in
  `{ mcp_user_prompt, mcp_autonomous, refine, repeat }`.
- **Muted `·` chip** for `tool_invoked` / `fused_expansion`.

The badge is the only place AI provenance is colour-coded; the
[reasoning-badge tooltip](src/components/ui/ReasoningBadge.tsx) carries the
model name, version, and timestamp.

### 9.3 Lifecycle

- **Live edit** — slider drag → optimistic patch → debounced
  `set_widget_param`. The canvas updates instantly.
- **Apply** → `accept_widget` *bakes* the effect into `operation_graph` and
  the widget vanishes from the canvas. Effect remains; the chrome goes.
- **×** → `delete_widget`. Effect undone.
- **Reset** → reverts every binding to its default.
- **Refine** → inline `RefineInput` opens above the footer. Enter sends
  `refine_widget` with the typed instruction. The widget *mutates in place*
  — same id, new resolution.

#### Entscheidung 21 — Why "live + Apply = bake"?

- The expanded widget is the user *trying on* an effect. Live preview is via
  the same canonical writes a manual slider would do — no separate "preview
  mode" code path.
- Apply is *promotion*, not commit: the effect was already on. The button
  removes the chrome (the widget card itself) and keeps the canonical
  contributions.
- Dismiss must actually undo the effect — otherwise users get confused
  ("why does the image still look warm after I dismissed the warm grade?").

#### Entscheidung 22 — Multi-expand allowed

- Lightroom and friends restrict to one expanded section. The thesis
  workspace is canvas-centric, with widgets *physically separated* on the
  canvas — there is no scroll cost to multi-expand.
- Power users edit multiple widgets in concert (sky + subject + grade);
  forcing collapse on each click hurts that flow.

### 9.4 Compare / visibility

Spec: `2026-06-02-widget-visibility-and-compare-design.md`.

- An **eye icon** in the header toggles widget visibility — its contribution
  is *suppressed* in the render pipeline without deleting the widget.
- A **shift-hold** gesture on the image (or any widget header) toggles a
  "compare to original" temporary state. Lift to return.

#### Entscheidung 23 — Why a non-destructive visibility toggle on each widget?

- The user can A/B individual effects without losing the whole stack.
- Combined with shift-hold compare-to-original, the user has two visibility
  scopes: per-widget and whole-stack.

### 9.5 Specialised widget bodies

The shell's bindings region defaults to `BindingRow` (slider/toggle/choice).
But certain ops need richer bodies; they get bespoke components:

- **HSL** — `HslWidgetBody` (8-band wheel + per-band channel sliders, spec
  `2026-05-31-hsl-panel-redesign-design.md`).
- **Curves** — `CurvesWidgetBody` (spline editor).
- **Levels** — `LevelsWidgetBody` (histogram + 5 markers).
- **Compound** — `CompoundWidgetBody`: a perceptual dial topology
  (`linear` slider or `wheel` SVG, see Entscheidung 24) over named anchors
  (Mood, Age, Weather, Time of Day, Season).

#### Entscheidung 24 — Why two compound-dial topologies (linear vs wheel)?

Spec: `2026-06-09-circular-compound-dial-design.md`.

- Mood, Age, Weather are *directional* progressions — a linear dial fits
  ("cold → warm").
- Time of Day and Season are *cyclic* — day repeats, year repeats. A linear
  dial puts a seam in a cycle that has none.
- The wheel is the natural metaphor (a Northern-hemisphere seasons diagram,
  a clock face) and the JSON `topology: "wheel"` declaration keeps the
  switch a one-line config decision per op.

### 9.6 HSL panel redesign

Spec: `2026-05-31-hsl-panel-redesign-design.md`.

The old HSL surface was 24 identical rows (8 bands × hue/sat/lum). The
redesign uses:

- **8 band tiles**, one per colour, with the colour itself filling the tile
  background.
- **Two views**: the tile grid (overview, "what have I touched?") and a
  per-band detail view (3 sliders for the picked band).
- A **dirty dot** on touched tiles so the overview surfaces edit state.

#### Entscheidung 25 — Why a colour-driven HSL panel?

- The 24-row wall has no visual hierarchy; users can't tell at a glance
  which band they're editing or what they've touched.
- Good HSL panels (Lightroom, Capture One, Photoshop) all use colour cues.
- The redesign is purely frontend — the engine and shader stayed.
- It's also the canonical demonstration of the **provenance colour rule**
  (untouched grey, hand-touched accent, AI-touched violet) on a dense
  surface.

---

## 10 · Slider primitive

`src/components/ui/AdjustmentSlider.tsx`. Built on Radix Slider.

- **Hidden thumb.** The slider track *is* the thumb — the fill colour
  travels from the neutral position to the current value. Drag scrubs.
- **Drag-to-scrub numeric readout.** The label flips to a live numeric value
  while dragging; releases back to the static label.
- **Click-to-type.** Click the value to enter a number directly.
- **Double-click to reset** to `defaultValue` (the AI's pick for AI
  bindings, engine neutral for manual ones).
- **Provenance colour:**
  - `default` (grey, `--color-text-secondary`) — untouched.
  - `hand` (accent blue) — the user moved it.
  - `ai` (violet, `--color-ai`) — an AI/fused widget set it.
- **Bipolar gradient.** For HSL hue sliders, the track shows a CSS gradient
  representing the colour shift rather than the standard fill.
- `.num` (Geist Mono + tabular-nums) on every readout so digits don't
  jitter.

#### Entscheidung 26 — Why a thumbless slider?

- The thumb is visual noise. The fill itself already communicates value.
- Thumbless sliders read as more **tool-like** and less **form-like** — the
  surface is *for editing*, not for committing.
- Drag-to-scrub is the natural gesture on a thumbless track; click-to-type
  covers the precise-entry case.

#### Entscheidung 27 — Provenance colour at the slider level

- The user always knows where a value came from. Untouched stays grey;
  AI-set is violet; hand-moved is blue. The colour persists until reset.
- This is the *only* place "AI" gets a unique visual treatment outside the
  badge. The doctrine is consistent: violet means "AI touched this".
- Implementation: `useParamProvenance` watches a touched-key set; AI
  bindings auto-flag from their source.

---

## 11 · BackendStatusBar + toasts

`src/components/ui/BackendStatusBar.tsx`.

A single docked strip at the bottom that surfaces:

- **Connection status** — the SSE state from `BackendState.sseStatus`.
- **In-flight analyze phase** — the representative phase label from
  `PhaseSteps` (Update / Mechanical / AI context / Suggest), with sub-counts
  for `mask_precompute`.
- **Cumulative token usage** for the current analyze run.
- **Cancel button** while an analyze is in flight (calls a backend cancel
  endpoint; flips to "Cancelling…" until `phase.cancelled` arrives).
- **Toasts** — `toast.info(text)` and `toast.error(text)` from anywhere in
  the app. Queue is **replace-latest, length 1** — the newest toast wins.

Animation is a single Framer enter (opacity + 4 px) + AnimatePresence wait.
Colours: info / progress grey, success emerald, error red.

#### Entscheidung 28 — Replace-latest toast queue

- A real queue would stack multiple errors during, say, a backend disconnect
  burst. The status bar would become an alert wall.
- Editor errors are usually transient and superseded — the latest one is
  what the user cares about.

#### Entscheidung 29 — Phases as named, ordered steps

- Each analyze phase has a distinct *user-facing meaning* (Mechanical = fast
  stats; AI context = vision call; Suggest = widgets). Calling them out by
  name lets the bar surface useful progress instead of a generic spinner.
- The phases also enable a clean cancel UX — the bar can show
  "Cancelling…" until the matching phase event arrives.

---

## 12 · Layers panel

`src/components/panels/LayersPanel.tsx`.

Standard layer-panel features: drag-reorder, visibility toggle, opacity %,
blend mode dropdown, layer-type icon (`Image / Brush / Type / Sun` from
Lucide).

UX details worth calling out:

- **`OpacityInput`** — single-click reveals an input pre-selected; Enter or
  blur commits; values clamped to 0–100.
- **Blend modes** in a Radix `DropdownMenu` styled as `.overlay`.
- **Context menu** (right-click on a row) for Duplicate, Delete, Convert to
  mask — also `.overlay` styled.
- Layer rows highlight on hover via `bg-surface-secondary`, not an outline.

The Layers panel is **part of the right sidebar shell**, not a separate
floating panel. It coexists with the Inspector tabs; the user can resize
the sidebar (200–480 px clamp).

#### Entscheidung 30 — Layers in the sidebar, not on the canvas

- One earlier iteration had layers *as* React Flow nodes inside an ImageNode
  stack. That worked for two-image cases but cluttered the canvas with
  meta-rows that weren't editable surfaces.
- The sidebar Layers panel is invisible until the user needs it (it
  unmounts when there are no layers) and out of the way of the image.

---

## 13 · Image node UX

`src/components/workspace/ImageNode.tsx`. A `.overlay` card:

- **Header** — icon · file name · `N LAYERS` badge.
- **Body** — `<canvas>` driven by `useImageNodeRender`. Sized to the
  *display* width (independent of source resolution).
- **Footer** — `{w} × {h}` · `Layer N` (the active layer's name).

When **selected**:

- A **stack strip** appears below the body for multi-layer nodes — a
  horizontal list of the layers in the stack, draggable to reorder.
- A **circular split/menu affordance** at the top-right opens a Radix
  DropdownMenu with **Split last layer** / **Delete**.
- An **`ImageNodeSelectionPopover`** anchors to the header, surfacing
  **Create layer** / **Discard** when a committed selection mask sits
  inside its layers.

Drag handles on the corners enable **interactive resize**, aspect-locked,
clamped to `[IMAGE_NODE_MIN_DISPLAY_WIDTH, IMAGE_NODE_MAX_DISPLAY_WIDTH]`.

#### Entscheidung 31 — Display-width independent of source resolution

- A 24 MP source and a 1 MP source both enter the workspace at the same
  visual size. Users compare images on equal terms.
- The internal pipeline still renders at source resolution; display width
  only affects the canvas element's CSS dims.

#### Entscheidung 32 — Selection-only affordances (stack strip, split/menu)

- The clean image-node card is the default; selection reveals the editing
  surface.
- This mirrors the "no chrome until needed" principle for the editor as a
  whole.
- The chevron-less menu (just a small button) avoids a perpetual UI element
  on every node.

---

## 14 · Iconography rules

- **Lucide React** for chrome (close, chevrons, file ops, status bar). Named
  imports only — `import { Sun } from 'lucide-react'`, never star-import
  (tree-shaking, lint-checked).
- **Material Symbols (Outlined)** for op icons and processing icons. Each op
  in `shared/registry/ops/*.json` declares an `icon` field that's a Material
  symbol name (`light_mode`, `tune`, `colorize`, `ssid_chart`). The icons
  are loaded from a single CSS-embedded font and rendered by a
  `MaterialIcon` primitive.
- Sizes: 16 px (toolbars), 14 px (inline with text), 12 px (badges), 10 px
  (kbd chips).
- Stroke 1.5 – 2 (Lucide default OK).

#### Entscheidung 33 — Two icon families: Lucide + Material Symbols

- Lucide's stroke style matches the editor's flat register; it's the right
  choice for *chrome* (buttons, close icons, status icons).
- Material Symbols are richer for the **op domain** (`tune`, `ssid_chart`,
  `colorize`, `wb_sunny`) — Lucide doesn't cover all the photo-editor
  vocabulary at the right semantic level.
- The two are tuned to read at the same visual weight (`opsz` axis on
  Material set to match Lucide's 1.75 px stroke).

---

## 15 · The drafting visual style

Spec: `2026-06-16-image-node-drafting.md`. An *opt-in* alternative visual
register, picked from the palette ("style drafting"). When active,
`[data-visual-style="drafting"]` on `<html>` swaps in a different palette:

- Cream paper background (`oklch(0.97 0.012 90)`).
- Ink-coloured text.
- Ochre accent (`oklch(0.55 0.20 30)`) — stands in for "marginalia ink".
- Fraunces (variable italic serif) as the display family for image-node
  marginalia. Body UI stays on Geist.
- AI provenance stays violet — that doctrine is universal.

#### Entscheidung 34 — Why ship a second visual style?

- Thesis demonstrates that the token system *works*: a different aesthetic
  drops in via one CSS variable swap, no component changes.
- The drafting register is a deliberate *contrast*: warm vs cool, serif vs
  sans, marginalia metaphor vs flat utility. The user can experience the
  same editor with a totally different mood.
- Practically: it's a forcing function. If a component is style-agnostic, it
  works in both registers. If it breaks, it's leaking hardcoded values.

---

## 16 · Preferences

`src/store/preferences-store.ts`. Persisted via `zustand/middleware/persist`
under `localStorage['editor-preferences']`.

- `themeMode: 'light' | 'dark' | 'system'`.
- `accentColor` — picked from `ACCENT_COLORS` (Blue, Purple, Pink, Red,
  Orange, Yellow, Green, Teal).
- `radiusScale: 'none' | 'small' | 'medium' | 'large' | 'full'`.
- `visualStyle: 'classic' | 'drafting'`.
- `rightSidebarCollapsed`, `rightSidebarWidth`, `rightSidebarTab`,
  `inspectorTab`.

All of these are settable from the **palette** rather than a dedicated
Preferences page. Each command runs `applyPreferences()` which writes the
matching CSS variables on `<html>` and persists.

#### Entscheidung 35 — Preferences live as palette commands

- One surface for everything the user might invoke.
- The user types "dark" → "Theme · Dark" appears → Enter. No separate modal,
  no settings hunt.
- An `accentColor` change is one keypress away from the action — invites
  experimentation.

---

## 17 · Empty states

- **No image opened.** Centered "Open Image" button + a `Kbd` chip showing
  `⌘O`. No spinner, no decoration.
- **Backend not connected.** Status bar shows the reconnect state; Cmd+K is
  disabled with a tooltip; toolrail equivalents are disabled.
- **Active layer with no widgets.** Adjustments accordion still shows the
  six tool sections — they're always editable; the AI group is just empty.
- **Cmd+K with empty query and no recent commands.** All sections show; no
  "no recent" empty-state row (it would add noise).

#### Entscheidung 36 — Empty states never apologise

- "No image yet" with a sad face is hostile. The empty editor just shows
  the affordance to add one, and the kbd hint for keyboard users.
- "Backend not connected" surfaces in the status bar as state, not as a
  modal. The user keeps their workspace; the editor degrades gracefully.

---

## 18 · Accessibility

- Radix primitives provide keyboard navigation, focus trapping, ARIA roles
  for: Dialog (palette, dialogs), DropdownMenu (menu bar, layer context),
  ContextMenu, Tooltip, Slider, ToggleGroup, Tabs, ScrollArea.
- **Focus ring** is the Radix default, recoloured to `--color-accent`.
- Kbd chips don't carry click handlers but expose their key combination as
  visible text for screen readers.
- `prefers-reduced-motion` block in `index.css` damps every motion to
  near-instant.
- Numeric readouts use `tabular-nums` so screen-magnifier users don't see
  the row reflow under their cursor.

#### Entscheidung 37 — Lean on Radix instead of building primitives

- Every Radix primitive used in the editor (Dialog, Menubar, DropdownMenu,
  Tooltip, Slider, ToggleGroup, Tabs, ContextMenu, Popover, ScrollArea,
  Separator, Switch) ships keyboard + screen-reader behaviour we'd
  otherwise have to write and test ourselves.
- Cost: bundle size. Mitigated by Radix's per-primitive packages — only
  what's imported lands.

---

## 19 · Component-tier rules and code health

These are not aesthetic decisions but they shape what gets built. Repeated
from `CLAUDE.md` because they're load-bearing for *consistency*:

- **Three tiers** — primitives (`ui/`), level-2 topic folders (`workspace/`,
  `inspector/`, `panels/`, `toolbar/`, `widget/`), scaffolds (root of
  `components/`).
- **No inline-defined components.** Enforced by a custom ESLint rule
  (`tools/eslint-rules/no-nested-component-definition.test.js`). Wired into
  `npm run check` and the pre-commit hook.
- **Reuse before invent.** Before writing JSX, search `ui/` and the relevant
  topic folder for a primitive that fits.
- **Style only via design tokens.** No hardcoded hex, px, or ms for design
  values. The cubic-bezier inside a Framer Motion call is the one allowed
  exception (Framer can't read CSS variables).

#### Entscheidung 38 — Enforce structure with lint, not review

- Visual review catches inconsistency *after* it's written; lint catches it
  *as* it's written.
- The component-tier rule documents itself — a violation lights up in the
  editor.
- This is the single biggest lever against design drift in a long-lived
  codebase.

---

## 20 · What to write *about* (priority order)

When the second agent uses this brief to write thesis text, the user-facing
load-bearing decisions are, in roughly decreasing thesis-relevance order:

1. **The Vercel/Radix flat redesign as a deliberate retreat from
   delight-aesthetics** (Entscheidungen 1, 2, 3, 12).
2. **The Command Palette replacing the toolrail** as the new spawn surface,
   with fuzzy field-tiered scoring and a target chip (Entscheidungen 5, 6, 7, 8).
3. **AI provenance as a single visual rule** — violet for AI, blue for hand,
   grey for untouched — applied at every level (slider, badge, selection
   glow) (Entscheidungen 19, 25, 27).
4. **The widget shell as a unit of AI-composed editing** with the
   live-edit-then-Apply lifecycle (Entscheidung 21).
5. **The "no chrome until needed" pattern** — sidebar unmounts when empty,
   image-node affordances appear on selection, panel rows expand inline
   (Entscheidungen 4, 32, 36).
6. **Two views of the same edit** — Inspector accordion + canvas widget
   share canonical state, no synchronisation code (Entscheidung 15).
7. **Tethers as attribution, not DAG semantics** — preserves visual benefit
   without cognitive cost (Entscheidung 17).
8. **Zoom-aware Figma model** — widgets live in canvas space, with LOD
   collapse to MarkerDots at extreme zoom-out (Entscheidung 18).
9. **The compound dial topologies** — linear vs wheel as a per-op JSON flag
   (Entscheidung 24).
10. **The drafting style as a token-system proof** — a totally different
    aesthetic without any component change (Entscheidung 34).

Each Entscheidung above has the argument that produced it; the body of this
brief has the supporting evidence (specs, files, primitives). Lift the
arguments directly into the narrative.
