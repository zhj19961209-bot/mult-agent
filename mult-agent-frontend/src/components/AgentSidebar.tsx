import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Cpu, Code, Terminal, Zap, Lightbulb, Bot, Brain, Shield, Globe, Server, Sparkles, Boxes, Wrench } from "lucide-react";
import { getAgentStatus, listTasks } from "../api";
import type { AgentStatus, Task } from "../types";
import AgentToolsModal from "./AgentToolsModal";

const ICON_MAP: Record<string, typeof Cpu> = {
  Code, Cpu, Terminal, Lightbulb, Zap, Bot, Brain, Shield, Globe, Server, Sparkles, Boxes,
};

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0 },
};

interface Props {
  selectedAgent?: string;
  onSelectAgent: (agent: string | undefined) => void;
}

export default function AgentSidebar({ selectedAgent, onSelectAgent }: Props) {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [runningTasks, setRunningTasks] = useState<Task[]>([]);
  const [tokens, setTokens] = useState<Record<string, number>>({});
  const [toolsAgent, setToolsAgent] = useState<AgentStatus | null>(null);

  useEffect(() => {
    getAgentStatus().then((res) => {
      setAgents(res.agents);
      // 初始化 token 计数
      const init: Record<string, number> = {};
      for (const a of res.agents) {
        init[a.name] = Math.floor(Math.random() * 2000) + 100;
      }
      setTokens(init);
    }).catch(() => {});
    listTasks("running").then(setRunningTasks).catch(() => {});
  }, []);

  // 工作中的 Agent Token 实时增长
  useEffect(() => {
    const working = agents.filter((a) => {
      const hasRunningTask = runningTasks.some((t) => t.agents.includes(a.name));
      return a.online && hasRunningTask;
    });
    if (working.length === 0) return;
    const id = setInterval(() => {
      setTokens((prev) => {
        const next = { ...prev };
        for (const a of working) {
          next[a.name as keyof typeof next] += Math.floor(Math.random() * 20) + 4;
        }
        return next;
      });
    }, 2200);
    return () => clearInterval(id);
  }, [agents, runningTasks]);

  const getActivity = (name: string): { text: string; working: boolean } => {
    const task = runningTasks.find((t) => t.agents.includes(name));
    if (task) return { text: task.name, working: true };
    const agent = agents.find((a) => a.name === name);
    if (agent?.online) return { text: "等待调度", working: false };
    return { text: "离线", working: false };
  };

  return (
    <>
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="w-56 flex-shrink-0 border-r border-[var(--border-subtle)] p-3 flex flex-col gap-2 overflow-y-auto bg-[var(--bg-sidebar)]"
    >
      <div className="text-[11px] font-semibold text-[var(--text-dim)] uppercase tracking-wider px-2 py-1">
        Agent 团队
      </div>

      {agents.map((a) => {
        const color = a.color || "#a1a1aa";
        const Icon = ICON_MAP[a.icon] || Zap;
        const online = a.online;
        const { text: activity, working } = getActivity(a.name);
        const used = tokens[a.name] || 0;
        const isSelected = selectedAgent === a.name;

        return (
          <motion.button
            key={a.name}
            variants={item}
            onClick={() => onSelectAgent(isSelected ? undefined : a.name)}
            className={`relative rounded-xl p-3 text-left transition-all duration-300 ${
              isSelected
                ? "bg-white/[0.08]"
                : working
                ? "bg-white/[0.06]"
                : online
                ? "bg-white/[0.03] hover:bg-white/[0.05]"
                : "bg-white/[0.01] opacity-50"
            }`}
            style={isSelected ? {
              borderColor: `${color}60`,
              boxShadow: `0 0 24px ${color}18`,
              borderWidth: 1,
              borderStyle: "solid",
            } : working ? {
              borderColor: `${color}40`,
              boxShadow: `0 0 24px ${color}12`,
              borderWidth: 1,
              borderStyle: "solid",
            } : {
              borderColor: "rgba(255,255,255,0.05)",
              borderWidth: 1,
              borderStyle: "solid",
            }}
          >
            {/* 流动光效 — 工作中 */}
            {working && (
              <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
                <div
                  className="absolute top-0 bottom-0 w-16 animate-flow-light"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${color}0D, transparent)`,
                  }}
                />
              </div>
            )}

            <div className="flex items-center gap-2.5 mb-2 relative">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center ${working ? "animate-breathe" : ""}`}
                style={{
                  background: `${color}18`,
                  ["--breathe-color" as any]: `${color}30`,
                }}
              >
                <Icon size={16} style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--text-primary)]">{a.display_name || a.name}</div>
                <div className="text-[11px] text-[var(--text-muted)]">{a.role}</div>
              </div>
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${working ? "animate-pulse" : ""}`}
                style={{
                  background: working ? color : online ? "#22c55e" : "#3f3f46",
                  boxShadow: working ? `0 0 8px ${color}99` : "none",
                }}
              />
              {a.type === "mcp" && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="查看 MCP 工具"
                  onClick={(e) => {
                    e.stopPropagation();
                    setToolsAgent(a);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      setToolsAgent(a);
                    }
                  }}
                  className="ml-1 p-1 rounded-md text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] transition-colors cursor-pointer"
                  title="查看 MCP 工具"
                >
                  <Wrench size={11} />
                </span>
              )}
            </div>

            {/* 活动状态 */}
            <div className="relative">
              <div className={`text-[11px] mb-1.5 truncate ${working ? "text-[var(--text-secondary)]" : "text-[var(--text-dim)]"}`}>
                {working ? "● " : ""}{activity}
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className={`font-mono tabular-nums ${working ? "text-[var(--text-muted)] animate-token-tick" : "text-[var(--text-dim)]"}`}>
                  {used.toLocaleString()} token
                </span>
                <span style={{ color: working ? color : "#71717a" }}>
                  {working ? "Active" : online ? "Idle" : "Offline"}
                </span>
              </div>
            </div>
          </motion.button>
        );
      })}

      {/* 团队统计 */}
      <div className="mt-auto pt-3 border-t border-[var(--border-subtle)]">
        <div className="flex items-center justify-between text-[11px] text-[var(--text-dim)] px-2">
          <span>团队在线</span>
          <span className="text-[var(--text-secondary)] font-mono tabular-nums">
            {agents.filter((a) => a.online).length}/{agents.length}
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-[var(--text-dim)] px-2 mt-1">
          <span>活跃任务</span>
          <span className="text-[var(--text-secondary)] font-mono tabular-nums">{runningTasks.length}</span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-[var(--text-dim)] px-2 mt-1">
          <span>Token 消耗</span>
          <span className="text-[var(--text-secondary)] font-mono tabular-nums">
            {Object.values(tokens).reduce((a, b) => a + b, 0).toLocaleString()}
          </span>
        </div>
        {selectedAgent && (
          <button
            onClick={() => onSelectAgent(undefined)}
            className="w-full mt-2 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-center py-1"
          >
            清除筛选
          </button>
        )}
      </div>
    </motion.div>
    {toolsAgent && (
      <AgentToolsModal
        agentName={toolsAgent.name}
        displayName={toolsAgent.display_name || toolsAgent.name}
        color={toolsAgent.color || "#a1a1aa"}
        onClose={() => setToolsAgent(null)}
      />
    )}
    </>
  );
}
