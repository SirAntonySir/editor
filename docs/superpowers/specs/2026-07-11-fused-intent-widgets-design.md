# Fused Intent Widgets — Design

**Status:** Approved
**Date:** 2026-07-11
**Author:** Anton (with Claude)
**Branch:** to be created off `dev`

---

## 1. Problem

Fused/compound widgets exist today only for predefined scenarios: registry ops with a
`compound` block (`time-of-day`, `weather`, `mood`, `season`, `age`), each a hand-authored
JSON anchor table. An intent like *"make this element black"* instead produces a multi-op
widget with grouped param sliders — correct, but the user asked for an outcome and gets a
panel of mechanics.

We want the assistant layer to be generated **on user intent**: one semantic slider
("Blackness") synthesized per proposal, connected to the image, with progressive
disclosure into the original op controls — a fused control layer *in between* assistant
simplicity and full grain control.

## 2. Goals

1. Every intent-spawned widget ships a synthesized driver slider named after the intent.
2. The driver's scale is percent-of-proposal: 0 = as shot, 100 = the AI's resolved target,
   up to 150 = overshoot past the AI's taste.
3. The original op controls remain reachable: inline (accordion sections in the card) and
   on the canvas (break-out satellites), without leaving the fused widget's ownership.
4. The tether visualizes the fusion: one strand per op, braided into one cable; a strand
   separates when its op is hand-pinned.
5. **Reuse before invent.** Every UI element maps onto an existing component, extended
   with additive, non-breaking props. Existing paths (registry compound ops, toolrail
   widgets, flat BindingRow fallback) keep their current dispatch branches.

## 3. Non-goals

- A second semantic driver per widget ("darker **and** warmer" → two drivers). Deferred
  until the single-driver model proves itself; requires param-blending rules.
- Bypass topology as the default break-out (satellite tethered straight to the image).
  Detach exists only as an explicit menu action.
- Anchor-editing UI (dragging anchor positions).
- Mask-thumbnail in the scope chip (nicety; existing dot+label chip ships first).
- Migrating registry compound ops (`time-of-day` etc.) onto the new body — they keep
  `CompoundWidgetBody` unchanged.

## 4. Decisions (settled during brainstorm)

| Question | Decision |
|---|---|
| Advanced options placement | **Hybrid**: accordion sections in-card + ⤢ break-out to canvas satellites |
| Tether visual | **Braided**, category-tinted strands (one per op) |
| Break-out topology | **Hub**: satellite tethers into the fused widget; braid to image stays whole. "Detach from intent" in ⋯ menu as escape hatch |
| Which proposals get fused | **Always** for `mcp_user_prompt` / `mcp_autonomous`; never for `tool_invoked` |
| Driver range | 0–150, hairline tick at 100 ("proposed"), magnet snap at 100, double-click reset to 100 |
| Overshoot treatment | **Amber overfill**: fill and thumb ring past 100 turn amber; value reads "100 +12" |
| Driver component | **Extend `AdjustmentSlider`** (not `PerceptualDialBody`) |
| Pin color | Existing provenance system: following = ai-violet, pinned/hand = accent-blue. No new color |
| Satellite identity | **Projection** — frontend-only view of the parent widget, not a backend Widget |

## 5. Architecture overview

```
Planner (Anthropic call)          +driver_label per widget (1–2 words from intent)
  ↓
Resolver (phase 2, unchanged)     computes target params per op
  ↓
propose_stack                     mechanically builds widget-local compound block:
                                    anchors: [{position: 0, values: neutral},
                                              {position: 1, values: resolved targets}]
  ↓
backend Widget schema             +compound?: same shape as registry compound block
  ↓
set_widget_param '__driver'       backend interpolates/extrapolates anchors → writes
                                  unlocked params into nodes; stores driver value
  ↓
frontend WidgetShell dispatch     widget-local compound → FusedWidgetBody
frontend TetherEdge               variant 'fused' → braided strands
frontend workspace-slice          WidgetNodeState variant 'fused_slice' (break-out)
```

SSoT doctrine holds: the snapshot owns all adjustment data; the frontend interpolates the
same anchors optimistically for live preview (the existing `CompoundWidgetBody` /
`applyOptimistic` pattern) and reconciles on the next snapshot.

## 6. Backend

### 6.1 Planner

`_PLANNER_SYSTEM_PROMPT` response shape gains one field per plan entry:

```json
{ "widget_name": "Make it black", "driver_label": "Blackness", "category": "tone", "ops": [...] }
```

`driver_label` is a 1–2 word noun derived from the intent. No other planner judgment is
added — anchor construction is mechanical, downstream of the resolver.

### 6.2 Compound block synthesis

After phase-2 resolution, `propose_stack` builds:

```python
compound = CompoundBlock(
    driver="__driver",
    label=driver_label,          # e.g. "Blackness"
    topology="linear",
    range=(0.0, 1.5),            # UI renders ×100 → 0–150
    anchors=[
        Anchor(position=0.0, values=neutral_values),   # engine-canonical neutrals per param
        Anchor(position=1.0, values=resolved_values),  # resolver output
    ],
)
```

Stored on `Widget.compound` (new optional field on `backend/app/schemas/widget.py`),
**same shape** as the registry compound block so frontend interpolation code is shared.
The widget also stores `driver_value: float = 1.0` (spawns at the proposal).

### 6.3 Driver moves

`set_widget_param(widget_id, param_key='__driver', value=t)`:

1. Interpolate anchors at `t`. For `t > 1.0`, extrapolate linearly from the last segment.
2. Clamp each param to its registry min/max (driver position is preserved so easing back
   is symmetric).
3. Write results into the widget's nodes for **unlocked params only** (`locked_params`
   respected, mirroring the existing compound-dial behavior).
4. Store `driver_value = t`. One revision → linear undo unchanged.

`'__driver'` is exempt from the implicit-lock rule in `set_widget_param` (it is the
driver, not a derived param — same exemption registry compound drivers already have).

### 6.4 Refine

Refine re-runs the resolver for **unlocked** params only and rewrites anchor 1.0 with the
new targets. Pins survive; the driver value is preserved.

### 6.5 `detach_widget_op` (Phase C)

New MCP tool: splits one op out of a fused widget into a standalone Widget
(`origin: 'fused_expansion'`), removing the op's node(s) and bindings from the fused
widget and dropping its anchor entries. Irreversible (modulo undo). This is the **only**
path that creates a second widget.

## 7. Frontend

### 7.1 `AdjustmentSlider` — two additive props

```ts
overshootFrom?: number;  // fill past this value renders amber (--color-warning tone);
                         // thumb ring follows; value formats as "100 +12"
snapTo?: number;         // magnet snap (±2.5) with a subtle thumb pop on capture
```

Existing behavior already covers the rest: tick at `neutralValue` (=100), double-click
reset to `defaultValue` (=100), number scrub, provenance fill, `pinSlot`. Both props are
optional — no existing call site changes.

### 7.2 `FusedWidgetBody` (new, `src/components/widget/`)

New branch in the `WidgetShell` body-dispatch switch (`WidgetShell.tsx:371–403`), checked
**before** the registry-compound branch: widget-local `compound` present →
`FusedWidgetBody`. Composition:

- **Driver**: `AdjustmentSlider` `min=0 max=150 defaultValue=100 neutralValue=100
  overshootFrom=100 snapTo=100`, label = `compound.label`, endpoints "as shot" / "150".
  Drag → optimistic compiled-bindings patch (canon key) + debounced
  `set_widget_param('__driver')` — the `CompoundWidgetBody` pattern.
- **Op sections**: `sliceWidgetByOp` (existing) per op. Collapsible header row per
  section: chevron, category-tint swatch, op display name, live value summary (first two
  params, abbreviated), ⤢ on hover. Expanded body = untouched `RegistryDrivenPanel`
  via `RegistryDrivenSectionBody`. All sections spawn collapsed.
- **Provenance**: unlocked params show `provenance='ai'` with a ghost "following" label;
  touching one goes through the existing implicit-lock flow → `provenance='hand'`,
  📌 affordance (click to `unlock_widget_param`).
- **Footer**: existing `RefineInput`. **Header**: existing `WidgetShellHeader` incl.
  scope chip for non-global scopes.

### 7.3 Braided tether — `TetherEdge` `variant: 'fused'`

`TetherEdgeData` gains:

```ts
variant?: 'extracted' | 'fused';
strands?: Array<{ opId: string; color: string; separated: boolean }>;
```

Rendering: for each strand, offset the base Bézier perpendicular by
`A · sin(π·s) · sin(2πF·s + φᵢ)` (amplitude envelope → strands merge at both endpoints),
φᵢ evenly phased. A separated strand renders lifted out of the braid on its own envelope,
stroked accent-blue (hand provenance), with a small dot at apex. `separated = true` when
≥1 of that op's params is in `lockedParams`; unpinning all rejoins it. Marching-ants,
selection, and endpoint-dot behaviors inherit from the existing edge.

**Category tint tokens** (new, `src/index.css`): `--strand-tone`, `--strand-color`,
`--strand-detail`, `--strand-texture`, `--strand-effect`. Constraint: the palette must
not collide with `--color-ai` (violet) or `--color-accent` (blue) — the color category
uses a magenta hue, not violet. Section swatches and strand strokes read the same tokens.

### 7.4 Break-out projection (Phase C)

`WidgetNodeState` gains a variant `{ kind: 'fused_slice'; parentWidgetId: string;
opId: string }`. Its renderer looks up the parent widget in the snapshot, feeds
`WidgetShell` the `sliceWidgetByOp` view (satellite header shows op name + "from
'<intent>'"). All edits route to `set_widget_param(parentWidgetId, …)` — pinning falls
out for free; the backend never learns about the satellite.

- Spawn: ⤢ in a section header → `editorDocument.workspace.*` op using
  `nextSpawnPositionFor` / `pickSpawnSide`; tether targets the **fused widget node**
  (hub), stroked with the op's strand tint.
- Close: pure UI removal; state unchanged. The section row shows "broken out ⤢" while
  a satellite exists (clicking focuses it instead of spawning a duplicate).
- Dismissing the fused widget removes its satellites (they render the parent; the
  workspace slice prunes `fused_slice` nodes whose parent is gone).

### 7.5 Card ⋯ menu

Adds "Detach from intent" per expanded/broken-out op → `detach_widget_op` (Phase C),
with a confirm affordance since it is the one non-reversible-in-place action.

## 8. Edge cases

- **SSE disconnected**: existing global disable (tools, Cmd+K) covers the driver and
  sections; last-rendered canvas stays visible.
- **Overshoot clamping**: params saturate at their registry ranges while the driver keeps
  its position — dragging back down retraces the same curve.
- **All params pinned**: driver still moves (stores value) but drives nothing; every
  strand separated. Acceptable degenerate state; refine or unpin recovers.
- **Registry compound ops / old sessions**: dispatch fallback
  `widget.compound ?? loadRegistry().ops[widget.opId]?.compound`; registry ops keep
  `CompoundWidgetBody`. No migration.
- **Genfill widgets**: no op-graph nodes → never fused; dispatch order unaffected.

## 9. Phasing

| Phase | Scope | Shippable alone |
|---|---|---|
| **A — core** | Planner `driver_label`, compound synthesis, `__driver` handling, `AdjustmentSlider` props, `FusedWidgetBody` | Yes — fused widgets with plain tethers |
| **B — braid** | `TetherEdge` 'fused' variant, category tint tokens, strand separation on pin | Yes |
| **C — break-out** | `fused_slice` projection nodes, hub tethers, ⤢/close/focus flow, `detach_widget_op`, ⋯ menu entry | Yes |

## 10. Testing

- **Backend**: anchor construction from resolver output; `__driver` interpolation,
  extrapolation past 1.0, per-param clamping; locked-param skip; refine preserving pins
  and driver value; `detach_widget_op` splitting.
- **Frontend units**: extrapolation mirror of `interpolate1D` tests;
  `sliceWidgetByOp`-based projection view.
- **Component (Vitest, existing patterns)**: `AdjustmentSlider` overshoot fill/format +
  snap; `FusedWidgetBody` section collapse/expand, live summaries, pin → provenance flip,
  ⤢ spawn dispatch; `TetherEdge` fused-variant strand geometry (snapshot) + separated
  strand on `lockedParams` change; `WidgetShell` dispatch precedence (widget-local
  compound > registry compound > HSL/levels/curves > BindingRow).
- **Manual (dev server)**: "make this element black" end-to-end — spawn at 100, drag to
  overshoot, pin Shadows in the expanded Light section, watch strand separate, break out
  Color, edit in satellite, unpin, detach.

## 11. Open follow-ups (out of scope, tracked)

- Second semantic driver (multi-axis intents).
- Mask thumbnail in scope chip.
- Anchor overshoot beyond linear extrapolation (perceptual easing).
- Category-driven canvas sort/filter (pre-existing deferral).
