import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import CanvasProjectPage from "@/pages/canvas/project";
import AdminPage from "@/pages/admin";
import MyRevenuePage from "@/pages/my-revenue";
import ConfigPage from "@/pages/config";
import HomePage from "@/pages/home";
import HistoryPage from "@/pages/history";
import TasksPage from "@/pages/tasks";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import SkillStorePage from "@/pages/skill-store";
import VideoPage from "@/pages/video";
import DramaLayout from "@/pages/drama/drama-layout";
import DramaProjectsPage from "@/pages/drama/drama-projects";
import DramaScriptPage from "@/pages/drama/drama-script";
import DramaNovelPage from "@/pages/drama/drama-novel";
import DramaAssetsPage from "@/pages/drama/drama-assets";
import DramaStoryboardPage from "@/pages/drama/drama-storyboard";
import DramaTasksPage from "@/pages/drama/drama-tasks";
import DramaArtStylePage from "@/pages/drama/drama-art-style";
import DramaSettingsPage from "@/pages/drama/drama-settings";
import DramaMediaLabPage from "@/pages/drama/drama-media-lab";
import DramaPromptStudioPage from "@/pages/drama/drama-prompt-studio";
import { DramaScriptAgentPage, DramaAudioPage } from "@/pages/drama/drama-module";
import CostCenterPage from "@/pages/cost-center";
import DiagnosticsPage from "@/pages/diagnostics";
import QAPage from "@/pages/qa";
import DramaLockCardPage from "@/pages/drama/lock-card";
import { useUserStore } from "@/stores/use-user-store";

function RequireAuth({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
    const user = useUserStore((state) => state.user);
    if (!user) {
        return <Navigate to="/login" replace state={{ from: window.location.pathname + window.location.search }} />;
    }
    if (adminOnly && user.role !== "admin") {
        return <Navigate to="/" replace />;
    }
    return <>{children}</>;
}

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/history", element: <RequireAuth><HistoryPage /></RequireAuth> },
            { path: "/tasks", element: <RequireAuth><TasksPage /></RequireAuth> },
            { path: "/cost-center", element: <RequireAuth><CostCenterPage /></RequireAuth> },
            { path: "/diagnostics", element: <RequireAuth adminOnly><DiagnosticsPage /></RequireAuth> },
            { path: "/qa", element: <RequireAuth><QAPage /></RequireAuth> },
            { path: "/lock-card", element: <RequireAuth><DramaLockCardPage /></RequireAuth> },
            { path: "/assets", element: <RequireAuth><AssetsPage /></RequireAuth> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <RequireAuth><CanvasPage /></RequireAuth> },
            { path: "/canvas/:id", element: <RequireAuth><CanvasProjectPage /></RequireAuth> },
            { path: "/config", element: <ConfigPage /> },
            { path: "/skill-store", element: <RequireAuth><SkillStorePage /></RequireAuth> },
            { path: "/my-revenue", element: <RequireAuth><MyRevenuePage /></RequireAuth> },
            { path: "/admin", element: <RequireAuth adminOnly><AdminPage /></RequireAuth> },
            { path: "/admin/:tab", element: <RequireAuth adminOnly><AdminPage /></RequireAuth> },
            {
                path: "/drama",
                element: <RequireAuth><DramaLayout /></RequireAuth>,
                children: [
                    { index: true, element: <Navigate to="/drama/projects" replace /> },
                    { path: "projects", element: <DramaProjectsPage /> },
                    { path: "tasks", element: <DramaTasksPage /> },
                    { path: "script", element: <DramaScriptPage /> },
                    { path: "script-agent", element: <DramaScriptAgentPage /> },
                    { path: "novel", element: <DramaNovelPage /> },
                    { path: "assets", element: <DramaAssetsPage /> },
                    { path: "assets-generate", element: <DramaAssetsPage /> },
                    { path: "art-style", element: <DramaArtStylePage /> },
                    { path: "audio", element: <DramaAudioPage /> },
                    { path: "storyboard", element: <DramaStoryboardPage /> },
                    { path: "production", element: <DramaStoryboardPage /> },
                    { path: "prompt-studio", element: <DramaPromptStudioPage /> },
                    { path: "media-lab", element: <DramaMediaLabPage /> },
                    { path: "settings", element: <DramaSettingsPage /> },
                ],
            },
        ],
    },
    { path: "/login", element: <LoginPage /> },
    { path: "/register", element: <RegisterPage /> },
    { path: "*", element: <NotFound /> },
]);
