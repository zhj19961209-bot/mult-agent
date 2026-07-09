from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database.setup import init_db
from app.api.task import router as task_router
from app.api.agent import router as agent_router
from app.api.profile import router as profile_router
from app.api.knowledge import router as knowledge_router
from app.api.ws import router as ws_router
from app.api.fs import router as fs_router
from app.services.agent_registry import list_agents
from app.services.mcp_manager import mcp_manager

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # 自动启动标记为 auto_start 的 MCP server
    for cfg in list_agents():
        if cfg.get("type") == "mcp" and cfg.get("auto_start") and cfg.get("enabled", True):
            try:
                await mcp_manager.start(cfg["name"], cfg)
                logger.info(f"MCP[{cfg['name']}] auto_start 成功")
            except Exception as e:
                logger.warning(f"MCP[{cfg['name']}] auto_start 失败: {e}")
    try:
        yield
    finally:
        await mcp_manager.stop_all()

app = FastAPI(title="多 Agent 协作平台", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(task_router)
app.include_router(agent_router)
app.include_router(profile_router)
app.include_router(knowledge_router)
app.include_router(ws_router)
app.include_router(fs_router)

@app.get("/health")
async def health():
    return {"status": "ok"}
