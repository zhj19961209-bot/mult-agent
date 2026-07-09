from fastapi import APIRouter, Query, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.setup import get_db
from app.services.knowledge_service import (
    add_feedback,
    search_knowledge,
    get_knowledge_count,
    get_all_knowledge,
    delete_knowledge,
)

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


class FeedbackRequest(BaseModel):
    task_id: str
    agent_name: str
    output: str
    summary: str
    question: str = ""
    feedback: str  # "positive" | "negative"


@router.get("")
async def query_knowledge(
    q: str = Query(default="", description="搜索关键词"),
    db: AsyncSession = Depends(get_db),
):
    if q:
        entries = await search_knowledge(db, q)
    else:
        entries = await get_all_knowledge(db)
    count = await get_knowledge_count(db)
    return {"entries": entries, "total": count}


@router.post("/feedback")
async def submit_feedback(req: FeedbackRequest, db: AsyncSession = Depends(get_db)):
    if req.feedback not in ("positive", "negative"):
        raise HTTPException(status_code=400, detail="feedback 必须是 positive 或 negative")
    entry = await add_feedback(
        db=db,
        task_id=req.task_id,
        agent_name=req.agent_name,
        output=req.output,
        summary=req.summary,
        question=req.question,
        feedback=req.feedback,
    )
    return {"id": entry.id, "feedback": entry.feedback}


@router.delete("/{knowledge_id}")
async def remove_knowledge(knowledge_id: int, db: AsyncSession = Depends(get_db)):
    ok = await delete_knowledge(db, knowledge_id)
    if not ok:
        raise HTTPException(status_code=404, detail="条目不存在")
    return {"message": "已删除", "id": knowledge_id}
