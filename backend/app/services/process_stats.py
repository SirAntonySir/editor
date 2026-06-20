"""Process-wide resource snapshots for the admin cockpit.

Samples RAM (RSS), CPU, and active-session counts every
``PROCESS_STATS_INTERVAL_S`` seconds; appends each sample to
``.sessions/process_stats.jsonl``. The cockpit's aggregate dashboard
plots from this file.

Per-session RAM is approximated by reading the in-memory record sizes
on demand (admin endpoint, not the tick) — psutil cannot attribute
heap bytes to logical sessions, so a precise figure isn't worth the
overhead.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import psutil
except ImportError:  # pragma: no cover - optional during tests
    psutil = None  # type: ignore[assignment]

from app.services import disk_session_io

logger = logging.getLogger(__name__)

PROCESS_STATS_INTERVAL_S = 30.0


def _stats_path() -> Path:
    return disk_session_io.SESSIONS_DIR / "process_stats.jsonl"


def sample() -> dict:
    """Take one snapshot. Returns the dict that gets written to disk."""
    now_ts = time.time()
    payload: dict = {
        "ts": now_ts,
        "iso": datetime.now(timezone.utc).isoformat(),
    }
    if psutil is not None:
        try:
            proc = psutil.Process()
            with proc.oneshot():
                mem = proc.memory_info()
                payload["rss_mb"] = round(mem.rss / (1024 * 1024), 1)
                payload["vms_mb"] = round(mem.vms / (1024 * 1024), 1)
                # cpu_percent needs a baseline call; the loop primes it on
                # startup so subsequent samples report meaningful deltas.
                payload["cpu_pct"] = proc.cpu_percent(interval=None)
                payload["num_threads"] = proc.num_threads()
            sysmem = psutil.virtual_memory()
            payload["sys_avail_mb"] = round(sysmem.available / (1024 * 1024), 1)
            payload["sys_pct"] = sysmem.percent
        except Exception:  # noqa: BLE001
            logger.exception("process_stats: psutil sample failed")
    return payload


def write_sample(extra: dict | None = None) -> None:
    """Take a sample and append it to the stats journal. `extra` is
    merged in (used by the loop to attach active-session count)."""
    try:
        path = _stats_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = sample()
        if extra:
            payload.update(extra)
        line = json.dumps(payload, separators=(",", ":")) + "\n"
        with path.open("a", encoding="utf-8") as fp:
            fp.write(line)
    except Exception:  # noqa: BLE001
        logger.exception("process_stats: failed to write sample")


def read_samples(limit: int = 2880) -> list[dict]:
    """Read the most recent N samples. Default 2880 = 24h at 30s tick."""
    path = _stats_path()
    if not path.exists():
        return []
    out: list[dict] = []
    try:
        with path.open("r", encoding="utf-8") as fp:
            for line in fp:
                line = line.strip()
                if not line:
                    continue
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        logger.exception("process_stats: failed to read")
        return []
    if len(out) > limit:
        out = out[-limit:]
    return out


async def stats_loop(store) -> None:
    """Background task: tick every PROCESS_STATS_INTERVAL_S, sample
    process metrics + active-session count, append to the journal.

    Prime cpu_percent once at start so the first real sample carries a
    meaningful delta (psutil.cpu_percent's first call returns 0.0).
    """
    if psutil is not None:
        try:
            psutil.Process().cpu_percent(interval=None)
        except Exception:  # noqa: BLE001
            pass
    while True:
        await asyncio.sleep(PROCESS_STATS_INTERVAL_S)
        try:
            await asyncio.to_thread(
                write_sample,
                {"active_sessions": len(store._records)},
            )
        except Exception:  # noqa: BLE001
            logger.exception("process_stats: tick failed")
