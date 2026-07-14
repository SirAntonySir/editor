# Admin Cockpit — Measure Analyze-Path LLM Cost

**Date:** 2026-07-14
**Status:** Approved for implementation

## Problem

The admin cockpit derives per-session cost by summing `mcp.usage` events
from `.sessions/{sid}/events.jsonl`. Only the user-intent path
(`propose_stack`: `plan_widget_stack`, `resolve_stack_params`) ever lands
there — the analyze pipeline's Claude calls are invisible, so session cost
is systematically undercounted (analyze is a multi-call vision pipeline;
its cost is substantial).

## Root cause

`_log_cache_stats` (anthropic_client.py) reports usage by fetching the
session doc from a contextvar (`get_active_doc()`) and emitting
`mcp.usage` through it (SSE bus → journal mirror).

- `propose_stack.py` wraps its LLM calls in `asyncio.to_thread`, which
  COPIES contextvars into the worker thread → usage journals correctly.
- The analyze path wraps its LLM calls in `loop.run_in_executor`, which
  does NOT copy contextvars → `get_active_doc()` returns `None` in the
  worker thread and the usage event is silently dropped.

Verified in real session journals: `phase.*` events from analyze are
journaled (the doc's event sink works), but zero `analyze` /
`augment_context` usage events exist.

Affected call sites (LLM calls under `run_in_executor`):

| Site | Call |
|---|---|
| `app/tools/atomic/analyze_context.py:80` | `analyze_image` → `"analyze"` |
| `app/tools/atomic/analyze_context.py:120` | `augment_context_soft_fields` → `"augment_context"` |
| `app/services/autonomous_suggestions.py:327` | `suggest_fused_tools_for_character` |

The legacy `/analyze` route (`api/analyze.py`) already uses
`asyncio.to_thread` and is unaffected. Non-LLM `run_in_executor` calls
(numpy stats, SAM) emit no usage and stay as they are.

## Decisions (made with Anton)

- **Cockpit presentation:** totals only. The cockpit already sums every
  `mcp.usage` event into `usd_cost` / token columns; no cockpit change.
- **Approach:** both fixes (call-site + sink safety net), per
  recommendation.

## Design

### 1. Call-site fix — `run_in_executor` → `asyncio.to_thread`

Swap the three affected LLM calls to `asyncio.to_thread(...)`, matching
the working `propose_stack` pattern. `to_thread` runs
`contextvars.copy_context()` under the hood, so `get_active_doc()`
resolves inside the worker thread and usage flows through the existing
emit path (SSE + journal). Where the call is wrapped in
`asyncio.wait_for` (autonomous_suggestions), the timeout wrapper stays;
only the inner awaitable changes.

Side benefit: `_emit_usage`'s documented consumer — the frontend status
bar's live token counter during an analyze run — starts receiving events.

### 2. Sink safety net — journal fallback in `_log_cache_stats`

In `_log_cache_stats`, when `get_active_doc()` returns `None` but a
`session_id` was passed:

- `write_event(session_id, "mcp.usage", {call, input_tokens,
  output_tokens, cache_create, cache_read})` — same payload shape as
  `_emit_usage`, so the cockpit's summing loop needs no change.
- `logger.warning(...)` naming the call — a mis-threaded call site is a
  bug worth noticing, not silent behavior.

This guarantees any future LLM call site that loses the contextvar still
records cost (journal-only; no SSE — acceptable, it never had SSE).
When both doc and session_id are absent, keep today's behavior (log only).

### 3. Testing

Backend pytest:

- **Fallback unit tests** (`tests/services/`): fake response with usage
  attrs; (a) no active doc + session_id → `write_event` called with the
  right kind/payload; (b) no active doc + no session_id → no write;
  (c) active doc present → usage emitted via the doc, no direct
  journal write (unchanged behavior).
- **Context-propagation test** (`tests/tools/`): stub Anthropic client
  whose `analyze_image` / `augment_context_soft_fields` invoke the real
  `_log_cache_stats`; set an active doc, run the `analyze_context`
  handler, assert `mcp.usage` events appear in `doc.history`. This fails
  under `run_in_executor` (contextvar lost) and passes with `to_thread` —
  the red/green pair for the swap.

## Out of scope

- Per-call cost breakdown columns in the cockpit (decided against).
- The `mcp.usage` payload carries no `model` field, so the cockpit prices
  everything at the default (Sonnet) tier — pre-existing, unchanged here.
- Backfilling cost for historical sessions (the data was never recorded).
