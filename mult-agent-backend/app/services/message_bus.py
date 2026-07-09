"""Per-task in-memory message bus that also persists to DB and broadcasts via WS.

每个 collaborative 任务有一个 MessageBus 实例。Agent 通过：
- task_context["inbox"] 读取上一轮发给自己（或广播）的消息
- task_context["bus_post"](content, to=None, topic=None) 主动发消息
- 或在输出文本里用 `@AgentName: ...` 语法（scheduler 解析后调 bus.post）
"""

from __future__ import annotations

import asyncio
from typing import Optional

from sqlalchemy import select

from app.models.task import AgentMessage
from app.services.ws_manager import manager as ws_manager


class MessageBus:
    def __init__(self, task_id: str, db_session_factory):
        self.task_id = task_id
        self._db_factory = db_session_factory
        self._messages: list[dict] = []
        self._lock = asyncio.Lock()

    async def load_from_db(self) -> None:
        """启动时一次性把 DB 里已存在的消息读回内存。"""
        async with self._db_factory() as db:
            stmt = select(AgentMessage).where(AgentMessage.task_id == self.task_id).order_by(AgentMessage.id)
            rows = (await db.execute(stmt)).scalars().all()
            self._messages = [self._row_to_dict(r) for r in rows]

    async def post(
        self,
        from_agent: str,
        content: str,
        to: Optional[str] = None,
        topic: Optional[str] = None,
        round: int = 0,
    ) -> dict:
        """Append a message to bus + DB + broadcast via WS. Returns the message dict."""
        if not content or not content.strip():
            return {}
        async with self._db_factory() as db:
            row = AgentMessage(
                task_id=self.task_id,
                round=round,
                from_agent=from_agent,
                to_agent=to,
                topic=topic,
                content=content,
            )
            db.add(row)
            await db.commit()
            await db.refresh(row)
            msg = self._row_to_dict(row)
        async with self._lock:
            self._messages.append(msg)
        await ws_manager.broadcast(self.task_id, {"type": "message", **msg})
        return msg

    async def inbox(self, agent_name: str, since_round: int = -1) -> list[dict]:
        """Messages addressed to this agent (or broadcast), strictly after since_round.
        since_round=-1 means all rounds."""
        async with self._lock:
            return [
                m for m in self._messages
                if (m["to_agent"] == agent_name or m["to_agent"] is None)
                and m["from_agent"] != agent_name
                and (since_round == -1 or m["round"] > since_round)
            ]

    async def all_messages(self) -> list[dict]:
        async with self._lock:
            return list(self._messages)

    async def count_in_round(self, round: int) -> int:
        async with self._lock:
            return sum(1 for m in self._messages if m["round"] == round)

    @staticmethod
    def _row_to_dict(row: AgentMessage) -> dict:
        return {
            "id": row.id,
            "task_id": row.task_id,
            "round": row.round,
            "from_agent": row.from_agent,
            "to_agent": row.to_agent,
            "topic": row.topic,
            "content": row.content,
            "created_at": row.created_at,
        }


# Per-task bus registry — keeps the bus alive for the lifetime of the task run
_buses: dict[str, MessageBus] = {}


def get_bus(task_id: str, db_factory) -> MessageBus:
    bus = _buses.get(task_id)
    if bus is None:
        bus = MessageBus(task_id, db_factory)
        _buses[task_id] = bus
    return bus


def drop_bus(task_id: str) -> None:
    _buses.pop(task_id, None)
