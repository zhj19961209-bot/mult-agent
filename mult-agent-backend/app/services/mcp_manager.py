"""MCP (Model Context Protocol) server manager.

支持 stdio 和 SSE 两种 transport，通过 JSON-RPC 与 MCP server 通信。
协议参考: https://spec.modelcontextprotocol.io/specification/
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shlex
import time
from typing import Optional, Awaitable, Callable
from urllib.parse import urljoin, urlparse

import httpx

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = "2024-11-05"
INIT_TIMEOUT = 30.0
CALL_TIMEOUT = 120.0
RESTART_MIN_INTERVAL = 5.0  # seconds — avoid hot-restart loops


class _StdioTransport:
    def __init__(
        self,
        name: str,
        on_message: Callable[[dict], Awaitable[None]],
        on_died: Optional[Callable[[str], Awaitable[None]]] = None,
    ):
        self.name = name
        self.on_message = on_message
        self.on_died = on_died
        self.proc: Optional[asyncio.subprocess.Process] = None
        self._reader_task: Optional[asyncio.Task] = None
        self._stderr_task: Optional[asyncio.Task] = None
        self._write_lock = asyncio.Lock()
        self.stderr_log: list[str] = []
        self._stopping = False

    @property
    def running(self) -> bool:
        return self.proc is not None and self.proc.returncode is None

    async def start(self, command: str, args: list[str], env: Optional[dict] = None,
                    cwd: Optional[str] = None) -> None:
        full_env = dict(os.environ)
        if env:
            full_env.update({k: str(v) for k, v in env.items() if v is not None})
        self.proc = await asyncio.create_subprocess_exec(
            command, *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=full_env, cwd=cwd,
        )
        self._reader_task = asyncio.create_task(self._read_loop())
        self._stderr_task = asyncio.create_task(self._read_stderr())

    async def stop(self) -> None:
        self._stopping = True
        if self.proc and self.proc.returncode is None:
            try:
                self.proc.terminate()
                try:
                    await asyncio.wait_for(self.proc.wait(), timeout=5.0)
                except asyncio.TimeoutError:
                    self.proc.kill()
                    await self.proc.wait()
            except ProcessLookupError:
                pass
        for t in (self._reader_task, self._stderr_task):
            if t:
                t.cancel()
        self.proc = None

    async def send(self, payload: dict) -> None:
        assert self.proc and self.proc.stdin
        data = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
        async with self._write_lock:
            self.proc.stdin.write(data)
            await self.proc.stdin.drain()

    async def _read_loop(self) -> None:
        assert self.proc and self.proc.stdout
        try:
            while True:
                line = await self.proc.stdout.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line.decode("utf-8", errors="replace"))
                except json.JSONDecodeError:
                    logger.debug(f"MCP[{self.name}] 非 JSON 行: {line[:200]!r}")
                    continue
                await self.on_message(msg)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"MCP[{self.name}] stdio read loop error: {e}")
        finally:
            if not self._stopping and self.on_died:
                # Process closed stdout — gather diagnostics and notify session
                rc = self.proc.returncode if self.proc else None
                tail = "\n".join(self.stderr_log[-10:]) if self.stderr_log else ""
                reason = f"stdio process exited (rc={rc})"
                if tail:
                    reason += f"\n--- stderr tail ---\n{tail}"
                try:
                    await self.on_died(reason)
                except Exception:
                    pass

    async def _read_stderr(self) -> None:
        assert self.proc and self.proc.stderr
        try:
            while True:
                line = await self.proc.stderr.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").rstrip()
                self.stderr_log.append(text)
                if len(self.stderr_log) > 500:
                    self.stderr_log = self.stderr_log[-300:]
                logger.debug(f"MCP[{self.name}] stderr: {text}")
        except asyncio.CancelledError:
            pass


class _SSETransport:
    """SSE transport for MCP.

    旧版规范：GET /sse 建立事件流；首条 `event: endpoint` 告知 POST URL；
    后续 `event: message` 携带 JSON-RPC 响应；客户端把请求 POST 到 endpoint。
    """

    def __init__(
        self,
        name: str,
        on_message: Callable[[dict], Awaitable[None]],
        on_died: Optional[Callable[[str], Awaitable[None]]] = None,
    ):
        self.name = name
        self.on_message = on_message
        self.on_died = on_died
        self._client: Optional[httpx.AsyncClient] = None
        self._sse_task: Optional[asyncio.Task] = None
        self._endpoint_url: Optional[str] = None
        self._endpoint_ready = asyncio.Event()
        self._running = False
        self._sse_url: str = ""
        self._stopping = False

    @property
    def running(self) -> bool:
        return self._running

    async def start(self, sse_url: str, timeout: float = 300.0) -> None:
        self._sse_url = sse_url
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(timeout, read=None))
        self._running = True
        self._sse_task = asyncio.create_task(self._read_loop())
        try:
            await asyncio.wait_for(self._endpoint_ready.wait(), timeout=INIT_TIMEOUT)
        except asyncio.TimeoutError:
            await self.stop()
            raise RuntimeError("SSE endpoint 未在超时内就绪")

    async def stop(self) -> None:
        self._stopping = True
        self._running = False
        if self._sse_task:
            self._sse_task.cancel()
        if self._client:
            await self._client.aclose()
            self._client = None

    async def send(self, payload: dict) -> None:
        if not self._client or not self._endpoint_url:
            raise RuntimeError("SSE endpoint 未就绪")
        resp = await self._client.post(
            self._endpoint_url,
            json=payload,
            headers={"Content-Type": "application/json"},
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"SSE POST {resp.status_code}: {resp.text[:200]}")

    async def _read_loop(self) -> None:
        assert self._client
        reason = ""
        try:
            async with self._client.stream(
                "GET", self._sse_url,
                headers={"Accept": "text/event-stream"},
            ) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", errors="replace")
                    reason = f"SSE 连接失败 {resp.status_code}: {body[:200]}"
                    logger.error(f"MCP[{self.name}] {reason}")
                    return
                event = ""
                data_lines: list[str] = []
                async for line in resp.aiter_lines():
                    if line == "":
                        if event and data_lines:
                            await self._dispatch(event, "\n".join(data_lines))
                        event = ""
                        data_lines = []
                        continue
                    if line.startswith(":"):
                        continue
                    if line.startswith("event:"):
                        event = line[6:].strip()
                    elif line.startswith("data:"):
                        data_lines.append(line[5:].lstrip())
            reason = reason or "SSE stream closed by peer"
        except asyncio.CancelledError:
            pass
        except Exception as e:
            reason = f"SSE read loop error: {e}"
            logger.error(f"MCP[{self.name}] {reason}")
        finally:
            self._running = False
            if not self._stopping and self.on_died and reason:
                try:
                    await self.on_died(reason)
                except Exception:
                    pass

    async def _dispatch(self, event: str, data: str) -> None:
        if event == "endpoint":
            # 解析出 POST 目标，可能是相对路径
            base = self._sse_url
            self._endpoint_url = urljoin(base, data.strip())
            self._endpoint_ready.set()
            logger.info(f"MCP[{self.name}] SSE endpoint: {self._endpoint_url}")
            return
        if event in ("message", ""):
            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                logger.debug(f"MCP[{self.name}] SSE 非 JSON data: {data[:200]!r}")
                return
            await self.on_message(msg)


class MCPSession:
    """单个 MCP server 的会话，独立于 transport。"""

    def __init__(self, name: str):
        self.name = name
        self._next_id = 1
        self._pending: dict[int, asyncio.Future] = {}
        self._tools: list[dict] = []
        self._initialized = False
        self._transport: Optional[_StdioTransport | _SSETransport] = None
        self.last_error: str = ""
        self.restart_count: int = 0
        self.last_started_at: float = 0.0

    @property
    def running(self) -> bool:
        return self._transport is not None and self._transport.running

    @property
    def stderr_log(self) -> list[str]:
        if isinstance(self._transport, _StdioTransport):
            return self._transport.stderr_log
        return []

    async def _on_died(self, reason: str) -> None:
        """Called by transport when the underlying process/stream dies unexpectedly."""
        self.last_error = reason
        self._initialized = False
        logger.warning(f"MCP[{self.name}] 异常终止: {reason}")
        # 让所有 pending 请求快速失败，避免永久挂起
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(RuntimeError(f"MCP session died: {reason[:200]}"))
        self._pending.clear()

    async def start_stdio(self, command: str, args: list[str], env: Optional[dict] = None,
                          cwd: Optional[str] = None) -> None:
        t = _StdioTransport(self.name, self._on_message, on_died=self._on_died)
        await t.start(command, args, env=env, cwd=cwd)
        self._transport = t
        self.last_started_at = time.time()
        try:
            await self._initialize()
            await self._refresh_tools()
        except Exception as e:
            self.last_error = f"initialize failed: {e}"
            await self.stop()
            raise

    async def start_sse(self, sse_url: str, timeout: float = 300.0) -> None:
        t = _SSETransport(self.name, self._on_message, on_died=self._on_died)
        await t.start(sse_url, timeout=timeout)
        self._transport = t
        self.last_started_at = time.time()
        try:
            await self._initialize()
            await self._refresh_tools()
        except Exception as e:
            self.last_error = f"initialize failed: {e}"
            await self.stop()
            raise

    async def stop(self) -> None:
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(RuntimeError("MCP session stopped"))
        self._pending.clear()
        if self._transport:
            await self._transport.stop()
        self._initialized = False
        self._transport = None

    async def _initialize(self) -> None:
        result = await self._request(
            "initialize",
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "mult-agent-backend", "version": "0.1.0"},
            },
            timeout=INIT_TIMEOUT,
        )
        await self._notify("notifications/initialized", {})
        self._initialized = True
        logger.info(f"MCP[{self.name}] 初始化完成: {result.get('serverInfo', {})}")

    async def _refresh_tools(self) -> None:
        try:
            res = await self._request("tools/list", {}, timeout=CALL_TIMEOUT)
            self._tools = res.get("tools", []) or []
        except Exception as e:
            logger.warning(f"MCP[{self.name}] tools/list 失败: {e}")
            self._tools = []

    @property
    def tools(self) -> list[dict]:
        return list(self._tools)

    async def call_tool(self, tool_name: str, arguments: dict) -> dict:
        if not self._initialized:
            raise RuntimeError(f"MCP[{self.name}] 未初始化")
        return await self._request(
            "tools/call",
            {"name": tool_name, "arguments": arguments or {}},
            timeout=CALL_TIMEOUT,
        )

    async def _on_message(self, msg: dict) -> None:
        mid = msg.get("id")
        if mid is not None and mid in self._pending:
            fut = self._pending.pop(mid)
            if "error" in msg:
                fut.set_exception(RuntimeError(json.dumps(msg["error"])))
            else:
                fut.set_result(msg.get("result", {}))

    async def _request(self, method: str, params: dict, timeout: float = CALL_TIMEOUT) -> dict:
        if not self._transport:
            raise RuntimeError("MCP transport 未启动")
        msg_id = self._next_id
        self._next_id += 1
        payload = {"jsonrpc": "2.0", "id": msg_id, "method": method, "params": params}
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[msg_id] = fut
        try:
            await self._transport.send(payload)
            return await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            self._pending.pop(msg_id, None)
            raise RuntimeError(f"MCP {method} 超时 ({timeout}s)")

    async def _notify(self, method: str, params: dict) -> None:
        if not self._transport:
            return
        payload = {"jsonrpc": "2.0", "method": method, "params": params}
        await self._transport.send(payload)


class MCPManager:
    """所有 MCP server 会话的注册中心。"""

    def __init__(self):
        self._sessions: dict[str, MCPSession] = {}
        self._lock = asyncio.Lock()

    def is_running(self, name: str) -> bool:
        sess = self._sessions.get(name)
        return sess is not None and sess.running

    def get_session(self, name: str) -> Optional[MCPSession]:
        return self._sessions.get(name)

    async def start(self, name: str, cfg: dict) -> MCPSession:
        async with self._lock:
            existing = self._sessions.get(name)
            if existing and existing.running:
                return existing

            previous_restart_count = 0
            if existing is not None:
                # 旧 session 存在但已死：节流 + 清理 + 计数
                if existing.last_started_at:
                    elapsed = time.time() - existing.last_started_at
                    if elapsed < RESTART_MIN_INTERVAL:
                        raise RuntimeError(
                            f"MCP[{name}] 上次启动 {elapsed:.1f}s 前，"
                            f"距重启窗口还需 {RESTART_MIN_INTERVAL - elapsed:.1f}s。"
                            f"上次错误: {existing.last_error[:200]}"
                        )
                previous_restart_count = existing.restart_count
                try:
                    await existing.stop()
                except Exception:
                    pass

            transport = cfg.get("transport", "stdio")
            sess = MCPSession(name)
            sess.restart_count = previous_restart_count + (1 if existing else 0)
            try:
                if transport == "stdio":
                    command = cfg.get("command")
                    if not command:
                        raise ValueError("MCP Agent 必须指定 command")
                    args = cfg.get("mcp_args") or []
                    if isinstance(args, str):
                        args = shlex.split(args)
                    env_spec = cfg.get("env") or {}
                    resolved_env = {}
                    for k, v in env_spec.items():
                        if k.endswith("_ENV") and isinstance(v, str):
                            resolved_env[k[:-4]] = os.environ.get(v, "")
                        else:
                            resolved_env[k] = v
                    cwd = cfg.get("workspace_dir") or None
                    await sess.start_stdio(command, args, env=resolved_env, cwd=cwd)
                elif transport == "sse":
                    sse_url = (cfg.get("sse_url") or "").strip()
                    if not sse_url:
                        raise ValueError("SSE MCP Agent 必须指定 sse_url")
                    parsed = urlparse(sse_url)
                    if parsed.scheme not in ("http", "https"):
                        raise ValueError("sse_url 必须是 http/https")
                    await sess.start_sse(sse_url, timeout=cfg.get("timeout", 300))
                else:
                    raise NotImplementedError(f"transport={transport} 暂未支持")
            except Exception as e:
                # 把死掉的 session 留在 dict 里，便于诊断 last_error，但 running=False
                sess.last_error = sess.last_error or str(e)
                self._sessions[name] = sess
                raise
            self._sessions[name] = sess
            return sess

    async def stop(self, name: str) -> None:
        async with self._lock:
            sess = self._sessions.pop(name, None)
        if sess:
            await sess.stop()

    async def stop_all(self) -> None:
        async with self._lock:
            names = list(self._sessions.keys())
        for n in names:
            await self.stop(n)

    async def get_or_start(self, name: str, cfg: dict) -> MCPSession:
        sess = self._sessions.get(name)
        if sess and sess.running:
            return sess
        # 已存在但已死 → 透明重启（受 RESTART_MIN_INTERVAL 节流保护）
        return await self.start(name, cfg)

    async def list_tools(self, name: str) -> list[dict]:
        sess = self._sessions.get(name)
        if not sess or not sess.running:
            return []
        return sess.tools

    async def call_tool(self, name: str, tool_name: str, arguments: dict) -> dict:
        sess = self._sessions.get(name)
        if not sess or not sess.running:
            raise RuntimeError(f"MCP[{name}] 未运行，请先调用 start")
        return await sess.call_tool(tool_name, arguments)


mcp_manager = MCPManager()
