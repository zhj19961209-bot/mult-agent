import type { TaskStatus } from "../types";

const config: Record<TaskStatus, { color: string; bg: string; label: string }> = {
  pending: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)", label: "等待中" },
  running: { color: "#3b82f6", bg: "rgba(59,130,246,0.12)", label: "执行中" },
  completed: { color: "#22c55e", bg: "rgba(34,197,94,0.12)", label: "已完成" },
  failed: { color: "#ef4444", bg: "rgba(239,68,68,0.12)", label: "失败" },
  cancelled: { color: "#71717a", bg: "rgba(113,113,122,0.12)", label: "已取消" },
};

export default function StatusBadge({ status }: { status: TaskStatus }) {
  const c = config[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ color: c.color, background: c.bg }}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${status === "running" ? "animate-pulse" : ""}`}
        style={{ background: c.color }}
      />
      {c.label}
    </span>
  );
}
