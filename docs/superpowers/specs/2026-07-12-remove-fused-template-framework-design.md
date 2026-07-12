# Remove the Fused-Template Framework — Design (System 2 of 2)

**Status:** Approved
**Date:** 2026-07-12
**Author:** Anton (with Claude)
**Branch:** `feat/remove-fused-templates` (off `main`)

---

## 1. Problem

The legacy fused-template framework (`backend/app/tools/fused_framework.py` + ~20
template files in `backend/app/tools/fused/`, ~35 curated templates) is the last
"special fused widget" system. Templates can no longer be spawned directly; they are
reached only through four call sites: `autonomous_suggestions` and `correct_problem`
*mint* template widgets, `refine_widget` and `repeat_widget` *re-resolve* them.

Because this path bypasses `propose_stack`, template-minted widgets never get the new
synthesized driver — autonomous suggestion widgets render as flat slider lists. Removing
the framework and rewiring its producers onto the registry-op path fixes that and leaves
exactly one widget-production system.

Companion spec: `2026-07-11-remove-compound-dial-system-design.md` (System 1, landed).

## 2. Goals

1. Delete `fused_framework.py`, `app/tools/fused/`, and the `list_fused_tools` atomic
   tool; zero template references remain.
2. Problems carry **registry op ids** (`suggested_ops`), emitted by the analysis LLM.
3. One shared template-free minting helper used by both autonomous suggestions and
   correct-problem; minted widgets get the synthesized driver (`_attach_fused_compound`).
4. The autonomous **verification loop survives unchanged** (it measures widgets, not
   templates) — required by the study instrumentation.
5. `refine_widget` / `repeat_widget` work without templates.
6. Study logging keeps working: `param_source` stamping and journal event *key names*
   stay stable.

## 3. Non-goals

- Reproducing per-template curated envelopes, incl. `skin_safe_max` face clamps —
  accepted loss; registry param ranges still clamp globally.
- Template preview/typical-use metadata.
- Migrating persisted sessions whose widgets carry template `op_id`s (e.g.
  `golden_hour`). Old widgets keep rendering via their nodes/bindings; refine/repeat on
  them route through the registry-op path keyed by `nodes[0]` (see §6.5).
- Phase C of the fused-intent spec (break-out) — queued separately after this.

## 4. Architecture after removal

```
analysis LLM  → Problem{kind, severity, suggested_ops: ["light","color"], …}
                          │
     ┌────────────────────┴─────────────────────┐
autonomous_suggestions                    correct_problem
     │  (selection, dedup, knob-collision,      │  (single problem)
     │   dismissals, verification loop)         │
     └────────────► resolve_problem_widgets ◄───┘        NEW shared helper
                    │  mechanical plan (1 entry/problem,
                    │  ops = suggested_ops, driver_label from kind)
                    │  → anthropic.resolve_stack_params   (ONE call, whole batch)
                    │  → _build_widget_multi → _attach_fused_compound
                    ▼
              widgets WITH synthesized driver
```

`refine_widget`/`repeat_widget` keep operating on existing widgets via the registry-op
resolver (`resolve_widget_params`), never via templates.

## 5. Component changes

### 5.1 Problem vocabulary — analyzer emits ops

- `backend/app/schemas/enriched_context.py` `Problem`: add
  `suggested_ops: list[str] = Field(default_factory=list)`; keep
  `suggested_fused_tools` as a deprecated field (default `[]`) so persisted sessions
  validate. Nothing writes it anymore.
- `backend/app/services/anthropic_client.py` analyze tool schema (~lines 269, 314):
  replace `suggested_fused_tools` with `suggested_ops`; `required` updated. The analysis
  prompt's tool vocabulary section now lists **registry op ids** (from `get_registry()`)
  with their one-line LLM descriptions instead of template ids.
- `backend/app/services/analysis_eval.py`: construct Problems with `suggested_ops=[]`.
- Regenerate shared types. Frontend `src/types/image-context.ts` mirrors the new field;
  `ProblemsSection.tsx` reads `suggestedOps ?? suggestedFusedTools` (old sessions) and
  renders op display names.

### 5.2 Shared minting helper (new)

`backend/app/services/problem_widgets.py`:

```python
async def resolve_problem_widgets(
    doc, problems: list[Problem], *, scope_for, origin_kind: str,
    anthropic, session_id: str,
) -> list[Widget]
```

- Builds plan entries mechanically: one per problem —
  `{widget_name: <humanized kind>, driver_label: <humanized kind>, category: None,
  ops: [{op_id, rationale: problem.summary} for op_id in problem.suggested_ops
  if op_id in registry]}`. Problems with no valid ops are skipped (journaled).
- One `anthropic.resolve_stack_params(plan_entries, …)` call for the whole batch
  (replaces N parallel `run_fused_tool` calls — cheaper and budget-aware across
  overlapping ops).
- Builds widgets via `propose_stack._build_widget_multi` + `_attach_fused_compound`
  (origin `mcp_autonomous` / `tool_invoked` per caller) — **widgets get the driver**.
- Stamps `param_source` exactly like the old framework: `"llm"` normally,
  `"llm_clamped"` when `clamp_op_params` had to clamp, `"midpoint"` fallback is retired
  (resolver failure → problem skipped + journaled, mirroring `_ProposalFailed`).
- `_build_widget_multi`/`_attach_fused_compound` are imported from
  `app.tools.widgets.propose_stack` (extract to a shared module only if a circular
  import forces it).

### 5.3 `autonomous_suggestions.py`

- Template registry/lookup gone; selection iterates `problem.suggested_ops`.
- Dedup/dismissal keys change from `fused_id` to the **op signature**
  (`"+".join(sorted(ops))`) + scope — same semantics, new key. `DismissalRule` matching
  updated accordingly; existing persisted dismissal rules that name template ids simply
  never match again (acceptable: dismissals are session-scoped hygiene, not user data).
- Knob-collision detection (`_canonical_targets`) computes `(node_type, param_key)`
  pairs from registry ops instead of template skeletons.
- Batch resolve goes through `resolve_problem_widgets`.
- **Verification loop unchanged**: `measure_and_verify(problem, image_bytes, mime,
  widget, …)` already takes the widget. Retry-with-feedback re-resolves through the
  helper with the feedback instruction appended to the entry rationale.
- Journal events keep their `event` names and the `"tool"` key; its value becomes the
  op signature string (scripts keyed on event names keep working; flagged to Anton).

### 5.4 `correct_problem.py`

Routes through `resolve_problem_widgets` with a single problem, origin `tool_invoked`
(same as today — immediate tether, no pending chip). Error when `suggested_ops` is
empty/unknown mirrors the current "no template" error.

### 5.5 `refine_widget.py` / `repeat_widget.py`

- `refine_widget`: delete the template lookup + `run_fused_tool` branch. The existing
  single-registry-op branch (resolve → write-back → `update_target_anchor`) handles all
  widgets. Widgets whose `op_id` isn't a registry op (persisted template widgets, or
  multi-op planner widgets whose `op_id` is the first op) resolve via
  `reg.ops.get(w.nodes[0].op_id)` fallback when `reg.ops.get(w.op_id)` misses.
- `repeat_widget`: replace `run_fused_tool` with `resolve_widget_params`, extended with
  a new optional `rejected_attempts: list[dict] | None` parameter — prior attempts'
  values are injected into the prompt with an explicit "produce a meaningfully different
  result; do not repeat these values" instruction. `w.rejected_attempts` bookkeeping
  (`ResolvedNumbers`) is unchanged.

### 5.6 Deletions

- `backend/app/tools/fused_framework.py`
- `backend/app/tools/fused/` (entire package, ~20 files)
- `backend/app/tools/atomic/list_fused_tools.py` + its registration in
  `atomic/__init__.py`
- Every remaining import/reference (`run_fused_tool`, `all_fused_templates`,
  `FusedToolTemplate`, `NodeSkeleton`, `BindingSkeleton`, `envelope(`, `slider(` from
  the framework helpers) — verified by grep sweep.
- Tests bound to templates (framework tests, template loader tests, per-template
  resolve tests). Call-site tests are rewritten against the new helper, not deleted.

**Kept:** `ResolvedNumbers` (rejected_attempts), `param_source` field + stamping,
`suggestion_verification.py`, all journaling event names.

## 6. Edge cases

- **Problem with unknown/empty `suggested_ops`** → skipped + journaled
  (`resolve_failed`, reason `no_valid_ops`); correct_problem surfaces a tool error.
- **Old persisted widgets with template op_ids** → render fine (nodes/bindings are
  self-contained); refine/repeat fall back to `nodes[0].op_id` (§5.5); accept/dismiss/
  undo unaffected.
- **Analysis LLM emits a template id anyway** (stale model behavior): unknown op ids are
  filtered against the registry; if all filtered out → skip path above.
- **Resolver failure for the whole batch** → autonomous run mints nothing this pass
  (journaled), no midpoint fallback — consistent with propose_stack's trust posture.

## 7. Testing

- Unit: plan-entry construction from problems (valid/unknown/empty ops), param_source
  stamping, dedup/knob-collision on op signatures, repeat's rejected-attempts prompt
  injection, refine fallback to `nodes[0].op_id`.
- Integration (mocked Anthropic, existing patterns): autonomous pass mints widgets WITH
  `compound` + `driver_value`; correct_problem mints a driver widget; verification loop
  still invoked with the widget.
- Frontend: ProblemsSection renders `suggestedOps` (+ fallback) — component test.
- Grep sweeps: zero references to the deleted symbols.
- Full suites green: `npm run check` + backend `pytest tests/ -q`.
- Manual: open image → auto-analyze → suggestion widgets now carry the driver slider;
  correct-a-problem chip → driver widget; repeat + refine on one.

## 8. Phasing (ordered so the tree stays green)

1. **T1** Problem vocabulary (schema + analyzer prompt/tool + eval + regen + frontend).
2. **T2** `resolve_problem_widgets` helper + tests (framework still present, unused).
3. **T3** Rewire `autonomous_suggestions` (biggest; verification kept).
4. **T4** Rewire `correct_problem`.
5. **T5** `refine_widget` template-branch deletion + `repeat_widget` re-roll via
   extended `resolve_widget_params`.
6. **T6** Delete framework + templates + `list_fused_tools`; grep sweep; full suites.
