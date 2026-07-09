export default function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full bg-[var(--bg-surface-raised)] rounded-full h-1.5 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{
          width: `${Math.min(100, Math.max(0, progress))}%`,
          background: "linear-gradient(90deg, #3b82f6, #6366f1)",
        }}
      />
    </div>
  );
}
