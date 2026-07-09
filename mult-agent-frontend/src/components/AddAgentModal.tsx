import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Plus, Search, Loader, Terminal, Globe, Boxes, Wrench } from "lucide-react";
import { createAgent, discoverAgents, getAgents } from "../api";
import type { AgentStatus, AgentType, DiscoverSuggestion } from "../types";

const ICONS = ["Zap", "Code", "Cpu", "Terminal", "Lightbulb", "Bot", "Brain", "Shield", "Globe", "Server", "Sparkles", "Boxes"];
const COLORS = ["#3b82f6", "#8b5cf6", "#06b6d4", "#f97316", "#22c55e", "#ef4444", "#eab308", "#ec4899", "#14b8a6", "#a855f7"];
const MODELS = [
  { value: "", label: "默认（环境变量）" },
  { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { value: "deepseek-v3.2", label: "DeepSeek V3.2" },
  { value: "deepseek-v3.1", label: "DeepSeek V3.1" },
  { value: "deepseek-r1-0528", label: "DeepSeek R1" },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];

const HTTP_PRESETS = [
  { label: "DeepSeek", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", api_key_env: "DEEPSEEK_API_KEY" },
  { label: "Qwen / DashScope", base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", api_key_env: "DASHSCOPE_API_KEY" },
  { label: "Moonshot Kimi", base_url: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", api_key_env: "MOONSHOT_API_KEY" },
  { label: "智谱 GLM", base_url: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-plus", api_key_env: "ZHIPU_API_KEY" },
  { label: "OpenAI", base_url: "https://api.openai.com/v1", model: "gpt-4o-mini", api_key_env: "OPENAI_API_KEY" },
  { label: "本地 vLLM/Ollama", base_url: "http://localhost:8001/v1", model: "qwen2.5-7b", api_key_env: "" },
];

const MCP_PRESETS = [
  { label: "Fetch (网页抓取)", command: "npx", args: "-y @modelcontextprotocol/server-fetch" },
  { label: "Filesystem", command: "npx", args: "-y @modelcontextprotocol/server-filesystem ." },
  { label: "GitHub", command: "npx", args: "-y @modelcontextprotocol/server-github", env: "GITHUB_TOKEN_ENV=GITHUB_TOKEN" },
  { label: "Memory", command: "npx", args: "-y @modelcontextprotocol/server-memory" },
  { label: "Sqlite", command: "uvx", args: "mcp-server-sqlite --db-path ./data.db" },
];

interface Props {
  onCreated: (agent: AgentStatus) => void;
  onClose: () => void;
}

export default function AddAgentModal({ onCreated, onClose }: Props) {
  const [tab, setTab] = useState<AgentType>("cli");

  // 公共字段
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("");
  const [icon, setIcon] = useState("Zap");
  const [color, setColor] = useState("#a1a1aa");
  const [description, setDescription] = useState("");

  // CLI
  const [cliBinary, setCliBinary] = useState("");
  const [argsTemplate, setArgsTemplate] = useState("-p {prompt}");
  const [stdinMode, setStdinMode] = useState(false);
  const [model, setModel] = useState("");

  // HTTP
  const [baseUrl, setBaseUrl] = useState("");
  const [httpModel, setHttpModel] = useState("");
  const [apiKeyEnv, setApiKeyEnv] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [selectedMcpTools, setSelectedMcpTools] = useState<string[]>([]);
  const [mcpAgents, setMcpAgents] = useState<AgentStatus[]>([]);

  // MCP
  const [transport, setTransport] = useState<"stdio" | "sse">("stdio");
  const [command, setCommand] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");
  const [envText, setEnvText] = useState("");
  const [sseUrl, setSseUrl] = useState("");
  const [autoStart, setAutoStart] = useState(false);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [suggestions, setSuggestions] = useState<DiscoverSuggestion[]>([]);

  useEffect(() => {
    if (tab !== "http") return;
    getAgents().then((res) => {
      setMcpAgents(res.agents.filter((a) => a.type === "mcp"));
    }).catch(() => setMcpAgents([]));
  }, [tab]);

  const toggleMcpTool = (name: string) => {
    setSelectedMcpTools((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const parseEnv = (raw: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of raw.split(/\n|,/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return out;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSending(true);
    setError(null);
    try {
      const base = {
        name: name.trim().toLowerCase(),
        display_name: displayName.trim() || undefined,
        role: role.trim() || undefined,
        icon,
        color,
        description: description.trim() || undefined,
      };
      let payload: any;
      if (tab === "cli") {
        payload = {
          ...base,
          type: "cli",
          cli_binary: cliBinary.trim() || undefined,
          args_template: argsTemplate.trim() || undefined,
          stdin_mode: stdinMode || undefined,
          model: model || undefined,
        };
      } else if (tab === "http") {
        if (!baseUrl.trim()) throw new Error("base_url 必填");
        if (!httpModel.trim()) throw new Error("model 必填");
        payload = {
          ...base,
          type: "http",
          base_url: baseUrl.trim(),
          model: httpModel.trim(),
          api_key_env: apiKeyEnv.trim() || undefined,
          system_prompt: systemPrompt.trim() || undefined,
          temperature: parseFloat(temperature) || 0.7,
          mcp_tools: selectedMcpTools.length > 0 ? selectedMcpTools : undefined,
        };
      } else {
        if (transport === "stdio") {
          if (!command.trim()) throw new Error("command 必填");
        } else {
          if (!sseUrl.trim()) throw new Error("sse_url 必填");
        }
        payload = {
          ...base,
          type: "mcp",
          transport,
          command: transport === "stdio" ? command.trim() : undefined,
          mcp_args: transport === "stdio"
            ? mcpArgs.trim().split(/\s+/).filter(Boolean)
            : undefined,
          sse_url: transport === "sse" ? sseUrl.trim() : undefined,
          env: envText.trim() ? parseEnv(envText) : undefined,
          auto_start: autoStart,
        };
      }
      const agent = await createAgent(payload);
      onCreated(agent);
    } catch (err: any) {
      setError(err.message || "创建失败");
    } finally {
      setSending(false);
    }
  };

  const handleDiscover = async () => {
    setScanning(true);
    try {
      const data = await discoverAgents();
      setSuggestions(data.suggestions);
    } catch {
      // ignore
    } finally {
      setScanning(false);
    }
  };

  const handleQuickAdd = async (s: DiscoverSuggestion) => {
    setSending(true);
    setError(null);
    try {
      const agent = await createAgent({
        name: s.name,
        display_name: s.display_name,
        role: s.role,
        type: "cli",
        cli_binary: s.cli_binary || s.name,
        args_template: s.args_template || "-p {prompt}",
        stdin_mode: s.stdin_mode,
        icon: s.icon,
        color: s.color,
        description: s.description || "",
      });
      onCreated(agent);
    } catch (err: any) {
      setError(err.message || "添加失败");
    } finally {
      setSending(false);
    }
  };

  const applyHttpPreset = (p: typeof HTTP_PRESETS[number]) => {
    setBaseUrl(p.base_url);
    setHttpModel(p.model);
    setApiKeyEnv(p.api_key_env);
    if (!name) setName(p.label.toLowerCase().split(/[ /]/)[0]);
    if (!displayName) setDisplayName(p.label);
  };

  const applyMcpPreset = (p: typeof MCP_PRESETS[number]) => {
    setCommand(p.command);
    setMcpArgs(p.args);
    if (p.env) setEnvText(p.env);
    if (!name) setName(p.label.toLowerCase().split(/[ (]/)[0].replace(/[^a-z0-9-]/g, "-"));
    if (!displayName) setDisplayName(p.label);
  };

  const tabBtn = (key: AgentType, label: string, Icon: typeof Terminal) => (
    <button
      key={key}
      type="button"
      onClick={() => setTab(key)}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg border transition-all ${
        tab === key
          ? "bg-[var(--bg-button)] border-[var(--border-accent)] text-[var(--text-primary)]"
          : "bg-transparent border-[var(--border-subtle)] text-[var(--text-dim)] hover:border-[var(--border-strong)]"
      }`}
    >
      <Icon size={13} /> {label}
    </button>
  );

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
        className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Plus size={16} /> 添加 Agent
          </h3>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text-primary)]">
            <X size={16} />
          </button>
        </div>

        {/* 类型 Tab */}
        <div className="flex gap-1.5 mb-5">
          {tabBtn("cli", "CLI", Terminal)}
          {tabBtn("http", "HTTP API", Globe)}
          {tabBtn("mcp", "MCP", Boxes)}
        </div>

        {/* CLI 自动发现 */}
        {tab === "cli" && (
          <div className="mb-5 p-3 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-glass)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[var(--text-muted)]">自动发现 PATH 中的已知 CLI</span>
              <button
                type="button"
                onClick={handleDiscover}
                disabled={scanning}
                className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-2.5 py-1 rounded-lg border border-[var(--border-default)] hover:border-[var(--border-strong)] transition-colors disabled:opacity-50"
              >
                {scanning ? <Loader size={11} className="animate-spin" /> : <Search size={11} />}
                {scanning ? "扫描中..." : "扫描"}
              </button>
            </div>
            {suggestions.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {suggestions.map((s) => (
                  <div
                    key={s.name}
                    className="flex items-center gap-3 p-2.5 rounded-lg bg-[var(--bg-surface-raised)] border border-[var(--border-subtle)]"
                  >
                    <div className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: s.color }} >
                      {s.name[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-[var(--text-primary)]">{s.display_name}</div>
                      <div className="text-[10px] text-[var(--text-dim)]">
                        {s.role} · <code className="text-amber-400 bg-amber-500/10 rounded px-0.5">{s.name}</code>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleQuickAdd(s)}
                      disabled={sending}
                      className="text-[11px] text-green-400 hover:text-green-300 px-2.5 py-1 rounded-lg border border-green-500/20 hover:border-green-500/40 transition-colors disabled:opacity-50 shrink-0"
                    >
                      添加
                    </button>
                  </div>
                ))}
              </div>
            )}
            {suggestions.length === 0 && !scanning && (
              <p className="text-[10px] text-[var(--text-dim)] mt-1">扫描 cursor-agent, aider, gemini, qwen, crush 等已知 CLI</p>
            )}
          </div>
        )}

        {/* HTTP 预设 */}
        {tab === "http" && (
          <div className="mb-5 p-3 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-glass)]">
            <div className="text-xs text-[var(--text-muted)] mb-2">常用服务预设</div>
            <div className="flex flex-wrap gap-1.5">
              {HTTP_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyHttpPreset(p)}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-[var(--border-subtle)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* MCP 预设 */}
        {tab === "mcp" && (
          <div className="mb-5 p-3 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-glass)]">
            <div className="text-xs text-[var(--text-muted)] mb-2">官方 MCP Server 预设</div>
            <div className="flex flex-wrap gap-1.5">
              {MCP_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyMcpPreset(p)}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-[var(--border-subtle)] hover:border-[var(--border-accent)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 通用字段 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                名称 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                pattern="[a-z][a-z0-9_-]*"
                placeholder={tab === "cli" ? "openclaw" : tab === "http" ? "deepseek" : "github-mcp"}
                className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">显示名</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)]"
              />
            </div>
          </div>

          {/* CLI 字段 */}
          {tab === "cli" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">CLI 二进制</label>
                  <input
                    type="text"
                    value={cliBinary}
                    onChange={(e) => setCliBinary(e.target.value)}
                    placeholder={name || "命令名"}
                    className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">参数模板</label>
                  <input
                    type="text"
                    value={argsTemplate}
                    onChange={(e) => setArgsTemplate(e.target.value)}
                    placeholder="-p {prompt}"
                    className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] cursor-pointer">
                  <input type="checkbox" checked={stdinMode} onChange={(e) => setStdinMode(e.target.checked)} />
                  通过 stdin 传 prompt
                </label>
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">模型</label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-2 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-accent)]"
                  >
                    {MODELS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-[10px] text-[var(--text-dim)]">
                占位符：<code className="text-amber-400 bg-amber-500/10 rounded px-1">{'{prompt}'}</code>
                {' '}<code className="text-amber-400 bg-amber-500/10 rounded px-1">{'{prompt_file}'}</code>
                {' '}<code className="text-amber-400 bg-amber-500/10 rounded px-1">{'{workspace}'}</code>
                {' '}<code className="text-amber-400 bg-amber-500/10 rounded px-1">{'{model}'}</code>
              </p>
            </>
          )}

          {/* HTTP 字段 */}
          {tab === "http" && (
            <>
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                  Base URL <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  required
                  placeholder="https://api.deepseek.com/v1"
                  className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                    Model <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={httpModel}
                    onChange={(e) => setHttpModel(e.target.value)}
                    required
                    placeholder="deepseek-chat"
                    className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">API Key 环境变量</label>
                  <input
                    type="text"
                    value={apiKeyEnv}
                    onChange={(e) => setApiKeyEnv(e.target.value)}
                    placeholder="DEEPSEEK_API_KEY"
                    className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">System Prompt</label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={2}
                  placeholder="你是一个..."
                  className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)] resize-none"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">Temperature</label>
                  <input
                    type="number"
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                    step="0.1"
                    min="0"
                    max="2"
                    className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-accent)]"
                  />
                </div>
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] mb-2">
                  <Wrench size={12} /> 关联 MCP 工具
                  <span className="text-[10px] text-[var(--text-dim)]">（开启 tool-calling loop）</span>
                </label>
                {mcpAgents.length === 0 ? (
                  <p className="text-[10px] text-[var(--text-dim)]">
                    暂无已注册的 MCP Agent，先到 MCP Tab 注册一个再回来配置
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {mcpAgents.map((a) => {
                      const active = selectedMcpTools.includes(a.name);
                      return (
                        <button
                          key={a.name}
                          type="button"
                          onClick={() => toggleMcpTool(a.name)}
                          className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors flex items-center gap-1 ${
                            active
                              ? "border-[var(--border-accent)] bg-[var(--bg-button)] text-[var(--text-primary)]"
                              : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]"
                          }`}
                          style={active ? { boxShadow: `0 0 8px ${a.color}40` } : {}}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: a.color }}
                          />
                          {a.display_name || a.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <p className="text-[10px] text-[var(--text-dim)]">
                兼容 OpenAI Chat Completions 协议。API Key 通过环境变量注入，不会写入注册表。
              </p>
            </>
          )}

          {/* MCP 字段 */}
          {tab === "mcp" && (
            <>
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">Transport</label>
                <div className="flex gap-2">
                  {(["stdio", "sse"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTransport(t)}
                      className={`flex-1 py-1.5 text-xs rounded-md border transition-all ${
                        transport === t
                          ? "bg-[var(--bg-button)] border-[var(--border-accent)] text-[var(--text-primary)]"
                          : "bg-transparent border-[var(--border-subtle)] text-[var(--text-dim)]"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              {transport === "stdio" ? (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                        Command <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        required
                        placeholder="npx"
                        className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-accent)]"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[11px] text-[var(--text-muted)] mb-1">Args</label>
                      <input
                        type="text"
                        value={mcpArgs}
                        onChange={(e) => setMcpArgs(e.target.value)}
                        placeholder="-y @modelcontextprotocol/server-fetch"
                        className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-accent)]"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                    SSE URL <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={sseUrl}
                    onChange={(e) => setSseUrl(e.target.value)}
                    placeholder="http://localhost:9000/sse"
                    className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-accent)]"
                  />
                  <p className="text-[10px] text-[var(--text-dim)] mt-1">远程 MCP server 的 SSE 端点（带 endpoint 事件协议）</p>
                </div>
              )}
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">
                  环境变量（每行 KEY=VALUE，可用 KEY_ENV 形式从主进程环境读取）
                </label>
                <textarea
                  value={envText}
                  onChange={(e) => setEnvText(e.target.value)}
                  rows={2}
                  placeholder="GITHUB_TOKEN_ENV=GITHUB_TOKEN"
                  className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-xs font-mono text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)] resize-none"
                />
              </div>
              <label className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] cursor-pointer">
                <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
                后端启动时自动启动该 MCP server
              </label>
              <p className="text-[10px] text-[var(--text-dim)]">
                注册后可以从 Agent 侧边栏点击查看暴露的工具。
              </p>
            </>
          )}

          {/* 通用：role / icon / color / description */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">角色标签</label>
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="通用 AI"
                className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)]"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">颜色 <span className="font-mono text-[10px]">{color}</span></label>
              <div className="flex gap-1.5 flex-wrap pt-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="w-6 h-6 rounded-md border-2 transition-all"
                    style={{
                      background: c,
                      borderColor: color === c ? "#fff" : "transparent",
                      boxShadow: color === c ? `0 0 8px ${c}80` : "none",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-[var(--text-muted)] mb-1">图标</label>
            <div className="flex gap-1.5 flex-wrap">
              {ICONS.map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIcon(i)}
                  className={`px-2.5 py-1 text-[11px] rounded-md border transition-all ${
                    icon === i
                      ? "bg-[var(--bg-button)] border-[var(--border-accent)] text-[var(--text-primary)]"
                      : "bg-transparent border-[var(--border-subtle)] text-[var(--text-dim)] hover:border-[var(--border-strong)]"
                  }`}
                >
                  {i}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-[var(--text-muted)] mb-1">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="这个 Agent 的用途..."
              className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)] resize-none"
            />
          </div>

          {error && (
            <div className="text-red-400 text-xs bg-red-500/5 border border-red-500/10 rounded-lg p-3">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg border border-[var(--border-default)] transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={sending || !name.trim()}
              className="flex-1 py-2.5 text-sm bg-[var(--bg-button)] hover:bg-[var(--bg-button-hover)] text-[var(--text-primary)] rounded-lg border border-[var(--border-strong)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
            >
              <Plus size={14} />
              {sending ? "创建中..." : "添加 Agent"}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
