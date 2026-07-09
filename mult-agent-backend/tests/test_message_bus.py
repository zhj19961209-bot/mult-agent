"""Unit tests for MessageBus + collaborative scheduler bits."""
from __future__ import annotations

import asyncio
import pytest
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models.task import Base
from app.services.message_bus import MessageBus, get_bus, drop_bus
from app.services.scheduler import _dispatch_mentions, _format_inbox


@pytest.fixture
async def db_factory():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    def factory():
        return Session()

    yield factory
    await engine.dispose()


@pytest.mark.asyncio
async def test_post_persists_and_appears_in_inbox(db_factory):
    bus = MessageBus("task-1", db_factory)
    await bus.post(from_agent="claude", content="hi codex", to="codex", round=0)
    await bus.post(from_agent="claude", content="hi all", to=None, round=0)
    # Codex inbox: directed + broadcast
    codex_inbox = await bus.inbox("codex")
    assert len(codex_inbox) == 2
    # Depk inbox: only the broadcast (not the directed one)
    depk_inbox = await bus.inbox("depk")
    assert len(depk_inbox) == 1
    assert depk_inbox[0]["content"] == "hi all"
    # Sender doesn't see own messages
    claude_inbox = await bus.inbox("claude")
    assert claude_inbox == []


@pytest.mark.asyncio
async def test_inbox_filtered_by_since_round(db_factory):
    bus = MessageBus("task-2", db_factory)
    await bus.post(from_agent="a", content="round0", to=None, round=0)
    await bus.post(from_agent="a", content="round1", to=None, round=1)
    after_r0 = await bus.inbox("b", since_round=0)
    assert len(after_r0) == 1
    assert after_r0[0]["content"] == "round1"


@pytest.mark.asyncio
async def test_post_empty_content_is_skipped(db_factory):
    bus = MessageBus("task-3", db_factory)
    await bus.post(from_agent="a", content="   ", to=None, round=0)
    assert await bus.all_messages() == []


@pytest.mark.asyncio
async def test_load_from_db_rehydrates(db_factory):
    bus1 = MessageBus("task-4", db_factory)
    await bus1.post(from_agent="a", content="persisted", to=None, round=0)

    # New bus instance for same task should load existing rows
    bus2 = MessageBus("task-4", db_factory)
    await bus2.load_from_db()
    msgs = await bus2.all_messages()
    assert len(msgs) == 1
    assert msgs[0]["content"] == "persisted"


@pytest.mark.asyncio
async def test_dispatch_mentions_parses_directed_and_broadcast(db_factory):
    bus = MessageBus("task-5", db_factory)
    stdout = """这是给所有人看的开头。
@codex: 帮我写一个冒泡排序
@depk: 评审一下
中间的正文
@invalid_name_with_at@: 不是合法 mention
结尾"""
    await _dispatch_mentions(bus, "claude", stdout, round=2)
    msgs = await bus.all_messages()
    # Two directed messages
    directed = [m for m in msgs if m["to_agent"] is not None]
    assert len(directed) == 2
    targets = sorted(m["to_agent"] for m in directed)
    assert targets == ["codex", "depk"]
    # One broadcast for the leftover text
    broadcast = [m for m in msgs if m["to_agent"] is None]
    assert len(broadcast) == 1
    assert "中间的正文" in broadcast[0]["content"]
    assert "@codex:" not in broadcast[0]["content"]
    assert "@depk:" not in broadcast[0]["content"]


@pytest.mark.asyncio
async def test_dispatch_mentions_only_pure_broadcast(db_factory):
    bus = MessageBus("task-6", db_factory)
    await _dispatch_mentions(bus, "claude", "no mentions just text", round=0)
    msgs = await bus.all_messages()
    assert len(msgs) == 1
    assert msgs[0]["to_agent"] is None
    assert msgs[0]["from_agent"] == "claude"


@pytest.mark.asyncio
async def test_dispatch_mentions_lowercase_target(db_factory):
    """target name should be lowercased to match agent name keys"""
    bus = MessageBus("task-7", db_factory)
    await _dispatch_mentions(bus, "claude", "@Codex: hi", round=0)
    msgs = await bus.all_messages()
    directed = [m for m in msgs if m["to_agent"] is not None]
    assert directed[0]["to_agent"] == "codex"


def test_format_inbox_renders_conversation():
    inbox = [
        {"from_agent": "claude", "to_agent": None, "content": "all hands", "round": 0},
        {"from_agent": "depk", "to_agent": "codex", "content": "please refactor", "round": 0},
    ]
    out = _format_inbox(inbox)
    assert "@claude" in out and "→所有人" in out
    assert "@depk" in out and "→@codex" in out
    assert "please refactor" in out


def test_get_bus_returns_same_instance_and_drop_clears():
    def fake_factory():  # unused
        pass
    b1 = get_bus("task-x", fake_factory)
    b2 = get_bus("task-x", fake_factory)
    assert b1 is b2
    drop_bus("task-x")
    b3 = get_bus("task-x", fake_factory)
    assert b3 is not b1
    drop_bus("task-x")
