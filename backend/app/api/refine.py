from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.post("/refine")
async def refine_stub() -> dict[str, str]:
    raise HTTPException(status_code=501, detail="refine endpoint lands in Phase 3")
