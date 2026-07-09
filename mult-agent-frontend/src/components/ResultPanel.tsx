import type { ResultEntry } from "../types";
import MarkdownRenderer from "./MarkdownRenderer";

interface Props {
  results: ResultEntry[];
}

const agentColors: Record<string, string> = {
  codex: "border-l-blue-500",
  claude: "border-l-orange-500",
  tli: "border-l-purple-500",
};

export default function ResultPanel({ results }: Props) {
  if (results.length === 0) {
    return (
      <div className="text-center text-gray-400 py-12">
        <p>暂无结果</p>
        <p className="text-sm mt-1">Agent 正在执行任务...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {results.map((r) => (
        <div
          key={r.result_id}
          className={`bg-white rounded-lg border border-gray-200 border-l-4 ${agentColors[r.agent_name] || "border-l-gray-300"} p-4`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-sm text-gray-900">
              {r.agent_name}
            </span>
            <span className="text-xs text-gray-400">
              {r.created_at ? new Date(r.created_at).toLocaleTimeString("zh-CN") : ""}
            </span>
          </div>
          <div className="text-sm text-gray-700">
            <MarkdownRenderer content={r.output} />
          </div>
          {r.summary && r.summary !== r.output && (
            <details className="mt-2">
              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                摘要
              </summary>
              <p className="text-xs text-gray-600 mt-1">{r.summary}</p>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
