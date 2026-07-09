import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Cpu } from "lucide-react";
import { continueTask, getAgents } from "../api";
import type { ResultEntry, AgentStatus } from "../types";
import MarkdownRenderer from "./MarkdownRenderer";

interface Message {
  role: "user" | "agent";
  agentName?: string;
  content: string;
}

interface Props {
  taskId: string;
  existingResults: ResultEntry[];
}

export default function ContinueConversation({ taskId, existingResults }: Props) {
  const [messages, setMessages] = useState<Message[]>(() => {
    const msgs: Message[] = [];
    for (const r of existingResults) {
      if (r.agent_name === "user") {
        msgs.push({ role: "user", content: r.summary });
      } else {
        msgs.push({ role: "agent", agentName: r.agent_name, content: r.output });
      }
    }
    return msgs;
  });
  const [input, setInput] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("");
  const [sending, setSending] = useState(false);
  const [agentList, setAgentList] = useState<AgentStatus[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 只显示当前任务中参与过的 Agent
    const taskAgents = new Set(
      existingResults
        .filter((r) => r.agent_name !== "user")
        .map((r) => r.agent_name)
    );
    getAgents().then((r) => {
      const list = r.agents.filter((a) => taskAgents.has(a.name));
      setAgentList(list);
      if (list.length > 0 && !list.find((a) => a.name === selectedAgent)) {
        setSelectedAgent(list[0].name);
      }
    }).catch(() => {});
  }, []);

  const agentColor = Object.fromEntries(agentList.map((a) => [a.name, a.color || "#a1a1aa"]));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const question = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setSending(true);
    try {
      const detail = await continueTask(taskId, { agent: selectedAgent, question });
      const agentResults = detail.results.filter((r) => r.agent_name !== "user");
      if (agentResults.length > 0) {
        const last = agentResults[agentResults.length - 1];
        setMessages((prev) => [
          ...prev,
          { role: "agent", agentName: last.agent_name, content: last.output },
        ]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "agent", content: "请求失败" }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border border-[var(--border-default)] rounded-xl bg-[var(--bg-glass)] flex flex-col h-[500px]">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <AnimatePresence>
          {messages.length === 0 && (
            <p className="text-center text-[var(--text-dim)] text-sm mt-20">开始与 Agent 对话</p>
          )}
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${
                  msg.role === "user"
                    ? "bg-blue-600/20 border border-blue-500/20 text-[var(--text-primary)]"
                    : "bg-[var(--bg-surface-raised)] border border-[var(--border-default)]"
                }`}
              >
                {msg.agentName && (
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] mb-1">
                    <Cpu size={11} style={{ color: agentColor[msg.agentName] }} />
                    <span className="font-medium capitalize">{msg.agentName}</span>
                  </div>
                )}
                {msg.role === "agent" ? (
                  <MarkdownRenderer content={msg.content} />
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {sending && (
          <div className="flex items-center gap-2 text-[var(--text-dim)] text-xs pl-2">
            <span className="animate-pulse">●</span> Thinking...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[var(--border-default)] p-3 flex gap-2">
        <select
          value={selectedAgent}
          onChange={(e) => setSelectedAgent(e.target.value)}
          className="bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] focus:outline-none focus:border-[var(--border-accent)]"
        >
          {agentList.map((a) => (
            <option key={a.name} value={a.name} className="bg-[#111]">{a.display_name || a.name}</option>
          ))}
        </select>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="输入消息..."
          className="flex-1 bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)]"
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          className="px-4 py-2 bg-[var(--bg-button)] hover:bg-[var(--bg-button-hover)] text-[var(--text-primary)] rounded-lg text-xs font-medium disabled:opacity-30 transition-colors flex items-center gap-1.5"
        >
          <Send size={12} /> 发送
        </button>
      </div>
    </div>
  );
}
