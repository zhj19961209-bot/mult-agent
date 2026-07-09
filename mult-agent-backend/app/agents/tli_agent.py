import json
from app.agents.base import BaseAgent, AgentResult
from app.services.tli_executor import execute_commands

class TLIAgent(BaseAgent):
    def __init__(self):
        super().__init__("tli")

    async def execute(self, task_context: dict, history: str = "", on_progress=None) -> AgentResult:
        commands_str = task_context.get("tli_commands", "[]")
        try:
            commands = json.loads(commands_str) if isinstance(commands_str, str) else commands_str
        except json.JSONDecodeError:
            commands = []

        if not commands:
            return AgentResult(
                agent_name=self.name,
                success=True,
                output="[TLI] 无命令需要执行",
                summary="无 TLI 命令",
            )

        results = await execute_commands(commands, workspace=(task_context.get("workspace_dir") or "").strip() or None)
        all_stdout = "\n".join(r["stdout"] for r in results)
        all_stderr = "\n".join(r["stderr"] for r in results)
        all_success = all(r["success"] for r in results)

        return AgentResult(
            agent_name=self.name,
            success=all_success,
            output=f"[TLI] 执行 {len(commands)} 条命令",
            summary=all_stdout.strip() or "命令执行完成",
            stdout=all_stdout,
            stderr=all_stderr,
        )
