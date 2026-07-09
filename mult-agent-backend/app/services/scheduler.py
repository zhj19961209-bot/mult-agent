import asyncio
import json
import logging
import re
from sqlalchemy.ext.asyncio import AsyncSession
from app.agents.base import BaseAgent
from app.models.task import Task
from app.services.task_service import update_task_status, write_log, write_result, get_task
from app.services.agent_registry import get_agent_cls
from app.services.knowledge_service import build_knowledge_context
from app.services.message_bus import get_bus, drop_bus
from app.services.ws_manager import manager

logger = logging.getLogger(__name__)

MAX_COLLAB_ROUNDS = 5
_MENTION_RE = re.compile(r"^[\s>*+\-]*@([A-Za-z][\w-]*?)\s*[:：]\s*(.+)$", re.MULTILINE)

# Track running tasks for cancellation
_active_tasks: dict[str, asyncio.Task] = {}

def _build_agents(task: Task) -> list[BaseAgent]:
    agent_names = json.loads(task.agents) if isinstance(task.agents, str) else task.agents
    agents = []
    for name in agent_names:
        agent = get_agent_cls(name)
        if agent:
            agents.append(agent)
    return agents

def _agent_count(task: Task) -> int:
    agent_names = json.loads(task.agents) if isinstance(task.agents, str) else task.agents
    return len(agent_names)

async def _execute_agent(agent: BaseAgent, task: Task, db_session_factory, task_context: dict, history: str = "", bus=None, round: int = 0):
    """Execute one agent and persist log + result, with streaming progress.

    If `bus` is provided, parses @Mention: lines from result.stdout and posts them
    to the message bus as directed messages, and posts the remaining text as a
    broadcast message from this agent.
    """
    progress_buffer = []
    last_flush = [0.0]

    async def on_progress(text: str):
        progress_buffer.append(text)
        now = asyncio.get_event_loop().time()
        # 每条输出都实时推送 WebSocket
        await manager.broadcast(task.task_id, {
            "type": "log",
            "agent_name": agent.name,
            "stdout": text,
        })
        if len(progress_buffer) >= 20 or (now - last_flush[0]) >= 5:
            if progress_buffer:
                chunk = "".join(progress_buffer)
                progress_buffer.clear()
                last_flush[0] = now
                async with db_session_factory() as db:
                    await write_log(db, task.task_id, agent.name, chunk, "")

    # Approval callback for CLI agents
    async def approval_callback(task_id: str, question: str):
        await manager.broadcast(task_id, {
            "type": "approval_required",
            "agent_name": agent.name,
            "question": question,
        })

    # Inject approval callback and task_id into context
    task_context["approval_callback"] = approval_callback
    task_context["task_id"] = task.task_id

    async with db_session_factory() as db:
        try:
            result = await agent.execute(task_context, history=history, on_progress=on_progress)
            # 刷出剩余进度
            if progress_buffer:
                chunk = "".join(progress_buffer)
                async with db_session_factory() as db2:
                    await write_log(db2, task.task_id, agent.name, chunk, "")
            await write_log(db, task.task_id, agent.name, result.stdout, result.stderr)
            await write_result(db, task.task_id, agent.name, result.output, result.summary)
            await manager.broadcast(task.task_id, {
                "type": "result",
                "agent_name": agent.name,
                "output": result.output,
                "summary": result.summary,
                "success": result.success,
            })
            # Collaborative: parse @mentions from full stdout and dispatch to bus
            if bus is not None and result.success and result.stdout:
                await _dispatch_mentions(bus, agent.name, result.stdout, round)
            return result
        except Exception as e:
            await write_log(db, task.task_id, agent.name, "", str(e))
            await write_result(db, task.task_id, agent.name, "", f"执行失败: {e}")
            await manager.broadcast(task.task_id, {
                "type": "result",
                "agent_name": agent.name,
                "summary": f"执行失败: {e}",
                "success": False,
            })
            return None  # signal failure


async def _dispatch_mentions(bus, from_agent: str, stdout: str, round: int) -> None:
    """Extract `@Name: content` lines as directed messages; broadcast the remainder."""
    mentions = list(_MENTION_RE.finditer(stdout))
    posted_any = False
    for m in mentions:
        to = m.group(1).strip().lower()
        content = m.group(2).strip()
        if not content:
            continue
        await bus.post(from_agent=from_agent, content=content, to=to, round=round)
        posted_any = True
    # Remaining text (after stripping mention lines) becomes the broadcast
    leftover = _MENTION_RE.sub("", stdout).strip()
    if leftover:
        await bus.post(from_agent=from_agent, content=leftover, to=None, round=round)
        posted_any = True
    if not posted_any:
        # Empty round contribution — still log something so we can detect halt
        logger.debug(f"collab[{from_agent}] round {round} produced no message")

async def _run_sequential(task_id: str, db_session_factory):
    async with db_session_factory() as db:
        task = await get_task(db, task_id)
        if not task or task.status == "cancelled":
            return

    agents = _build_agents(task)
    total = len(agents)

    knowledge_context = ""
    async with db_session_factory() as db:
        knowledge_context = await build_knowledge_context(db, task.description)

    task_context = {
        "name": task.name,
        "description": task.description,
        "tli_commands": task.tli_commands,
        "knowledge": knowledge_context,
        "workspace_dir": getattr(task, "workspace_dir", "") or "",
    }

    chain_context = ""
    for i, agent in enumerate(agents):
        async with db_session_factory() as db:
            task = await get_task(db, task_id)
            if task and task.status == "cancelled":
                logger.info(f"Task {task_id} cancelled during sequential execution")
                return

        task_context["chain_context"] = chain_context
        result = await _execute_agent(agent, task, db_session_factory, task_context)
        if result and result.success:
            chain_context = result.summary
        progress = int((i + 1) / total * 100)
        async with db_session_factory() as db:
            await update_task_status(db, task_id, "running", progress)
        await manager.broadcast(task_id, {"type": "status", "status": "running", "progress": progress})

    async with db_session_factory() as db:
        await update_task_status(db, task_id, "completed", 100)
    await manager.broadcast(task_id, {"type": "status", "status": "completed", "progress": 100})

async def _run_parallel(task_id: str, db_session_factory):
    async with db_session_factory() as db:
        task = await get_task(db, task_id)
        if not task or task.status == "cancelled":
            return

    agents = _build_agents(task)
    total = len(agents)

    knowledge_context = ""
    async with db_session_factory() as db:
        knowledge_context = await build_knowledge_context(db, task.description)

    task_context = {
        "name": task.name,
        "description": task.description,
        "tli_commands": task.tli_commands,
        "knowledge": knowledge_context,
        "workspace_dir": getattr(task, "workspace_dir", "") or "",
    }

    completed_count = 0

    async def run_one(agent: BaseAgent):
        nonlocal completed_count
        try:
            await _execute_agent(agent, task, db_session_factory, task_context)
        finally:
            completed_count += 1
            progress = int(completed_count / total * 100)
            async with db_session_factory() as db:
                await update_task_status(db, task_id, "running", progress)
            await manager.broadcast(task_id, {"type": "status", "status": "running", "progress": progress})

    await asyncio.gather(*(run_one(a) for a in agents))

    async with db_session_factory() as db:
        task = await get_task(db, task_id)
        if task and task.status != "cancelled":
            await update_task_status(db, task_id, "completed", 100)
    await manager.broadcast(task_id, {"type": "status", "status": "completed", "progress": 100})


def _format_inbox(messages: list[dict], me: str = "") -> str:
    """Render inbox as a readable conversation prefix for prompt injection.

    发给当前 agent 的定向消息单独拎到 [待回复] 区,提示模型优先应答;
    其余作为广播上下文。
    """
    if not messages:
        return ""
    directed = [m for m in messages if me and m["to_agent"] == me]
    broadcast = [m for m in messages if not (me and m["to_agent"] == me)]
    lines = []
    if directed:
        lines.append("[待回复] 以下是队友直接向你提出的问题/请求，请在发言开头先正面回答，再展开：")
        for m in directed:
            lines.append(f"@{m['from_agent']} 问你：{m['content']}")
    if broadcast:
        lines.append("[团队消息]")
        for m in broadcast:
            target = "→所有人" if m["to_agent"] is None else f"→@{m['to_agent']}"
            lines.append(f"@{m['from_agent']} {target}：{m['content']}")
    return "\n".join(lines)


async def _run_collaborative(task_id: str, db_session_factory):
    async with db_session_factory() as db:
        task = await get_task(db, task_id)
        if not task or task.status == "cancelled":
            return

    agents = _build_agents(task)
    if not agents:
        async with db_session_factory() as db:
            await update_task_status(db, task_id, "completed", 100)
        return

    bus = get_bus(task_id, db_session_factory)
    await bus.load_from_db()

    knowledge_context = ""
    async with db_session_factory() as db:
        knowledge_context = await build_knowledge_context(db, task.description)

    agent_names = [a.name for a in agents]
    roster = "、".join(f"@{n}" for n in agent_names)
    collab_system = (
        "你正在和其他 agent 协作完成一项任务。"
        f"队友包括 {roster}。\n"
        "协作协议：\n"
        "- 想私聊某位队友，单独成行写 `@<队友名>: <消息内容>`（冒号后紧跟内容，中英文冒号都行）\n"
        "- 想广播给所有人，正常输出文本即可（会作为本轮你对所有人的发言）\n"
        "- 若收到的上下文里有 [待回复] 区，说明队友在直接向你提问，"
        "请在本轮发言的开头先正面、具体地回答这些问题，再展开你自己的观点\n"
        "- 不要把这套语法解释给用户看，直接照规则发就行\n"
        "- 任务结束时不需要继续 @ 别人，给出最终答复即可"
    )

    try:
        for round_idx in range(MAX_COLLAB_ROUNDS):
            async with db_session_factory() as db:
                task = await get_task(db, task_id)
                if task and task.status == "cancelled":
                    return

            before_count = len(await bus.all_messages())

            async def run_one(agent):
                inbox = await bus.inbox(agent.name)
                ctx = {
                    "name": task.name,
                    "description": task.description,
                    "tli_commands": task.tli_commands,
                    "knowledge": knowledge_context,
                    "workspace_dir": getattr(task, "workspace_dir", "") or "",
                    "inbox": inbox,
                    "round": round_idx,
                    "collab_system": collab_system,
                    "chain_context": _format_inbox(inbox, agent.name),
                }

                async def post(content, to=None, topic=None):
                    return await bus.post(
                        from_agent=agent.name, content=content,
                        to=to, topic=topic, round=round_idx,
                    )
                ctx["bus_post"] = post

                await _execute_agent(
                    agent, task, db_session_factory, ctx,
                    bus=bus, round=round_idx,
                )

            await asyncio.gather(*(run_one(a) for a in agents))

            after_count = len(await bus.all_messages())
            new_msgs = after_count - before_count

            progress = int(((round_idx + 1) / MAX_COLLAB_ROUNDS) * 100)
            async with db_session_factory() as db:
                await update_task_status(db, task_id, "running", progress)
            await manager.broadcast(
                task_id,
                {"type": "round", "round": round_idx, "new_messages": new_msgs, "progress": progress},
            )

            if new_msgs == 0:
                logger.info(f"collab task {task_id} converged at round {round_idx}")
                break

        async with db_session_factory() as db:
            task = await get_task(db, task_id)
            if task and task.status != "cancelled":
                await update_task_status(db, task_id, "completed", 100)
        await manager.broadcast(task_id, {"type": "status", "status": "completed", "progress": 100})
    finally:
        drop_bus(task_id)


async def run_task(task_id: str, db_session_factory):
    """Main entry: run the task in background."""
    async with db_session_factory() as db:
        task = await get_task(db, task_id)
        if not task:
            return
        await update_task_status(db, task_id, "running", 0)
    await manager.broadcast(task_id, {"type": "status", "status": "running", "progress": 0})

    try:
        async with db_session_factory() as db:
            task = await get_task(db, task_id)
            if task.mode == "parallel":
                await _run_parallel(task_id, db_session_factory)
            elif task.mode == "collaborative":
                await _run_collaborative(task_id, db_session_factory)
            else:
                await _run_sequential(task_id, db_session_factory)
    except asyncio.CancelledError:
        async with db_session_factory() as db:
            await update_task_status(db, task_id, "cancelled", 0)
        await manager.broadcast(task_id, {"type": "status", "status": "cancelled", "progress": 0})
    except Exception as e:
        logger.exception(f"Task {task_id} failed: {e}")
        async with db_session_factory() as db:
            await update_task_status(db, task_id, "failed", 0)
        await manager.broadcast(task_id, {"type": "status", "status": "failed", "progress": 0})

def schedule_task(task_id: str, db_session_factory):
    """Schedule a task to run in the background."""
    coro = run_task(task_id, db_session_factory)
    asyncio_task = asyncio.create_task(coro)
    _active_tasks[task_id] = asyncio_task

def cancel_running_task(task_id: str) -> bool:
    """Cancel a running task. Returns True if a running task was found and cancelled."""
    asyncio_task = _active_tasks.pop(task_id, None)
    if asyncio_task and not asyncio_task.done():
        asyncio_task.cancel()
        return True
    return False
