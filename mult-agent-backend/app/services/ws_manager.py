import asyncio
import json
import logging
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """管理按 task_id 分组的 WebSocket 连接。"""

    def __init__(self):
        self._connections: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, task_id: str, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self._connections.setdefault(task_id, set()).add(ws)

    async def disconnect(self, task_id: str, ws: WebSocket):
        async with self._lock:
            conns = self._connections.get(task_id, set())
            conns.discard(ws)
            if not conns:
                self._connections.pop(task_id, None)

    async def broadcast(self, task_id: str, event: dict):
        """向监听此 task 的所有客户端推送事件。"""
        async with self._lock:
            conns = self._connections.get(task_id, set())
            if not conns:
                return

        dead = []
        message = json.dumps(event, ensure_ascii=False)
        for ws in list(conns):
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)

        if dead:
            async with self._lock:
                for ws in dead:
                    conns.discard(ws)


manager = ConnectionManager()
