"""Unit tests for MCPManager: auto-restart, throttling, session death cleanup."""
from __future__ import annotations

import asyncio
import time
import pytest

from app.services import mcp_manager as mcp_manager_module
from app.services.mcp_manager import MCPManager, MCPSession


class _FakeTransport:
    """Pretends to be _StdioTransport. The session uses our `_on_message` callback
    to resolve futures; we never actually emit messages, so we patch _initialize
    and _refresh_tools to no-ops to skip RPC."""

    def __init__(self):
        self.running = True
        self.stopped = False

    async def stop(self):
        self.stopped = True
        self.running = False

    async def send(self, payload):
        return None


@pytest.fixture
def patched_session(monkeypatch):
    """Make MCPSession.start_stdio create a _FakeTransport and skip RPC handshake."""

    async def fake_start_stdio(self, command, args, env=None, cwd=None):
        self._transport = _FakeTransport()
        self.last_started_at = time.time()
        self._initialized = True
        self._tools = [{"name": "ping", "description": "p", "inputSchema": {}}]

    monkeypatch.setattr(MCPSession, "start_stdio", fake_start_stdio)
    yield


@pytest.mark.asyncio
async def test_manager_starts_and_caches_session(patched_session):
    mgr = MCPManager()
    cfg = {"transport": "stdio", "command": "fake"}
    sess1 = await mgr.start("alpha", cfg)
    assert mgr.is_running("alpha")
    sess2 = await mgr.get_or_start("alpha", cfg)
    assert sess1 is sess2  # cached


@pytest.mark.asyncio
async def test_dead_session_transparent_restart(patched_session, monkeypatch):
    mgr = MCPManager()
    cfg = {"transport": "stdio", "command": "fake"}
    sess1 = await mgr.start("beta", cfg)
    # Simulate transport death
    await sess1._on_died("simulated crash")
    sess1._transport.running = False
    assert not mgr.is_running("beta")
    assert sess1.last_error == "simulated crash"

    # Force restart window to be in the past so throttle doesn't fire
    sess1.last_started_at = time.time() - 100

    sess2 = await mgr.get_or_start("beta", cfg)
    assert sess2 is not sess1
    assert mgr.is_running("beta")
    assert sess2.restart_count == 1


@pytest.mark.asyncio
async def test_restart_throttle_blocks_hot_restart(patched_session):
    mgr = MCPManager()
    cfg = {"transport": "stdio", "command": "fake"}
    sess1 = await mgr.start("gamma", cfg)
    # Make it appear dead
    await sess1._on_died("crash")
    sess1._transport.running = False
    # last_started_at is "just now" — restart should be throttled
    with pytest.raises(RuntimeError, match="重启窗口"):
        await mgr.get_or_start("gamma", cfg)


@pytest.mark.asyncio
async def test_died_callback_fails_pending_futures(patched_session):
    mgr = MCPManager()
    cfg = {"transport": "stdio", "command": "fake"}
    sess = await mgr.start("delta", cfg)
    # Inject a pending future
    loop = asyncio.get_event_loop()
    fut = loop.create_future()
    sess._pending[42] = fut
    await sess._on_died("boom")
    assert fut.done() and fut.exception() is not None
    assert "boom" in str(fut.exception())
    assert sess._pending == {}


@pytest.mark.asyncio
async def test_failed_start_keeps_session_with_last_error(monkeypatch):
    """If start_stdio raises, session is preserved in dict with last_error set."""

    async def boom_start_stdio(self, command, args, env=None, cwd=None):
        raise RuntimeError("cannot spawn")

    monkeypatch.setattr(MCPSession, "start_stdio", boom_start_stdio)

    mgr = MCPManager()
    cfg = {"transport": "stdio", "command": "fake"}
    with pytest.raises(RuntimeError, match="cannot spawn"):
        await mgr.start("epsilon", cfg)
    sess = mgr.get_session("epsilon")
    assert sess is not None
    assert not sess.running
    assert "cannot spawn" in sess.last_error
