# Grounded, Verified AI Suggestions — Design

**Date:** 2026-07-10
**Status:** Approved

## Problem

The analyze pipeline correctly *detects* image defects, but its severities are
LLM-assigned and run conservative, while the autonomous-suggestion flow gates
corrective suggestions at `severity >= 0.5` and then tops up the card quota
with aesthetic grades matched to image character.

Observed failure (session `e4cefaa1…`, 2026-07-10): a deliberately degraded
stimulus (cast_strength 0.46, median_luma 18/255) produced problems
`strong_color_cast` 0.35, `crushed_shadows` 0.45, `local_underexposure` 0.40 —
**all** skipped by the severity gate (journal: `suggestion_skipped /
severity_gate` ×3) — after which the character top-up minted *Complementary
grade* and *Teal & orange*. The user saw: "Problems: strong color cast" in the
Info tab, and "make it more teal" from Suggest.

Root tension: the gate compares an LLM-vibes number against a fixed threshold
while ignoring the mechanical evidence sitting in the same
`EnrichedImageContext`. The soft-fields prompt already contains a 0.5-anchored
rubric and already receives the cheap-pass numbers — prompt-only calibration
is demonstrably insufficient.

## Decision summary

Four phases, each independently landable, each degrading to current behavior
on any error:

- **A. Severity grounding** — mechanical floors for measurable problem kinds,
  applied at context-build time; gate lowered 0.5 → 0.4; prompt rewritten to
  delegate measurable severity to provided anchors.
- **B. Suggestion behavior** — no aesthetic top-up while corrective problems
  remain unresolved; fused-tool param resolution receives an explicit
  measurement block.
- **C. Self-verification** — corrective suggestions are previewed via the CPU
  pipeline and re-checked against the cheap-pass metrics before surfacing;
  one feedback retry.
- **D. Eval harness** — ground-truth regression suite built on
  `scripts/degrade-dng.py` stimuli; free mechanical tier (CI) + env-gated
  LLM tier.

## Phase A — Severity grounding

### A1. Grounding module

New `backend/app/services/severity_grounding.py`:

```python
def ground_problem_severities(
    problems: list[Problem],
    cheap: CheapPassResult,
    region_stats: list[RegionStats],
) -> list[Problem]
```

Pure function; returns new Problem models with
`severity = max(llm_severity, floor(kind, evidence))`. Floors exist ONLY for
kinds with mechanical evidence:

| kind | evidence | floor shape (calibrate in impl) |
|---|---|---|
| strong_color_cast | `cast_strength` | ~`clamp(cast_strength * 1.5, 0, 0.9)`; today's 0.46 must ground to ≥ 0.6 |
| crushed_shadows | `clipped_shadows_pct`, `median_luma` | rises with clip fraction; boosted when median_luma < 50 |
| clipped_highlights | `clipped_highlights_pct` | rises with clip fraction |
| low_contrast | `contrast_p10_p90` | rises as spread falls below ~100 (boat session: 27) |
| local_underexposure / local_overexposure | matching region's `mean_luma` | region-matched via `region_label`; no region match → no floor |

Judgment-only kinds (`soft_focus`, `distracting_element`, `dull_subject`,
`skin_tone_shift`, `uneven_white_balance`, `noisy_shadows`, `other`) are
untouched — grounding never invents problems and never *lowers* a severity.

> Implementation check: confirm the units of `clipped_*_pct` (fraction vs
> percent) in `compute_cheap_pass` before writing the floor — frontend
> `auto-tune.ts` treats its copy as percent units; the backend session value
> 0.103 for a heavily crushed image suggests fraction. Do not trust the name.

Calibration fixtures: the two real session contexts from 2026-07-10
(`e4cefaa1…` boat, `61c3afe9…` Astroland) are captured as test fixtures; both
of their cast/underexposure problems must clear the 0.4 gate after grounding.

### A2. Wiring

Applied in `build_enriched` (`_analyze_phases.py`) so every consumer — InfoTab
badges, suggestion gate, journal, LLM prompts that echo context — sees the
same grounded number. No surface may see ungrounded severities.

### A3. Gate

`autonomous_suggestions.py` severity gate: `0.5` → `0.4` (named constant
`SEVERITY_GATE`, journal reason unchanged).

### A4. Prompt

`_AUGMENT_PROMPT` severity paragraph is rewritten to delegate: for the five
measurable kinds, severity anchors are stated in terms of the cheap-pass
numbers the model already receives (e.g. "cast_strength 0.45+ in a scene that
should contain neutrals → severity 0.7+"), and the model is told the system
applies mechanical floors — its judgment moves severity for *importance*
(subject vs corner), not for magnitude. Two concrete worked examples replace
the abstract 0.25/0.5/0.75 ladder.

## Phase B — Suggestion behavior

### B1. Top-up guard

In `mint_autonomous_suggestions`: after the problem-driven pass, compute
`open_corrective = any corrective problem with severity >= 0.35 that did not
mint a widget` (corrective = the five measurable kinds + their local
variants). If `open_corrective`, **skip the image-character top-up entirely**
(journal `topup_skipped / open_corrective_problems`). A damaged image gets
corrections or fewer cards — never decoration.

### B2. Measurement-aimed params

The fused-tool resolve path (`_run_fused_tool_sync` → resolve prompt) gains a
measurement block for corrective intents:

```
Measured evidence: cast_direction (Lab a*,b*) = [11.7, -25.3];
estimated_white_point = [70, 75, 90]; median_luma = 18/255;
clipped_shadows = …; contrast_p10_p90 = 27
Derive parameter values from these measurements (e.g. kelvin shift opposing
the cast direction, exposure lift sized by the median-luma gap), then adjust
for taste. Do not re-estimate the defect from the image alone.
```

Data is already in `EnrichedImageContext`; this is prompt plumbing, not new
computation.

## Phase C — Self-verification

After a corrective suggestion resolves (Phase B params), before
`doc.add_widget`:

1. Render the widget's ops on a downscaled copy (≤ 512px long edge) via the
   existing CPU preview approximation (the `preview_widget` pipeline — kelvin
   / basic / curves / levels only).
2. Recompute `compute_cheap_pass` on the result.
3. Accept if the problem's own metric improved past a threshold:
   - cast problems: `cast_strength` drops by ≥ 20% relative
   - exposure problems: `median_luma` moves toward [90, 140] by ≥ 15 points
   - clipping problems: the relevant `clipped_*_pct` shrinks by ≥ 25% relative
4. On failure: journal `verify_failed` with before/after numbers, retry the
   resolve ONCE with that feedback appended ("your params raised
   cast_strength 0.46 → 0.51"), keep the better of the two attempts. The
   suggestion is always surfaced — verification tunes, it never blocks.
5. Widgets containing ops outside the CPU-approximable subset skip
   verification (journal `verify_skipped / unsupported_ops`).

Latency: one downscaled CPU render + at most one extra LLM call per
corrective suggestion; suggestions already stream asynchronously over SSE, so
this appears as corrective cards arriving slightly later, never as UI
blocking.

## Phase D — Eval harness

`scripts/eval-analysis.py` + `backend/tests/eval/`:

- **Fixtures**: original/degraded DNG pairs generated by
  `scripts/degrade-dng.py` with the recipe recorded as ground truth (known
  cast direction + strength, known gamma). Developed PNGs are cached so the
  eval doesn't need rawpy at run time.
- **Tier 1 — mechanical (free, CI)**: `compute_cheap_pass` + grounding floors
  on each degraded image must (a) detect the planted defect direction in
  `cast_direction`, (b) produce grounded floors clearing the 0.4 gate for the
  planted kinds, (c) stay quiet (< 0.4) on the originals.
- **Tier 2 — LLM (env-gated `EDITOR_EVAL_LLM=1`, costs API calls)**: full
  analyze on degraded images must emit the planted problem kinds; the minted
  corrective suggestion, applied via the CPU pipeline, must move the image
  measurably toward the original (Lab ΔE or cast_strength/median_luma
  recovery ≥ threshold).
- Output: a small markdown/JSON report per run — the thesis's measurable
  before/after for suggestion quality.

## Error handling

Every phase is a best-effort layer: exceptions in grounding, the measurement
block, verification, or eval fixtures degrade to the exact current behavior
and journal the failure. No new hard-failure paths in analyze or suggest.

## Testing

- Unit: each grounding floor (boundary values + the two 2026-07-10 session
  fixtures), units check for `clipped_*_pct`, guard logic for B1
  (open/resolved/mixed), verification accept/reject/retry/unsupported.
- Integration: analyze pipeline end-to-end with mocked LLM emitting today's
  exact soft fields → grounded context → suggestions must mint cast/shadow
  corrections and skip top-up.
- Eval Tier 1 in CI; Tier 2 documented, run manually.

## Files touched

| Phase | Files |
|---|---|
| A | `backend/app/services/severity_grounding.py` (new), `backend/app/tools/atomic/_analyze_phases.py`, `backend/app/services/anthropic_client.py` (prompt), `backend/app/services/autonomous_suggestions.py` (gate) |
| B | `backend/app/services/autonomous_suggestions.py`, `backend/app/services/anthropic_client.py` (resolve prompt plumbing) |
| C | `backend/app/services/autonomous_suggestions.py`, CPU preview module (reuse), `backend/app/state/context_stats.py` (reuse) |
| D | `scripts/eval-analysis.py` (new), `backend/tests/eval/` (new), `scripts/degrade-dng.py` (recipe emission) |

## Out of scope

- Frontend changes (InfoTab already renders whatever severities arrive).
- New problem kinds or new fused tools.
- The as-shot WB feature (separate spec, 2026-07-10) — though once landed,
  develop metadata becomes additional grounding evidence.
