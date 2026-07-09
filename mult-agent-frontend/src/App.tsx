import { useState } from "react";
import { ThemeProvider } from "./hooks/useTheme";
import Layout from "./components/Layout";
import TaskList from "./components/TaskList";
import TaskDetail from "./components/TaskDetail";
import CreateTaskForm from "./components/CreateTaskForm";
import ProfilePage from "./components/ProfilePage";
import AgentTeam from "./components/AgentTeam";

type View =
  | { page: "list"; statusFilter?: string }
  | { page: "create" }
  | { page: "detail"; taskId: string }
  | { page: "profile" }
  | { page: "agentTeam" };

export default function App() {
  const [view, setView] = useState<View>({ page: "list" });
  const [agentFilter, setAgentFilter] = useState<string | undefined>(undefined);

  return (
    <ThemeProvider>
      <Layout
        agentFilter={agentFilter}
        currentPage={view.page}
        onSelectAgent={(a) => {
          setAgentFilter(a);
          setView({ page: "list" });
        }}
        onNavigateToList={() => {
          setAgentFilter(undefined);
          setView({ page: "list" });
        }}
        onNavigateToCreate={() => setView({ page: "create" })}
        onNavigateToProfile={() => setView({ page: "profile" })}
        onNavigateToAgentTeam={() => setView({ page: "agentTeam" })}
      >
        {view.page === "list" && (
          <TaskList
            statusFilter={view.statusFilter}
            agentFilter={agentFilter}
            onStatusFilter={(f) => setView({ page: "list", statusFilter: f })}
            onClearAgentFilter={() => setAgentFilter(undefined)}
            onSelectTask={(id) => setView({ page: "detail", taskId: id })}
          />
        )}
        {view.page === "create" && (
          <CreateTaskForm
            onCreated={(id) => setView({ page: "detail", taskId: id })}
          />
        )}
        {view.page === "detail" && (
          <TaskDetail
            taskId={view.taskId}
            onBack={() => setView({ page: "list" })}
          />
        )}
        {view.page === "profile" && <ProfilePage />}
        {view.page === "agentTeam" && <AgentTeam />}
      </Layout>
    </ThemeProvider>
  );
}
