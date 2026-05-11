from fastapi import APIRouter

from . import analyze, panel, refine, session

router = APIRouter(prefix="/api")
router.include_router(session.router)
router.include_router(analyze.router)
router.include_router(panel.router)
router.include_router(refine.router)
