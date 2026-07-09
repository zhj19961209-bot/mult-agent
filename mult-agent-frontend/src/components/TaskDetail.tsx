import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, XCircle, Cpu, User, Clock, ChevronDown, ChevronUp, RefreshCw, ThumbsUp, ThumbsDown } from "lucide-react";
import { getTaskDetail, cancelTask, retryTask, getAgents, queryKnowledge, submitFeedback } from "../api";
import type { TaskDetail as TaskDetailType, LogEntry, ResultEntry, KnowledgeEntry, AgentMessage, AgentStatus } from "../types";
import MarkdownRenderer from "./MarkdownRenderer";
import LogPanel from "./LogPanel";
import ContinueConversation from "./ContinueConversation";
import MessagesPanel from "./MessagesPanel";
import ApprovalModal from "./ApprovalModal";

interface Props {
  taskId: string;
  onBack: () => void;
}

const DEFAULT_COLOR: Record<string, string> = {
  user: "#6366f1",
};

const ANSI = /(?:\x1b)?\[[0-9;]*m/g;
const stripA = (s: string) => s.replace(ANSI, "");

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// 时间线事件：从 logs + results 合并
interface TimelineEvent {
  time: string;
  agent: string;
  type: "result" | "log";
  content: string;
}

function buildTimeline(logs: LogEntry[], results: ResultEntry[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const l of logs) {
    if (l.stdout.trim()) {
      events.push({ time: l.timestamp, agent: l.agent_name, type: "log", content: l.stdout.trim() });
    }
  }
  for (const r of results) {
    const label = r.agent_name === "user" ? "用户提问" : `${r.agent_name} 完成`;
    events.push({
      time: r.created_at,
      agent: r.agent_name,
      type: "result",
      content: r.agent_name === "user" ? r.summary : `${label}：${r.summary.slice(0, 100)}`,
    });
  }
  events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  return events;
}

export default function TaskDetail({ taskId, onBack }: Props) {
  const [task, setTask] = useState<TaskDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTimeline, setShowTimeline] = useState(true);
  const [activeTab, setActiveTab] = useState<"timeline" | "results" | "conversation" | "knowledge" | "messages">("timeline");
  const [agentColor, setAgentColor] = useState<Record<string, string>>(DEFAULT_COLOR);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [feedbackState, setFeedbackState] = useState<Record<string, "positive" | "negative">>({});
  const [liveMessages, setLiveMessages] = useState<AgentMessage[]>([]);
  const [agentList, setAgentList] = useState<AgentStatus[]>([]);
  const [approvalRequest, setApprovalRequest] = useState<{ agentName: string; question: string } | null>(null);

  useEffect(() => {
    getAgents().then((r) => {
      const colors: Record<string, string> = { ...DEFAULT_COLOR };
      for (const a of r.agents) {
        colors[a.name] = a.color || "#a1a1aa";
      }
      setAgentColor(colors);
      setAgentList(r.agents);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (task && task.results.length > 0) {
      const q = task.description || task.name;
      queryKnowledge(q).then((r) => setKnowledge(r.entries)).catch(() => {});
    }
  }, [task]);

  const fetch = useCallback(async () => {
    try {
      const data = await getTaskDetail(taskId);
      setTask(data);
      setError(null);
    } catch (e: any) {
      setError(e.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);

  // WebSocket 实时推送
  const fallbackTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!taskId) return;
    const wsUrl = `ws://localhost:8010/ws/task/${taskId}`;
    let closed = false;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      if (fallbackTimer.current) {
        clearInterval(fallbackTimer.current);
        fallbackTimer.current = null;
      }
    };

    ws.onmessage = (e) => {
      if (closed) return;
      try {
        const event = JSON.parse(e.data);
        if (event.type === "log") {
          setTask((prev) => {
            if (!prev) return prev;
            return { ...prev, logs: [...prev.logs, {
              log_id: Date.now(), agent_name: event.agent_name,
              stdout: event.stdout, stderr: "", timestamp: new Date().toISOString(),
            }]};
          });
        } else if (event.type === "result") {
          setTask((prev) => {
            if (!prev) return prev;
            const exists = prev.results.find((r) => r.agent_name === event.agent_name);
            if (exists) return prev;
            return { ...prev, results: [...prev.results, {
              result_id: Date.now(), agent_name: event.agent_name,
              output: event.output || "", summary: event.summary || "",
              created_at: new Date().toISOString(),
            }]};
          });
        } else if (event.type === "status") {
          setTask((prev) => prev ? { ...prev, status: event.status, progress: event.progress } : prev);
        } else if (event.type === "message") {
          setLiveMessages((prev) => [...prev, {
            id: event.id, task_id: event.task_id, round: event.round,
            from_agent: event.from_agent, to_agent: event.to_agent,
            topic: event.topic, content: event.content, created_at: event.created_at,
          }]);
        } else if (event.type === "approval_required") {
          setApprovalRequest({
            agentName: event.agent_name,
            question: event.question,
          });
        }
      } catch {}
    };

    ws.onerror = () => {
      // WebSocket 失败 → 切回轮询
      if (!fallbackTimer.current) {
        fallbackTimer.current = setInterval(fetch, 3000);
      }
    };

    return () => {
      closed = true;
      ws.close();
      if (fallbackTimer.current) {
        clearInterval(fallbackTimer.current);
        fallbackTimer.current = null;
      }
    };
  }, [taskId]);

  const handleCancel = async () => {
    await cancelTask(taskId);
    fetch();
  };

  const handleRetry = async () => {
    await retryTask(taskId);
    fetch();
  };

  const handleFeedback = async (result: ResultEntry, fb: "positive" | "negative") => {
    const key = result.agent_name;
    const current = feedbackState[key];
    // 点同一个按钮 → 取消反馈，点另一个 → 切换
    const newFb = current === fb ? "" : fb;
    try {
      await submitFeedback({
        task_id: taskId,
        agent_name: result.agent_name,
        output: result.output,
        summary: result.summary,
        question: task?.results.find((r) => r.agent_name === "user")?.summary || task?.description || "",
        feedback: newFb,
      });
      setFeedbackState((prev) => {
        const next = { ...prev };
        if (newFb) next[key] = fb; else delete next[key];
        return next;
      });
    } catch {
      // ignore
    }
    if (task) {
      const q = task.description || task.name;
      queryKnowledge(q).then((r) => setKnowledge(r.entries)).catch(() => {});
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--text-dim)]">
        <span className="animate-pulse">加载中...</span>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400">{error || "任务不存在"}</p>
        <button onClick={onBack} className="mt-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline text-sm">
          返回列表
        </button>
      </div>
    );
  }

  const isRunning = task.status === "running";
  const canCancel = task.status === "pending" || isRunning;
  const timeline = buildTimeline(task.logs, task.results);
  const color = isRunning ? "#3b82f6" : task.status === "completed" ? "#22c55e" : task.status === "failed" ? "#ef4444" : "#f59e0b";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-6xl mx-auto animate-slide-up"
    >
      {/* 顶部操作栏 */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-lg font-bold text-[var(--text-primary)]">{task.name}</h2>
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-medium rounded-full px-2.5 py-0.5"
          style={{ color, background: `${color}15` }}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? "animate-pulse" : ""}`} style={{ background: color }} />
          {isRunning ? "Running" : task.status === "completed" ? "Completed" : task.status === "failed" ? "Failed" : "Pending"}
        </span>
        {canCancel && (
          <button
            onClick={handleCancel}
            className="ml-auto flex items-center gap-1 text-xs text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg border border-red-500/20 hover:border-red-500/40 transition-colors"
          >
            <XCircle size={14} /> 取消任务
          </button>
        )}
        {task.status === "failed" && (
          <button
            onClick={handleRetry}
            className="ml-auto flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 px-3 py-1.5 rounded-lg border border-amber-500/20 hover:border-amber-500/40 transition-colors"
          >
            <RefreshCw size={14} /> 重试任务
          </button>
        )}
      </div>

      {/* Tab 切换 */}
      <div className="flex items-center gap-4 mb-6 border-b border-[var(--border-subtle)] pb-2">
        {([
          ["timeline", "时间线"],
          ["results", "执行结果"],
          ["messages", "Agent 消息"],
          ["conversation", "继续对话"],
          ["knowledge", "知识库"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`text-xs pb-2 -mb-0.5 border-b-2 transition-colors ${
              activeTab === key
                ? "text-[var(--text-primary)] border-zinc-200"
                : "text-[var(--text-dim)] border-transparent hover:text-[var(--text-secondary)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 主内容区 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
        >
          {activeTab === "timeline" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* 时间线 */}
              <div className="lg:col-span-2">
                <div className="relative pl-8 border-l-2 border-[var(--border-strong)] space-y-5">
                  {timeline.length === 0 && (
                    <p className="text-[var(--text-dim)] text-sm py-8">等待 Agent 开始协作...</p>
                  )}
                  {timeline.map((evt, i) => {
                    const c = agentColor[evt.agent] || "#a1a1aa";
                    return (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="relative"
                      >
                        {/* 节点圆点 */}
                        <div
                          className="absolute -left-[29px] w-3 h-3 rounded-full border-2 border-[#0a0a0a]"
                          style={{ background: c }}
                        />
                        <div className="text-[11px] text-[var(--text-dim)] mb-1 flex items-center gap-2">
                          <Clock size={11} />
                          {formatTime(evt.time)}
                          <span className="text-[var(--text-muted)] capitalize">{evt.agent}</span>
                          {evt.type === "result" && (
                            <span className="text-emerald-500 text-[10px]">✓ Complete</span>
                          )}
                        </div>
                        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-3 text-sm text-[var(--text-secondary)]">
                          {evt.type === "result" ? (
                            <MarkdownRenderer content={evt.content} />
                          ) : (
                            <p className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">
                              {stripA(evt.content).slice(0, 300)}
                            </p>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {/* 右侧日志 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                    Terminal Output
                  </h3>
                  <button
                    onClick={() => setShowTimeline(!showTimeline)}
                    className="text-[var(--text-dim)] hover:text-[var(--text-secondary)]"
                  >
                    {showTimeline ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>
                {showTimeline && <LogPanel logs={task.logs} />}
              </div>
            </div>
          )}

          {activeTab === "results" && (
            <div className="space-y-4">
              {task.results.length === 0 ? (
                <p className="text-[var(--text-dim)] py-12 text-center">暂无结果</p>
              ) : (
                task.results.map((r) => (
                  <div
                    key={r.result_id}
                    className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-5"
                    style={{ borderLeftColor: agentColor[r.agent_name] || "#333", borderLeftWidth: 3 }}
                  >
                    <div className="flex items-center gap-2 mb-3 text-sm">
                      <Cpu size={14} style={{ color: agentColor[r.agent_name] }} />
                      <span className="text-[var(--text-primary)] font-medium capitalize">{r.agent_name}</span>
                      {r.agent_name === "user" && <User size={14} className="text-blue-400" />}
                      <span className="text-[11px] text-[var(--text-dim)] ml-auto">
                        {r.created_at ? formatTime(r.created_at) : ""}
                      </span>
                    </div>
                    <MarkdownRenderer content={r.output} />
                    {r.agent_name !== "user" && (() => {
                      const fb = feedbackState[r.agent_name];
                      return (
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--border-subtle)]">
                          <button
                            onClick={() => handleFeedback(r, "positive")}
                            className={`flex items-center gap-1 text-[10px] transition-colors px-2 py-1 rounded ${
                              fb === "positive"
                                ? "text-emerald-400 bg-emerald-500/10"
                                : "text-[var(--text-dim)] hover:text-emerald-400 hover:bg-emerald-500/10"
                            }`}
                          >
                            <ThumbsUp size={12} fill={fb === "positive" ? "currentColor" : "none"} /> 有用
                          </button>
                          <button
                            onClick={() => handleFeedback(r, "negative")}
                            className={`flex items-center gap-1 text-[10px] transition-colors px-2 py-1 rounded ${
                              fb === "negative"
                                ? "text-red-400 bg-red-500/10"
                                : "text-[var(--text-dim)] hover:text-red-400 hover:bg-red-500/10"
                            }`}
                          >
                            <ThumbsDown size={12} fill={fb === "negative" ? "currentColor" : "none"} /> 踩
                          </button>
                          {fb && (
                            <span className="text-[10px] text-[var(--text-dim)] ml-auto">
                              {fb === "positive" ? "已标记为有用" : "已标记为踩"}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "conversation" && (
            <div className="max-w-3xl">
              <ContinueConversation taskId={taskId} existingResults={task.results} />
            </div>
          )}

          {activeTab === "messages" && (
            <MessagesPanel taskId={taskId} agents={agentList} liveMessages={liveMessages} />
          )}

          {activeTab === "knowledge" && (
            <div className="space-y-3">
              {knowledge.length === 0 ? (
                <p className="text-[var(--text-dim)] py-12 text-center text-sm">
                  暂无知识沉淀，在"执行结果"tab 中点赞/踩来积累
                </p>
              ) : (
                knowledge.map((k) => {
                  const isPositive = k.feedback === "positive";
                  return (
                    <div
                      key={k.id}
                      className="bg-[var(--bg-surface)] border rounded-lg p-4"
                      style={{
                        borderColor: isPositive ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)",
                        borderLeftWidth: 3,
                        borderLeftColor: isPositive ? "#22c55e" : "#ef4444",
                      }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full ${
                            isPositive
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-red-500/10 text-red-400"
                          }`}
                        >
                          {isPositive ? "👍 经验" : "👎 教训"}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-[var(--text-dim)]">
                          {k.category}
                        </span>
                        <span className="text-[11px] text-[var(--text-muted)] capitalize">{k.agent_name}</span>
                      </div>
                      {k.question && (
                        <p className="text-[11px] text-[var(--text-dim)] mb-2">
                          问题: {k.question.slice(0, 120)}
                        </p>
                      )}
                      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{k.summary.slice(0, 300)}</p>
                      {k.keywords.length > 0 && (
                        <div className="flex gap-1.5 mt-2 flex-wrap">
                          {k.keywords.map((kw, i) => (
                            <span
                              key={i}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-glass)] text-[var(--text-dim)]"
                            >
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Approval Modal */}
      {approvalRequest && (
        <ApprovalModal
          taskId={taskId}
          agentName={approvalRequest.agentName}
          question={approvalRequest.question}
          onClose={() => setApprovalRequest(null)}
        />
      )}
    </motion.div>
  );
}
