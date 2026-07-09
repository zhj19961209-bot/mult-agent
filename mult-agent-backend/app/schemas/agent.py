from pydantic import BaseModel, Field
from typing import Optional


class AgentStatus(BaseModel):
    name: str
    display_name: str = ""
    online: bool
    type: str  # "cli" | "builtin" | "http" | "mcp" | "mock"
    role: str = ""
    icon: str = "Zap"
    color: str = "#a1a1aa"
    description: str = ""
    enabled: bool = True


class AgentStatusResponse(BaseModel):
    agents: list[AgentStatus]


class AgentCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_-]*$")
    display_name: str = ""
    description: str = ""
    role: str = "通用 Agent"
    type: str = "cli"  # "cli" | "http" | "mcp"
    icon: str = "Zap"
    color: str = "#a1a1aa"
    role_hint: str = ""
    timeout: int = 300

    # CLI 字段
    cli_binary: Optional[str] = None
    args_template: Optional[str] = None
    workspace_dir: Optional[str] = None
    heartbeat_interval: int = 30
    strip_ansi: bool = True
    model: str = ""
    stdin_mode: bool = False
    use_pty: bool = False  # 伪终端模式：交互式 CLI（需 TTY 才正常输出）用

    # HTTP 字段
    base_url: Optional[str] = None
    api_key_env: Optional[str] = None
    system_prompt: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    extra_headers: Optional[dict] = None
    mcp_tools: Optional[list[str]] = None

    # MCP 字段
    transport: Optional[str] = None  # "stdio" | "sse"
    command: Optional[str] = None
    mcp_args: Optional[list[str]] = None
    env: Optional[dict] = None
    sse_url: Optional[str] = None
    auto_start: Optional[bool] = None


class AgentToolInfo(BaseModel):
    name: str
    description: str = ""
    input_schema: dict = Field(default_factory=dict)


class AgentToolsResponse(BaseModel):
    agent: str
    transport: str = ""
    running: bool = False
    tools: list[AgentToolInfo] = Field(default_factory=list)
    error: str = ""
    last_error: str = ""
    restart_count: int = 0
