import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Megaphone, ArrowRight } from "lucide-react";
import { getTaskMessages } from "../api";
import type { AgentMessage, AgentStatus } from "../types";

interface Props {
  taskId: string;
  agents: AgentStatus[];
  liveMessages: AgentMessage[];
}

function colorFor(agents: AgentStatus[], name: string): string {
  const a = agents.find((x) => x.name === name);
  return a?.color || "#a1a1aa";
}

function displayName(agents: AgentStatus[], name: string): string {
  const a = agents.find((x) => x.name === name);
  return a?.display_name || name;
}

export default function MessagesPanel({ taskId, agents, liveMessages }: Props) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getTaskMessages(taskId)
      .then((m) => setMessages(m))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [taskId]);

  // Merge live ws messages, dedup by id
  useEffect(() => {
    if (liveMessages.length === 0) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const incoming = liveMessages.filter((m) => !seen.has(m.id));
      if (incoming.length === 0) return prev;
      return [...prev, ...incoming];
    });
  }, [liveMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Group consecutive by round
  const rounds: Map<number, AgentMessage[]> = new Map();
  for (const m of messages) {
    const arr = rounds.get(m.round) ?? [];
    arr.push(m);
    rounds.set(m.round, arr);
  }
  const roundEntries = Array.from(rounds.entries()).sort((a, b) => a[0] - b[0]);

  if (loading) {
    return <p className="text-[var(--text-dim)] text-sm py-8 text-center">载入消息...</p>;
  }
  if (messages.length === 0) {
    return (
      <p className="text-[var(--text-dim)] text-sm py-8 text-center">
        暂无 Agent 消息。仅 <code className="text-amber-400 bg-amber-500/10 rounded px-1">collaborative</code> 模式会产生 agent 之间的对话。
      </p>
    );
  }

  return (
    <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-1">
      {roundEntries.map(([round, msgs]) => (
        <div key={round}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
              第 {round + 1} 轮
            </span>
            <div className="flex-1 h-px bg-[var(--border-subtle)]" />
            <span className="text-[10px] text-[var(--text-dim)] tabular-nums">{msgs.length} 条</span>
          </div>
          <div className="space-y-3">
            {msgs.map((m) => {
              const fromColor = colorFor(agents, m.from_agent);
              const broadcast = m.to_agent === null;
              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] overflow-hidden"
                  style={{ borderLeft: `3px solid ${fromColor}` }}
                >
                  <div className="px-3 py-1.5 flex items-center gap-2 text-[11px] bg-[var(--bg-glass)]">
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: fromColor }}
                    />
                    <span className="font-medium text-[var(--text-primary)]">
                      {displayName(agents, m.from_agent)}
                    </span>
                    {broadcast ? (
                      <span className="flex items-center gap-1 text-[var(--text-muted)]">
                        <Megaphone size={10} />
                        广播
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[var(--text-muted)]">
                        <ArrowRight size={10} />
                        <span style={{ color: colorFor(agents, m.to_agent!) }}>
                          {displayName(agents, m.to_agent!)}
                        </span>
                      </span>
                    )}
                    {m.topic && (
                      <span className="ml-auto text-[10px] text-[var(--text-dim)]">[{m.topic}]</span>
                    )}
                  </div>
                  <div className="px-3 py-2.5 text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words leading-relaxed">
                    {m.content}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
