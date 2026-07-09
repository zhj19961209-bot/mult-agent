import shutil
from fastapi import APIRouter, HTTPException
from app.schemas.agent import (
    AgentStatusResponse,
    AgentStatus,
    AgentCreateRequest,
    AgentToolsResponse,
    AgentToolInfo,
)
from app.services.agent_registry import (
    list_agents,
    add_agent,
    delete_agent,
    discover_agents,
    get_agent_config,
    BUILTIN_NAMES,
)
from app.services.mcp_manager import mcp_manager

router = APIRouter(prefix="/agent", tags=["agent"])


def _to_status(cfg: dict) -> AgentStatus:
    atype = cfg.get("type", "cli")
    if atype == "cli":
        binary = cfg.get("cli_binary", cfg["name"])
        online = shutil.which(binary) is not None
    elif atype == "http":
        online = bool(cfg.get("base_url"))
    elif atype == "mcp":
        online = mcp_manager.is_running(cfg["name"])
    else:
        online = True
    return AgentStatus(
        name=cfg["name"],
        display_name=cfg.get("display_name", cfg["name"].capitalize()),
        online=online,
        type=atype,
        role=cfg.get("role", ""),
        icon=cfg.get("icon", "Zap"),
        color=cfg.get("color", "#a1a1aa"),
        description=cfg.get("description", ""),
        enabled=cfg.get("enabled", True),
    )


@router.get("", response_model=AgentStatusResponse)
async def get_agents():
    agents = [_to_status(cfg) for cfg in list_agents()]
    return AgentStatusResponse(agents=agents)


@router.get("/status", response_model=AgentStatusResponse)
async def get_agent_status():
    """兼容旧接口"""
    return await get_agents()


@router.post("", response_model=AgentStatus, status_code=201)
async def register_agent(req: AgentCreateRequest):
    try:
        cfg = add_agent(req.model_dump(exclude_none=True))
        return _to_status(cfg)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.get("/discover")
async def discover():
    """扫描 PATH 中的已知 CLI，返回未注册的建议。"""
    return {"suggestions": discover_agents()}


@router.get("/{name}/tools", response_model=AgentToolsResponse)
async def list_agent_tools(name: str):
    """列出 MCP Agent 暴露的工具。"""
    cfg = get_agent_config(name)
    if not cfg:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' 不存在")
    if cfg.get("type") != "mcp":
        return AgentToolsResponse(
            agent=name, transport="", running=False, tools=[],
            error="该 Agent 不是 MCP 类型",
        )
    try:
        tools_raw = await mcp_manager.list_tools(name)
        tools = [
            AgentToolInfo(
                name=t.get("name", ""),
                description=t.get("description", ""),
                input_schema=t.get("inputSchema") or t.get("input_schema") or {},
            )
            for t in tools_raw
        ]
        sess = mcp_manager.get_session(name)
        return AgentToolsResponse(
            agent=name,
            transport=cfg.get("transport", "stdio"),
            running=mcp_manager.is_running(name),
            tools=tools,
            last_error=sess.last_error if sess else "",
            restart_count=sess.restart_count if sess else 0,
        )
    except Exception as e:
        sess = mcp_manager.get_session(name)
        return AgentToolsResponse(
            agent=name,
            transport=cfg.get("transport", "stdio"),
            running=False,
            tools=[],
            error=str(e),
            last_error=sess.last_error if sess else "",
            restart_count=sess.restart_count if sess else 0,
        )


@router.post("/{name}/start")
async def start_agent(name: str):
    """启动 MCP Agent 的 server 进程。"""
    cfg = get_agent_config(name)
    if not cfg:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' 不存在")
    if cfg.get("type") != "mcp":
        raise HTTPException(status_code=400, detail="仅 MCP Agent 支持 start")
    try:
        await mcp_manager.start(name, cfg)
        return {"message": "已启动", "name": name, "running": mcp_manager.is_running(name)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{name}/stop")
async def stop_agent(name: str):
    cfg = get_agent_config(name)
    if not cfg:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' 不存在")
    if cfg.get("type") != "mcp":
        raise HTTPException(status_code=400, detail="仅 MCP Agent 支持 stop")
    await mcp_manager.stop(name)
    return {"message": "已停止", "name": name}


@router.delete("/{name}")
async def remove_agent(name: str):
    if name in BUILTIN_NAMES:
        raise HTTPException(status_code=403, detail=f"内置 Agent '{name}' 不可删除")
    cfg = get_agent_config(name)
    if cfg and cfg.get("type") == "mcp":
        await mcp_manager.stop(name)
    ok = delete_agent(name)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' 不存在")
    return {"message": "已删除", "name": name}
