# Problem Vocabulary Hybrid — Free Labels, `other` Escape Hatch, Severity Anchors

**Date:** 2026-07-02
**Status:** Approved
**Scope:** Backend only — `schemas/enriched_context.py`, `anthropic_client.py`
(augment prompt + soft-fields tool schema), `autonomous_suggestions.py`, tests.
**Companion to:** `2026-07-02-fused-resolution-telemetry-design.md`.

## Problem

`ProblemKind` is a closed 6-entry Literal of histogram-adjacent defects. Its
machine role is small (widget naming + analytics key; gating reads severity,
action reads suggested_fused_tools, dismissals key on fused_tool_id), but it
has two costs:

1. **Names are canned.** Autonomous widgets are named `kind.replace("_"," ")`
   or `template.label` — byte-identical across every image. The user reads
   "clipped highlights" forever, never "Blown-out sky behind the wires".
2. **Detection recall is capped, blindly.** Claude can only report what the
   enum names. We have no data on what it *wanted* to report, so growing the
   vocabulary is guesswork.

Full freedom (open `kind`) was considered and rejected: the action space
(fused templates) is fixed anyway, the study needs countable keys, and
severity calibration drifts across an open set.

## Design — closed spine, free skin, empirical growth

### 1. `Problem.display_label` — free-text naming

- New optional field `display_label: str | None` on `Problem` (2–6 words,
  image-specific, human-facing) + matching property in the hand-rolled
  `_SOFT_FIELDS_TOOL` schema and an instruction in `_AUGMENT_PROMPT`.
- `mint_autonomous_suggestions` sets the minted widget's `display_name` from
  the problem's `display_label` (problem pass) or `template.label` (top-up
  pass — previously None). `intent` stays canonical for analytics; the UI
  header prefers `display_name` and falls back to `intent` as today.

### 2. `kind: "other"` — journal-only escape hatch

- `"other"` added to `ProblemKind` and the tool-schema enum, plus a new
  optional `description: str | None` field for what was observed.
- The augment prompt instructs: use `other` only when no vocabulary kind
  fits; describe the observation; it will be recorded, not acted on.
- `mint_autonomous_suggestions` journals `other` problems as
  `proposal.health {stage: autonomous, event: observation}` with the
  label/description + severity and skips minting (no tool mapping exists —
  a widget would be noise).
- Registry growth becomes empirical: recurring `observation` events across
  study sessions are candidates for promotion to real kinds, each paired
  with the question "which fused tool handles this?".

### 3. Per-kind severity anchors

One-line calibration per kind in `_AUGMENT_PROMPT` (e.g. clipped_highlights
≈ fraction of frame with lost detail × importance of that area) so the
hardcoded 0.5 mint gate compares like with like.

## Out of scope

- Minting widgets from `other` problems (needs a tool-mapping story first).
- Frontend changes (display_name already renders with intent fallback).
- Promoting any specific new kind now — that's what the observation data is
  for.

## Testing

- Autonomous pass: problem with `display_label` → minted widget carries it
  as `display_name`; top-up widget gets `template.label`; `other` problem →
  `observation` journaled, nothing minted.
- Schema: `_SOFT_FIELDS_TOOL` enum contains `other` + `display_label` /
  `description` properties; `_AUGMENT_PROMPT` mentions display_label, the
  `other` rule, and severity anchors (pin like the planner-prompt tests).
