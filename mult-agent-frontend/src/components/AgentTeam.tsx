import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Code, Cpu, Terminal, Lightbulb, Wifi, WifiOff, Loader2, Plus, Trash2, Zap, Bot, Brain, Shield, Globe, Server } from "lucide-react";
import { getAgents, listTasks, deleteAgent } from "../api";
import type { AgentStatus, Task } from "../types";
import AddAgentModal from "./AddAgentModal";

const ICON_MAP: Record<string, typeof Cpu> = {
  Code, Cpu, Terminal, Lightbulb, Zap, Bot, Brain, Shield, Globe, Server,
};

const BUILTIN = new Set(["codex", "claude", "depk", "tli"]);

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

const card = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

export default function AgentTeam() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [runningTasks, setRunningTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      getAgents().then((r) => setAgents(r.agents)).catch(() => {}),
      listTasks().then(setRunningTasks).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (name: string) => {
    try {
      await deleteAgent(name);
      setAgents((prev) => prev.filter((a) => a.name !== name));
    } catch {}
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--text-dim)]">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="max-w-4xl mx-auto animate-slide-up"
    >
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">Agent 团队</h2>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-[var(--bg-button)] hover:bg-[var(--bg-button-hover)] text-[var(--text-primary)] border border-[var(--border-strong)] transition-colors"
        >
          <Plus size={13} /> 添加 Agent
        </button>
      </div>
      <p className="text-xs text-[var(--text-dim)] mb-6">
        当前 {agents.filter((a) => a.online).length}/{agents.length} 在线，{runningTasks.filter((t) => t.status === "running").length} 个任务执行中
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map((a) => {
          const Icon = ICON_MAP[a.icon] || Zap;
          const online = a.online;
          const activeTask = runningTasks.find((t) => t.agents.includes(a.name) && t.status === "running");
          const recentTasks = runningTasks.filter((t) => t.agents.includes(a.name)).slice(0, 3);
          const isBuiltin = BUILTIN.has(a.name);

          return (
            <motion.div
              key={a.name}
              variants={card}
              className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-5 relative group"
              style={{ borderLeftColor: a.color, borderLeftWidth: 3 }}
            >
              {/* Delete button for custom agents */}
              {!isBuiltin && (
                <button
                  onClick={() => handleDelete(a.name)}
                  className="absolute top-3 right-3 text-[var(--text-dim)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                  title="删除 Agent"
                >
                  <Trash2 size={13} />
                </button>
              )}

              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: `${a.color}18` }}
                >
                  <Icon size={20} style={{ color: a.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">
                      {a.display_name || a.name}
                    </span>
                    {activeTask && (
                      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: a.color }} />
                    )}
                  </div>
                  <span className="text-[11px] text-[var(--text-muted)]">{a.role}</span>
                </div>
                <div
                  className="flex items-center gap-1 text-[11px] font-medium rounded-full px-2.5 py-0.5"
                  style={{
                    color: online ? "#22c55e" : "#71717a",
                    background: online ? "#22c55e15" : "#71717a10",
                  }}
                >
                  {online ? <Wifi size={10} /> : <WifiOff size={10} />}
                  {online ? "在线" : "离线"}
                </div>
              </div>

              <div className="space-y-2 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-[var(--text-dim)]">类型</span>
                  <span className="text-[var(--text-secondary)] font-mono">
                    {a.type === "builtin" ? "内置" : "本地 CLI"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-dim)]">名称</span>
                  <span className="text-[var(--text-secondary)] font-mono text-[10px]">{a.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-dim)]">当前状态</span>
                  <span className="text-[var(--text-secondary)]">
                    {activeTask ? `● ${activeTask.name}` : "空闲"}
                  </span>
                </div>
              </div>

              {recentTasks.length > 0 && (
                <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
                  <div className="text-[10px] text-[var(--text-dim)] mb-2 uppercase tracking-wider">最近任务</div>
                  <div className="space-y-1">
                    {recentTasks.map((t) => (
                      <div key={t.task_id} className="flex items-center justify-between text-[11px]">
                        <span className="text-[var(--text-secondary)] truncate flex-1 mr-2">{t.name}</span>
                        <span
                          className="font-mono flex-shrink-0"
                          style={{
                            color:
                              t.status === "running" ? "#3b82f6" :
                              t.status === "completed" ? "#22c55e" :
                              t.status === "failed" ? "#ef4444" : "#71717a",
                          }}
                        >
                          {t.status === "running" ? "running" :
                           t.status === "completed" ? "done" :
                           t.status === "failed" ? "failed" : t.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {showModal && (
        <AddAgentModal
          onCreated={(agent) => {
            setAgents((prev) => [...prev, agent]);
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </motion.div>
  );
}
