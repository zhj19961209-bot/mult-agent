import { useEffect, useRef } from "react";
import type { LogEntry } from "../types";
import ToolTraceRenderer from "./ToolTraceRenderer";

const ANSI = /(?:\x1b)?\[[0-9;]*m/g;
function strip(s: string) { return s.replace(ANSI, ""); }

const agentColor: Record<string, string> = {
  codex: "#3b82f6",
  claude: "#8b5cf6",
  tli: "#f97316",
  depk: "#06b6d4",
};

export default function LogPanel({ logs }: { logs: LogEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  return (
    <div className="bg-black/40 border border-[var(--border-default)] rounded-xl p-4 h-80 overflow-y-auto font-mono text-xs leading-relaxed">
      {logs.length === 0 ? (
        <p className="text-[var(--text-dim)] text-center mt-28">等待输出...</p>
      ) : (
        logs.map((log) => (
          <div key={log.log_id} className="mb-2.5">
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-dim)] mb-0.5">
              <span>{log.timestamp ? new Date(log.timestamp).toLocaleTimeString("zh-CN") : ""}</span>
              <span style={{ color: agentColor[log.agent_name] || "#a1a1aa" }}>
                {log.agent_name}
              </span>
            </div>
            {log.stdout && (
              <ToolTraceRenderer text={strip(log.stdout)} className="text-[var(--text-secondary)]" />
            )}
            {log.stderr && (
              <pre className="text-red-400/70 whitespace-pre-wrap break-all m-0">{strip(log.stderr)}</pre>
            )}
          </div>
        ))
      )}
      <div ref={bottomRef} />
    </div>
  );
}
