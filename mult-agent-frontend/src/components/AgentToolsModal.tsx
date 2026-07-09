import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Play, Square, RefreshCw, Loader, Wrench, AlertCircle } from "lucide-react";
import { getAgentTools, startAgent, stopAgent } from "../api";
import type { AgentTool } from "../types";

interface Props {
  agentName: string;
  displayName: string;
  color: string;
  onClose: () => void;
}

export default function AgentToolsModal({ agentName, displayName, color, onClose }: Props) {
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<"start" | "stop" | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAgentTools(agentName);
      setTools(data.tools);
      setRunning(data.running);
      if (data.error) setError(data.error);
    } catch (err: any) {
      setError(err.message || "查询失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentName]);

  const handleStart = async () => {
    setActing("start");
    setError(null);
    try {
      await startAgent(agentName);
      await refresh();
    } catch (err: any) {
      setError(err.message || "启动失败");
    } finally {
      setActing(null);
    }
  };

  const handleStop = async () => {
    setActing("stop");
    setError(null);
    try {
      await stopAgent(agentName);
      await refresh();
    } catch (err: any) {
      setError(err.message || "停止失败");
    } finally {
      setActing(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-2xl w-full max-w-xl mx-4 shadow-2xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: `${color}18` }}
            >
              <Wrench size={16} style={{ color }} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)]">{displayName}</h3>
              <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${running ? "animate-pulse" : ""}`}
                  style={{ background: running ? "#22c55e" : "#52525b" }}
                />
                {running ? "运行中" : "未启动"} · MCP 工具列表
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text-primary)]">
            <X size={16} />
          </button>
        </div>

        <div className="flex items-center gap-2 p-3 border-b border-[var(--border-subtle)] bg-[var(--bg-glass)]">
          <button
            onClick={running ? handleStop : handleStart}
            disabled={acting !== null}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50 ${
              running
                ? "border-red-500/30 text-red-300 hover:bg-red-500/10"
                : "border-green-500/30 text-green-300 hover:bg-green-500/10"
            }`}
          >
            {acting !== null ? (
              <Loader size={12} className="animate-spin" />
            ) : running ? (
              <Square size={12} />
            ) : (
              <Play size={12} />
            )}
            {running ? "停止" : "启动"}
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            刷新
          </button>
          <span className="ml-auto text-[11px] text-[var(--text-dim)] tabular-nums">
            {tools.length} 个工具
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {error && (
            <div className="flex items-start gap-2 text-amber-300 text-xs bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span className="break-all">{error}</span>
            </div>
          )}
          {!loading && tools.length === 0 && !error && (
            <div className="text-center py-10 text-[var(--text-dim)] text-xs">
              {running ? "该 MCP server 未暴露任何工具" : "点击「启动」连接 MCP server"}
            </div>
          )}
          {tools.map((t) => {
            const isOpen = expanded === t.name;
            return (
              <div
                key={t.name}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] overflow-hidden"
              >
                <button
                  onClick={() => setExpanded(isOpen ? null : t.name)}
                  className="w-full p-3 flex items-start gap-2 text-left hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono font-semibold text-[var(--text-primary)]">{t.name}</div>
                    {t.description && (
                      <div className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">
                        {t.description}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-[var(--text-dim)] mt-0.5">
                    {isOpen ? "−" : "+"}
                  </span>
                </button>
                {isOpen && (
                  <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-glass)]">
                    <div className="text-[10px] text-[var(--text-dim)] mb-1">Input Schema</div>
                    <pre className="text-[10px] font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                      {JSON.stringify(t.input_schema, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
