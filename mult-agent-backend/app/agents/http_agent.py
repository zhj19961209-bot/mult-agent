import json
import logging
import os
from typing import Optional, Callable, Awaitable

import httpx

from app.agents.base import BaseAgent, AgentResult
from app.services.mcp_manager import mcp_manager

logger = logging.getLogger(__name__)

TOOL_SEPARATOR = "__"
MAX_TOOL_ITERATIONS = 10


class HTTPAgent(BaseAgent):
    """OpenAI 兼容协议的 HTTP Agent。

    支持 DeepSeek、Qwen、Kimi、智谱 GLM、本地 vLLM 等任何兼容
    /v1/chat/completions 协议的服务。

    - 未配置 mcp_tools：流式输出纯文本，每个 chunk 调 on_progress
    - 配置了 mcp_tools：进入 tool-calling loop（非流式），模型自主决定调哪个
      MCP 工具，工具名通过 "{server}__{tool}" 命名空间隔离
    """

    def __init__(
        self,
        name: str,
        base_url: str,
        model: str,
        api_key_env: str = "",
        api_key: str = "",
        system_prompt: str = "",
        role_hint: str = "",
        temperature: float = 0.7,
        max_tokens: int = 4096,
        timeout: int = 300,
        extra_headers: Optional[dict] = None,
        mcp_tools: Optional[list[str]] = None,
    ):
        super().__init__(name)
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key_env = api_key_env
        self.api_key = api_key
        self.system_prompt = system_prompt
        self.role_hint = role_hint
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout = timeout
        self.extra_headers = extra_headers or {}
        self.mcp_tools = list(mcp_tools or [])

    def _resolve_api_key(self) -> str:
        if self.api_key:
            return self.api_key
        if self.api_key_env:
            return os.environ.get(self.api_key_env, "")
        return ""

    def _build_messages(self, task_context: dict, history: str) -> list[dict]:
        name = task_context.get("name", "unknown")
        description = task_context.get("description", "")
        chain = task_context.get("chain_context", "")
        knowledge = task_context.get("knowledge", "")
        collab_system = task_context.get("collab_system", "")
        inbox = task_context.get("inbox") or []
        round_idx = task_context.get("round")

        messages: list[dict] = []
        sys_parts = []
        if self.system_prompt:
            sys_parts.append(self.system_prompt)
        if self.role_hint:
            sys_parts.append(self.role_hint)
        if collab_system:
            sys_parts.append(collab_system)
        if knowledge:
            sys_parts.append(knowledge)
        if sys_parts:
            messages.append({"role": "system", "content": "\n\n".join(sys_parts)})

        if history:
            messages.append({"role": "user", "content": f"{history}\n\n请基于以上对话历史回答最新的问题。"})
            return messages

        # Collaborative mode: inject inbox as prior turns so the model sees actual chat
        if inbox:
            for m in inbox:
                target = "所有人" if m.get("to_agent") is None else f"@{m['to_agent']}"
                role = "user" if m.get("from_agent") != self.name else "assistant"
                messages.append({
                    "role": role,
                    "content": f"[@{m['from_agent']} → {target}]\n{m.get('content', '')}",
                })

        if chain and not inbox:
            user_text = (
                f"任务：{name}\n描述：{description}\n\n"
                f"上一阶段输出：\n{chain}\n\n请基于以上输出继续执行并产出你的结果。"
            )
        elif inbox:
            round_hint = f"（第 {round_idx + 1} 轮）" if round_idx is not None else ""
            user_text = (
                f"任务：{name}\n描述：{description}\n\n"
                f"以上是队友们的最新发言{round_hint}，请基于这些回应继续推进任务。"
            )
        else:
            user_text = f"任务：{name}\n描述：{description}\n\n请执行此任务并输出结果。"
        messages.append({"role": "user", "content": user_text})
        return messages

    async def _build_openai_tools(self) -> tuple[list[dict], dict[str, tuple[str, str]]]:
        """从配置的 MCP server 拉取工具，转 OpenAI tools schema。

        返回 (tools_schema, name_map)；name_map: 命名空间名 -> (server, tool)。
        """
        tools_schema: list[dict] = []
        name_map: dict[str, tuple[str, str]] = {}
        for server_name in self.mcp_tools:
            from app.services.agent_registry import get_agent_config
            cfg = get_agent_config(server_name)
            if not cfg or cfg.get("type") != "mcp":
                logger.warning(f"HTTPAgent[{self.name}]: mcp_tools 包含的 '{server_name}' 不是 MCP agent，已跳过")
                continue
            try:
                sess = await mcp_manager.get_or_start(server_name, cfg)
            except Exception as e:
                logger.warning(f"HTTPAgent[{self.name}]: MCP server {server_name} 启动失败: {e}")
                continue
            for t in sess.tools:
                raw_name = t.get("name", "")
                if not raw_name:
                    continue
                ns_name = f"{server_name}{TOOL_SEPARATOR}{raw_name}"
                # OpenAI 函数名限制：1-64 chars, [a-zA-Z0-9_-]
                ns_name = ns_name.replace("-", "_")[:64]
                schema = t.get("inputSchema") or t.get("input_schema") or {"type": "object", "properties": {}}
                tools_schema.append({
                    "type": "function",
                    "function": {
                        "name": ns_name,
                        "description": t.get("description", "")[:1024],
                        "parameters": schema,
                    },
                })
                name_map[ns_name] = (server_name, raw_name)
        return tools_schema, name_map

    async def execute(
        self,
        task_context: dict,
        history: str = "",
        on_progress: Optional[Callable[[str], Awaitable[None]]] = None,
    ) -> AgentResult:
        api_key = self._resolve_api_key()
        if not api_key and self.api_key_env:
            return AgentResult(
                agent_name=self.name,
                success=False,
                output=f"[{self.name}] 未配置 API Key（环境变量 {self.api_key_env} 为空）",
                summary="缺少 API Key",
                stderr=f"missing env: {self.api_key_env}",
            )

        messages = self._build_messages(task_context, history)

        if self.mcp_tools:
            return await self._tool_calling_loop(messages, api_key, on_progress)
        return await self._streaming_chat(messages, api_key, on_progress)

    def _http_headers(self, api_key: str, accept_sse: bool) -> dict:
        h = {
            "Content-Type": "application/json",
            **self.extra_headers,
        }
        if accept_sse:
            h["Accept"] = "text/event-stream"
        if api_key:
            h["Authorization"] = f"Bearer {api_key}"
        return h

    async def _streaming_chat(
        self,
        messages: list[dict],
        api_key: str,
        on_progress: Optional[Callable[[str], Awaitable[None]]],
    ) -> AgentResult:
        url = f"{self.base_url}/chat/completions"
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "stream": True,
        }
        chunks: list[str] = []
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream(
                    "POST", url, headers=self._http_headers(api_key, accept_sse=True), json=payload
                ) as resp:
                    if resp.status_code >= 400:
                        body = (await resp.aread()).decode("utf-8", errors="replace")
                        return AgentResult(
                            agent_name=self.name,
                            success=False,
                            output=f"[{self.name}] HTTP {resp.status_code}: {body[:500]}",
                            summary=f"HTTP {resp.status_code}",
                            stderr=body[:2000],
                        )
                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if not data or data == "[DONE]":
                            continue
                        try:
                            obj = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        choices = obj.get("choices") or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta") or {}
                        piece = delta.get("content") or ""
                        if piece:
                            chunks.append(piece)
                            if on_progress:
                                await on_progress(piece)
        except httpx.TimeoutException:
            return AgentResult(
                agent_name=self.name, success=False,
                output=f"[{self.name}] 请求超时 ({self.timeout}s)",
                summary="请求超时", stderr=f"timeout: {self.timeout}s",
            )
        except Exception as e:
            return AgentResult(
                agent_name=self.name, success=False,
                output=f"[{self.name}] 执行异常: {str(e)[:500]}",
                summary="执行失败", stderr=str(e)[:2000],
            )
        full_text = "".join(chunks).strip()
        if not full_text:
            return AgentResult(
                agent_name=self.name, success=False,
                output=f"[{self.name}] 无输出", summary="模型未返回内容",
            )
        return AgentResult(
            agent_name=self.name, success=True,
            output=full_text[:4000], summary=full_text[:1000],
            stdout=full_text, stderr="",
        )

    async def _tool_calling_loop(
        self,
        messages: list[dict],
        api_key: str,
        on_progress: Optional[Callable[[str], Awaitable[None]]],
    ) -> AgentResult:
        url = f"{self.base_url}/chat/completions"
        tools_schema, name_map = await self._build_openai_tools()
        if not tools_schema:
            if on_progress:
                await on_progress(f"[{self.name}] 未发现可用 MCP 工具，退化为纯文本对话\n")
            return await self._streaming_chat(messages, api_key, on_progress)

        if on_progress:
            await on_progress(
                f"[{self.name}] tool-calling loop 启用：{len(tools_schema)} 个工具 "
                f"({', '.join(self.mcp_tools)})\n"
            )

        trace_lines: list[str] = []
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for iteration in range(MAX_TOOL_ITERATIONS):
                payload = {
                    "model": self.model,
                    "messages": messages,
                    "temperature": self.temperature,
                    "max_tokens": self.max_tokens,
                    "tools": tools_schema,
                    "stream": False,
                }
                try:
                    resp = await client.post(
                        url, headers=self._http_headers(api_key, accept_sse=False), json=payload
                    )
                except httpx.TimeoutException:
                    return AgentResult(
                        agent_name=self.name, success=False,
                        output=f"[{self.name}] 请求超时 ({self.timeout}s)",
                        summary="请求超时", stderr=f"timeout: {self.timeout}s",
                    )
                except Exception as e:
                    return AgentResult(
                        agent_name=self.name, success=False,
                        output=f"[{self.name}] 网络异常: {str(e)[:500]}",
                        summary="网络异常", stderr=str(e)[:2000],
                    )
                if resp.status_code >= 400:
                    body = resp.text
                    return AgentResult(
                        agent_name=self.name, success=False,
                        output=f"[{self.name}] HTTP {resp.status_code}: {body[:500]}",
                        summary=f"HTTP {resp.status_code}", stderr=body[:2000],
                    )
                data = resp.json()
                choices = data.get("choices") or []
                if not choices:
                    break
                msg = choices[0].get("message") or {}
                tool_calls = msg.get("tool_calls") or []
                content = msg.get("content") or ""

                if not tool_calls:
                    # 模型给出最终答复
                    final = content.strip()
                    if on_progress and final:
                        await on_progress(final)
                    transcript = ("\n".join(trace_lines) + ("\n\n" if trace_lines else "")) + final
                    return AgentResult(
                        agent_name=self.name, success=True,
                        output=transcript[:4000], summary=final[:1000] or transcript[:1000],
                        stdout=transcript, stderr="",
                    )

                # 把 assistant 消息（含 tool_calls）压回 messages
                messages.append({
                    "role": "assistant",
                    "content": content,
                    "tool_calls": tool_calls,
                })

                # 执行每个 tool_call
                for tc in tool_calls:
                    tc_id = tc.get("id") or ""
                    fn = tc.get("function") or {}
                    fn_name = fn.get("name") or ""
                    fn_args_raw = fn.get("arguments") or "{}"
                    try:
                        fn_args = json.loads(fn_args_raw) if isinstance(fn_args_raw, str) else fn_args_raw
                    except json.JSONDecodeError:
                        fn_args = {}

                    target = name_map.get(fn_name)
                    if not target:
                        tool_result = f"[error] 未知工具 {fn_name}"
                    else:
                        server, raw_tool = target
                        line = f"→ {server}::{raw_tool}({json.dumps(fn_args, ensure_ascii=False)[:200]})"
                        trace_lines.append(line)
                        if on_progress:
                            await on_progress(line + "\n")
                        try:
                            mcp_res = await mcp_manager.call_tool(server, raw_tool, fn_args)
                            content_parts = mcp_res.get("content") or []
                            text_parts = []
                            for cp in content_parts:
                                if isinstance(cp, dict) and cp.get("type") == "text":
                                    text_parts.append(cp.get("text", ""))
                                else:
                                    text_parts.append(json.dumps(cp, ensure_ascii=False))
                            tool_result = "\n".join(text_parts) or json.dumps(mcp_res, ensure_ascii=False)
                            if mcp_res.get("isError"):
                                tool_result = f"[tool error] {tool_result}"
                        except Exception as e:
                            tool_result = f"[tool exception] {str(e)[:500]}"
                        preview = tool_result[:200].replace("\n", " ")
                        trace_lines.append(f"← {preview}")
                        if on_progress:
                            await on_progress(f"← {preview}\n")

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc_id,
                        "content": tool_result[:8000],
                    })

        # 超过迭代上限
        final = f"[{self.name}] 达到 tool-calling 迭代上限 ({MAX_TOOL_ITERATIONS})"
        if on_progress:
            await on_progress(final + "\n")
        transcript = "\n".join(trace_lines) + "\n" + final
        return AgentResult(
            agent_name=self.name, success=False,
            output=transcript[:4000], summary=final, stdout=transcript,
            stderr="max iterations exceeded",
        )
