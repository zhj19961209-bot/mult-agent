import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Save, User, Heart, Loader2 } from "lucide-react";
import { getProfile, updateProfile } from "../api";

export default function ProfilePage() {
  const [user, setUser] = useState("");
  const [soul, setSoul] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getProfile();
      setUser(data.user || "");
      setSoul(data.soul || "");
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile(user, soul);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--text-dim)]">
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-2xl mx-auto animate-slide-up"
    >
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">Personal</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-[var(--bg-button)] hover:bg-[var(--bg-button-hover)] text-[var(--text-primary)] border border-[var(--border-strong)] transition-colors disabled:opacity-50"
        >
          {saving ? (
            <Loader2 size={13} className="animate-spin" />
          ) : saved ? (
            <span className="text-emerald-400">已保存</span>
          ) : (
            <>
              <Save size={13} /> 保存
            </>
          )}
        </button>
      </div>

      <p className="text-xs text-[var(--text-dim)] mb-6">
        这些信息会自动附加到每个任务的上下文中，帮助 Agent 更好地理解你。支持 Markdown 格式。
      </p>

      <div className="space-y-5">
        {/* 用户档案 */}
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center">
              <User size={14} className="text-blue-400" />
            </div>
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">用户档案</div>
              <div className="text-[11px] text-[var(--text-dim)]">客观信息：姓名、职业、技术栈等</div>
            </div>
          </div>
          <textarea
            value={user}
            onChange={(e) => setUser(e.target.value)}
            rows={6}
            placeholder={`# 用户档案\n\n- 姓名是...\n- 职业是...\n- 擅长...`}
            className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)] resize-none font-mono"
          />
        </div>

        {/* 用户偏好 */}
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center">
              <Heart size={14} className="text-amber-400" />
            </div>
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">用户偏好</div>
              <div className="text-[11px] text-[var(--text-dim)]">主观偏好：风格喜好、工作习惯、价值观</div>
            </div>
          </div>
          <textarea
            value={soul}
            onChange={(e) => setSoul(e.target.value)}
            rows={6}
            placeholder={`# 用户偏好\n\n- 喜欢用...\n- 偏好简洁的...\n- 不喜欢...`}
            className="w-full bg-[var(--bg-surface-raised)] border border-[var(--border-strong)] rounded-lg px-4 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-accent)] resize-none font-mono"
          />
        </div>
      </div>
    </motion.div>
  );
}
