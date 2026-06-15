import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router as api_router
from .api.deps import get_session_store
from .config import get_app_config, get_settings
from .mcp.server import router as mcp_router

logger = logging.getLogger(__name__)


async def _disk_prune_loop(store) -> None:
    """Background task: periodically delete on-disk session directories
    whose `created_at` is older than `disk_session_max_age_s`. Without
    this, `.sessions/` grows unbounded (each entry holds source image
    bytes).
    """
    runtime = get_app_config().runtime
    interval = runtime.disk_prune_interval_s
    max_age = runtime.disk_session_max_age_s
    while True:
        await asyncio.sleep(interval)
        try:
            n = await asyncio.to_thread(store.prune_disk, max_age)
            if n:
                logger.info("disk-prune: removed %d stale sessions", n)
        except Exception:
            logger.exception("disk-prune: sweep failed")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Startup + shutdown hooks.

    On startup:
      - Revive any persisted SessionDocuments from .sessions/ so a backend
        restart resumes verbatim (per Phase 2 of the SSOT plan).
      - Start the session checkpointer's background tick so any dirty
        SessionDocument is flushed to disk within the configured interval
        (RUNTIME.checkpoint_interval_s).
      - Start the disk-pruner so stale .sessions/ entries are evicted.

    On shutdown:
      - Stop the ticks and drain any still-dirty sessions so a graceful
        shutdown doesn't lose state. `kill -9` still loses the last
        interval's worth of edits — that's what the eager flush_now path
        is reserved for.
    """
    from .session import revive

    store = get_session_store()
    revive.revive_all(store)
    await store.checkpointer.start()
    prune_task = asyncio.create_task(_disk_prune_loop(store), name="disk-pruner")
    try:
        yield
    finally:
        prune_task.cancel()
        try:
            await prune_task
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

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
