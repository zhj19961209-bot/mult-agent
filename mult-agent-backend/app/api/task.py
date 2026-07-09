import asyncio as aio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.database.setup import get_db, AsyncSessionLocal
from app.models.task import AgentMessage
from app.schemas.task import (
    TaskCreateRequest, TaskResponse, TaskDetailResponse,
    ContinueRequest, AgentMessageResponse, ApprovalRequest
)
from app.services import task_service
from app.services.scheduler import schedule_task, cancel_running_task
from app.services.agent_registry import get_agent_cls
from app.services.profile_service import load_profile, extract_and_update
from app.services.task_service import reset_task as svc_reset_task
from app.agents.cli_agent import get_pending_approval

router = APIRouter(prefix="/task", tags=["task"])

@router.post("", response_model=TaskResponse, status_code=201)
async def create_task(req: TaskCreateRequest, db: AsyncSession = Depends(get_db)):
    data = req.model_dump()
    profile = load_profile()
    if profile:
        data["description"] = f"[系统上下文]\n{profile}\n\n[任务]\n{data['description']}"
    task = await task_service.create_task(db, data)
    schedule_task(task.task_id, AsyncSessionLocal)
    return TaskResponse.from_model(task)

@router.get("", response_model=list[TaskResponse])
async def list_tasks(status: str | None = None, db: AsyncSession = Depends(get_db)):
    tasks = await task_service.get_tasks(db, status)
    return [TaskResponse.from_model(t) for t in tasks]

@router.get("/{task_id}", response_model=TaskDetailResponse)
async def get_task_detail(task_id: str, db: AsyncSession = Depends(get_db)):
    task = await task_service.get_task(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    logs = await task_service.get_task_logs(db, task_id)
    results = await task_service.get_task_results(db, task_id)
    resp = TaskDetailResponse.from_model(task)
    resp.logs = [
        {"log_id": l.log_id, "agent_name": l.agent_name, "stdout": l.stdout, "stderr": l.stderr, "timestamp": l.timestamp}
        for l in logs
    ]
    resp.results = [
        {"result_id": r.result_id, "agent_name": r.agent_name, "output": r.output, "summary": r.summary, "created_at": r.created_at}
        for r in results
    ]
    return resp


@router.get("/{task_id}/messages", response_model=list[AgentMessageResponse])
async def get_task_messages(task_id: str, db: AsyncSession = Depends(get_db)):
    task = await task_service.get_task(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    stmt = select(AgentMessage).where(AgentMessage.task_id == task_id).order_by(AgentMessage.id)
    rows = (await db.execute(stmt)).scalars().all()
    return [
        AgentMessageResponse(
            id=r.id, task_id=r.task_id, round=r.round, from_agent=r.from_agent,
            to_agent=r.to_agent, topic=r.topic, content=r.content, created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("/{task_id}/cancel")
async def cancel_task(task_id: str, db: AsyncSession = Depends(get_db)):
    cancelled = cancel_running_task(task_id)
    if not cancelled:
        db_cancelled = await task_service.cancel_task(db, task_id)
        if not db_cancelled:
            raise HTTPException(status_code=400, detail="任务无法取消（不在待执行或执行中状态）")
    return {"message": "任务已取消", "task_id": task_id}

@router.post("/{task_id}/retry")
async def retry_task(task_id: str, db: AsyncSession = Depends(get_db)):
    ok = await svc_reset_task(db, task_id)
    if not ok:
        raise HTTPException(status_code=400, detail="只能重试失败或已取消的任务")
    schedule_task(task_id, AsyncSessionLocal)
    return {"message": "任务已重新调度", "task_id": task_id}


@router.post("/{task_id}/approve")
async def approve_task(task_id: str, req: ApprovalRequest, db: AsyncSession = Depends(get_db)):
    """Submit user approval response to a paused CLI agent."""
    task = await task_service.get_task(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    pending = get_pending_approval(task_id)
    if not pending:
        raise HTTPException(status_code=400, detail="当前没有待审核请求")

    pending.submit_response(req.response)
    return {"message": "审核响应已提交", "task_id": task_id}


@router.post("/{task_id}/continue", response_model=TaskDetailResponse)
async def continue_task(task_id: str, req: ContinueRequest, db: AsyncSession = Depends(get_db)):
    task = await task_service.get_task(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    agent = get_agent_cls(req.agent)
    if not agent:
        raise HTTPException(status_code=400, detail=f"不支持的 Agent: {req.agent}")

    # Save user question as a message
    await task_service.write_result(db, task_id, "user", req.question, req.question)

    # Build conversation history with profile context
    profile = load_profile()
    results = await task_service.get_task_results(db, task_id)
    history_parts = []
    if profile:
        history_parts.append(f"[系统上下文]\n{profile}\n")
    history_parts.append(f"用户：{task.description}")
    for r in results:
        if r.agent_name == "user":
            history_parts.append(f"用户：{r.summary}")
        else:
            history_parts.append(f"助手({r.agent_name})：{r.summary}")
    history = "\n".join(history_parts)

    # Execute agent with history
    import json
    task_context = {
        "name": task.name,
        "description": task.description,
        "tli_commands": task.tli_commands,
        "workspace_dir": getattr(task, "workspace_dir", "") or "",
    }

    result = await agent.execute(task_context, history)
    await task_service.write_log(db, task_id, agent.name, result.stdout, result.stderr)
    await task_service.write_result(db, task_id, agent.name, result.output, result.summary)

    # Async extract profile (fire-and-forget, does not block response)
    aio.create_task(extract_and_update(history + f"\n助手({agent.name})：{result.summary}"))

    # Return updated detail
    logs = await task_service.get_task_logs(db, task_id)
    results = await task_service.get_task_results(db, task_id)
    resp = TaskDetailResponse.from_model(task)
    resp.logs = [
        {"log_id": l.log_id, "agent_name": l.agent_name, "stdout": l.stdout, "stderr": l.stderr, "timestamp": l.timestamp}
        for l in logs
    ]
    resp.results = [
        {"result_id": r.result_id, "agent_name": r.agent_name, "output": r.output, "summary": r.summary, "created_at": r.created_at}
        for r in results
    ]
    return resp
