from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.profile_service import USER_FILE, SOUL_FILE

router = APIRouter(prefix="/profile", tags=["profile"])


class ProfileResponse(BaseModel):
    user: str
    soul: str


class ProfileUpdate(BaseModel):
    user: str = ""
    soul: str = ""


def _read(path) -> str:
    if path.exists():
        content = path.read_text("utf-8").strip()
        return content if content else ""
    return ""


@router.get("", response_model=ProfileResponse)
async def get_profile():
    return ProfileResponse(user=_read(USER_FILE), soul=_read(SOUL_FILE))


@router.put("", response_model=ProfileResponse)
async def update_profile(body: ProfileUpdate):
    try:
        USER_FILE.parent.mkdir(parents=True, exist_ok=True)
        if body.user:
            USER_FILE.write_text(body.user.strip() + "\n", "utf-8")
        if body.soul:
            SOUL_FILE.write_text(body.soul.strip() + "\n", "utf-8")
        return ProfileResponse(user=body.user.strip(), soul=body.soul.strip())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存失败: {e}")
