"""Admin cockpit — thesis-evaluation views over the session journal.

Localhost-only by design. The cockpit reads ``.sessions/{sid}/events.jsonl``
files and the process-stats journal, derives cost / acceptance / use
metrics on demand, and serves them via JSON and a single HTML page.

Mounted at ``/admin/*``. The gate is the client peer IP — any non-loopback
request gets a 403. Tunnel traffic (Cloudflare, ngrok) arrives with the
tunnel daemon as the peer, which is also loopback on the same host. To
prevent that, a tunnel operator should *not* point the tunnel at
``/admin``; the standard pattern is to tunnel ``/api/*`` and ``/health``
only.

The cost model uses Anthropic's published prices (USD per million
tokens). Numbers below are intentionally const — they would drift over
time; the cockpit is a research tool, not billing.
"""

from __future__ import annotations

import csv
import io
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel

from app.config import get_settings
from app.services import cohort_store, disk_session_io, process_stats
from app.services.event_journal import read_events, write_event
from app.services.study_measures import compute_study_measures
from app.services.session_store import SessionNotFound, SessionStore

from .deps import get_event_bus, get_session_store

router = APIRouter(prefix="/admin")


# ─── Pricing table ────────────────────────────────────────────────────
# USD per 1M tokens. Sourced from anthropic.com/pricing at the time of
# writing — used only by the cockpit, not for billing. Update when a
# model's price changes.
_PRICES_USD_PER_M = {
    "claude-opus-4-7":   {"in": 15.00, "cache_write": 18.75, "cache_read": 1.50, "out": 75.00},
    "claude-opus-4-6":   {"in": 15.00, "cache_write": 18.75, "cache_read": 1.50, "out": 75.00},
    "claude-sonnet-4-6": {"in":  3.00, "cache_write":  3.75, "cache_read": 0.30, "out": 15.00},
    "claude-haiku-4-5":  {"in":  0.80, "cache_write":  1.00, "cache_read": 0.08, "out":  4.00},
    "default":           {"in":  3.00, "cache_write":  3.75, "cache_read": 0.30, "out": 15.00},
}


def _pricing_for(model_id: str | None) -> dict:
    if not model_id:
        return _PRICES_USD_PER_M["default"]
    # Strip the bracketed suffix variant (claude-opus-4-7[1m] → claude-opus-4-7).
    base = re.sub(r"\[.*?\]$", "", model_id)
    return _PRICES_USD_PER_M.get(base, _PRICES_USD_PER_M["default"])


def _usage_cost_usd(usage_payload: dict, model_id: str | None) -> float:
    """Compute USD cost for one mcp.usage event payload."""
    p = _pricing_for(model_id)
    in_t = int(usage_payload.get("input_tokens", 0) or 0)
    out_t = int(usage_payload.get("output_tokens", 0) or 0)
    cw_t = int(usage_payload.get("cache_create", 0) or 0)
    cr_t = int(usage_payload.get("cache_read", 0) or 0)
    return (
        in_t * p["in"]
        + out_t * p["out"]
        + cw_t * p["cache_write"]
        + cr_t * p["cache_read"]
    ) / 1_000_000.0


# ─── Localhost guard ──────────────────────────────────────────────────


def _require_loopback(request: Request) -> None:
    """Gate admin to loopback OR a valid shared token.

    Loopback (local dev, or an SSH/Tailscale tunnel terminating on the host) is
    always allowed. On a hosted deploy (Render) there is no loopback path from a
    browser, so a request is also accepted when it carries the configured
    ``ADMIN_TOKEN`` — either ``Authorization: Bearer <token>`` or a
    ``?token=<token>`` query param (so the cockpit is openable as a plain URL).

    ``ADMIN_TOKEN`` is deliberately SEPARATE from ``BACKEND_AUTH_TOKEN``: the
    latter ships in the public frontend bundle (``VITE_BACKEND_TOKEN``) and so
    can't protect the participant data the cockpit exposes. When no
    ``ADMIN_TOKEN`` is configured, only loopback is allowed.
    """
    client = request.client
    host = client.host if client else None
    if host in {"127.0.0.1", "::1", "localhost"}:
        return
    token = get_settings().admin_token
    if token:
        authz = request.headers.get("authorization", "")
        provided = (
            authz[len("Bearer ") :]
            if authz.startswith("Bearer ")
            else request.query_params.get("token")
        )
        if provided and provided == token:
            return
    raise HTTPException(status_code=403, detail="admin requires loopback or a valid ADMIN_TOKEN")


# ─── Session summary derivation ───────────────────────────────────────


def _list_session_ids() -> list[str]:
    """Return every session id with an on-disk directory, newest first
    by meta.json mtime."""
    root = disk_session_io.SESSIONS_DIR
    if not root.exists():
        return []
    pairs: list[tuple[str, float]] = []
    for entry in root.iterdir():
        if not entry.is_dir():
            continue
        meta = entry / "meta.json"
        if not meta.exists():
            continue
        try:
            ts = meta.stat().st_mtime
        except OSError:
            ts = 0.0
        pairs.append((entry.name, ts))
    pairs.sort(key=lambda p: p[1], reverse=True)
    return [sid for sid, _ in pairs]


def _summarize_session(sid: str) -> dict[str, Any]:
    """Derive a one-row summary from a session's journal + meta.json."""
    summary: dict[str, Any] = {
        "session_id": sid,
        "created_at": None,
        "user_id": None,
        "user_agent": None,
        "image_bytes": None,
        "filename": None,
        "event_count": 0,
        "widget_proposed": 0,
        "widget_applied": 0,
        "widget_dismissed": 0,
        "prompt_count": 0,
        "tool_invocations": 0,
        "usd_cost": 0.0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "duration_s": 0.0,
        "last_event_ts": None,
        "ai_access": True,
    }
    # meta.json carries created_at wall-clock + mime + size + ai_access.
    meta_path = disk_session_io.SESSIONS_DIR / sid / "meta.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text())
            created = meta.get("created_at")
            # Legacy metas persisted time.monotonic() (seconds since BOOT),
            # which renders as a 1970-adjacent date. Anything below ~2001
            # epoch can't be a real wall-clock stamp — fall back to the
            # meta file's mtime, which is written at session creation.
            if isinstance(created, (int, float)) and created < 1_000_000_000:
                created = meta_path.stat().st_mtime
            summary["created_at"] = created
            summary["mime_type"] = meta.get("mime_type")
            summary["ai_access"] = bool(meta.get("ai_access", True))
        except (OSError, json.JSONDecodeError):
            pass

    events = read_events(sid)
    summary["event_count"] = len(events)
    first_ts: float | None = None
    last_ts: float | None = None
    model_id_seen: str | None = None
    for ev in events:
        ts = float(ev.get("ts", 0.0)) or None
        if ts:
            if first_ts is None or ts < first_ts:
                first_ts = ts
            if last_ts is None or ts > last_ts:
                last_ts = ts
        kind = ev.get("kind", "")
        payload = ev.get("payload") or {}
        if kind == "session.created":
            summary["user_id"] = payload.get("user_id")
            summary["user_agent"] = payload.get("user_agent")
            summary["image_bytes"] = payload.get("bytes")
            summary["filename"] = payload.get("filename")
        elif kind == "prompt.entered":
            summary["prompt_count"] += 1
        elif kind == "widget.created":
            summary["widget_proposed"] += 1
        elif kind == "widget.accepted":
            summary["widget_applied"] += 1
        elif kind == "widget.deleted":
            summary["widget_dismissed"] += 1
        elif kind == "mcp.usage":
            model_id_seen = payload.get("model") or model_id_seen
            summary["input_tokens"] += int(payload.get("input_tokens", 0) or 0)
            summary["output_tokens"] += int(payload.get("output_tokens", 0) or 0)
            summary["cache_read_tokens"] += int(payload.get("cache_read", 0) or 0)
            summary["usd_cost"] += _usage_cost_usd(payload, model_id_seen)

    if first_ts and last_ts:
        summary["duration_s"] = round(last_ts - first_ts, 1)
    summary["last_event_ts"] = last_ts
    summary["usd_cost"] = round(summary["usd_cost"], 4)
    return summary


# ─── Routes ───────────────────────────────────────────────────────────


@router.get("", dependencies=[Depends(_require_loopback)])
@router.get("/", dependencies=[Depends(_require_loopback)])
def admin_index() -> HTMLResponse:
    """Single-page HTML cockpit. Vanilla JS, no build step — designed
    to be edited in place during a study run if a view needs a new
    column."""
    html = _ADMIN_HTML
    return HTMLResponse(content=html)


@router.get("/sessions", dependencies=[Depends(_require_loopback)])
def list_sessions(
    limit: int = 200,
    since_ts: float | None = None,
) -> JSONResponse:
    """List sessions, newest-first. `since_ts` filters by created_at >=
    the given wall-clock timestamp (used for "today only" view)."""
    rows: list[dict[str, Any]] = []
    for sid in _list_session_ids()[:limit]:
        summary = _summarize_session(sid)
        if since_ts is not None:
            created = summary.get("created_at") or 0.0
            if created < since_ts:
                continue
        rows.append(summary)
    return JSONResponse({"sessions": rows, "count": len(rows)})


@router.get("/sessions/{sid}", dependencies=[Depends(_require_loopback)])
def session_detail(
    sid: str,
    store: SessionStore = Depends(get_session_store),
) -> JSONResponse:
    """Full per-session payload: summary, every event, and a memory
    estimate read from the live record if it's still in memory."""
    if not (disk_session_io.SESSIONS_DIR / sid).exists():
        raise HTTPException(status_code=404, detail="session not found")
    summary = _summarize_session(sid)
    events = read_events(sid)
    # Live memory: if the record is still resident, sum the bytes we can
    # actually measure. Document state isn't trivially sizeable, so this
    # is a coarse floor, not a ceiling.
    live_mem: dict[str, Any] | None = None
    record = store._records.get(sid)
    if record is not None:
        live_mem = {
            "image_bytes": len(record.image_bytes),
            "has_document": record.document is not None,
            "context_present": record.context is not None,
            "history_entries": (
                len(record.history_engine.entries)
                if record.history_engine is not None
                else 0
            ),
        }
    return JSONResponse({
        "summary": summary,
        "events": events,
        "live_memory": live_mem,
    })


class _AiAccessBody(BaseModel):
    ai_access: bool


class _BlockMarkerBody(BaseModel):
    block: int
    part: str  # 'corrective' | 'creative' | 'sky'
    condition: str | None = None  # 'ai_on' | 'ai_off' — auto-filled if omitted
    action: str = "start"  # 'start' | 'end'


@router.post("/sessions/{sid}/ai-access", dependencies=[Depends(_require_loopback)])
async def set_session_ai_access(
    sid: str,
    body: _AiAccessBody,
    store: SessionStore = Depends(get_session_store),
) -> JSONResponse:
    """Flip the study-design AI_access flag on a session.

    Does two things:
    1. Sets the participant's COHORT default (keyed by the session's user_id),
       so every future session that browser mints — each reload / new image
       starts a fresh one — inherits the condition. This is what makes the
       toggle stick across reloads.
    2. Flips the CURRENT session live: persists to the in-memory record +
       meta.json, journals the change for the timeline, and emits a live
       `session.ai_access` event so a connected client toggles its AI surfaces
       without a reload. Mirrors api/state.py's history-apply pattern.
    """
    # Cohort first so it's stamped even if the live session is already gone.
    user_id = _summarize_session(sid).get("user_id")
    cohort_store.set_cohort_ai_access(user_id, body.ai_access)
    try:
        store.set_ai_access(sid, body.ai_access)
        async with store.with_document_lock(sid) as doc:
            ev = doc._emit("session.ai_access", {"ai_access": body.ai_access})
            get_event_bus().publish(sid, ev)
            doc._published_idx = len(doc.history)
            store.checkpointer.mark_dirty(doc)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="session not found")
    write_event(sid, "admin.ai_access", {"ai_access": body.ai_access})
    return JSONResponse({
        "session_id": sid,
        "ai_access": body.ai_access,
        "user_id": user_id,
    })


@router.post("/sessions/{sid}/block", dependencies=[Depends(_require_loopback)])
async def mark_study_block(
    sid: str,
    body: _BlockMarkerBody,
    store: SessionStore = Depends(get_session_store),
) -> JSONResponse:
    """Write a `study.block` marker to the session journal. The interviewer
    clicks this per part (corrective / creative / sky) so measures compute
    per-part and the AI-block boundary is explicit. `condition` auto-fills from
    the session's current AI_access when omitted."""
    if not (disk_session_io.SESSIONS_DIR / sid).exists():
        raise HTTPException(status_code=404, detail="session not found")
    condition = body.condition
    if condition is None:
        try:
            summary = _summarize_session(sid)
            condition = "ai_on" if summary.get("ai_access", True) else "ai_off"
        except Exception:
            condition = None
    payload = {
        "block": body.block,
        "part": body.part,
        "condition": condition,
        "action": body.action,
    }
    write_event(sid, "study.block", payload)
    return JSONResponse({"session_id": sid, "marker": payload})


@router.get("/sessions/{sid}/image", dependencies=[Depends(_require_loopback)])
def session_image(sid: str) -> Response:
    """Stream the session's source image bytes. Used by the admin UI to
    render an inline thumbnail per session."""
    session_dir = disk_session_io.SESSIONS_DIR / sid
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail="session not found")
    # The source image is saved by save_session as image.<ext> next to
    # meta.json. Find the first match.
    for candidate in session_dir.iterdir():
        if candidate.name.startswith("image.") and candidate.is_file():
            try:
                meta = json.loads((session_dir / "meta.json").read_text())
                mime = meta.get("mime_type", "image/jpeg")
            except (OSError, json.JSONDecodeError):
                mime = "image/jpeg"
            return Response(content=candidate.read_bytes(), media_type=mime)
    raise HTTPException(status_code=404, detail="no source image on disk")


@router.get("/aggregate", dependencies=[Depends(_require_loopback)])
def aggregate() -> JSONResponse:
    """Aggregate dashboard numbers. Re-derived every call — cheap
    enough at study scale (<10k sessions). Cache later if it gets slow."""
    sids = _list_session_ids()
    summaries = [_summarize_session(sid) for sid in sids]
    if not summaries:
        return JSONResponse({"empty": True})

    total_cost = round(sum(s["usd_cost"] for s in summaries), 2)
    total_in = sum(s["input_tokens"] for s in summaries)
    total_out = sum(s["output_tokens"] for s in summaries)
    total_cache_read = sum(s["cache_read_tokens"] for s in summaries)
    total_proposed = sum(s["widget_proposed"] for s in summaries)
    total_applied = sum(s["widget_applied"] for s in summaries)
    total_dismissed = sum(s["widget_dismissed"] for s in summaries)
    total_prompts = sum(s["prompt_count"] for s in summaries)
    users = {s["user_id"] for s in summaries if s.get("user_id")}

    # Top tools: count tool invocations across all sessions via the
    # phase.started event kind, which is emitted at every tool entry.
    tool_counts: dict[str, int] = {}
    for sid in sids:
        for ev in read_events(sid):
            if ev.get("kind") == "phase.started":
                phase = (ev.get("payload") or {}).get("phase", "")
                if phase:
                    tool_counts[phase] = tool_counts.get(phase, 0) + 1
    top_tools = sorted(tool_counts.items(), key=lambda kv: kv[1], reverse=True)[:10]

    return JSONResponse({
        "sessions": len(summaries),
        "users": len(users),
        "total_cost_usd": total_cost,
        "total_input_tokens": total_in,
        "total_output_tokens": total_out,
        "total_cache_read_tokens": total_cache_read,
        "widgets_proposed": total_proposed,
        "widgets_applied": total_applied,
        "widgets_dismissed": total_dismissed,
        "prompts_entered": total_prompts,
        "acceptance_rate": (
            round(total_applied / total_proposed, 3) if total_proposed else None
        ),
        "top_tools": top_tools,
    })


@router.get("/process_stats", dependencies=[Depends(_require_loopback)])
def process_stats_route(limit: int = 480) -> JSONResponse:
    """Recent process-RAM samples. Default 480 = 4h at 30s tick."""
    return JSONResponse({"samples": process_stats.read_samples(limit=limit)})


@router.get("/export.csv", dependencies=[Depends(_require_loopback)])
def export_csv() -> PlainTextResponse:
    """Per-session CSV export. The full event journal is shipped as
    /admin/export.json — CSV is for spreadsheet eyeballing."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "session_id", "user_id", "created_at", "duration_s", "filename",
        "image_bytes", "event_count", "prompts", "widgets_proposed",
        "widgets_applied", "widgets_dismissed", "usd_cost",
        "input_tokens", "output_tokens", "cache_read_tokens", "user_agent",
    ])
    for sid in _list_session_ids():
        s = _summarize_session(sid)
        writer.writerow([
            s["session_id"], s.get("user_id") or "", s.get("created_at") or "",
            s.get("duration_s") or 0, s.get("filename") or "",
            s.get("image_bytes") or 0, s.get("event_count") or 0,
            s.get("prompt_count") or 0, s.get("widget_proposed") or 0,
            s.get("widget_applied") or 0, s.get("widget_dismissed") or 0,
            s.get("usd_cost") or 0.0, s.get("input_tokens") or 0,
            s.get("output_tokens") or 0, s.get("cache_read_tokens") or 0,
            (s.get("user_agent") or "").replace("\n", " ")[:200],
        ])
    return PlainTextResponse(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"content-disposition": "attachment; filename=sessions.csv"},
    )


@router.get("/sessions/{sid}/export.json", dependencies=[Depends(_require_loopback)])
def export_session_json(sid: str) -> JSONResponse:
    """Single-session JSON export — summary + every event. The unit of
    analysis is one session, so the export shape matches: dump one file
    per session and concatenate off-box if you want a corpus.

    The previous bulk export (every session in one response) is gone:
    at study scale the response was multi-MB JSON the browser then had
    to hold in memory, and one bad session could corrupt the whole
    dump. Per-session is bounded by the longest session and
    fail-isolated.
    """
    if not (disk_session_io.SESSIONS_DIR / sid).exists():
        raise HTTPException(status_code=404, detail="session not found")
    events = read_events(sid)
    payload = {
        "summary": _summarize_session(sid),
        # Per-part study measures (segmentation, manual-vs-AI edit share,
        # refines/reverts/coexistent widgets/toggles/renames). See
        # services/study_measures.py.
        "study_measures": compute_study_measures(events),
        "events": events,
        "exported_at": datetime.now(timezone.utc).isoformat(),
    }
    return JSONResponse(
        payload,
        headers={
            "content-disposition": f'attachment; filename="session-{sid}.json"',
        },
    )


# ─── HTML cockpit ─────────────────────────────────────────────────────
# Single-page vanilla JS. Three views toggled by hash:
#   #/           → aggregate dashboard + session list
#   #/s/{sid}    → per-session detail (timeline + events + image)
# No build step. Edit-in-place is intentional.

_ADMIN_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>editor cockpit</title>
<style>
  :root {
    --bg: #0b0b0d;
    --panel: #15151a;
    --panel-hi: #1d1d24;
    --border: #28282f;
    --text: #e8e8ed;
    --text-mute: #8c8c95;
    --accent: #7c6df0;
    --ok: #4ade80;
    --warn: #fbbf24;
    --err: #f87171;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: -apple-system, "SF Pro Text", system-ui, sans-serif;
    background: var(--bg); color: var(--text); font-size: 13px;
  }
  header {
    padding: 12px 20px; border-bottom: 1px solid var(--border);
    display: flex; gap: 24px; align-items: center;
  }
  header h1 { font-size: 14px; margin: 0; font-weight: 600; }
  header a {
    color: var(--text-mute); text-decoration: none; font-size: 12px;
  }
  header a:hover { color: var(--text); }
  main { padding: 20px; max-width: 1400px; margin: 0 auto; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em;
       color: var(--text-mute); font-weight: 500; margin: 24px 0 12px; }
  .grid-stats {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px; margin-bottom: 24px;
  }
  .stat {
    background: var(--panel); border: 1px solid var(--border);
    padding: 12px 14px; border-radius: 6px;
  }
  .stat .label {
    font-size: 11px; color: var(--text-mute); text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .stat .value {
    font-size: 22px; font-variant-numeric: tabular-nums; margin-top: 4px;
  }
  .stat .sub { font-size: 11px; color: var(--text-mute); margin-top: 2px; }
  table {
    width: 100%; border-collapse: collapse; background: var(--panel);
    border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
  }
  th, td {
    padding: 8px 12px; text-align: left; font-size: 12px;
    border-bottom: 1px solid var(--border); font-variant-numeric: tabular-nums;
  }
  th {
    background: var(--panel-hi); color: var(--text-mute);
    text-transform: uppercase; letter-spacing: 0.04em; font-size: 10px;
    font-weight: 500;
  }
  tr:hover { background: var(--panel-hi); cursor: pointer; }
  tr:last-child td { border-bottom: none; }
  .row-link { color: var(--accent); }
  .pill {
    display: inline-block; padding: 1px 6px; border-radius: 3px;
    background: var(--panel-hi); color: var(--text-mute); font-size: 10px;
  }
  pre {
    background: var(--panel); border: 1px solid var(--border);
    padding: 10px; border-radius: 4px; overflow-x: auto;
    font-size: 11px; line-height: 1.5; color: var(--text);
  }
  .timeline {
    border-left: 2px solid var(--border); padding-left: 12px;
    margin-left: 8px;
  }
  .ev {
    margin-bottom: 6px; padding: 6px 8px; background: var(--panel);
    border: 1px solid var(--border); border-radius: 4px; font-size: 11px;
  }
  .ev .kind { color: var(--accent); font-weight: 500; font-family: ui-monospace, monospace; }
  .ev .ts { color: var(--text-mute); margin-left: 8px; font-size: 10px; }
  .ev pre { background: transparent; border: none; padding: 4px 0; margin: 4px 0 0; color: var(--text-mute); }
  .img-preview { max-width: 320px; max-height: 240px; border: 1px solid var(--border); border-radius: 4px; }
  .filter-bar { margin-bottom: 12px; display: flex; gap: 12px; align-items: center; }
  input, select, button {
    background: var(--panel); color: var(--text); border: 1px solid var(--border);
    padding: 5px 9px; border-radius: 4px; font-size: 12px; font-family: inherit;
  }
  button { cursor: pointer; }
  button:hover { background: var(--panel-hi); }
  .empty { color: var(--text-mute); padding: 24px; text-align: center; }
  .cost-hi { color: var(--warn); }
  .cost-vhi { color: var(--err); }
</style>
</head>
<body>
<header>
  <h1>editor cockpit</h1>
  <a href="#/">dashboard</a>
  <a id="export-csv-link" href="/admin/export.csv">export csv (all sessions)</a>
  <span style="flex:1"></span>
  <a id="refresh" href="#" onclick="route(); return false;">refresh</a>
</header>
<main id="app"></main>
<script>
const $ = (s, el = document) => el.querySelector(s);

// On hosted deploys the cockpit is opened as /admin/?token=<BACKEND_AUTH_TOKEN>.
// Carry that token onto every same-origin admin request + link so the gate
// (see _require_loopback) accepts them. Empty on loopback (no token needed).
const TOKEN = new URLSearchParams(location.search).get('token') || '';
function withTok(path) {
  if (!TOKEN) return path;
  return path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN);
}

async function fetchJSON(path) {
  const r = await fetch(withTok(path));
  if (!r.ok) throw new Error(path + ' → ' + r.status);
  return r.json();
}

function fmtBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function fmtMoney(n) {
  if (!n) return '$0';
  if (n < 0.01) return '$' + n.toFixed(4);
  if (n < 1) return '$' + n.toFixed(3);
  return '$' + n.toFixed(2);
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

function fmtRel(ts) {
  if (!ts) return '—';
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function fmtDuration(s) {
  if (!s) return '0s';
  if (s < 60) return s.toFixed(0) + 's';
  if (s < 3600) return (s / 60).toFixed(1) + 'm';
  return (s / 3600).toFixed(2) + 'h';
}

async function dashboard() {
  const app = $('#app');
  app.innerHTML = '<div class="empty">Loading…</div>';
  // Carry the token onto the static export link too (server-rendered href).
  const csv = $('#export-csv-link');
  if (csv) csv.href = withTok('/admin/export.csv');
  const [agg, list, ps] = await Promise.all([
    fetchJSON('/admin/aggregate'),
    fetchJSON('/admin/sessions?limit=200'),
    fetchJSON('/admin/process_stats?limit=120'),
  ]);

  if (agg.empty) {
    app.innerHTML = '<div class="empty">No sessions yet. Open the editor and upload an image to start.</div>';
    return;
  }

  const stats = [
    ['Sessions',            agg.sessions, ''],
    ['Unique users',        agg.users, ''],
    ['Total cost',          fmtMoney(agg.total_cost_usd), ''],
    ['Input tokens',        agg.total_input_tokens.toLocaleString(), ''],
    ['Output tokens',       agg.total_output_tokens.toLocaleString(), ''],
    ['Cache reads',         agg.total_cache_read_tokens.toLocaleString(), ''],
    ['Prompts entered',     agg.prompts_entered, ''],
    ['Widgets proposed',    agg.widgets_proposed, ''],
    ['Widgets applied',     agg.widgets_applied,
      agg.acceptance_rate != null ? (agg.acceptance_rate * 100).toFixed(1) + '% accepted' : ''],
    ['Widgets dismissed',   agg.widgets_dismissed, ''],
  ];

  const psLatest = ps.samples.length ? ps.samples[ps.samples.length - 1] : null;
  if (psLatest) {
    stats.push(['RAM (RSS)', (psLatest.rss_mb || 0).toFixed(0) + ' MB',
      'system ' + (psLatest.sys_pct || 0).toFixed(0) + '% used']);
    stats.push(['CPU', (psLatest.cpu_pct || 0).toFixed(0) + '%',
      'active sessions: ' + (psLatest.active_sessions || 0)]);
  }

  let html = '<div class="grid-stats">';
  for (const [lbl, val, sub] of stats) {
    html += `<div class="stat"><div class="label">${lbl}</div><div class="value">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  }
  html += '</div>';

  if (agg.top_tools && agg.top_tools.length) {
    html += '<h2>Top tools / phases</h2><table><thead><tr><th>Tool/Phase</th><th>Calls</th></tr></thead><tbody>';
    for (const [name, n] of agg.top_tools) {
      html += `<tr onclick="event.preventDefault()"><td><span class="pill">${name}</span></td><td>${n}</td></tr>`;
    }
    html += '</tbody></table>';
  }

  html += '<h2>Sessions</h2>';
  html += '<table><thead><tr>';
  for (const h of ['Session', 'User', 'Created', 'Duration', 'Prompts', 'Widgets', 'Cost', 'Events']) {
    html += `<th>${h}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (const s of list.sessions) {
    const costCls = s.usd_cost > 0.5 ? 'cost-vhi' : (s.usd_cost > 0.1 ? 'cost-hi' : '');
    const widgets = `${s.widget_applied}/${s.widget_proposed}`;
    html += `<tr onclick="location.hash='#/s/${s.session_id}'">
      <td><span class="row-link">${s.session_id.slice(0, 8)}</span></td>
      <td>${(s.user_id || '').slice(0, 8) || '—'}</td>
      <td title="${fmtDate(s.created_at)}">${fmtRel(s.created_at)}</td>
      <td>${fmtDuration(s.duration_s)}</td>
      <td>${s.prompt_count}</td>
      <td>${widgets}</td>
      <td class="${costCls}">${fmtMoney(s.usd_cost)}</td>
      <td>${s.event_count}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  app.innerHTML = html;
}

async function sessionDetail(sid) {
  const app = $('#app');
  app.innerHTML = '<div class="empty">Loading…</div>';
  const data = await fetchJSON('/admin/sessions/' + encodeURIComponent(sid));
  const s = data.summary;
  const evs = data.events;

  let html = `<h2 style="display:flex; align-items:center; gap:12px;">
    <span>Session <span class="pill">${sid}</span></span>
    <a href="${withTok('/admin/sessions/' + sid + '/export.json')}" download
       style="font-size:11px; color:var(--accent); text-transform:none; letter-spacing:0; font-weight:400;">
      ⬇ export this session (json)
    </a>
  </h2>`;

  // Study-condition switch — flips the session's AI_access constant. AI ON =
  // analysis / command-palette AI / suggestions available; AI OFF = control.
  const aiOn = s.ai_access !== false;
  html += `<div style="margin:0 0 16px; display:flex; align-items:center; gap:10px; font-size:12px;">
    <span style="color:var(--text-mute);">AI_access (study condition):</span>
    <button id="ai-access-toggle" data-on="${aiOn ? '1' : '0'}"
      style="cursor:pointer; border:1px solid var(--border); border-radius:6px; padding:4px 12px;
             font-size:11px; font-weight:600; letter-spacing:0.3px;
             background:${aiOn ? 'var(--accent)' : 'transparent'}; color:${aiOn ? '#fff' : 'var(--text-mute)'};">
      ${aiOn ? 'AI ON' : 'AI OFF · control'}
    </button>
    <span style="color:var(--text-mute); font-size:10px;">applies to this participant — survives reloads &amp; new sessions</span>
  </div>`;

  // Left: image + summary
  html += '<div style="flex:0 0 340px;">';
  html += `<img class="img-preview" src="${withTok('/admin/sessions/' + sid + '/image')}" alt="source" onerror="this.style.display='none'" />`;
  html += '<div style="margin-top:12px;">';
  const rows = [
    ['User',        (s.user_id || '').slice(0, 12) || '—'],
    ['Created',     fmtDate(s.created_at)],
    ['Duration',    fmtDuration(s.duration_s)],
    ['Filename',    s.filename || '—'],
    ['Image size',  fmtBytes(s.image_bytes)],
    ['Prompts',     s.prompt_count],
    ['Widgets',     `${s.widget_applied}/${s.widget_proposed} (${s.widget_dismissed} dismissed)`],
    ['Cost',        fmtMoney(s.usd_cost)],
    ['Input tokens',  s.input_tokens.toLocaleString()],
    ['Output tokens', s.output_tokens.toLocaleString()],
    ['Cache reads',   s.cache_read_tokens.toLocaleString()],
    ['Events',      s.event_count],
    ['User agent',  (s.user_agent || '').slice(0, 80)],
  ];
  for (const [k, v] of rows) {
    html += `<div style="display:flex; padding:4px 0; border-bottom:1px solid var(--border); font-size:11px;">
      <span style="flex:0 0 100px; color:var(--text-mute);">${k}</span>
      <span style="flex:1;">${v}</span>
    </div>`;
  }
  if (data.live_memory) {
    html += `<div style="margin-top:12px; font-size:11px; color:var(--text-mute);">In-memory: ${fmtBytes(data.live_memory.image_bytes)} image + ${data.live_memory.history_entries} history entries</div>`;
  }
  html += '</div></div>';

  // Right: timeline
  html += '<div style="flex:1; min-width:0;">';
  html += '<div class="timeline">';
  if (evs.length === 0) {
    html += '<div class="empty">No events.</div>';
  } else {
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      const rel = i === 0 ? 0 : (ev.ts - evs[0].ts);
      const payload = JSON.stringify(ev.payload, null, 0);
      const showPayload = payload && payload !== '{}' && payload.length < 400;
      html += `<div class="ev">
        <span class="kind">${ev.kind}</span>
        <span class="ts">+${rel.toFixed(1)}s · ${new Date(ev.ts * 1000).toLocaleTimeString()}</span>
        ${showPayload ? `<pre>${payload.replace(/</g, '&lt;')}</pre>` : ''}
      </div>`;
    }
  }
  html += '</div></div>';

  html += '</div>';
  app.innerHTML = html;

  // Wire the AI_access toggle: POST the flipped value, then re-render so the
  // button reflects the new state (and the timeline shows the admin.ai_access
  // event on next load).
  const toggleBtn = document.getElementById('ai-access-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', async () => {
      const cur = toggleBtn.getAttribute('data-on') === '1';
      toggleBtn.disabled = true;
      try {
        const r = await fetch(withTok('/admin/sessions/' + encodeURIComponent(sid) + '/ai-access'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ai_access: !cur }),
        });
        if (!r.ok) throw new Error('toggle failed: ' + r.status);
        sessionDetail(sid).catch(showError);
      } catch (e) {
        toggleBtn.disabled = false;
        showError(e);
      }
    });
  }
}

function route() {
  const hash = location.hash || '#/';
  if (hash.startsWith('#/s/')) {
    sessionDetail(decodeURIComponent(hash.slice(4))).catch(showError);
  } else {
    dashboard().catch(showError);
  }
}

function showError(err) {
  $('#app').innerHTML = `<div class="empty" style="color:var(--err)">${err.message}</div>`;
}

window.addEventListener('hashchange', route);
route();
</script>
</body>
</html>
"""
