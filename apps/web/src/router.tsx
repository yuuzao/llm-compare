import { LibraryPage } from "@/pages/library-page"
import { ProvidersPage } from "@/pages/providers-page"
import { createBrowserRouter } from "react-router"
import { AppShell } from "@/components/layout/app-shell"
import { AgentsPage } from "@/pages/agents-page"
import { HomePage } from "@/pages/home-page"
import { NotFoundPage } from "@/pages/not-found-page"
import { ProjectPage } from "@/pages/project-page"
import { RunPage } from "@/pages/run-page"
import { ThoughtSettingsPage } from "@/pages/thought-settings-page"

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "projects/:projectId", element: <ProjectPage /> },
      { path: "projects/:projectId/runs/:runId", element: <RunPage /> },
      { path: "settings/agents", element: <AgentsPage /> },
      { path: "settings/agents/:agentId", element: <AgentsPage /> },
      { path: "settings/providers", element: <ProvidersPage /> },
      { path: "settings/thought", element: <ThoughtSettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
])
