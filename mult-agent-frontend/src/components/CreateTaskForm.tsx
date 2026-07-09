import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Plus, X, Send, Folder } from "lucide-react";
import { createTask, getAgents } from "../api";
import type { TaskMode, AgentStatus } from "../types";
import DirectoryPicker from "./DirectoryPicker";

interface Props {
  onCreated: (taskId: string) => void;
}

const WORKSPACE_LS_KEY = "mult-agent.recent-workspaces";

function loadRecentWorkspaces(): string[] {
  try {
    const raw = localStorage.getItem(WORKSPACE_LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, 5) : [];
  } catch {
    return [];
  }
}

function pushRecentWorkspace(path: string) {
  try {
    const list = loadRecentWorkspaces().filter((p) => p !== path);
    list.unshift(path);
    localStorage.setItem(WORKSPACE_LS_KEY, JSON.stringify(list.slice(0, 5)));
  } catch {
    /* ignore */
  }
}

export default function CreateTaskForm({ onCreated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<TaskMode>("sequential");
  const [agents, setAgents] = useState<string[]>(["claude"]);
  const [commands, setCommands] = useState<string[]>([]);
  const [workspaceDir, setWorkspaceDir] = useState<string>("");
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allAgents, setAllAgents] = useState<AgentStatus[]>([]);

  useEffect(() => {
    getAgents().then((r) => setAllAgents(r.agents.filter((a) => a.enabled))).catch(() => {});
    setRecentWorkspaces(loadRecentWorkspaces());
  }, []);

  const toggleAgent = (a: string) => {
    setAgents((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || agents.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const task = await createTask({
        name: name.trim(),
        description,
        mode,
        agents,
        tli_commands: commands.filter((c) => c.trim()),
        workspace_dir: workspaceDir.trim() || undefined,
      });
      if (workspaceDir.trim()) pushRecentWorkspace(workspaceDir.trim());
      onCreated(task.task_id);
    } catch (err: any) {
      setError(err.message || "创建失败");
    } finally {
      setSending(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-xl mx-auto animate-slide-up"
    >
      <h2 className="text-lg font-bold text-[var(--text-primary)] mb-6">创建新任务</h2>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1.5">任务名称</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
            placeholder="例如：设计用户认证模块"
            className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)] focus:bg-[var(--bg-surface-hover)] transition-colors"
          />
        </div>

        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1.5">任务描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="描述你希望 AI 团队完成的任务..."
            className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)] focus:bg-[var(--bg-surface-hover)] transition-colors resize-none"
          />
        </div>

        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1.5">
            工作目录
            <span className="text-[var(--text-dim)] ml-1">— Agent 在此目录读写文件（留空使用各 Agent 默认）</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={workspaceDir}
              onChange={(e) => setWorkspaceDir(e.target.value)}
              spellCheck={false}
              placeholder="例如：/Users/your/project"
              className="flex-1 bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-4 py-2.5 text-xs font-mono text-[var(--text-secondary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)]"
            />
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm rounded-lg border border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition-colors"
            >
              <Folder size={14} /> 浏览…
            </button>
          </div>
          {recentWorkspaces.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {recentWorkspaces.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setWorkspaceDir(p)}
                  className="px-2 py-1 text-[10px] font-mono rounded-md border border-[var(--border-default)] text-[var(--text-dim)] hover:text-[var(--text-secondary)] hover:border-[var(--border-strong)] truncate max-w-[260px]"
                  title={p}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1.5">执行模式</label>
          <div className="flex gap-2">
            {(["sequential", "parallel", "collaborative"] as TaskMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 px-3 py-2.5 text-sm rounded-lg border transition-all ${
                  mode === m
                    ? "bg-[var(--bg-button)] border-[var(--border-accent)] text-[var(--text-primary)]"
                    : "bg-transparent border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--border-strong)]"
                }`}
              >
                {m === "sequential" ? "→ 串行" : m === "parallel" ? "∥ 并行" : "⇄ 协作"}
              </button>
            ))}
          </div>
          {mode === "collaborative" && (
            <p className="text-[10px] text-[var(--text-dim)] mt-1.5">
              所有 agent 按轮次并行执行，通过 <code className="text-amber-400 bg-amber-500/10 rounded px-1">@AgentName: ...</code> 互发消息，最多 5 轮，无新消息时自动结束。
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1.5">选择 Agent（至少一个）</label>
          <div className="flex gap-2 flex-wrap">
            {allAgents.map((a) => (
              <button
                key={a.name}
                type="button"
                onClick={() => toggleAgent(a.name)}
                className={`px-4 py-2.5 text-sm rounded-lg border transition-all ${
                  agents.includes(a.name)
                    ? "bg-[var(--bg-button)] border-[var(--border-accent)] text-[var(--text-primary)]"
                    : "bg-transparent border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--border-strong)]"
                }`}
              >
                {a.display_name || a.name}
              </button>
            ))}
          </div>
        </div>

        {agents.some((name) => {
          const agent = allAgents.find((a) => a.name === name);
          return agent?.type === "builtin" || name === "tli";
        }) && (
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">
              TLI 终端命令
              <span className="text-[var(--text-dim)] ml-1">— 由 TLI Agent 在沙箱中执行</span>
            </label>
            {commands.map((cmd, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={cmd}
                  onChange={(e) => {
                    const next = [...commands];
                    next[i] = e.target.value;
                    setCommands(next);
                  }}
                  placeholder="例如: python test.py"
                  className="flex-1 bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-1.5 text-xs font-mono text-[var(--text-secondary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)]"
                />
                <button
                  type="button"
                  onClick={() => setCommands((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-[var(--text-dim)] hover:text-red-400 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setCommands((prev) => [...prev, ""])}
              className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              <Plus size={12} /> 添加命令
            </button>
            <p className="text-[10px] text-[var(--text-dim)] mt-2">
              可用命令: ls, cat, echo, pwd, mkdir, grep, find, python, python3, node, npm, pip, claude, codex, depk — 危险操作已拦截
            </p>
          </div>
        )}

        {error && (
          <div className="text-red-400 text-xs bg-red-500/5 border border-red-500/10 rounded-lg p-3">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={sending || !name.trim() || agents.length === 0}
          className="w-full flex items-center justify-center gap-2 py-3 bg-[var(--bg-button)] hover:bg-[var(--bg-button-hover)] text-[var(--text-primary)] rounded-lg text-sm font-medium border border-[var(--border-strong)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Send size={14} />
          {sending ? "正在创建..." : "创建任务"}
        </button>
      </form>

      {showPicker && (
        <DirectoryPicker
          initialPath={workspaceDir || undefined}
          onClose={() => setShowPicker(false)}
          onSelect={(p) => {
            setWorkspaceDir(p);
            setShowPicker(false);
          }}
        />
      )}
    </motion.div>
  );
}
