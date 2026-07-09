import asyncio
import os
import pty
import re
import shlex
import tempfile
from typing import Optional, Awaitable, Callable
from app.agents.base import BaseAgent, AgentResult

_ANSI_RE = re.compile(r"(?:\x1b)?\[[0-9;]*m")

# PTY 模式下会出现大量控制序列（光标移动/擦除/OSC）和 \r 原地刷新，
# 仅清颜色码的 _ANSI_RE 不够，用下面这套更完整的清洗。
_CSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
_OSC_RE = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")
# 其余 C0 控制字符（退格/响铃/ESC 等），保留可见的 \n 与 \t
_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _clean_terminal(text: str) -> str:
    """清洗伪终端输出：去掉 OSC/CSI 控制序列、\r 原地刷新，以及残余控制字符。"""
    text = _OSC_RE.sub("", text)
    text = _CSI_RE.sub("", text)
    text = text.replace("\r\n", "\n").replace("\r", "")
    text = _CTRL_RE.sub("", text)
    return text

# Pattern to detect approval requests from CLI agents (e.g., Claude asking for permission)
_APPROVAL_PATTERN = re.compile(
    r"(请在命令行中输入\s*yes|授权我执行|输入\s*yes\s*来批准|批准我执行|approval required)",
    re.IGNORECASE
)

# Global registry: task_id -> PendingApproval
_pending_approvals: dict[str, "PendingApproval"] = {}


class PendingApproval:
    """Represents a paused CLI agent waiting for user approval."""
    def __init__(self, task_id: str, question: str, proc: asyncio.subprocess.Process):
        self.task_id = task_id
        self.question = question
        self.proc = proc
        self.response_event = asyncio.Event()
        self.response_text: str = ""

    async def wait_response(self) -> str:
        await self.response_event.wait()
        return self.response_text

    def submit_response(self, response: str):
        self.response_text = response
        self.response_event.set()


def get_pending_approval(task_id: str) -> Optional[PendingApproval]:
    return _pending_approvals.get(task_id)


def register_approval(task_id: str, question: str, proc: asyncio.subprocess.Process) -> PendingApproval:
    pending = PendingApproval(task_id, question, proc)
    _pending_approvals[task_id] = pending
    return pending


def clear_approval(task_id: str):
    _pending_approvals.pop(task_id, None)


class GenericCLIAgent(BaseAgent):
    """基于 CLI 的通用 Agent，参数化命令执行模式。

    args_template 支持的占位符：
      {prompt}       — prompt 文本（自动 shell-quote）
      {prompt_file}  — prompt 落盘到临时文件，传文件路径（长 prompt 用）
      {workspace}    — 工作目录
      {model}        — 模型名

    stdin_mode=True 时，prompt 通过 stdin 喂给进程，args_template 中不需要 {prompt}。
    """

    def __init__(
        self,
        name: str,
        cli_binary: str,
        args_template: str,
        workspace_dir: str,
        timeout: int = 300,
        heartbeat_interval: int = 30,
        role_hint: str = "",
        strip_ansi: bool = True,
        model: str = "",
        stdin_mode: bool = False,
        use_pty: bool = False,
    ):
        super().__init__(name)
        self.cli_binary = cli_binary
        self.args_template = args_template
        self.workspace_dir = workspace_dir
        self.timeout = timeout
        self.heartbeat_interval = heartbeat_interval
        self.role_hint = role_hint
        self.should_strip_ansi = strip_ansi
        self.model = model
        self.stdin_mode = stdin_mode
        self.use_pty = use_pty
        os.makedirs(self.workspace_dir, exist_ok=True)

    async def execute(self, task_context: dict, history: str = "", on_progress=None) -> AgentResult:
        prompt = self._build_prompt(task_context, history)
        task_id = task_context.get("task_id", "")
        # 任务级 workspace_dir 覆盖默认
        workspace = (task_context.get("workspace_dir") or "").strip() or self.workspace_dir
        try:
            os.makedirs(workspace, exist_ok=True)
        except Exception:
            workspace = self.workspace_dir

        prompt_file_path = ""
        if "{prompt_file}" in self.args_template:
            fd, prompt_file_path = tempfile.mkstemp(
                prefix=f"{self.name}_prompt_", suffix=".txt", dir=workspace
            )
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(prompt)

        args_str = self.args_template.format(
            prompt=shlex.quote(prompt),
            prompt_file=shlex.quote(prompt_file_path),
            workspace=workspace,
            model=self.model,
        )
        cmd = [self.cli_binary] + shlex.split(args_str)
        # 注入模型参数（如果配置了，且 args_template 没显式使用 {model}）
        if self.model and "{model}" not in self.args_template:
            cmd.extend(["--model", self.model])

        master_fd = None
        read_transport = None
        proc = None

        async def write_stdin(data: str):
            """向子进程写入（审核响应/stdin_mode）；PTY 走 master fd，否则走 proc.stdin。"""
            if self.use_pty and master_fd is not None:
                try:
                    os.write(master_fd, data.encode("utf-8"))
                except OSError:
                    pass
            elif proc is not None and proc.stdin and not proc.stdin.is_closing():
                try:
                    proc.stdin.write(data.encode("utf-8"))
                    await proc.stdin.drain()
                except Exception:
                    pass

        stdout_lines = []
        stderr_lines = []
        tag = self.name.capitalize()
        approval_callback = task_context.get("approval_callback")

        async def pump(reader, accumulator, tag: str, chunked: bool):
            """统一读循环：chunked=True 按块读(PTY 无规律换行)，否则按行读。"""
            buffer = ""
            while True:
                try:
                    if chunked:
                        data = await asyncio.wait_for(
                            reader.read(4096), timeout=self.heartbeat_interval
                        )
                    else:
                        data = await asyncio.wait_for(
                            reader.readline(), timeout=self.heartbeat_interval
                        )
                    if not data:
                        break
                    text = data.decode("utf-8", errors="replace")
                    accumulator.append(text)
                    buffer += text

                    # 先推送输出，再检测审核
                    if on_progress:
                        await on_progress(text)

                    # 检测审核请求（只检查最近 500 字符避免误报）
                    if _APPROVAL_PATTERN.search(buffer[-500:]) and approval_callback and task_id:
                        recent = "".join(accumulator[-3:])
                        pending = register_approval(task_id, recent, proc)
                        await approval_callback(task_id, recent)
                        response = await pending.wait_response()
                        await write_stdin(f"{response}\n")
                        clear_approval(task_id)
                        buffer = ""  # 清空 buffer 避免重复触发

                except asyncio.TimeoutError:
                    if on_progress:
                        await on_progress(f"[{tag} 运行中，等待输出...]\n")
                except OSError:
                    # PTY: 子进程退出后 master fd 读到 EIO，视为 EOF
                    break

        try:
            if self.use_pty:
                # 伪终端模式：交互式 CLI（如 depk）需要 TTY 才正常输出
                master_fd, slave_fd = pty.openpty()
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdin=slave_fd,
                    stdout=slave_fd,
                    stderr=slave_fd,
                    cwd=workspace,
                )
                os.close(slave_fd)  # 父进程关闭 slave，子进程退出后 master 读到 EOF
                loop = asyncio.get_event_loop()
                reader = asyncio.StreamReader()
                read_transport, _ = await loop.connect_read_pipe(
                    lambda: asyncio.StreamReaderProtocol(reader),
                    os.fdopen(master_fd, "rb", 0),
                )
                if self.stdin_mode:
                    await write_stdin(prompt)
                io_tasks = [asyncio.create_task(pump(reader, stdout_lines, tag, True))]
            else:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdin=asyncio.subprocess.PIPE,  # 始终打开 stdin 以便审核时写入
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=workspace,
                )
                if self.stdin_mode and proc.stdin is not None:
                    try:
                        proc.stdin.write(prompt.encode("utf-8"))
                        await proc.stdin.drain()
                        # 不关闭 stdin，保持可写状态
                    except Exception:
                        pass
                io_tasks = [
                    asyncio.create_task(pump(proc.stdout, stdout_lines, tag, False)),
                    asyncio.create_task(pump(proc.stderr, stderr_lines, f"{tag}-stderr", False)),
                ]

            done, pending = await asyncio.wait(io_tasks, timeout=self.timeout)
            try:
                await asyncio.wait_for(proc.wait(), timeout=10)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()

            for t in pending:
                t.cancel()

            stdout_str = "".join(stdout_lines).strip()
            stderr_str = "".join(stderr_lines).strip()

            if self.use_pty:
                # PTY 输出必然带控制序列，且 stdout/stderr 已合并到单流
                stdout_str = _clean_terminal(stdout_str).strip()
            elif self.should_strip_ansi:
                stdout_str = _ANSI_RE.sub("", stdout_str)
                stderr_str = _ANSI_RE.sub("", stderr_str)

            return AgentResult(
                agent_name=self.name,
                success=proc.returncode == 0,
                output=stdout_str[:4000] if stdout_str else f"[{self.name}] 无输出",
                summary=stdout_str[:1000] if stdout_str else "执行完成",
                stdout=stdout_str,
                stderr=stderr_str,
            )
        except asyncio.TimeoutError:
            try:
                if proc is not None:
                    proc.kill()
            except Exception:
                pass
            return AgentResult(
                agent_name=self.name,
                success=False,
                output=f"[{self.name}] 执行超时 ({self.timeout}s)",
                summary="任务超时",
                stderr=f"超时: {self.timeout}s",
            )
        except Exception as e:
            try:
                if proc is not None:
                    proc.kill()
            except Exception:
                pass
            return AgentResult(
                agent_name=self.name,
                success=False,
                output=f"[{self.name}] 执行异常: {e}",
                summary="执行失败",
                stderr=str(e),
            )
        finally:
            # 清理伪终端资源（正常路径已 close，异常路径兜底）
            if read_transport is not None:
                try:
                    read_transport.close()
                except Exception:
                    pass
            elif master_fd is not None:
                try:
                    os.close(master_fd)
                except OSError:
                    pass
            if prompt_file_path and os.path.exists(prompt_file_path):
                try:
                    os.unlink(prompt_file_path)
                except OSError:
                    pass

    def _build_prompt(self, task_context: dict, history: str = "") -> str:
        name = task_context.get("name", "unknown")
        description = task_context.get("description", "")
        chain = task_context.get("chain_context", "")
        knowledge = task_context.get("knowledge", "")
        collab_system = task_context.get("collab_system", "")
        round_idx = task_context.get("round")
        parts = []
        if self.role_hint:
            parts.append(self.role_hint)
        if collab_system:
            parts.append(collab_system)
        if knowledge:
            parts.append(knowledge)
        if history:
            parts.append(history)
            parts.append("请基于以上对话历史回答最新的问题。")
            return "\n\n".join(parts)
        if chain and round_idx is not None:
            parts.append(f"任务：{name}\n描述：{description}\n\n{chain}")
            parts.append(f"以上是队友们的最新发言（第 {round_idx + 1} 轮），请基于这些回应继续推进任务并产出你的发言。")
            return "\n\n".join(parts)
        if chain:
            parts.append(f"任务：{name}\n描述：{description}\n\n上一阶段输出：\n{chain}")
            parts.append("请基于以上输出继续执行并产出你的结果。")
            return "\n\n".join(parts)
        parts.append(f"任务：{name}\n描述：{description}")
        parts.append("请执行此任务并输出结果。")
        return "\n\n".join(parts)
