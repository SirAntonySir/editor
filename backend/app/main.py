import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router as api_router
from .api.deps import get_session_store
from .config import get_settings
from .mcp.server import router as mcp_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Startup + shutdown hooks.

    On startup:
      - Revive any persisted SessionDocuments from .sessions/ so a backend
        restart resumes verbatim (per Phase 2 of the SSOT plan).
      - Start the session checkpointer's background tick so any dirty
        SessionDocument is flushed to disk within the configured interval
        (RUNTIME.checkpoint_interval_s).

    On shutdown:
      - Stop the tick and drain any still-dirty sessions so a graceful
        shutdown doesn't lose state. `kill -9` still loses the last
        interval's worth of edits — that's what the eager flush_now path
        is reserved for.
    """
    from .session import revive

    store = get_session_store()
    revive.revive_all(store)
    await store.checkpointer.start()
    try:
        yield
    finally:
        await store.checkpointer.stop()


def create_app() -> FastAPI:
    # Surface our app-namespace loggers in the uvicorn console — uvicorn's
    # default config only emits its own loggers, so analyse-time diagnostics
    # (Claude coord values, refinement decisions, etc.) get swallowed otherwise.
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
    settings = get_settings()
    app = FastAPI(title="editor-backend", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins_list,
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
