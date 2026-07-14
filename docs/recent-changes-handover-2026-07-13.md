# Recent Changes — Handover (2026-07-13)

> **Purpose.** Delta handover for everything that landed *after* the
> 2026-07-10 handover (`docs/recent-changes-handover-2026-07-10.md`, commit
> `965d55b`). Covers the range `965d55b..544cafe` — **56 commits**, all on
> `main`.
>
> Same convention as the other dated handovers: this is the **delta** — what
> changed, why, and where to look. Ordered by importance; a chronological
> commit index closes the document.
>
> **Repository state (important, read first).**
> - `main` tip is `544cafe`. History is **linear** — the
>   `feat/grounded-verified-suggestions` branch from the 07-10 handover was
>   merged into `main` **as-is** (same hashes, no rebase), so the
>   commit-hygiene split suggested there never happened. The bundled-WIP
>   caveat in that document still describes `4823097`'s diff accurately.
> - **The working tree is NOT clean.** `backend/app/tools/widgets/detach_widget_op.py`
>   carries an uncommitted change (single-node detach degrades to un-fuse in
>   place — see §8), and `544cafe` was committed by a parallel session *while
>   this handover was being written*. Detach polish is actively in flight.
> - Frontend `npm run check`: **green** (tsc + eslint + 1384 passed / 1
>   skipped vitest).
> - Backend: **803 passed, 1 failed** — the failure
>   (`test_detach_widget_op.py::test_single_node_widget_raises_error`) is
>   caused by the uncommitted WIP above, not by anything committed. The drop
>   from 907 (07-10) to ~804 is expected: System 2 deleted ~3.7k LOC of
>   fused-template tests (§3).
>
> Big picture: this batch is one story told in three movements. **Fused
> intent widgets** (§1) introduce a single synthesized "driver" slider over
> multi-op AI widgets, with a braided tether and break-out projections. Then
> two legacy widget systems were deleted so the fused driver is the *only*
> special widget system left: the **compound-dial system** (§2) and the
> **fused-template framework** (§3). Around that core: reference-vs-target
> images (§4), show-in-sidebar + single-band HSL (§5), and open/replace-image
> correctness (§6).

---

## 1 · Fused intent widgets (spec `01387ed`, phases A → C → B + follow-ups)

Spec: `docs/superpowers/specs/2026-07-11-fused-intent-widgets-design.md`.
Plan: `92dbaed` (Phase A implementation plan). This is the flagship of the
batch and the thesis USP surface — every LLM-proposed multi-op widget now
fuses behind one semantic slider.

**The concept.** A fused intent widget is an LLM-proposed widget
(`mcp_user_prompt` / `mcp_autonomous`) whose ops are unified behind a single
driver slider named after the intent (planner emits a 1–2-word
`driver_label`, e.g. "Warmth", "Blackness"). The driver runs 0–150 with the
AI proposal at 100. Anchor 0 = pre-widget baseline, anchor 1 = the resolved
target values; dragging interpolates every *unlocked* bound param between
them (`interpolate_extended` extrapolates linearly past 100, clamped to
registry ranges). Hand-editing a derived param **implicit-locks** it so the
driver stops overwriting it. The compound block reuses the registry compound
shape, so frontend interpolation code is shared. SSoT holds: the snapshot
owns all values; the frontend interpolates optimistically only for preview.

**Phase A — backend driver + FusedWidgetBody** (`57569e2`…`edb3217`, 07-11):
- `interpolate_extended` (backend `registry/interpolate.py`) + exact frontend
  mirror `interpolateExtended` (`src/lib/perceptual-dial/interpolate.ts`).
- `synthesize_compound` (`backend/app/tools/widgets/fused_compound.py`):
  builds node-qualified (`{node_id}:{param_key}`) anchors, epsilon-filters
  no-op params; attached to LLM-proposed widgets in `propose_stack`
  (`d8082f2`). Schema: `Widget.compound`, `Widget.driver_value` (`0a4878d`).
- `set_widget_param('__driver')` branch (`9dec137`): interpolates, clamps,
  writes only unlocked params, stores `driver_value`; derived-key edits
  implicit-lock.
- Refine re-runs the resolver for unlocked params and **rewrites anchor 1**
  (`update_target_anchor`, `2bf5167`/`620c302`); pins and driver position
  survive. Known limitation: single-registry-op refine only.
- UI: `FusedWidgetBody.tsx` — driver slider (`AdjustmentSlider` gained
  `overshootFrom` amber fill + `snapTo` magnet, `395c94d`) over collapsible
  per-op sections sliced via `sliceWidgetByOp` (extracted to
  `src/lib/widget-slices.ts`). Unlocked params show a "following" ghost in
  ai-violet; touched ones flip to hand-blue with a pin.

**Phase C — break-out projections + detach** (`9670bcd`…`41834b0`, 07-12;
done *before* Phase B):
- **Backend `detach_widget_op`** (C1): splits one node out of a fused widget
  into a standalone widget with `origin.kind='fused_expansion'`; canonical
  params untouched so pixels don't move; lock cleanup is collision-safe for
  shared bare `param_key`s; `widget.op_id` re-points if the detached node
  owned it (`bc6927a`).
- **Unpin affordances** in fused sections (C2): per-param pins + a
  release-all button calling `unlock_widget_param`.
- **Projection satellites + hub tethers** (C3): new workspace node kind
  `fused_slice` (`{ parentWidgetId, opId }`) renders a sliced WidgetShell
  view of one op; edits route to the parent's `set_widget_param`. Spawned by
  a ⤢ affordance in section headers; tethered to the **parent widget node**
  (hub), not the image. Orphan sweep in `syncWidgetTethers` prunes slices
  whose node was detached (`8f84a9f`).
- **Detach-from-intent** (C4): two-click confirm button on satellites →
  `detach_widget_op` → satellite removed; `workspace-tether.ts` auto-tethers
  `fused_expansion` widgets on SSE `widget.created`. In-flight guard on the
  confirm (`a4f62a3`).
- Key files: `src/components/workspace/FusedSliceNode.tsx`,
  `src/lib/fused-breakout.ts`, `src/store/workspace-slice.ts`,
  `backend/app/tools/widgets/detach_widget_op.py`.

**Phase B — braided fused tether** (`3eedd18`, `bd636d6`, 07-12 evening):
- `src/lib/tether-strands.ts` (pure, 12 tests): one strand per op node,
  category-tinted (`--strand-tone/color/detail/texture/effect` tokens, chosen
  to avoid the ai-violet/accent-blue namespace), woven along the Bézier with
  an amplitude envelope that merges strands at both endpoints. A strand whose
  params are pinned **separates** — lifted on its own envelope, accent blue,
  dot at the apex. `sampleBezier` mirrors React Flow's control-point math and
  is pinned against `getBezierPath` output by a snapshot test (`bd636d6`).
- `TetherEdge` gains the `fused` variant; `CanvasWorkspace.derivedEdges`
  derives strands per render from snapshot widgets.

**07-13 follow-ups:**
- **Rich op bodies in fused sections + satellites** (`d4cef76`): new
  `FusedOpBody` dispatcher gives hsl/levels/curves ops their real bodies
  (band rail, histogram, curve editor) instead of flat sliders — inside
  fused sections *and* on satellites (satellite min-width 226→320). The
  sliced-view HSL reveal-key assumption is documented in-code (`3b8e582`).
- **Hub tether target handles** (`e3ed26d`): React Flow strict mode silently
  dropped hub edges targeting source-type handles; WidgetNode now exposes
  invisible `tether-in-*` target anchors. Break-out button uses the sidebar
  pin glyph in both states (`e3ed26d`, `a2d5412`); detach confirm's armed
  state made visible — a broken accent utility class (`544cafe`).

## 2 · System 1: compound-dial system removed (`e69fed2`…`751d7dc`, 07-11)

Spec: `docs/superpowers/specs/2026-07-11-remove-compound-dial-system-design.md`.
The circular-dial "atmosphere" system (five hard-coded compound ops —
`time-of-day`, `weather`, `mood`, `season`, `age` — with bespoke dial UI,
render-time node expansion, and a backend resolver) was fully redundant once
§1 landed: two parallel "special widget" systems, one had to go.
**Net ≈ −1.9k LOC over five commits:**
- T1 (`390118e`): the five op JSONs, `compound_resolver.py`, planner-prompt
  section, `set_widget_param` registry-compound branch + tests.
- T2 (`a646792`): render-time expansion (`perceptual-dial/expand-compound.ts`,
  `compile.ts`) out of select-pipeline-nodes / image-node-renderer.
- T3 (`8348f3f`): dial UI — `CompoundWidgetBody`, `CircularDial`,
  `PerceptualDialBody`, `wheel-math` — and the WidgetShell/ToolSection
  dispatch branches.
- T4 (`0b45ca3`): `RegistryOp.compound` field (Pydantic + Zod) and dead
  callers (compound-restore path in `unlock_widget_param`, etc.).
  `OpCompoundConfig` survives — it's the shape `Widget.compound` reuses.
- Sweep (`751d7dc`): `compoundOrder`, fixtures re-targeted off compound ops.

Former dial intents ("make it night") now compose primitive ops via the
normal planner and get the §1 driver.

## 3 · System 2: fused-template framework removed (`d3c7f05`…`439e876`, 07-12)

Spec: `docs/superpowers/specs/2026-07-12-remove-fused-template-framework-design.md`.
The last legacy widget producer: `fused_framework.py` + `app/tools/fused/`
(~20 template modules, ~35 curated templates) minted flat template widgets
from four call sites, bypassing `propose_stack` — so suggestion widgets never
got the driver. All four call sites now go through registry ops and mint
driver widgets. **Net ≈ −3.3k LOC; 48 files deleted in T6 alone.**

- **T1** (`808afbc`): analysis problems now carry `suggested_ops`
  (registry op ids); `suggested_fused_tools` deprecated (frontend reads
  `suggestedOps ?? suggestedFusedTools`).
- **T2** (`2c84eb1`): shared helper
  `backend/app/services/problem_widgets.py::resolve_problem_widgets` —
  one batched `resolve_stack_params` call, widgets built via
  `_build_widget_multi` + `_attach_fused_compound`, timeout + ctx guard.
- **T3** (`8a8a740`, `64a0f6d`): autonomous suggestions rewired onto the
  helper. Dedup/dismissal keys change from template id to **op signature**
  (`"+".join(sorted(op_ids))`); top-up dedups by the same key; per-instance
  feedback accumulates for retry.
- **T4** (`4e1a931`): `correct_problem` mints driver widgets from
  `suggested_ops`; scope derivation + immediate tether preserved.
- **T5** (`63e3567`): template-free refine (persisted template widgets fall
  back to `nodes[0].op_id`) + repeat with a `rejected_attempts` "do not
  repeat these values" resolver hint (capped at 5 to protect prompt cache).
- **T6 + final** (`3454e7f`, `439e876`): framework + `app/tools/fused/` +
  `list_fused_tools` + 13 test files deleted; shared
  `widget_op_signature()` used by both the dismissal writer
  (`delete_widget`) and the dedup reader. Regression test: dismissing a
  light+color widget suppresses the pair but still allows a light-only mint.

User-visible: every suggestion / Correct-button / palette widget now carries
the driver slider; dismissals of multi-op widgets suppress the right combos.

## 4 · Reference vs target images (`cdf4530`, 07-10)

Spec: `docs/superpowers/specs/2026-07-10-reference-vs-target-images-design.md`.
"Edit image1 to look like image2" used to edit **both** (every attachment was
a forced target). Attached chips in the prompt editor now toggle
Target ↔ Reference: references are excluded from `forced_targets` /
`node_layers`, get a compact measured appearance summary (cheap-pass cast,
median luma, palette, grade character) threaded to the model instead of
being editable, and the dispatch guard rejects any reference as a proposal
target. Match-intent params derive from the reference's measurements
(cast → kelvin/tint, luma gap → exposure). Key files:
`backend/app/api/state.py` (`_build_reference_summaries`),
`backend/app/tools/agent_loop.py`, `src/lib/prompt-doc.ts`,
`src/components/ui/PromptEditor.tsx`.

## 5 · Show-in-sidebar + single-band HSL spawn (`c471282`, `647bc6b`, 07-10)

Spec: `docs/superpowers/specs/2026-07-10-show-in-sidebar-and-hsl-single-band-design.md`.
- **Show in sidebar**: widget context-menu action → opens the Adjustments
  sidebar, focuses the target layer, scrolls the op section into view
  (reuses `sectionScrollTarget`; op-backed widgets only).
- **Single-band HSL**: HSL widgets always carry all 24 bindings backend-side
  (AI/preset spawns padded in `propose_stack`), but the UI opens showing one
  band. Ephemeral `hslRevealedBands` view-state (tool-slice) tracks reveals;
  edited bands always show. Add-colour is a dashed "add swatch" at the end of
  the band rail (`HslAddBandControl`, `647bc6b`); the widget body's redundant
  Reset was dropped.

## 6 · Open/replace-image correctness + agent targeting (07-11, on main)

- **Replacing an image now works end-to-end**: `openImage` resets the
  workspace (stale image node blocked the auto-mount, `5a82d09`) *and* the
  backend session (stale `imageContext` made auto-analyze skip the new
  image, `cd7fe33`). Tests in `src/core/open-image.test.ts`.
- **`layer_ids` selector on `propose_adjustment_widgets`** (`bff3d75`):
  multi-region prompts can scope a proposal to a named layer subset instead
  of collapsing to whole-node targeting; layer labels threaded into the
  agent-loop system prompt.
- **Palette dispatch unified** (`328780e`): `dispatchOp` / `dispatchPreset`
  in `src/lib/palette-inspector-route.ts` replace ad-hoc routing in
  CommandPalette + MenuBar. No behavior change.

## 7 · Small fixes

- **Duplicate removed from the widget context menu** (`e4dfc79`): the state
  model keys widgets by (layer, op, param) — a same-layer copy collides on
  the same node; `repeat_widget` is a re-roll, not a copy.

## 8 · In-flight WIP (uncommitted, read before continuing)

The working tree at handover time carries an **uncommitted** change to
`backend/app/tools/widgets/detach_widget_op.py`: detaching the only node of
a single-node fused widget no longer raises `_SingleNodeWidget` — it
**un-fuses in place** (strips `compound` + `driver_value`, bumps revision,
returns the same widget as both `widget` and `parent`; pixels untouched).
`tests/tools/widgets/test_detach_widget_op.py::test_single_node_widget_raises_error`
still asserts the old raise and is the **single red backend test**. Whoever
picks this up: update that test to the new contract (and check whether the
frontend detach button's single-node disable in `FusedSliceNode.tsx` should
be lifted to expose un-fuse). A parallel session was committing detach
polish (`544cafe`) while this document was written.

## 9 · Known caveats carried forward

- Sliced-view HSL reveal-key assumption on fused sections/satellites is
  documented in `FusedOpBody.tsx` (`3b8e582`); full reveal-key scoping on
  slices is deferred.
- Fused refine's anchor rewrite handles single-registry-op refines only
  (`2bf5167`).
- Bare `param_key` namespace collisions across nodes are handled in detach's
  lock cleanup but remain a schema-level footnote (`6e6e790`, `bc6927a`).
- The 07-10 handover's commit-hygiene note about `4823097` still applies to
  history archaeology (the branch merged unrebased), but is moot for the
  working tree.

## Chronological commit index (`965d55b..544cafe`, oldest first)

```
e4dfc79 fix(widget): drop Duplicate from widget context menu
cdf4530 feat(ai): reference vs target images — 'look like X' no longer edits X
df41850 docs(spec): show-in-sidebar widget action + single-band HSL spawn
c471282 feat(widget): show-in-sidebar action + single-band HSL spawn with add-colour
647bc6b refactor(widget): swatch add-colour in the band rail + drop redundant HSL reset
5a82d09 fix(document): reset workspace on openImage so replacing an image works
cd7fe33 fix(document): reset backend session on openImage so replaced images auto-analyze
bff3d75 feat(ai): layer_ids selector for propose_adjustment_widgets
328780e refactor(palette): unify op/preset dispatch via dispatchOp/dispatchPreset
01387ed docs(spec): fused intent widgets — synthesized driver, braided tether, break-out projections
92dbaed docs(plan): fused intent widgets phase A implementation plan
57569e2 feat(backend): interpolate_extended — linear extrapolation past last anchor
b0dbd55 refactor(backend): hoist interpolate helpers + harden delegation test
d92d4a7 feat(lib): interpolateExtended — frontend mirror of backend extrapolation
0a4878d feat(schema): widget-local compound block + driver_value on Widget
620c302 feat(backend): fused compound synthesis + refine target-anchor update
056f1e8 feat(planner): driver_label per plan entry for fused intent widgets
d8082f2 feat(backend): attach synthesized compound to LLM-proposed widgets
9dec137 feat(backend): __driver interpolation + implicit lock on fused widgets
2bf5167 feat(backend): refine rewrites fused target anchor for unlocked params
395c94d feat(ui): AdjustmentSlider overshootFrom + snapTo props, --color-overshoot token
64b7d63 refactor(lib): extract sliceWidgetByOp to src/lib/widget-slices
9bec7f2 feat(widget): FusedWidgetBody — driver slider + collapsible op sections
7278f6a fix(widget): FusedWidgetBody — locked-skip, multi-layer, pinned count, driver sync, debounce cleanup, Intensity label
edb3217 fix(fused): clamp overshoot preview to registry range + review cleanups
e69fed2 docs(spec): remove compound-dial system (System 1 of 2)
390118e refactor(backend): remove compound-dial ops, planner routing, resolver (System 1 T1)
a646792 refactor(render): remove compound-node expansion path (System 1 T2)
8348f3f refactor(widget): remove compound-dial UI + dispatch (System 1 T3)
0b45ca3 refactor(schema): drop RegistryOp.compound field, finish compound-dial removal (System 1 T4)
751d7dc chore: sweep residual compound-dial artifacts (System 1)
d3c7f05 docs(spec): remove fused-template framework (System 2 of 2)
808afbc feat(analysis): problems suggest registry ops, deprecate template ids (System 2 T1)
2c84eb1 fix(backend): timeout + ctx guard + test hardening on problem_widgets (T2 review)
8a8a740 feat(backend): autonomous suggestions mint driver widgets via registry ops (System 2 T3)
64a0f6d fix(backend): top-up dedup by op signature + problem-widget pairing + per-instance feedback (T3 review)
4e1a931 feat(backend): correct_problem mints driver widgets via registry ops (System 2 T4)
63e3567 feat(backend): template-free refine + repeat with rejected-attempts resolver (System 2 T5)
3454e7f refactor(backend): delete fused-template framework + review cleanups (System 2 T6)
439e876 fix(backend): shared op-signature for dismissals + final review polish (System 2 final)
9670bcd feat(backend): detach_widget_op — split an op out of a fused widget (Phase C1)
bc6927a fix(backend): collision-safe lock cleanup + op_id repoint test on detach (C1 review)
6c5c8e4 feat(widget): unpin affordances in fused sections (Phase C2)
6e6e790 chore(widget): token radius + bare-key namespace comment (C2 notes)
cd33250 feat(workspace): fused-slice projection satellites + hub tethers + break-out affordance (Phase C3)
8f84a9f fix(workspace): sweep orphaned fused-slice nodes + spawn collision polish (C3 review)
a58c765 feat(workspace): detach-from-intent on projection satellites (Phase C4)
a4f62a3 fix(workspace): in-flight guard on detach confirm + hook hygiene (C4 review)
41834b0 chore(workspace): drop dead FusedSliceBinding export (final review M1)
3eedd18 feat(workspace): braided fused tether — category strands + pin separation (Phase B)
bd636d6 test(workspace): pin sampleBezier against getBezierPath output (Phase B review)
d4cef76 feat(widget): rich op bodies (hsl/levels/curves) in fused sections + satellites
3b8e582 docs(widget): note sliced-view hsl reveal-key assumption (review)
e3ed26d fix(workspace): hub tether target handles on WidgetNode + pin glyph for broken-out sections
a2d5412 fix(widget): break-out button uses the sidebar pin glyph in both states
544cafe fix(workspace): visible armed state on detach confirm (broken accent utility)
```
