from fastapi import APIRouter

from . import analyze, panel, raw, refine, segment, session, state, telemetry, tools_rest

router = APIRouter(prefix="/api")
router.include_router(session.router)
router.include_router(analyze.router)
router.include_router(panel.router)
router.include_router(raw.router)
router.include_router(refine.router)
router.include_router(segment.router)
router.include_router(state.router)
router.include_router(telemetry.router)
router.include_router(tools_rest.router)
