import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart3, CheckCircle2, XCircle, RotateCw, Zap, TrendingUp, TrendingDown } from "lucide-react";
import { listTasks } from "../api";
import type { Task } from "../types";
import TaskCard from "./TaskCard";
import ProgressBar from "./ProgressBar";

interface Props {
  statusFilter?: string;
  agentFilter?: string;
  onStatusFilter: (f: string | undefined) => void;
  onClearAgentFilter: () => void;
  onSelectTask: (id: string) => void;
}

const filters = [
  { label: "全部", value: undefined, key: "all" },
  { label: "执行中", value: "running", key: "running" },
  { label: "已完成", value: "completed", key: "completed" },
  { label: "失败", value: "failed", key: "failed" },
];

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

// 确定性伪随机生成 sparkline 柱高
function hashSeed(s: string): number[] {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  const abs = Math.abs(h);
  return Array.from({ length: 6 }).map((_, i) => 25 + ((abs * (i + 1) * 7 + i * 13) % 55));
}

function Sparkline({ color, seed }: { color: string; seed: string }) {
  const bars = useMemo(() => hashSeed(seed), [seed]);
  return (
    <div className="flex items-end gap-0.5 h-6">
      {bars.map((h, i) => (
        <div
          key={i}
          className="w-1.5 rounded-sm flex-shrink-0"
          style={{ height: `${h}%`, background: color, opacity: 0.2 + (i / bars.length) * 0.75 }}
        />
      ))}
    </div>
  );
}

function stripDesc(desc: string): string {
  const match = desc.match(/\[任务\]\n?(.+)$/s);
  return match ? match[1].trim() : desc;
}

export default function TaskList({ statusFilter, agentFilter, onStatusFilter, onClearAgentFilter, onSelectTask }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = () => {
    setLoading(true);
    setError(null);
    listTasks(statusFilter)
      .then(setTasks)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(fetch, [statusFilter]);

  // 客户端按 Agent 过滤
  const filteredTasks = useMemo(
    () => agentFilter ? tasks.filter((t) => t.agents.includes(agentFilter)) : tasks,
    [tasks, agentFilter]
  );

  const stats = useMemo(() => ({
    total: filteredTasks.length,
    running: filteredTasks.filter((t) => t.status === "running").length,
    completed: filteredTasks.filter((t) => t.status === "completed").length,
    failed: filteredTasks.filter((t) => t.status === "failed").length,
    successRate: filteredTasks.length > 0
      ? Math.round((filteredTasks.filter((t) => t.status === "completed").length / filteredTasks.length) * 100)
      : 0,
  }), [filteredTasks]);

  const runningTask = useMemo(() => filteredTasks.find((t) => t.status === "running"), [filteredTasks]);
  const latestCompleted = useMemo(
    () => filteredTasks.filter((t) => t.status === "completed").slice(-1)[0],
    [filteredTasks]
  );

  return (
    <div className="max-w-5xl mx-auto animate-slide-up">
      {/* ═══════ Current Mission — 页面视觉焦点 ═══════ */}
      {runningTask && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="text-[10px] font-semibold text-blue-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <Zap size={10} className="animate-pulse" />
            Current Mission
          </div>
          <div
            onClick={() => onSelectTask(runningTask.task_id)}
            className="relative bg-[var(--bg-surface-raised)] rounded-2xl p-6 cursor-pointer transition-all duration-300 hover:bg-[var(--bg-surface-hover)]"
            style={{
              borderLeft: "3px solid #3b82f6",
              boxShadow: "0 0 40px rgba(59,130,246,0.06)",
            }}
          >
            {/* 径向光晕 */}
            <div
              className="absolute inset-0 rounded-2xl opacity-8 pointer-events-none"
              style={{
                background: "radial-gradient(ellipse at 30% 50%, rgba(59,130,246,0.2), transparent 70%)",
              }}
            />

            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <h2 className="text-lg font-bold text-[var(--text-primary)] mb-2">
                  {runningTask.name}
                </h2>
                <p className="text-sm text-[var(--text-muted)] max-w-xl line-clamp-2 leading-relaxed">
                  {stripDesc(runningTask.description || "") || "无描述"}
                </p>
              </div>
              <span className="inline-flex items-center gap-2 text-xs font-medium text-blue-400 bg-blue-500/10 rounded-full px-3 py-1.5 ml-4 flex-shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                Running
              </span>
            </div>

            {/* 进度 */}
            <div className="flex items-center gap-6 mb-4">
              <div className="flex-1 max-w-sm">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] text-[var(--text-muted)]">Progress</span>
                  <span className="text-[11px] text-blue-400 tabular-nums font-mono">
                    {runningTask.progress}%
                  </span>
                </div>
                <ProgressBar progress={runningTask.progress} />
              </div>
              <div className="flex items-center gap-3 text-[11px] text-[var(--text-dim)]">
                {runningTask.agents.map((a) => (
                  <span key={a} className="text-[var(--text-secondary)] capitalize">{a}</span>
                ))}
                <span>{runningTask.mode === "parallel" ? "∥ parallel" : "→ sequential"}</span>
              </div>
            </div>

            {/* Live 指示 */}
            <div className="flex items-center gap-2 pt-3 border-t border-[var(--border-subtle)]">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
              <span className="text-[11px] text-[var(--text-muted)]">Live — 点击查看实时详情</span>
            </div>
          </div>
        </motion.div>
      )}

      {/* ═══════ Latest Completion — 无运行任务时展示 ═══════ */}
      {!runningTask && latestCompleted && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="text-[10px] font-semibold text-emerald-400 uppercase tracking-widest mb-3 flex items-center gap-2">
            <CheckCircle2 size={10} />
            Latest Completion
          </div>
          <div
            onClick={() => onSelectTask(latestCompleted.task_id)}
            className="relative bg-[var(--bg-surface)] rounded-2xl p-5 cursor-pointer transition-all duration-300 hover:bg-[var(--bg-surface-hover)]"
            style={{
              borderLeft: "3px solid #22c55e",
              boxShadow: "0 0 20px rgba(34,197,94,0.04)",
            }}
          >
            <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1.5">
              {latestCompleted.name}
            </h3>
            <p className="text-sm text-[var(--text-muted)] line-clamp-1 leading-relaxed">
              {stripDesc(latestCompleted.description || "") || "无描述"}
            </p>
          </div>
        </motion.div>
      )}

      {/* ═══════ 统计区 — 玻璃态 + sparkline ═══════ */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 mb-6">
        {([
          { label: "Total", value: stats.total, icon: BarChart3, color: "#a1a1aa", seed: "total", trend: null as "up" | "down" | null },
          { label: "Running", value: stats.running, icon: RotateCw, color: "#3b82f6", seed: "running", trend: null as "up" | "down" | null },
          { label: "Done", value: stats.completed, icon: CheckCircle2, color: "#22c55e", seed: "done", trend: (stats.completed > 0 ? "up" : null) as "up" | "down" | null },
          { label: "Failed", value: stats.failed, icon: XCircle, color: "#ef4444", seed: "failed", trend: (stats.failed > 0 ? "down" : null) as "up" | "down" | null },
          { label: "Success", value: `${stats.successRate}%`, icon: TrendingUp, color: "#f59e0b", seed: "success", trend: (stats.successRate >= 50 ? "up" : "down") as "up" | "down" | null },
        ]).map((s) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[var(--bg-glass)] rounded-xl p-3 border border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-[var(--text-dim)]">{s.label}</span>
              <s.icon size={12} style={{ color: s.color, opacity: 0.6 }} />
            </div>
            <div className="flex items-end justify-between mb-2">
              <span className="text-xl font-bold text-[var(--text-primary)] tabular-nums">{s.value}</span>
              {s.trend && (
                <span className={`text-[10px] flex items-center gap-0.5 ${s.trend === "up" ? "text-emerald-500" : "text-red-400"}`}>
                  {s.trend === "up" ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                </span>
              )}
            </div>
            <Sparkline color={s.color} seed={s.seed} />
          </motion.div>
        ))}
      </div>

      {/* Agent 筛选指示 */}
      {agentFilter && (
        <div className="flex items-center gap-2 mb-4 px-4 py-2 bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)]">
          <span className="text-[11px] text-[var(--text-muted)]">按 Agent 筛选：</span>
          <span className="text-[11px] font-medium text-[var(--text-primary)] capitalize">{agentFilter}</span>
          <button
            onClick={onClearAgentFilter}
            className="ml-auto text-[11px] text-[var(--text-dim)] hover:text-[var(--text-primary)] transition-colors"
          >
            清除
          </button>
        </div>
      )}

      {/* ═══════ 筛选栏 ═══════ */}
      <div className="flex items-center gap-2 mb-5">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => onStatusFilter(f.value)}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
              statusFilter === f.value
                ? "bg-[var(--bg-button)] border-[var(--border-accent)] text-[var(--text-primary)]"
                : "bg-transparent border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
            }`}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={fetch}
          className="ml-auto flex items-center gap-1 text-xs text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors"
        >
          <RotateCw size={12} /> 刷新
        </button>
      </div>

      {/* ═══════ 内容区 ═══════ */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-[var(--bg-glass)] rounded-xl p-6 animate-pulse"
              style={{ borderLeft: "3px solid rgba(255,255,255,0.04)" }}
            >
              <div className="h-4 bg-[var(--bg-surface-raised)] rounded w-2/3 mb-3" />
              <div className="h-3 bg-[var(--bg-glass)] rounded w-full mb-2" />
              <div className="h-3 bg-[var(--bg-glass)] rounded w-1/3" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="text-center py-20">
          <p className="text-red-400 mb-3">{error}</p>
          <button
            onClick={fetch}
            className="px-4 py-2 bg-[var(--bg-button)] rounded-lg text-sm hover:bg-[var(--bg-button-hover)] transition-colors"
          >
            重试
          </button>
        </div>
      )}

      {!loading && !error && filteredTasks.length === 0 && (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center mx-auto mb-4">
            <Zap size={24} className="text-[var(--text-dim)]" />
          </div>
          <p className="text-[var(--text-secondary)] mb-1">
            {agentFilter ? `没有 ${agentFilter} 参与的任务` : statusFilter ? "没有匹配的任务" : "还没有任务"}
          </p>
          <p className="text-xs text-[var(--text-dim)]">
            {agentFilter ? "试试选择其他 Agent 或清除筛选" : "点击顶部 + 新建任务 启动你的 AI 团队"}
          </p>
        </div>
      )}

      {!loading && !error && filteredTasks.length > 0 && (
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 md:grid-cols-2 gap-3"
        >
          <AnimatePresence mode="popLayout">
            {filteredTasks.map((t) => (
              <TaskCard
                key={t.task_id}
                task={t}
                onClick={() => onSelectTask(t.task_id)}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
