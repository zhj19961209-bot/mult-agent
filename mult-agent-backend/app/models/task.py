import uuid
from datetime import datetime
from app.config import BEIJING_TZ
from sqlalchemy import Column, String, Integer, Text, ForeignKey
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class Task(Base):
    __tablename__ = "tasks"

    task_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    description = Column(String, default="")
    mode = Column(String, nullable=False, default="sequential")  # sequential | parallel
    agents = Column(String, nullable=False)  # JSON list string
    tli_commands = Column(String, default="[]")  # JSON list string
    workspace_dir = Column(String, default="")  # 任务级覆盖 agent 默认 workspace
    status = Column(String, nullable=False, default="pending")
    progress = Column(Integer, default=0)
    created_at = Column(String, default=lambda: datetime.now(BEIJING_TZ).isoformat())
    updated_at = Column(String, default=lambda: datetime.now(BEIJING_TZ).isoformat())

class TaskLog(Base):
    __tablename__ = "task_logs"

    log_id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String, ForeignKey("tasks.task_id"), nullable=False)
    agent_name = Column(String, nullable=False)
    stdout = Column(Text, default="")
    stderr = Column(Text, default="")
    timestamp = Column(String, default=lambda: datetime.now(BEIJING_TZ).isoformat())

class TaskResult(Base):
    __tablename__ = "task_results"

    result_id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String, ForeignKey("tasks.task_id"), nullable=False)
    agent_name = Column(String, nullable=False)
    output = Column(Text, default="")
    summary = Column(Text, default="")
    created_at = Column(String, default=lambda: datetime.now(BEIJING_TZ).isoformat())


class KnowledgeEntry(Base):
    __tablename__ = "knowledge_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String, ForeignKey("tasks.task_id"), nullable=False)
    agent_name = Column(String, nullable=False)
    content = Column(Text, default="")
    summary = Column(Text, default="")
    feedback = Column(String, default="")  # "positive" | "negative"
    question = Column(Text, default="")   # 触发这条知识的问题
    keywords = Column(String, default="[]")
    category = Column(String, default="")
    created_at = Column(String, default=lambda: datetime.now(BEIJING_TZ).isoformat())


class AgentMessage(Base):
    __tablename__ = "agent_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String, ForeignKey("tasks.task_id"), nullable=False)
    round = Column(Integer, nullable=False, default=0)
    from_agent = Column(String, nullable=False)
    to_agent = Column(String, nullable=True)  # NULL = 广播
    topic = Column(String, nullable=True)
    content = Column(Text, default="")
    created_at = Column(String, default=lambda: datetime.now(BEIJING_TZ).isoformat())
