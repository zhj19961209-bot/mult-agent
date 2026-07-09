import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  X,
  Folder,
  FileText,
  ChevronLeft,
  Home,
  RefreshCw,
  Check,
  Eye,
  EyeOff,
} from "lucide-react";
import { fsHome, fsList } from "../api";
import type { FsEntry } from "../types";

interface Props {
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}

export default function DirectoryPicker({ initialPath, onClose, onSelect }: Props) {
  const [path, setPath] = useState<string>(initialPath || "");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [roots, setRoots] = useState<{ label: string; path: string }[]>([]);
  const [pathInput, setPathInput] = useState<string>(initialPath || "");

  const load = async (target: string, hidden = showHidden) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fsList(target, hidden);
      setPath(res.path);
      setPathInput(res.path);
      setEntries(res.entries);
      setParent(res.parent);
    } catch (err: any) {
      setError(err.message || "读取失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const h = await fsHome();
        setRoots(h.roots);
        await load(initialPath || h.home);
      } catch (err: any) {
        setError(err.message || "初始化失败");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEnter = (e: FsEntry) => {
    if (e.is_dir) load(e.path);
  };

  const segments = path ? path.split("/").filter(Boolean) : [];

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
        className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-2xl w-full max-w-2xl mx-4 shadow-2xl flex flex-col"
        style={{ maxHeight: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)]">
          <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Folder size={16} /> 选择工作目录
          </h3>
          <button
            onClick={onClose}
            className="text-[var(--text-dim)] hover:text-[var(--text-primary)]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-[var(--border-default)] flex flex-wrap items-center gap-2">
          <button
            onClick={() => parent && load(parent)}
            disabled={!parent || loading}
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-30"
            title="上一级"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => load(path)}
            disabled={loading}
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-30"
            title="刷新"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          {roots.map((r) => (
            <button
              key={r.path}
              onClick={() => load(r.path)}
              className="px-2 py-1 text-xs rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] flex items-center gap-1"
              title={r.path}
            >
              {r.label === "Home" ? <Home size={11} /> : null}
              {r.label}
            </button>
          ))}
          <button
            onClick={() => {
              const next = !showHidden;
              setShowHidden(next);
              load(path, next);
            }}
            className="ml-auto p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]"
            title={showHidden ? "隐藏隐藏文件" : "显示隐藏文件"}
          >
            {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        </div>

        <div className="px-6 py-2 border-b border-[var(--border-default)] flex items-center gap-2">
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") load(pathInput);
            }}
            spellCheck={false}
            className="flex-1 bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-md px-2 py-1 text-xs font-mono text-[var(--text-secondary)] focus:outline-none focus:border-[var(--border-accent)]"
            placeholder="/Users/..."
          />
          <button
            onClick={() => load(pathInput)}
            className="px-3 py-1 text-xs rounded-md bg-[var(--bg-button)] hover:bg-[var(--bg-button-hover)] border border-[var(--border-strong)] text-[var(--text-primary)]"
          >
            转到
          </button>
        </div>

        {segments.length > 0 && (
          <div className="px-6 py-2 text-[11px] text-[var(--text-dim)] font-mono overflow-x-auto whitespace-nowrap border-b border-[var(--border-default)]">
            <span
              className="hover:text-[var(--text-secondary)] cursor-pointer"
              onClick={() => load("/")}
            >
              /
            </span>
            {segments.map((seg, idx) => {
              const partial = "/" + segments.slice(0, idx + 1).join("/");
              return (
                <span key={partial}>
                  <span
                    className="hover:text-[var(--text-secondary)] cursor-pointer"
                    onClick={() => load(partial)}
                  >
                    {seg}
                  </span>
                  {idx < segments.length - 1 && <span> / </span>}
                </span>
              );
            })}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 py-1 min-h-[300px]">
          {error && (
            <div className="m-4 text-red-400 text-xs bg-red-500/5 border border-red-500/10 rounded-lg p-3">
              {error}
            </div>
          )}
          {!error && entries.length === 0 && !loading && (
            <div className="text-center text-[var(--text-dim)] text-xs py-12">
              空目录
            </div>
          )}
          {entries.map((e) => (
            <button
              key={e.path}
              onClick={() => handleEnter(e)}
              disabled={!e.is_dir}
              className={`w-full flex items-center gap-2 px-4 py-1.5 text-xs rounded-md ${
                e.is_dir
                  ? "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] cursor-pointer"
                  : "text-[var(--text-dim)] cursor-default"
              }`}
            >
              {e.is_dir ? <Folder size={13} /> : <FileText size={13} />}
              <span className="truncate">{e.name}</span>
            </button>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-[var(--border-default)] flex items-center gap-3">
          <div className="flex-1 text-xs text-[var(--text-muted)] truncate font-mono">
            将使用：{path || "(未选择)"}
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]"
          >
            取消
          </button>
          <button
            onClick={() => {
              if (path) onSelect(path);
            }}
            disabled={!path}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-[var(--bg-button)] hover:bg-[var(--bg-button-hover)] border border-[var(--border-accent)] text-[var(--text-primary)] disabled:opacity-30"
          >
            <Check size={12} /> 使用此目录
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
