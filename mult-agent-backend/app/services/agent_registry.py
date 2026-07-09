import json
import logging
import os
import shutil
import threading
from pathlib import Path
from app.agents.base import BaseAgent
from app.agents.cli_agent import GenericCLIAgent
from app.agents.http_agent import HTTPAgent
from app.agents.mcp_agent import MCPAgent
from app.agents.tli_agent import TLIAgent
from app.config import BASE_DIR

logger = logging.getLogger(__name__)

REGISTRY_FILE = Path(BASE_DIR) / "agents_registry.json"
_lock = threading.Lock()

BUILTIN_NAMES = {"codex", "claude", "depk", "tli"}

DEFAULT_AGENTS = [
    {
        "name": "codex",
        "display_name": "Codex",
        "description": "OpenAI Codex CLI — 代码生成与执行",
        "role": "代码执行",
        "type": "cli",
        "cli_binary": "codex",
        "args_template": "exec {prompt} --ephemeral --skip-git-repo-check -C {workspace}",
        "workspace_dir": str(Path(BASE_DIR) / "workspace" / "codex"),
        "timeout": 300,
        "heartbeat_interval": 30,
        "icon": "Code",
        "color": "#3b82f6",
        "enabled": True,
        "strip_ansi": False,
    },
    {
        "name": "claude",
        "display_name": "Claude",
        "description": "Anthropic Claude CLI — 推理与代码专家",
        "role": "推理专家",
        "type": "cli",
        "cli_binary": "claude",
        "args_template": "-p {prompt} --bare --add-dir {workspace}",
        "workspace_dir": str(Path(BASE_DIR) / "workspace" / "claude"),
        "timeout": 300,
        "heartbeat_interval": 30,
        "icon": "Cpu",
        "color": "#8b5cf6",
        "enabled": True,
        "strip_ansi": False,
        "model": "",
    },
    {
        "name": "depk",
        "display_name": "DepK",
        "description": "DeepSeek CLI — 产品经理视角",
        "role": "产品经理",
        "type": "cli",
        "cli_binary": "depk",
        "args_template": "-p {prompt}",
        "workspace_dir": str(Path(BASE_DIR) / "workspace" / "depk"),
        "timeout": 300,
        "heartbeat_interval": 30,
        "icon": "Lightbulb",
        "color": "#06b6d4",
        "enabled": True,
        "strip_ansi": True,
        "use_pty": True,
        "role_hint": "你是一名产品经理（Product Manager），负责从产品角度分析和规划。请以产品经理的视角思考问题，关注用户体验、功能优先级、市场需求和商业价值。\n\n",
    },
    {
        "name": "tli",
        "display_name": "TLI",
        "description": "终端命令调度器 — 沙箱命令执行",
        "role": "命令调度",
        "type": "builtin",
        "icon": "Terminal",
        "color": "#f97316",
        "enabled": True,
    },
]


def _load_registry() -> list[dict]:
    """从 JSON 文件加载注册表，不存在则从默认值创建。"""
    if REGISTRY_FILE.exists():
        try:
            with open(REGISTRY_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, list) and len(data) > 0:
                return data
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(f"注册表文件损坏，从默认值重建: {e}")

    # 用默认值初始化
    _save_registry(list(DEFAULT_AGENTS))
    return list(DEFAULT_AGENTS)


def _save_registry(agents: list[dict]):
    with open(REGISTRY_FILE, "w", encoding="utf-8") as f:
        json.dump(agents, f, ensure_ascii=False, indent=2)


# 模块加载时初始化
_registry: list[dict] = _load_registry()


def reload_registry():
    """重新加载注册表（写操作后调用）。"""
    global _registry
    with _lock:
        _registry = _load_registry()


def list_agents() -> list[dict]:
    """返回所有已注册 agent 的配置。"""
    with _lock:
        return [dict(a) for a in _registry]


def get_agent_config(name: str) -> dict | None:
    with _lock:
        for a in _registry:
            if a["name"] == name:
                return dict(a)
    return None


def get_agent_cls(name: str) -> BaseAgent | None:
    """根据 agent 名构建实例。"""
    cfg = get_agent_config(name)
    if not cfg or not cfg.get("enabled", True):
        return None

    atype = cfg.get("type", "cli")
    if atype == "builtin":
        if name == "tli":
            return TLIAgent()
        return None  # 未知 builtin

    if atype == "http":
        return HTTPAgent(
            name=cfg["name"],
            base_url=cfg.get("base_url", ""),
            model=cfg.get("model", ""),
            api_key_env=cfg.get("api_key_env", ""),
            api_key=cfg.get("api_key", ""),
            system_prompt=cfg.get("system_prompt", ""),
            role_hint=cfg.get("role_hint", ""),
            temperature=cfg.get("temperature", 0.7),
            max_tokens=cfg.get("max_tokens", 4096),
            timeout=cfg.get("timeout", 300),
            extra_headers=cfg.get("extra_headers") or {},
            mcp_tools=cfg.get("mcp_tools") or [],
        )

    if atype == "mcp":
        return MCPAgent(name=cfg["name"], cfg=cfg)

    # CLI 类型
    return GenericCLIAgent(
        name=cfg["name"],
        cli_binary=cfg.get("cli_binary", name),
        args_template=cfg.get("args_template", "-p {prompt}"),
        workspace_dir=cfg.get("workspace_dir", str(Path(BASE_DIR) / "workspace" / name)),
        timeout=cfg.get("timeout", 300),
        heartbeat_interval=cfg.get("heartbeat_interval", 30),
        role_hint=cfg.get("role_hint", ""),
        strip_ansi=cfg.get("strip_ansi", True),
        model=cfg.get("model", ""),
        stdin_mode=cfg.get("stdin_mode", False),
        use_pty=cfg.get("use_pty", False),
    )


def add_agent(config: dict) -> dict:
    """添加新 agent，返回更新后的配置。"""
    name = config.get("name", "").strip().lower()
    if not name:
        raise ValueError("Agent 名称不能为空")
    if not name.replace("-", "").replace("_", "").isalnum():
        raise ValueError("Agent 名称只能包含字母、数字和连字符")

    with _lock:
        for a in _registry:
            if a["name"] == name:
                raise ValueError(f"Agent '{name}' 已存在")

        entry = {
            "name": name,
            "display_name": config.get("display_name", name.capitalize()),
            "description": config.get("description", ""),
            "role": config.get("role", "通用 Agent"),
            "type": config.get("type", "cli"),
            "icon": config.get("icon", "Zap"),
            "color": config.get("color", "#a1a1aa"),
            "enabled": True,
        }

        if entry["type"] == "cli":
            cli_binary = config.get("cli_binary", name)
            if "cli_binary" not in config and shutil.which(name) is None:
                raise ValueError(f"CLI 二进制 '{name}' 未在 PATH 中找到，请指定 cli_binary")
            entry["cli_binary"] = cli_binary
            entry["args_template"] = config.get("args_template", "-p {prompt}")
            entry["workspace_dir"] = config.get(
                "workspace_dir", str(Path(BASE_DIR) / "workspace" / name)
            )
            entry["timeout"] = config.get("timeout", 300)
            entry["heartbeat_interval"] = config.get("heartbeat_interval", 30)
            entry["strip_ansi"] = config.get("strip_ansi", True)
            entry["role_hint"] = config.get("role_hint", "")
            entry["model"] = config.get("model", "")
            entry["stdin_mode"] = config.get("stdin_mode", False)
            entry["use_pty"] = config.get("use_pty", False)
        elif entry["type"] == "http":
            base_url = (config.get("base_url") or "").strip()
            model = (config.get("model") or "").strip()
            if not base_url:
                raise ValueError("HTTP Agent 必须指定 base_url")
            if not model:
                raise ValueError("HTTP Agent 必须指定 model")
            entry["base_url"] = base_url
            entry["model"] = model
            entry["api_key_env"] = config.get("api_key_env", "")
            # 安全：不接受明文 api_key 写入注册表
            entry["system_prompt"] = config.get("system_prompt", "")
            entry["role_hint"] = config.get("role_hint", "")
            entry["temperature"] = float(config.get("temperature", 0.7))
            entry["max_tokens"] = int(config.get("max_tokens", 4096))
            entry["timeout"] = int(config.get("timeout", 300))
            entry["extra_headers"] = config.get("extra_headers") or {}
            mcp_tools = config.get("mcp_tools") or []
            if isinstance(mcp_tools, list):
                entry["mcp_tools"] = [str(x) for x in mcp_tools if x]
            else:
                entry["mcp_tools"] = []
        elif entry["type"] == "mcp":
            transport = config.get("transport", "stdio")
            if transport not in ("stdio", "sse"):
                raise ValueError("MCP transport 必须是 stdio 或 sse")
            entry["transport"] = transport
            if transport == "stdio":
                command = (config.get("command") or "").strip()
                if not command:
                    raise ValueError("stdio MCP Agent 必须指定 command")
                entry["command"] = command
                entry["mcp_args"] = config.get("mcp_args") or []
            else:
                sse_url = (config.get("sse_url") or "").strip()
                if not sse_url:
                    raise ValueError("sse MCP Agent 必须指定 sse_url")
                entry["sse_url"] = sse_url
            entry["env"] = config.get("env") or {}
            entry["auto_start"] = bool(config.get("auto_start", False))
            entry["timeout"] = int(config.get("timeout", 300))
            entry["workspace_dir"] = config.get(
                "workspace_dir", str(Path(BASE_DIR) / "workspace" / name)
            )

        _registry.append(entry)
        _save_registry(_registry)
        return dict(entry)


def delete_agent(name: str) -> bool:
    """删除 agent。内置 agent 不可删除。"""
    if name in BUILTIN_NAMES:
        raise ValueError(f"内置 Agent '{name}' 不可删除")
    with _lock:
        for i, a in enumerate(_registry):
            if a["name"] == name:
                _registry.pop(i)
                _save_registry(_registry)
                return True
    return False


# 已知 AI CLI 模式：{二进制名: 建议配置}
KNOWN_CLI_PATTERNS = {
    "openclaw": {
        "display_name": "OpenClaw",
        "role": "安全测试",
        "icon": "Shield",
        "color": "#22c55e",
        "args_template": "-p {prompt}",
    },
    "aider": {
        "display_name": "Aider",
        "role": "代码助手",
        "icon": "Bot",
        "color": "#eab308",
        "args_template": "--message-file {prompt_file} --yes",
    },
    "tgpt": {
        "display_name": "TGPT",
        "role": "通用 AI",
        "icon": "Brain",
        "color": "#ec4899",
        "args_template": "{prompt}",
    },
    "gemini": {
        "display_name": "Gemini",
        "role": "推理专家",
        "icon": "Globe",
        "color": "#14b8a6",
        "args_template": "-p {prompt}",
    },
    "qwen": {
        "display_name": "Qwen",
        "role": "通用 AI",
        "icon": "Bot",
        "color": "#a855f7",
        "args_template": "-p {prompt}",
    },
    "llama": {
        "display_name": "Llama",
        "role": "通用 AI",
        "icon": "Server",
        "color": "#f43f5e",
        "args_template": "-p {prompt}",
    },
    "copilot": {
        "display_name": "Copilot",
        "role": "代码助手",
        "icon": "Code",
        "color": "#3b82f6",
        "args_template": "-p {prompt}",
    },
    "cursor-agent": {
        "display_name": "Cursor Agent",
        "role": "代码助手",
        "icon": "MousePointer",
        "color": "#06b6d4",
        "args_template": "-p {prompt}",
    },
    "continue": {
        "display_name": "Continue",
        "role": "代码助手",
        "icon": "ArrowRight",
        "color": "#f59e0b",
        "args_template": "",
        "stdin_mode": True,
    },
    "qwen-coder": {
        "display_name": "Qwen Coder",
        "role": "代码助手",
        "icon": "Code",
        "color": "#a855f7",
        "args_template": "-p {prompt_file}",
    },
    "crush": {
        "display_name": "Charm Crush",
        "role": "通用 AI",
        "icon": "Sparkles",
        "color": "#ec4899",
        "args_template": "-p {prompt}",
    },
    "opencode": {
        "display_name": "OpenCode",
        "role": "代码助手",
        "icon": "Code",
        "color": "#10b981",
        "args_template": "-p {prompt}",
    },
    "sgpt": {
        "display_name": "Shell GPT",
        "role": "通用 AI",
        "icon": "Terminal",
        "color": "#6366f1",
        "args_template": "{prompt}",
    },
}


def discover_agents() -> list[dict]:
    """扫描 PATH 中的已知 CLI，返回未注册的建议。"""
    registered_names = {a["name"] for a in _registry}
    registered_binaries = {
        a.get("cli_binary", a["name"]) for a in _registry if a.get("type") == "cli"
    }
    suggestions = []

    for binary, template in KNOWN_CLI_PATTERNS.items():
        name = binary  # 二进制名即 agent 名
        if name in registered_names or binary in registered_binaries:
            continue
        if shutil.which(binary) is not None:
            entry = {
                "name": name,
                "display_name": template.get("display_name", name.capitalize()),
                "role": template.get("role", "通用 Agent"),
                "type": "cli",
                "cli_binary": binary,
                "args_template": template.get("args_template", "-p {prompt}"),
                "icon": template.get("icon", "Zap"),
                "color": template.get("color", "#a1a1aa"),
                "available": True,
            }
            if template.get("stdin_mode"):
                entry["stdin_mode"] = True
            suggestions.append(entry)

    return suggestions
