from datetime import timezone, timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
BEIJING_TZ = timezone(timedelta(hours=8))  # UTC+8 北京时间
DATABASE_URL = f"sqlite+aiosqlite:///{BASE_DIR}/data.db"

# TLI security
ALLOWED_COMMANDS = {
    "ls", "cat", "echo", "pwd", "mkdir", "touch", "grep", "find",
    "wc", "head", "tail", "python", "python3", "node", "npm", "pip",
    "claude", "codex", "depk",
}
BLOCKED_PATTERNS = [
    "rm -rf", "rm -r", "sudo", "chmod", "chown", "mkfs",
    "dd if=", "shutdown", "reboot", "kill", "> /dev/", "mkfs.",
]
ALLOWED_DIRECTORIES = [str(BASE_DIR), "/tmp"]
TLI_TIMEOUT = 60

# CLI Agent 配置（默认值，可在 agents_registry.json 中覆盖）
CLI_TIMEOUT = 300  # 5 minutes for AI CLI tasks
CLI_HEARTBEAT_INTERVAL = 30    # 无输出时每 30s 写一条心跳日志
CLI_WORK_DIR = str(BASE_DIR)

# 内置 agent 工作目录
TLI_WORKSPACE_DIR = str(BASE_DIR / "workspace" / "tli")
