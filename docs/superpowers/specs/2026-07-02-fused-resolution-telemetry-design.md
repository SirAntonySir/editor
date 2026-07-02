# Fused-Tool Resolution Telemetry + Clamp-on-Last-Retry

**Date:** 2026-07-02
**Status:** Approved
**Scope:** Backend only — `fused_framework.py`, `autonomous_suggestions.py`,
`schemas/widget.py`, the three `run_fused_tool` call sites, tests.
**Companion to:** `2026-07-02-holistic-stack-resolution-design.md` (same
telemetry channel, same philosophy: no silent degraded modes).

## Problem

Forensic analysis of a real session showed both autonomous widgets shipped
**envelope midpoints** — the LLM resolver was called 3× per tool, every
attempt was rejected, and `run_fused_tool` silently seeded mechanical values.
Nothing in the per-session journal records any of it; the only fingerprint is
3× `mcp.usage` + exact-midpoint params. Three gaps:

1. **The docstring lies.** `run_fused_tool` promises *"On envelope violation,
   clamp on last retry"* but the code never clamps-and-accepts — any
   third-attempt violation falls through to midpoint seeding. A resolution
   that is 95 % usable (one param slightly out of envelope) is discarded
   wholesale.
2. **No decision telemetry.** Resolver retries, envelope violations, midpoint
   seeding, the autonomous pass's severity-gate skips, dedup drops, dismissal
   skips, and swallowed resolve failures all go unjournaled (at best a
   process-level `logger.warning`). The study cannot distinguish
   "LLM-resolved" from "midpoint-seeded" widgets — very different conditions.
3. **The widget itself doesn't say.** Nothing on the Widget records how its
   values were produced.

## Design

### 1. `run_fused_tool` — implement the promised clamp, journal every attempt

- New optional param `session_id: str | None = None` (explicit, not
  contextvar magic — the autonomous path calls this from worker threads).
  All three call sites (`refine_widget`, `repeat_widget`,
  `autonomous_suggestions`) pass `doc.session_id`.
- Attempt loop behaviour:
  - `ResolverError` on attempts 1–2 → journal `resolver_retry` and continue
    (unchanged control flow).
  - Envelope violation on attempts 1–2 → journal `resolver_retry` with the
    offending param keys and continue (unchanged control flow).
  - Envelope violation on the **last** attempt → **clamp and accept**
    (implements the docstring): journal `envelope_clamped`, ship the clamped
    values, stamp `param_source="llm_clamped"`.
  - In-envelope success → stamp `param_source="llm"`.
  - All attempts raised `ResolverError` → journal `midpoint_seeded`, seed
    midpoints as today, stamp `param_source="midpoint"`, and set
    `reasoning` to a short honest note ("Automatic fallback — the resolver
    failed; values are safe midpoints, adjust to taste.") so the Why popover
    doesn't present mechanical values as an AI decision.
- Journal events use the existing `proposal.health` kind with
  `stage: "fused_resolve"` and payload `{event, tool, attempt?, detail?}`.
  Writes are wrapped so telemetry can never break resolution; `session_id
  is None` (old callers, tests) skips journaling.

### 2. `Widget.param_source`

New optional field `param_source: str | None = None` on the Widget schema
(`"llm" | "llm_clamped" | "midpoint"`; None for paths that don't stamp it,
e.g. propose_stack/preset spawns, which are LLM/preset by construction).
Additive and camel-aliased (`paramSource`) — the frontend ignores unknown
keys; the admin cockpit and study analysis read it from `widget.created`
journal payloads.

### 3. `mint_autonomous_suggestions` — journal the selection decisions

All events on `proposal.health` with `stage: "autonomous"`:

| event | when | payload extras |
|---|---|---|
| `suggestion_skipped` | a problem or candidate is passed over | `reason` (`severity_gate`, `duplicate_fused_id`, `knob_collision`, `dismissed`, `unknown_template`) + `problem`/`tool`, `severity` where relevant |
| `resolve_failed` | a pick's resolve times out or raises (today silently `None`) | `tool`, `detail` |
| `topup_requested` | the character-match top-up runs | `needed`, `candidates` |
| `topup_candidates_failed` | the top-up suggestion call times out | — |

The problem-pass loop journals one `suggestion_skipped` per skip decision
(bounded: ≤ problems × suggested tools, single digits in practice).

### 4. Out of scope

- Admin-cockpit slicing by `param_source` (admin.py has in-flight edits;
  additive journal data is enough for now).
- Prompt/quality changes to the fused resolvers themselves (why the envelope
  was violated 3× is a separate investigation — the telemetry added here is
  what makes it investigable).
- Frontend display of `param_source`.

## Testing

- `run_fused_tool` unit tests (stub template + fake resolver):
  - success → `param_source="llm"`, no health events;
  - violation ×2 then success → 2 `resolver_retry` events;
  - violation ×3 → clamped values shipped, `param_source="llm_clamped"`,
    `envelope_clamped` journaled — NOT midpoints;
  - `ResolverError` ×3 → midpoints, `param_source="midpoint"`,
    `midpoint_seeded` journaled, fallback reasoning set.
- `mint_autonomous_suggestions` unit test: ctx with a below-gate and an
  above-gate problem + a failing resolve → `suggestion_skipped
  (severity_gate)` and `resolve_failed` journaled; minted widget carries
  `param_source`.
- Journal capture via monkeypatched `write_event`.
