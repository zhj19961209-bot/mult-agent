import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Moon, Sun, Sunrise, User } from "lucide-react";
import { useTheme, type Theme } from "../hooks/useTheme";
import AgentSidebar from "./AgentSidebar";

const themes: { key: Theme; icon: typeof Moon; label: string }[] = [
  { key: "dark", icon: Moon, label: "黑夜" },
  { key: "light", icon: Sun, label: "白天" },
  { key: "sunny", icon: Sunrise, label: "晴天" },
];

interface Props {
  children: ReactNode;
  agentFilter?: string;
  currentPage: string;
  onSelectAgent: (agent: string | undefined) => void;
  onNavigateToList: () => void;
  onNavigateToCreate: () => void;
  onNavigateToProfile: () => void;
  onNavigateToAgentTeam: () => void;
}

export default function Layout({ children, agentFilter, currentPage, onSelectAgent, onNavigateToList, onNavigateToCreate, onNavigateToProfile, onNavigateToAgentTeam }: Props) {
  const { theme, setTheme } = useTheme();

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-root)] text-[var(--text-secondary)]">
      {/* Top Bar */}
      <header className="h-12 flex items-center px-4 border-b border-[var(--border-subtle)] bg-[var(--bg-header)] flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">A</span>
          </div>
          <span className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">
            AgentOS
          </span>
        </div>

        <nav className="flex items-center gap-1 ml-8">
          <button
            onClick={onNavigateToList}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              currentPage === "list" || currentPage === "detail" || currentPage === "create"
                ? "bg-[var(--bg-button)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]"
            }`}
          >
            任务中心
          </button>
          <button
            onClick={onNavigateToAgentTeam}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              currentPage === "agentTeam"
                ? "bg-[var(--bg-button)] text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]"
            }`}
          >
            Agent 团队
          </button>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onNavigateToProfile}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] transition-colors"
          >
            <User size={12} />
            Personal
          </button>
          {/* Theme Switcher */}
          <div className="flex items-center gap-0.5 bg-[var(--bg-surface)] rounded-lg p-0.5 border border-[var(--border-subtle)]">
            {themes.map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setTheme(key)}
                title={label}
                className={`p-1.5 rounded-md transition-all ${
                  theme === key
                    ? "bg-[var(--bg-button)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-dim)] hover:text-[var(--text-secondary)]"
                }`}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onNavigateToCreate}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-[var(--bg-button)] hover:bg-[var(--bg-button-hover)] text-[var(--text-primary)] border border-[var(--border-strong)] transition-colors"
          >
            <span className="text-base leading-none">+</span> 新建任务
          </motion.button>
        </div>
      </header>

      {/* Body: Sidebar + Main */}
      <div className="flex flex-1 overflow-hidden">
        <AgentSidebar
          selectedAgent={agentFilter}
          onSelectAgent={onSelectAgent}
        />
        <main className="flex-1 overflow-y-auto p-5">
          {children}
        </main>
      </div>
    </div>
  );
}
