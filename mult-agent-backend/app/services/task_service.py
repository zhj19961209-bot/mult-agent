import json
from datetime import datetime
from app.config import BEIJING_TZ
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.task import Task, TaskLog, TaskResult

async def create_task(db: AsyncSession, data: dict) -> Task:
    task = Task(
        name=data["name"],
        description=data.get("description", ""),
        mode=data.get("mode", "sequential"),
        agents=json.dumps(data.get("agents", [])),
        tli_commands=json.dumps(data.get("tli_commands", [])),
        workspace_dir=data.get("workspace_dir", "") or "",
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task

async def get_tasks(db: AsyncSession, status: str | None = None) -> list[Task]:
    stmt = select(Task).order_by(Task.created_at.desc())
    if status:
        stmt = stmt.where(Task.status == status)
    result = await db.execute(stmt)
    return list(result.scalars().all())

async def get_task(db: AsyncSession, task_id: str) -> Task | None:
    return await db.get(Task, task_id)

async def update_task_status(db: AsyncSession, task_id: str, status: str, progress: int | None = None):
    task = await db.get(Task, task_id)
    if task:
        task.status = status
        if progress is not None:
            task.progress = progress
        task.updated_at = datetime.now(BEIJING_TZ).isoformat()
        await db.commit()

async def cancel_task(db: AsyncSession, task_id: str) -> bool:
    task = await db.get(Task, task_id)
    if task and task.status in ("pending", "running"):
        task.status = "cancelled"
        task.updated_at = datetime.now(BEIJING_TZ).isoformat()
        await db.commit()
        return True
    return False

async def reset_task(db: AsyncSession, task_id: str) -> bool:
    task = await db.get(Task, task_id)
    if task and task.status in ("failed", "cancelled"):
        task.status = "pending"
        task.progress = 0
        task.updated_at = datetime.now(BEIJING_TZ).isoformat()
        await db.commit()
        return True
    return False

async def write_log(db: AsyncSession, task_id: str, agent_name: str, stdout: str, stderr: str):
    log = TaskLog(task_id=task_id, agent_name=agent_name, stdout=stdout, stderr=stderr)
    db.add(log)
    await db.commit()

async def write_result(db: AsyncSession, task_id: str, agent_name: str, output: str, summary: str):
    result = TaskResult(task_id=task_id, agent_name=agent_name, output=output, summary=summary)
    db.add(result)
    await db.commit()

async def get_task_logs(db: AsyncSession, task_id: str) -> list[TaskLog]:
    stmt = select(TaskLog).where(TaskLog.task_id == task_id).order_by(TaskLog.log_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())

async def get_task_results(db: AsyncSession, task_id: str) -> list[TaskResult]:
    stmt = select(TaskResult).where(TaskResult.task_id == task_id).order_by(TaskResult.result_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())
