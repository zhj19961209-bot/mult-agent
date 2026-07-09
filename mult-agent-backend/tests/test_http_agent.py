"""Unit tests for HTTPAgent: streaming chat + tool-calling loop."""
from __future__ import annotations

import json
import pytest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

from app.agents import http_agent as http_agent_module
from app.agents.http_agent import HTTPAgent, MAX_TOOL_ITERATIONS


# ---------- helpers ----------

class _FakeStreamResponse:
    """Mimic httpx streaming response context manager."""

    def __init__(self, status_code: int, lines: list[str] | None = None, body: bytes = b""):
        self.status_code = status_code
        self._lines = lines or []
        self._body = body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def aiter_lines(self):
        for line in self._lines:
            yield line

    async def aread(self):
        return self._body


class _FakePostResponse:
    def __init__(self, status_code: int, payload: dict | None = None, text: str = ""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text or json.dumps(self._payload)

    def json(self):
        return self._payload


class _FakeClient:
    """httpx.AsyncClient stand-in. `script` is a list consumed per call."""

    def __init__(self, stream_script: list | None = None, post_script: list | None = None):
        self._stream_script = list(stream_script or [])
        self._post_script = list(post_script or [])
        self.stream_calls: list[dict] = []
        self.post_calls: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    def stream(self, method, url, **kwargs):
        self.stream_calls.append({"method": method, "url": url, **kwargs})
        if not self._stream_script:
            raise AssertionError("unexpected stream() call — script exhausted")
        return self._stream_script.pop(0)

    async def post(self, url, **kwargs):
        self.post_calls.append({"url": url, **kwargs})
        if not self._post_script:
            raise AssertionError("unexpected post() call — script exhausted")
        return self._post_script.pop(0)


def _sse_lines_from_chunks(chunks: list[str]) -> list[str]:
    out = []
    for c in chunks:
        out.append(f"data: {json.dumps({'choices': [{'delta': {'content': c}}]})}")
    out.append("data: [DONE]")
    return out


# ---------- streaming chat ----------

@pytest.mark.asyncio
async def test_streaming_chat_accumulates_content(monkeypatch):
    chunks = ["Hello", " ", "world", "!"]
    fake_resp = _FakeStreamResponse(200, _sse_lines_from_chunks(chunks))
    fake_client = _FakeClient(stream_script=[fake_resp])
    monkeypatch.setattr(http_agent_module.httpx, "AsyncClient", lambda *a, **k: fake_client)

    agent = HTTPAgent(name="t", base_url="https://x/v1", model="m", api_key="sk")
    progress: list[str] = []

    async def on_progress(p):
        progress.append(p)

    result = await agent.execute({"name": "task", "description": "go"}, on_progress=on_progress)

    assert result.success is True
    assert result.stdout == "Hello world!"
    assert progress == chunks
    # Stream URL ends with /chat/completions
    assert fake_client.stream_calls[0]["url"].endswith("/chat/completions")
    # Auth header set
    assert fake_client.stream_calls[0]["headers"]["Authorization"] == "Bearer sk"


@pytest.mark.asyncio
async def test_streaming_chat_http_error_returned(monkeypatch):
    fake_resp = _FakeStreamResponse(500, body=b"server boom")
    fake_client = _FakeClient(stream_script=[fake_resp])
    monkeypatch.setattr(http_agent_module.httpx, "AsyncClient", lambda *a, **k: fake_client)

    agent = HTTPAgent(name="t", base_url="https://x/v1", model="m", api_key="sk")
    result = await agent.execute({"name": "n", "description": ""})
    assert result.success is False
    assert "HTTP 500" in result.output
    assert "server boom" in result.stderr


@pytest.mark.asyncio
async def test_missing_api_key_returns_error(monkeypatch):
    # api_key_env set but env var missing → fail without making any HTTP call
    monkeypatch.delenv("FAKE_KEY", raising=False)
    agent = HTTPAgent(name="t", base_url="https://x/v1", model="m", api_key_env="FAKE_KEY")
    result = await agent.execute({"name": "n", "description": ""})
    assert result.success is False
    assert "FAKE_KEY" in result.stderr


@pytest.mark.asyncio
async def test_empty_stream_returns_failure(monkeypatch):
    fake_resp = _FakeStreamResponse(200, [])  # no chunks
    fake_client = _FakeClient(stream_script=[fake_resp])
    monkeypatch.setattr(http_agent_module.httpx, "AsyncClient", lambda *a, **k: fake_client)
    agent = HTTPAgent(name="t", base_url="https://x/v1", model="m", api_key="sk")
    result = await agent.execute({"name": "n", "description": ""})
    assert result.success is False
    assert "无输出" in result.output


# ---------- tool-calling loop ----------

@pytest.fixture
def patch_mcp(monkeypatch):
    """Patch agent_registry.get_agent_config and mcp_manager with controllable mocks."""
    from app.services import agent_registry

    mcp_session = MagicMock()
    mcp_session.tools = [
        {"name": "fetch", "description": "Fetch URL", "inputSchema": {"type": "object", "properties": {"url": {"type": "string"}}}},
    ]

    async def fake_get_or_start(name, cfg):
        return mcp_session

    call_log: list[tuple[str, str, dict]] = []

    async def fake_call_tool(server, tool, args):
        call_log.append((server, tool, args))
        return {"content": [{"type": "text", "text": f"result of {tool}({args})"}], "isError": False}

    monkeypatch.setattr(http_agent_module.mcp_manager, "get_or_start", fake_get_or_start)
    monkeypatch.setattr(http_agent_module.mcp_manager, "call_tool", fake_call_tool)
    monkeypatch.setattr(
        agent_registry, "get_agent_config",
        lambda name: {"name": name, "type": "mcp"} if name == "fetch-mcp" else None,
    )
    return {"session": mcp_session, "call_log": call_log}


@pytest.mark.asyncio
async def test_tool_loop_no_tools_available_falls_back_to_streaming(monkeypatch, patch_mcp):
    # No tools on the session — agent should call _streaming_chat
    patch_mcp["session"].tools = []
    chunks = ["fallback text"]
    fake_resp = _FakeStreamResponse(200, _sse_lines_from_chunks(chunks))
    fake_client = _FakeClient(stream_script=[fake_resp])
    monkeypatch.setattr(http_agent_module.httpx, "AsyncClient", lambda *a, **k: fake_client)

    agent = HTTPAgent(name="t", base_url="https://x/v1", model="m", api_key="sk", mcp_tools=["fetch-mcp"])
    result = await agent.execute({"name": "n", "description": "d"})
    assert result.success is True
    assert "fallback text" in result.stdout


@pytest.mark.asyncio
async def test_tool_loop_immediate_text_answer(monkeypatch, patch_mcp):
    # Model returns content without tool_calls → terminate immediately
    fake_post = _FakePostResponse(200, {
        "choices": [{"message": {"role": "assistant", "content": "hi there"}}],
    })
    fake_client = _FakeClient(post_script=[fake_post])
    monkeypatch.setattr(http_agent_module.httpx, "AsyncClient", lambda *a, **k: fake_client)

    agent = HTTPAgent(name="t", base_url="https://x/v1", model="m", api_key="sk", mcp_tools=["fetch-mcp"])
    result = await agent.execute({"name": "n", "description": "d"})
    assert result.success is True
    assert "hi there" in result.stdout
    assert patch_mcp["call_log"] == []
    # Tools schema must have been sent
    body = fake_client.post_calls[0]["json"]
    assert body["tools"][0]["function"]["name"] == "fetch_mcp__fetch"  # hyphen normalized to underscore


@pytest.mark.asyncio
async def test_tool_loop_executes_tool_call_then_returns_final(monkeypatch, patch_mcp):
    # 1st call: model emits tool_calls
    # 2nd call: model returns final text
    fake1 = _FakePostResponse(200, {
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "",
                "tool_calls": [{
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "fetch_mcp__fetch", "arguments": '{"url":"https://example.com"}'},
                }],
            },
        }],
    })
    fake2 = _FakePostResponse(200, {
        "choices": [{"message": {"role": "assistant", "content": "ok done"}}],
    })
    fake_client = _FakeClient(post_script=[fake1, fake2])
    monkeypatch.setattr(http_agent_module.httpx, "AsyncClient", lambda *a, **k: fake_client)

    agent = HTTPAgent(name="t", base_url="https://x/v1", model="m", api_key="sk", mcp_tools=["fetch-mcp"])
    progress: list[str] = []

    async def on_progress(p):
        progress.append(p)

    result = await agent.execute({"name": "n", "description": "d"}, on_progress=on_progress)

    assert result.success is True
    # Tool was called against the right server and raw tool name (namespace stripped)
    assert patch_mcp["call_log"] == [("fetch-mcp", "fetch", {"url": "https://example.com"})]
    # Final text appears
    assert "ok done" in result.stdout
    # Trace lines surfaced in progress
    assert any("fetch-mcp::fetch" in p for p in progress)
    # Second call's messages should include assistant + tool message
    body2 = fake_client.post_calls[1]["json"]
    roles = [m["role"] for m in body2["messages"]]
    assert "assistant" in roles
    assert "tool" in roles


@pytest.mark.asyncio
async def test_tool_loop_max_iterations_terminates(monkeypatch, patch_mcp):
    # Model keeps emitting tool_calls forever — agent must stop at MAX_TOOL_ITERATIONS
    def always_tool_call_response():
        return _FakePostResponse(200, {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": "call_x",
                        "type": "function",
                        "function": {"name": "fetch_mcp__fetch", "arguments": "{}"},
                    }],
                },
            }],
        })

    fake_client = _FakeClient(post_script=[always_tool_call_response() for _ in range(MAX_TOOL_ITERATIONS + 2)])
    monkeypatch.setattr(http_agent_module.httpx, "AsyncClient", lambda *a, **k: fake_client)

    agent = HTTPAgent(name="t", base_url="https://x/v1", model="m", api_key="sk", mcp_tools=["fetch-mcp"])
    result = await agent.execute({"name": "n", "description": "d"})

    assert result.success is False
    assert "迭代上限" in result.output
    # Exactly MAX_TOOL_ITERATIONS POST calls were made
    assert len(fake_client.post_calls) == MAX_TOOL_ITERATIONS
    assert len(patch_mcp["call_log"]) == MAX_TOOL_ITERATIONS


@pytest.mark.asyncio
async def test_tool_loop_unknown_tool_name_returns_error_message(monkeypatch, patch_mcp):
    # Model invokes a tool whose namespaced name isn't in name_map
    fake1 = _FakePostResponse(200, {
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "",
                "tool_calls": [{
                    "id": "c1",
                    "type": "function",
                    "function": {"name": "ghost_tool", "arguments": "{}"},
                }],
            },
        }],
    })
    fake2 = _FakePostResponse(200, {"choices": [{"message": {"role": "assistant", "content": "stop"}}]})
    fake_client = _FakeClient(post_script=[fake1, fake2])
    monkeypatch.setattr(http_agent_module.httpx, "AsyncClient", lambda *a, **k: fake_client)

    agent = HTTPAgent(name="t", base_url="https://x/v1", model="m", api_key="sk", mcp_tools=["fetch-mcp"])
    result = await agent.execute({"name": "n", "description": "d"})

    assert result.success is True
    # MCP call_tool was NOT invoked
    assert patch_mcp["call_log"] == []
    # Tool result message contains the error
    tool_msg = next(m for m in fake_client.post_calls[1]["json"]["messages"] if m["role"] == "tool")
    assert "未知工具" in tool_msg["content"]
