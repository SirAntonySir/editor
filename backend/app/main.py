import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import router as api_router
from .config import get_settings


def create_app() -> FastAPI:
    # Surface our app-namespace loggers in the uvicorn console — uvicorn's
    # default config only emits its own loggers, so analyse-time diagnostics
    # (Claude coord values, refinement decisions, etc.) get swallowed otherwise.
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
    settings = get_settings()
    app = FastAPI(title="editor-backend", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins_list,
        allow_credentials=False,
        allow_methods=["POST", "GET", "OPTIONS"],
        allow_headers=["*"],
    )
    app.include_router(api_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
