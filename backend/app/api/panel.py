from fastapi import APIRouter

router = APIRouter()


@router.post("/panel")
async def panel_stub() -> dict[str, str]:
    return {"status": "not_implemented"}
