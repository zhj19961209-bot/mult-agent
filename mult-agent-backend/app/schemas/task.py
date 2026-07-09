import json
from pydantic import BaseModel, Field
from typing import Optional

class TaskCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str = ""
    mode: str = Field(default="sequential", pattern="^(sequential|parallel|collaborative)$")
    agents: list[str] = Field(..., min_length=1)
    tli_commands: list[str] = []
    workspace_dir: str = ""

class TaskResponse(BaseModel):
    task_id: str
    name: str
    description: str
    mode: str
    agents: list[str]
    tli_commands: list[str]
    workspace_dir: str = ""
    status: str
    progress: int
    created_at: str
    updated_at: str

    @classmethod
    def from_model(cls, task):
        return cls(
            task_id=task.task_id,
            name=task.name,
            description=task.description or "",
            mode=task.mode,
            agents=json.loads(task.agents) if isinstance(task.agents, str) else task.agents,
            tli_commands=json.loads(task.tli_commands) if isinstance(task.tli_commands, str) else task.tli_commands,
            workspace_dir=getattr(task, "workspace_dir", "") or "",
            status=task.status,
            progress=task.progress,
            created_at=task.created_at or "",
            updated_at=task.updated_at or "",
        )

class ContinueRequest(BaseModel):
    agent: str
    question: str = Field(..., min_length=1, max_length=2000)

class TaskDetailResponse(TaskResponse):
    logs: list[dict] = []
    results: list[dict] = []

class LogEntry(BaseModel):
    log_id: int
    agent_name: str
    stdout: str
    stderr: str
    timestamp: str

class ResultEntry(BaseModel):
    result_id: int
    agent_name: str
    output: str
    summary: str
    created_at: str


class AgentMessageResponse(BaseModel):
    id: int
    task_id: str
    round: int
    from_agent: str
    to_agent: Optional[str] = None
    topic: Optional[str] = None
    content: str
    created_at: str


class ApprovalRequest(BaseModel):
    response: str = Field(..., min_length=1, max_length=100)
