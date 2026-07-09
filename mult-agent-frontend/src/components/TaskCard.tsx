import { useState } from "react";
import { motion } from "framer-motion";
import type { Task, TaskStatus } from "../types";

interface Props {
  task: Task;
  onClick: () => void;
}

const statusColor: Record<TaskStatus, string> = {
  pending: "#f59e0b",
  running: "#3b82f6",
  completed: "#22c55e",
  failed: "#ef4444",
  cancelled: "#71717a",
};

const statusLabel: Record<TaskStatus, string> = {
  pending: "等待中",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const agentAccent: Record<string, string> = {
  codex: "#3b82f6",
  claude: "#8b5cf6",
  tli: "#f97316",
  depk: "#06b6d4",
};

function relativeTime(iso: string): string {
  if (!iso) return "";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function stripDesc(desc: string): string {
  const match = desc.match(/\[任务\]\n(.+)$/s);
  return match ? match[1].trim() : desc;
}

// 关键词高亮
function highlightKeywords(text: string) {
  const parts = text.split(/(`[^`]+`|\b\w+\.(?:py|js|ts|md|json|yaml|yml|sh|toml)\b|\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b)/g);
  return parts.map((part, i) => {
    if (/^`[^`]+`$/.test(part)) {
      return <code key={i} className="text-amber-300 bg-amber-500/10 rounded px-1 py-0.5 text-[11px]">{part.replace(/`/g, "")}</code>;
    }
    if (/\.(?:py|js|ts|md|json|yaml|yml|sh|toml)$/.test(part)) {
      return <code key={i} className="text-blue-300 bg-blue-500/10 rounded px-1 py-0.5 text-[11px]">{part}</code>;
    }
    return part;
  });
}

export default function TaskCard({ task, onClick }: Props) {
  const [hovered, setHovered] = useState(false);
  const desc = stripDesc(task.description || "");
  const isRunning = task.status === "running";
  const accent = agentAccent[task.agents[0]] || "#52525b";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      className="group/card relative cursor-pointer transition-all duration-300"
      style={{ transform: hovered ? "translateY(-2px)" : "translateY(0)" }}
    >
      <div
        className="relative rounded-xl p-6 transition-all duration-300"
        style={{
          background: hovered ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)",
          borderLeft: `3px solid ${isRunning ? accent : "rgba(255,255,255,0.06)"}`,
          boxShadow: isRunning
            ? `0 0 20px ${accent}10`
            : hovered
            ? "0 4px 20px rgba(0,0,0,0.3)"
            : "none",
        }}
      >
        {/* 右上角微光 */}
        {isRunning && (
          <div
            className="absolute top-0 right-0 w-24 h-full opacity-8 pointer-events-none rounded-xl"
            style={{
              background: `linear-gradient(135deg, transparent, ${accent}08, transparent)`,
            }}
          />
        )}

        {/* 头部 */}
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] group-hover/card:text-white transition-colors pr-3 leading-snug">
            {task.name}
          </h3>
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full px-2.5 py-0.5 flex-shrink-0"
            style={{ color: statusColor[task.status], background: `${statusColor[task.status]}12` }}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${isRunning ? "animate-pulse" : ""}`}
              style={{ background: statusColor[task.status] }}
            />
            {statusLabel[task.status]}
          </span>
        </div>

        {/* 描述 — 更大留白 + 关键词高亮 */}
        {desc && (
          <p className="text-xs text-[var(--text-muted)] mb-4 line-clamp-2 leading-relaxed">
            {highlightKeywords(desc)}
          </p>
        )}

        {/* 底部信息 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {task.agents.map((a) => {
              const c = agentAccent[a] || "#a1a1aa";
              return (
                <span key={a} className="inline-flex items-center gap-1.5 text-[11px]">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: c }}
                  />
                  <span className="text-[var(--text-secondary)] capitalize">{a}</span>
                </span>
              );
            })}
            <span className="text-[var(--text-dim)] text-[10px]">
              {task.mode === "parallel" ? "∥" : "→"}
            </span>
          </div>

          <span className="text-[11px] text-[var(--text-dim)]">
            {relativeTime(task.created_at)}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
