import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, CheckCircle, XCircle } from "lucide-react";
import { approveTask } from "../api";

interface Props {
  taskId: string;
  agentName: string;
  question: string;
  onClose: () => void;
}

export default function ApprovalModal({ taskId, agentName, question, onClose }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResponse = async (response: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await approveTask(taskId, response);
      onClose();
    } catch (err: any) {
      setError(err.message || "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.9, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-2xl shadow-2xl max-w-lg w-full p-6"
        >
          <div className="flex items-start gap-3 mb-4">
            <AlertCircle size={24} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
                Agent 需要权限
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                <span className="font-medium text-[var(--text-secondary)]">{agentName}</span> 正在请求执行权限
              </p>
            </div>
          </div>

          <div className="bg-[var(--bg-glass)] border border-[var(--border-subtle)] rounded-lg p-4 mb-6">
            <pre className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap break-words font-mono leading-relaxed">
              {question}
            </pre>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-sm text-red-400">
              <XCircle size={16} />
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => handleResponse("yes")}
              disabled={submitting}
              className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-600/50 text-white rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2"
            >
              <CheckCircle size={16} />
              批准执行
            </button>
            <button
              onClick={() => handleResponse("no")}
              disabled={submitting}
              className="flex-1 px-4 py-2.5 bg-[var(--bg-button)] hover:bg-[var(--bg-button-hover)] disabled:opacity-50 border border-[var(--border-default)] text-[var(--text-primary)] rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2"
            >
              <XCircle size={16} />
              拒绝
            </button>
          </div>

          <p className="text-[10px] text-[var(--text-dim)] mt-4 text-center">
            提示：批准后，Agent 将继续执行操作。拒绝将导致任务失败。
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
