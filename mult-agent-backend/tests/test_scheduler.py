import json
import pytest
from unittest.mock import patch
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
from app.agents.base import BaseAgent, AgentResult
from app.models.task import Task
from app.services.task_service import create_task, get_task
from app.services.scheduler import run_task, AGENT_REGISTRY

class _FakeAgent(BaseAgent):
    def __init__(self, name="fake"):
        super().__init__(name)

    async def execute(self, task_context: dict, history: str = "") -> AgentResult:
        return AgentResult(
            agent_name=self.name,
            success=True,
            output=f"[{self.name}] done",
            summary=f"{self.name} completed",
            stdout="ok",
            stderr="",
        )

FAKE_REGISTRY = {
    "codex": lambda: _FakeAgent("codex"),
    "claude": lambda: _FakeAgent("claude"),
    "tli": lambda: _FakeAgent("tli"),
}

@pytest.mark.asyncio
async def test_sequential_execution(engine):
    AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with AsyncSessionLocal() as db:
        task = await create_task(db, {
            "name": "顺序执行测试",
            "mode": "sequential",
            "agents": ["codex", "claude"],
        })
        task_id = task.task_id

    with patch.dict("app.services.scheduler.AGENT_REGISTRY", FAKE_REGISTRY, clear=True):
        await run_task(task_id, AsyncSessionLocal)

    async with AsyncSessionLocal() as db:
        task = await get_task(db, task_id)
        assert task.status == "completed"
        assert task.progress == 100

@pytest.mark.asyncio
async def test_parallel_execution(engine):
    AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with AsyncSessionLocal() as db:
        task = await create_task(db, {
            "name": "并行执行测试",
            "mode": "parallel",
            "agents": ["codex", "claude"],
        })
        task_id = task.task_id

    with patch.dict("app.services.scheduler.AGENT_REGISTRY", FAKE_REGISTRY, clear=True):
        await run_task(task_id, AsyncSessionLocal)

    async with AsyncSessionLocal() as db:
        task = await get_task(db, task_id)
        assert task.status == "completed"
        assert task.progress == 100
