import { useEffect, useState } from "react";
import { getAgentStatus } from "../api";
import type { AgentStatus } from "../types";

export default function AgentStatusBar() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);

  useEffect(() => {
    getAgentStatus().then((res) => setAgents(res.agents)).catch(() => {});
  }, []);

  return (
    <div className="flex gap-3 text-xs">
      {agents.map((a) => (
        <span key={a.name} className="flex items-center gap-1">
          <span
            className={`w-2 h-2 rounded-full ${a.online ? "bg-green-500" : "bg-red-400"}`}
          />
          <span className="text-gray-600 capitalize">{a.name}</span>
        </span>
      ))}
    </div>
  );
}
