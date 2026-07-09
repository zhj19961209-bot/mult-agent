"""MCP 类型 Agent。

执行模式：
  - 显式调用：task_context 提供 mcp_tool + mcp_arguments，直接调对应工具
  - 自省模式：未指定 tool 时返回 server 暴露的工具列表（方便调试）

后续扩展：接 HTTPAgent 做 tool-calling loop，让模型自主决定调哪个工具。
"""

import json
from typing import Optional, Callable, Awaitable

from app.agents.base import BaseAgent, AgentResult
from app.services.mcp_manager import mcp_manager


def _content_to_text(content: list[dict]) -> str:
    parts = []
    for item in content or []:
        if not isinstance(item, dict):
            continue
        ctype = item.get("type")
        if ctype == "text":
            parts.append(item.get("text", ""))
        elif ctype == "image":
            parts.append(f"[image:{item.get('mimeType', 'unknown')}]")
        elif ctype == "resource":
            res = item.get("resource", {})
            parts.append(f"[resource:{res.get('uri', '')}]")
        else:
            parts.append(json.dumps(item, ensure_ascii=False))
    return "\n".join(p for p in parts if p)


class MCPAgent(BaseAgent):
    def __init__(self, name: str, cfg: dict):
        super().__init__(name)
        self.cfg = cfg

    async def execute(
        self,
        task_context: dict,
        history: str = "",
        on_progress: Optional[Callable[[str], Awaitable[None]]] = None,
    ) -> AgentResult:
        try:
            sess = await mcp_manager.get_or_start(self.name, self.cfg)
        except Exception as e:
            return AgentResult(
                agent_name=self.name,
                success=False,
                output=f"[{self.name}] MCP server 启动失败: {e}",
                summary="MCP 启动失败",
                stderr=str(e),
            )

        tool_name = (task_context.get("mcp_tool") or "").strip()
        if not tool_name:
            tools = sess.tools
            if not tools:
                return AgentResult(
                    agent_name=self.name,
                    success=True,
                    output=f"[{self.name}] MCP server 已连接，但未暴露任何工具",
                    summary="无可用工具",
                )
            listing = "\n".join(
                f"- {t.get('name')}: {t.get('description', '')[:120]}"
                for t in tools
            )
            text = f"[{self.name}] MCP server 已连接，可用工具：\n{listing}\n\n请在 task_context.mcp_tool 中指定要调用的工具名，并通过 mcp_arguments 传参。"
            if on_progress:
                await on_progress(text)
            return AgentResult(
                agent_name=self.name,
                success=True,
                output=text[:4000],
                summary=f"已连接，{len(tools)} 个工具可用",
                stdout=text,
            )

        arguments = task_context.get("mcp_arguments") or {}
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except json.JSONDecodeError:
                arguments = {"input": arguments}

        if on_progress:
            await on_progress(f"[{self.name}] 调用工具 {tool_name}...\n")
        try:
            result = await sess.call_tool(tool_name, arguments)
        except Exception as e:
            return AgentResult(
                agent_name=self.name,
                success=False,
                output=f"[{self.name}] 工具调用失败: {e}",
                summary="工具调用失败",
                stderr=str(e),
            )

        is_error = bool(result.get("isError"))
        content = result.get("content") or []
        text = _content_to_text(content) or json.dumps(result, ensure_ascii=False)[:1000]
        if on_progress:
            await on_progress(text + "\n")
        return AgentResult(
            agent_name=self.name,
            success=not is_error,
            output=text[:4000],
            summary=text[:1000],
            stdout=text,
            stderr="" if not is_error else text,
        )
