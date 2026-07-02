# Holistic Stack Resolution for `propose_stack`

**Date:** 2026-07-02
**Status:** Approved
**Scope:** Backend only — `anthropic_client.py`, `propose_stack.py`, `tools/registry.py`, tests.

## Problem

The LLM widget-proposal path (`propose_stack`, mcp_* origins) has three quality
failures, observed in real sessions:

1. **Double application.** Phase 2 resolves every op's params **independently
   and in parallel** (`propose_stack.py` `_resolve_one`). Each
   `resolve_widget_params` call sees only its own op schema + intent + image
   context — never the sibling ops or their values. When the planner puts
   `light` (exposure) and `levels`/shadows in one stack for "brighten this",
   each resolver applies a full-strength correction. Nobody owns the total
   effect; there is no gain-staging.
2. **Frequent fallbacks.** `plan_widget_stack` parses the response with a raw
   `json.loads(response.content[0].text)` — no structured output, no retry.
   One markdown fence → empty plan → fallback. Worse, the fallback's last
   branch spawns **the first preset in dict order** when no keyword matches:
   the user gets an arbitrary, unrelated widget.
3. **Weak grouping.** The planner prompt's only grouping guidance is "ops with
   the same category usually belong together". There is no definition of what
   a widget *is* in UX terms (one perceptual intention, one card).

## Design

### 1. Planner (`plan_widget_stack`) — structured output + rubric

- Switch to **forced tool use** (house pattern, cf. `analyze_image`): a new
  `emit_plan` tool whose `input_schema` mirrors the current plan shape
  (`plan[].widget_name/category/ops[].op_id/rationale/starting_params`,
  `overall_rationale`), called with `tool_choice: {"type": "tool", "name":
  "emit_plan"}`.
- **Retry once** (2 attempts total) on SDK error or missing tool_use block.
  After both attempts fail, raise `RuntimeError`; the handler catches it,
  journals `planner_failed`, and enters the fallback path.
- `_PLANNER_SYSTEM_PROMPT` additions:
  - Widget definition: *one perceptual intention the user would name out
    loud* ("lift the shadows", "warm it up"); ops group into one widget only
    when a user would refine them as a single unit. One bad-grouping
    counter-example.
  - Minimal-ops discipline: "prefer the minimum set of ops that achieves the
    intent — do not add a second op that pushes the same perceptual axis as
    one already planned."
  - Compound-dial rules unchanged.

### 2. New `resolve_stack_params` — one call for the whole stack

Replaces the parallel per-op loop in `_handle_llm_path`.

- **Input:** the full deduped plan (entries with op_ids, rationales,
  starting_params), param schemas for *only the planned ops*, intent, and the
  stripped image context (same `image_context_for_llm` form; context block
  stays cache-ephemeral so planner + resolver share the cache line).
- **System prompt core:** "You are resolving parameters for the ENTIRE stack
  at once. The stack's *combined* effect must achieve the intent. Budget
  overlapping axes: if two ops both raise brightness, split the correction
  between them — never let each op independently achieve the full intent."
- **Output via forced tool use** (`emit_stack_params`):
  `{"entries": [{"entry_index": 0, "ops": [{"op_id": "light", "params":
  {...}}]}]}` — indices bind results to plan entries without string matching.
- **Guardrails unchanged:** per-param scalar clamping + default-fill extracted
  into a shared module-level helper `_clamp_op_params(op, raw)` used by both
  `resolve_stack_params` and the existing `resolve_widget_params` (which stays
  as-is for `refine_widget`).
- **Omission tolerance:** if the model omits an op that was in the plan, the
  handler fills it with `_clamp_op_params(op, starting_params or {})`
  (defaults + clamped planner priors) instead of dropping it. Unknown
  `entry_index` / `op_id` values in the response are skipped.
- **Failure handling:** one retry; if both attempts fail the whole proposal
  fails visibly (see §3) instead of dropping ops piecemeal.
- **Deleted:** `_resolve_one`, the flat-ops fan-out, per-op
  `asyncio.wait_for` timeouts, and the `by_entry` regrouping. The H19
  deadlock concern is covered by the SDK-level `ANTHROPIC_TIMEOUT_S` on the
  single call (worst case 2× timeout with retry, bounded).

### 3. Fallback — never spawn garbage

- Keep the keyword→preset match as a degraded mode; journal its use. The
  fallback path **skips the LLM resolver entirely**: preset params are
  curated values already, and when the planner just failed on an unhealthy
  API, two more timeout-length attempts would park the per-session write
  lock for nothing. The build loop ships the clamped preset priors directly.
- **Delete the "first preset in dict order" branch.** If the planner failed
  AND no keyword matches, raise `_ProposalFailed` ("couldn't compose widgets
  for this prompt — try rephrasing"). `tools/registry.py`
  `_classify_exception` maps it to envelope code `proposal_failed`
  (`retryable=True`, recovery hint "rephrase the prompt and try again"), which
  the frontend surfaces like any other tool error.
- Total resolver failure (§2) raises the same exception.

### 4. Telemetry

Journal (via `event_journal.write_event`, kind `proposal.health`) with a
`stage` + `event` payload:

| event | meaning |
|---|---|
| `planner_retry` | attempt 1 failed, retrying |
| `planner_failed` | both planner attempts failed → fallback path |
| `resolver_retry` | attempt 1 failed, retrying |
| `resolver_failed` | both resolver attempts failed → proposal_failed |
| `fallback_keyword_hit` | keyword preset used instead of LLM plan |
| `proposal_failed` | nothing spawnable → error returned |

`study_measures.compute_study_measures` ignores unknown kinds, so this is
additive; the admin cockpit / thesis analysis can count "dynamic path success
rate" directly from the journal.

### 5. Testing

- **Unit (`resolve_stack_params`, mocked `_messages_create`):** parses the
  tool_use block; clamps out-of-range scalars; retries when the tool block is
  missing; raises after two failures.
- **Integration (`test_propose_stack_integration.py`):** existing tests
  migrate from `resolve_widget_params` mocks to `resolve_stack_params` mocks;
  new tests: omitted op filled with clamped priors/defaults; resolver total
  failure raises `_ProposalFailed`; no-match fallback raises
  `_ProposalFailed` instead of spawning an arbitrary preset; keyword fallback
  still spawns and journals.
- **Manual eyeball (not asserted):** "brighten this dark photo" should produce
  a stack whose summed exposure-ish params are visibly more conservative than
  today.

## Out of scope

- Closed-loop verification (render preview → VLM inspects the result).
- Engine extension (LLM registers new ops/shaders) — Phase 4.
- Control-surface freedom (LLM picks bindings/ranges).
- `refine_widget` — keeps single-op `resolve_widget_params`.

## Latency note

Today: planner + slowest-of-N parallel resolvers. After: planner + one
resolver call that is longer than a single-op resolve but not hostage to
stragglers — roughly neutral or better, with far fewer failure points and no
per-op cache choreography.
