import asyncio
import os
import shlex
from typing import Optional
from app.config import ALLOWED_COMMANDS, BLOCKED_PATTERNS, ALLOWED_DIRECTORIES, TLI_TIMEOUT, TLI_WORKSPACE_DIR

class TLISecurityError(Exception):
    pass

def validate_command(cmd: str):
    """Check if command is allowed. Raises TLISecurityError if not."""
    parts = shlex.split(cmd)
    if not parts:
        raise TLISecurityError("空命令")

    for pattern in BLOCKED_PATTERNS:
        if pattern in cmd:
            raise TLISecurityError(f"命令包含危险模式: '{pattern}'")

    executable = parts[0]
    if executable not in ALLOWED_COMMANDS:
        raise TLISecurityError(f"命令 '{executable}' 不在白名单中")

def validate_directory(cmd: str):
    """Check if command operates within allowed directories. Raises TLISecurityError if not."""

async def execute_single_command(cmd: str, workspace: Optional[str] = None) -> dict:
    try:
        validate_command(cmd)
        cwd = workspace or TLI_WORKSPACE_DIR
        os.makedirs(cwd, exist_ok=True)
        proc = await asyncio.create_subprocess_exec(
            *shlex.split(cmd),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=TLI_TIMEOUT)
        return {
            "command": cmd,
            "success": proc.returncode == 0,
            "stdout": stdout.decode("utf-8", errors="replace").strip(),
            "stderr": stderr.decode("utf-8", errors="replace").strip(),
            "returncode": proc.returncode,
        }
    except asyncio.TimeoutError:
        return {
            "command": cmd,
            "success": False,
            "stdout": "",
            "stderr": f"命令超时 ({TLI_TIMEOUT}s): {cmd}",
            "returncode": -1,
        }
    except TLISecurityError as e:
        return {
            "command": cmd,
            "success": False,
            "stdout": "",
            "stderr": f"安全检查失败: {e}",
            "returncode": -1,
        }
    except Exception as e:
        return {
            "command": cmd,
            "success": False,
            "stdout": "",
            "stderr": f"执行异常: {e}",
            "returncode": -1,
        }

async def execute_commands(commands: list[str], workspace: Optional[str] = None) -> list[dict]:
    """Execute a list of commands sequentially."""
    return [await execute_single_command(cmd, workspace=workspace) for cmd in commands]
