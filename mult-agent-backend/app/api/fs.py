import os
from pathlib import Path
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/fs", tags=["fs"])


def _safe_resolve(path_str: str) -> Path:
    try:
        p = Path(path_str).expanduser()
        if not p.is_absolute():
            raise ValueError("路径必须是绝对路径")
        return p.resolve()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"非法路径: {e}")


@router.get("/home")
async def get_home():
    home = str(Path.home())
    roots = [
        {"label": "Home", "path": home},
        {"label": "Documents", "path": str(Path.home() / "Documents")},
        {"label": "Desktop", "path": str(Path.home() / "Desktop")},
        {"label": "Downloads", "path": str(Path.home() / "Downloads")},
        {"label": "/", "path": "/"},
    ]
    roots = [r for r in roots if Path(r["path"]).exists()]
    return {"home": home, "roots": roots}


@router.get("/list")
async def list_dir(
    path: str = Query(..., description="绝对路径"),
    show_hidden: bool = Query(False),
):
    p = _safe_resolve(path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="路径不存在")
    if not p.is_dir():
        raise HTTPException(status_code=400, detail="路径不是目录")

    entries = []
    try:
        for child in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            if not show_hidden and child.name.startswith("."):
                continue
            try:
                is_dir = child.is_dir()
            except OSError:
                continue
            entries.append({
                "name": child.name,
                "path": str(child),
                "is_dir": is_dir,
            })
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限访问该目录")

    parent = str(p.parent) if p.parent != p else None
    return {
        "path": str(p),
        "parent": parent,
        "entries": entries,
    }
