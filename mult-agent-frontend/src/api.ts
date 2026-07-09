import type { Task, TaskDetail, AgentStatus, AgentConfig, DiscoverSuggestion, AgentToolsResponse, AgentMessage, KnowledgeResponse, CreateTaskPayload, ContinuePayload, FsListResponse, FsHomeResponse } from "./types";

const BASE = "http://localhost:8010";

export async function healthCheck() {
  const res = await fetch(`${BASE}/health`);
  return res.json();
}

export async function getAgentStatus() {
  const res = await fetch(`${BASE}/agent/status`);
  return res.json() as Promise<{ agents: AgentStatus[] }>;
}

export async function getAgents() {
  const res = await fetch(`${BASE}/agent`);
  return res.json() as Promise<{ agents: AgentStatus[] }>;
}

export async function createAgent(config: AgentConfig) {
  const res = await fetch(`${BASE}/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "创建失败" }));
    throw new Error(err.detail || "创建失败");
  }
  return res.json() as Promise<AgentStatus>;
}

export async function deleteAgent(name: string) {
  const res = await fetch(`${BASE}/agent/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "删除失败" }));
    throw new Error(err.detail || "删除失败");
  }
  return res.json() as Promise<{ message: string; name: string }>;
}

export async function listTasks(status?: string) {
  const url = status
    ? `${BASE}/task?status=${encodeURIComponent(status)}`
    : `${BASE}/task`;
  const res = await fetch(url);
  return res.json() as Promise<Task[]>;
}

export async function getTaskDetail(taskId: string) {
  const res = await fetch(`${BASE}/task/${encodeURIComponent(taskId)}`);
  if (!res.ok) throw new Error(`Task not found`);
  return res.json() as Promise<TaskDetail>;
}

export async function getTaskMessages(taskId: string) {
  const res = await fetch(`${BASE}/task/${encodeURIComponent(taskId)}/messages`);
  if (!res.ok) throw new Error("拉取消息失败");
  return res.json() as Promise<AgentMessage[]>;
}

export async function createTask(payload: CreateTaskPayload) {
  const res = await fetch(`${BASE}/task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Create failed`);
  return res.json() as Promise<Task>;
}

export async function cancelTask(taskId: string) {
  const res = await fetch(`${BASE}/task/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
  });
  return res.json() as Promise<{ message: string; task_id: string }>;
}

export async function retryTask(taskId: string) {
  const res = await fetch(`${BASE}/task/${encodeURIComponent(taskId)}/retry`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Retry failed`);
  return res.json() as Promise<{ message: string; task_id: string }>;
}

export async function discoverAgents() {
  const res = await fetch(`${BASE}/agent/discover`);
  return res.json() as Promise<{ suggestions: DiscoverSuggestion[] }>;
}

export async function getAgentTools(name: string) {
  const res = await fetch(`${BASE}/agent/${encodeURIComponent(name)}/tools`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "查询失败" }));
    throw new Error(err.detail || "查询失败");
  }
  return res.json() as Promise<AgentToolsResponse>;
}

export async function startAgent(name: string) {
  const res = await fetch(`${BASE}/agent/${encodeURIComponent(name)}/start`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "启动失败" }));
    throw new Error(err.detail || "启动失败");
  }
  return res.json() as Promise<{ message: string; name: string; running: boolean }>;
}

export async function stopAgent(name: string) {
  const res = await fetch(`${BASE}/agent/${encodeURIComponent(name)}/stop`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "停止失败" }));
    throw new Error(err.detail || "停止失败");
  }
  return res.json() as Promise<{ message: string; name: string }>;
}

export async function queryKnowledge(q: string) {
  const res = await fetch(`${BASE}/knowledge?q=${encodeURIComponent(q)}`);
  return res.json() as Promise<KnowledgeResponse>;
}

export async function submitFeedback(data: {
  task_id: string;
  agent_name: string;
  output: string;
  summary: string;
  question: string;
  feedback: string;
}) {
  const res = await fetch(`${BASE}/knowledge/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Feedback failed");
  return res.json() as Promise<{ id: number; feedback: string }>;
}

export async function getProfile() {
  const res = await fetch(`${BASE}/profile`);
  return res.json() as Promise<{ user: string; soul: string }>;
}

export async function updateProfile(user: string, soul: string) {
  const res = await fetch(`${BASE}/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, soul }),
  });
  if (!res.ok) throw new Error(`Save failed`);
  return res.json() as Promise<{ user: string; soul: string }>;
}

export async function continueTask(taskId: string, payload: ContinuePayload) {
  const res = await fetch(
    `${BASE}/task/${encodeURIComponent(taskId)}/continue`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) throw new Error(`Continue failed`);
  return res.json() as Promise<TaskDetail>;
}

export async function approveTask(taskId: string, response: string) {
  const res = await fetch(
    `${BASE}/task/${encodeURIComponent(taskId)}/approve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response }),
    }
  );
  if (!res.ok) throw new Error("提交审核失败");
  return res.json();
}

export async function fsHome() {
  const res = await fetch(`${BASE}/fs/home`);
  if (!res.ok) throw new Error("获取主目录失败");
  return res.json() as Promise<FsHomeResponse>;
}

export async function fsList(path: string, showHidden = false) {
  const res = await fetch(
    `${BASE}/fs/list?path=${encodeURIComponent(path)}&show_hidden=${showHidden}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "读取目录失败" }));
    throw new Error(err.detail || "读取目录失败");
  }
  return res.json() as Promise<FsListResponse>;
}
