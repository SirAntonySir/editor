from fastapi import APIRouter

router = APIRouter()


@router.post("/analyze")
async def analyze_stub() -> dict[str, str]:
    return {"status": "not_implemented"}
