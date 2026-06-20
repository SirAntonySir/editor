# Figure 6.6 — Widget Code Structure (Gemini Spec)

A single architecture-reflects-code figure in the spirit of Herberto
Graca's *"Reflecting Architecture and Domain in Code"*. The figure
shows that the widget's source layout already *is* the architecture
diagram: each folder is a layer, each file is a unit, and you can
read the design directly off the filesystem.

Goal: defend the §6.6 claim that the widget is cleanly organised —
one shell, N variants behind one prop contract, shared types and
constants in one place — by **showing the folders**, not by drawing
data-flow arrows.

---

## 1 · Scene framing

**Composition.** Nested boxes, like a folder tree drawn as
concentric rectangles. Outer boxes are folders; inner boxes are
files. No arrows between siblings. Reading top-to-bottom mirrors
the order a developer would explore the code: from React Flow
integration → shell → variants → primitives → shared types.

**Style.** Academic, monochrome. White background. One mild
accent (violet `#7C3AED`) for the **shell + variants** group —
the OOP claim of the chapter. Everything else in neutral gray
(`#374151` borders, `#6B7280` text, `#F3F4F6` subtle fills). No
shadows, no 3D, no gradients.

**Typography.** Monospace (Geist Mono / JetBrains Mono) for every
folder and file name. Sans-serif (Geist / Inter) only for the four
short layer labels on the right margin.

**Grid.** Boxes left-aligned, indented one step per nesting level
(8 px), like a `tree` command's output drawn as rectangles.

---

## 2 · Element list

Five nested groups, top to bottom. Every name is a verbatim path
in the repo.

### 2.1 React Flow integration

Outer box label (monospace): **`src/components/workspace/`**
Right-margin layer label (sans-serif): *"React Flow integration"*

Inner files (each a small outlined rectangle, monospace label):
- `WidgetNode.tsx` — the React Flow node body
- `TetherEdge.tsx` — the attribution-only edge
- `CanvasWorkspace.tsx` — registers `nodeTypes = { image, widget, info }`

### 2.2 Widget shell (violet group)

Outer box label (monospace): **`src/components/widget/`**
Right-margin layer label (sans-serif): *"Widget shell"*
Outer box border: violet `#7C3AED`, 1.5 px.

Inner files:
- `WidgetShell.tsx` — the shell; owns header, decision pair, expansion state, write-back path
- `WidgetShellHeader.tsx` — header band
- `RefineInput.tsx` — refine-prompt input
- `WhyPopover.tsx` — provenance popover
- `WidgetAutoButton.tsx` — auto-tune pill
- `BindingRow.tsx` — the per-binding control row used by all variants

### 2.3 Widget variants (violet group, indented inside 2.2's column)

Same parent folder as the shell, drawn as a sibling sub-cluster
below the shell files. Right-margin layer label (sans-serif):
*"Variants — one prop contract"*. Outer border: violet, dashed
1.5 px (to signal "same folder, conceptual subgroup").

Inner files (stacked, monospace):
- `HslWidgetBody.tsx`
- `LevelsWidgetBody.tsx`
- `CurvesWidgetBody.tsx`
- `CompoundWidgetBody.tsx`

Small italic caption under the group (sans-serif):
*"Plain function components sharing one prop contract
`{ widget, effectiveValue, setParam }`. WidgetShell picks one by
predicate (`isHslWidget`, `isFullLevelsWidget`, `isCurvesWidget`,
`compound`)."*

### 2.4 Control primitives

Outer box label (monospace): **`src/components/widget/primitives/`**
Right-margin layer label (sans-serif): *"Reusable controls"*
Outer border: gray.

Inner files:
- `SliderControl.tsx`
- `CurveControl.tsx`
- `ChoiceControl.tsx`
- `ColorControl.tsx`
- `ToggleControl.tsx`
- `RegionPickerControl.tsx`
- `MaskThumbnailControl.tsx`

### 2.5 Shared types

Outer box label (monospace): **`src/types/`**
Right-margin layer label (sans-serif): *"Shared types"*
Outer border: gray.

Inner files:
- `widget.ts` — `Widget`, `WidgetBinding`, `Scope`, `Origin`,
  `MaskSummary`, `SessionStateSnapshot`, `OptimisticPatch`,
  `StateEvent`
- `workspace.ts` — `ImageNodeState`, `WidgetNodeState`,
  `TetherEdgeState`

---

## 3 · One reading order

A faint vertical bracket on the left edge spans all five groups,
top to bottom, with the single sans-serif italic caption:

*"The folder tree is the diagram. Top: how the widget plugs into
the canvas. Middle: shell and variants — one shell, N variants,
one prop contract. Bottom: shared controls and types reused by all
of the above."*

That's the whole claim. No other arrows, no other callouts.

---

## 4 · Style notes

- **Monospace** for every folder and file name; sans-serif only
  for the four right-margin layer labels and the two italic
  captions.
- **One accent.** Violet `#7C3AED` borders on the shell group
  (2.2) and the variants sub-group (2.3, dashed). Everything else
  in gray. Never use violet for anything else in the figure.
- **No arrows.** This figure is structural, not behavioural — the
  data-flow diagram is a separate figure if the chapter needs one.
- **No shadows, no gradients, no glassmorphism, no marketing
  aesthetic.** The reference visual is the output of `tree` or a
  layered-architecture diagram (Graca), not a product screenshot.
- **Indentation matches the filesystem** — children indent one
  step (8 px) inside their parent box's left edge.
