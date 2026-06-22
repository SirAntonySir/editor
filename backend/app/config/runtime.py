"""Runtime constants — timing, limits, LLM budgets.

Single source of truth for cadences and budgets consumed by both backend and
frontend. The frontend gets these via shared/types/generated.ts (Phase 1
codegen pipeline).

These are *not* env-overridable; they're application constants. If a value
ever needs operator override, promote it to env.py.
"""

from pydantic import BaseModel


class RuntimeConfig(BaseModel):
    """Application timing, limits, and LLM token budgets."""

    # --- SSE reconnect / safety ---
    sse_reconnect_base_ms: int = 250
    sse_reconnect_max_ms: int = 4000
    sse_safety_timeout_ms: int = 1500

    # --- UI cadences (frontend-only consumers) ---
    slider_debounce_ms: int = 300
    toast_dismiss_ms: int = 4000
    status_hold_ms: int = 3000
    # Palette typing-time smart-match: wait this long after the last
    # keystroke before firing the backend `smart_match_command` tool. 250 ms
    # is roughly two beats slower than a comfortable typing rhythm, which
    # avoids burning an LLM call per keypress without making the
    # suggestion feel sluggish.
    smart_match_debounce_ms: int = 250
    # Don't fire smart-match for queries shorter than this. 4 chars is the
    # threshold below which the deterministic synonym match nearly always
    # has a good answer — and below which the LLM would waste tokens
    # guessing what the user might type next.
    smart_match_min_chars: int = 4

    # --- Session engine limits (P2/P3) ---
    history_max_entries: int = 100
    undo_max_entries: int = 100
    checkpoint_interval_s: int = 5
    # Background sweep that deletes session state (both in-memory records
    # and on-disk directories) whose *last activity* is older than this.
    # Without it, .sessions/ grows unbounded and the in-memory records
    # map holds source image bytes for sessions that never receive another
    # `get()` to trip the lazy TTL check. Runs every
    # `disk_prune_interval_s`. Default: 24h retention, 10-minute sweep —
    # tuned so the admin cockpit can still see a thesis-evaluation
    # session after a coffee/lunch break. `prune_disk` keys off the
    # newest mtime among the session's mutating files (events.jsonl,
    # state.json, meta.json) so an active session is never wiped.
    disk_session_max_age_s: int = 86400
    disk_prune_interval_s: int = 600
    # When a user-action tool is invoked with the same `coalesce_key` as
    # the last entry on the undo stack within this window, the last
    # entry's `after` snapshot is updated in place rather than pushing a
    # new entry. Lets a slow slider drag (multiple debounced set_params)
    # collapse into one undoable step. 2 s comfortably covers a
    # pause-and-resume drag while still creating a new entry once the
    # user moves on to a different param.
    history_coalesce_window_ms: int = 2000

    # --- Anthropic client ---
    anthropic_timeout_s: float = 120.0
    max_vision_dim: int = 1568  # Claude downsamples to this long-edge bound

    # --- LLM token budgets ---
    # Replace scattered max_tokens= literals in anthropic_client.py.
    # Five tiers cover today's call sites:
    #   ANALYZE  — ImageContext + 6–10 candidate regions, planner outputs
    #   COMPOSE  — catalog-aware multi-pick suggestions
    #   REFINE   — single-tool fleshouts, param values
    #   CLASSIFY — name-pick, top-N picks
    #   SHORT    — single-label / yes-no responses
    max_tokens_analyze: int = 2048
    max_tokens_compose: int = 1500
    max_tokens_refine: int = 1024
    max_tokens_classify: int = 512
    max_tokens_short: int = 128
