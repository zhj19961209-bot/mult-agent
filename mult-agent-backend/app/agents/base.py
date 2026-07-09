from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Callable, Awaitable, Optional

@dataclass
class AgentResult:
    agent_name: str
    success: bool
    output: str = ""
    summary: str = ""
    stdout: str = ""
    stderr: str = ""

class BaseAgent(ABC):
    def __init__(self, name: str):
        self.name = name

    @abstractmethod
    async def execute(
        self,
        task_context: dict,
        history: str = "",
        on_progress: Optional[Callable[[str], Awaitable[None]]] = None,
    ) -> AgentResult:
        ...
