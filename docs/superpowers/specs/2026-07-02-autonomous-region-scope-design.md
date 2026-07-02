# Autonomous Suggestions — Region Scope (Step 1)

**Date:** 2026-07-02
**Status:** Approved
**Scope:** Backend only — `autonomous_suggestions.py` `_scope_for`, tests.
**Companion to:** `2026-07-02-problem-vocabulary-hybrid-design.md`.

## Problem

`_scope_for` hardcodes every autonomous widget to global scope, citing "SAM
is gated off, masks are not precomputed" — a stale claim: `precompute_regions`
now runs in every analyze flow and registers one labelled `MaskRecord` per
candidate region *before* the suggestion phase. Meanwhile the new
element-local problem kinds (local_underexposure on "face", …) minted at
global scope are actively wrong edits, not just imprecise ones.

## Design

`_scope_for(problem)` resolves the problem's `region_label` against
`doc.masks`:

- `region_label` set **and** a precomputed mask carries that label →
  `{kind: "named_region", label}` — same scope shape the user-prompt path
  ships, so anchor chips, per-region dismissal signatures
  (`named_region:<label>`), and the fused framework's skin-safety check all
  engage unchanged.
- `region_label` set but **no** matching mask → global, plus a journaled
  `proposal.health {stage: autonomous, event: scope_fallback}` so the
  degradation is measurable instead of silent.
- `region_label` None (whole-image problems) → global, no event.

Top-up widgets stay global (there is no problem region to scope to).

## Explicitly deferred (Step 2, separate spec)

Region-limited *pixels*. The canonical projection (`operations.py`
`project_to_graph`) flattens node scope to global for every path because
canonical state is keyed (layer, op) with no scope dimension. Until that is
extended, `named_region` scope on autonomous widgets does what it does on
user-prompt widgets: correct chips, dismissals, skin-safety, honest study
data — rendering applies the adjustment globally. Fixing the projection is
the scope-aware-canonical project.

## Testing

- Problem with `region_label` matching a registered mask → minted widget
  (and its nodes) carry `named_region` scope with that label.
- Problem with `region_label` but no mask → global scope + `scope_fallback`
  journaled.
- Whole-image problem (`region_label` None) → global, no fallback event.
