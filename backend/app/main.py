import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router as api_router
from .api.admin import router as admin_router
from .api.deps import get_session_store
from .config import get_app_config, get_settings
from .mcp.server import router as mcp_router

logger = logging.getLogger(__name__)


async def _session_prune_loop(store) -> None:
    """Background task: periodically evict session state older than
    `disk_session_max_age_s` — both the in-memory records map (which
    holds source image bytes) and the on-disk `.sessions/` directories.
    Without this both grow unbounded for sessions the user abandons.
    """
    runtime = get_app_config().runtime
    interval = runtime.disk_prune_interval_s
    max_age = runtime.disk_session_max_age_s
    while True:
        await asyncio.sleep(interval)
        try:
            mem = await asyncio.to_thread(store.prune_memory, max_age)
            disk = await asyncio.to_thread(store.prune_disk, max_age)
            if mem or disk:
                logger.info(
                    "session-prune: evicted %d in-memory, removed %d on-disk",
                    mem, disk,
                )
        except Exception:
            logger.exception("session-prune: sweep failed")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Startup + shutdown hooks.

    On startup:
      - Revive any persisted SessionDocuments from .sessions/ so a backend
        restart resumes verbatim (per Phase 2 of the SSOT plan).
      - Start the session checkpointer's background tick so any dirty
        SessionDocument is flushed to disk within the configured interval
        (RUNTIME.checkpoint_interval_s).
      - Start the session-pruner so stale in-memory records and
        .sessions/ entries are evicted.

    On shutdown:
      - Stop the ticks and drain any still-dirty sessions so a graceful
        shutdown doesn't lose state. `kill -9` still loses the last
        interval's worth of edits — that's what the eager flush_now path
        is reserved for.
    """
    from .services import process_stats
    from .session import revive

    store = get_session_store()
    revive.revive_all(store)
    await store.checkpointer.start()
    prune_task = asyncio.create_task(
        _session_prune_loop(store), name="session-pruner",
    )
    stats_task = asyncio.create_task(
        process_stats.stats_loop(store), name="process-stats",
    )
    try:
        yield
    finally:
        for t in (prune_task, stats_task):
            t.cancel()
        for t in (prune_task, stats_task):
            try:
                await t
            except asyncio.CancelledError:
                pass
        await store.checkpointer.stop()


def create_app() -> FastAPI:
    # Surface our app-namespace loggers in the uvicorn console — uvicorn's
    # default config only emits its own loggers, so analyse-time diagnostics
    # (Claude coord values, refinement decisions, etc.) get swallowed otherwise.
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
    settings = get_settings()
    app = FastAPI(title="editor-backend", version="0.1.0", lifespan=lifespan)
    origins = settings.origins_list
    if not origins:
        logger.warning(
            "No ALLOWED_ORIGINS configured — CORS will reject all cross-origin requests. "
            "Set ALLOWED_ORIGINS=http://localhost:5173 for local dev."
        )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["POST", "GET", "OPTIONS"],
        allow_headers=["*"],
    )
    app.include_router(api_router)
    app.include_router(mcp_router)
    # Admin cockpit — mounted at /admin, gated by a per-route loopback
    # check (see api/admin.py). Do not tunnel /admin/* publicly.
    app.include_router(admin_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
