import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import CanvasProjectPage from "@/pages/canvas/project";
import AdminPage from "@/pages/admin";
import AdminSkillReview from "@/pages/admin-skill-review";
import AdminModelPricing from "@/pages/admin-model-pricing";
import AdminAuditLogs from "@/pages/admin-audit-logs";
import MyRevenuePage from "@/pages/my-revenue";
import ConfigPage from "@/pages/config";
import HomePage from "@/pages/home";
import HistoryPage from "@/pages/history";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import SkillStorePage from "@/pages/skill-store";
import VideoPage from "@/pages/video";
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
            { path: "/assets", element: <RequireAuth><AssetsPage /></RequireAuth> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <RequireAuth><CanvasPage /></RequireAuth> },
            { path: "/canvas/:id", element: <RequireAuth><CanvasProjectPage /></RequireAuth> },
            { path: "/config", element: <ConfigPage /> },
            { path: "/skill-store", element: <RequireAuth><SkillStorePage /></RequireAuth> },
            { path: "/my-revenue", element: <RequireAuth><MyRevenuePage /></RequireAuth> },
            { path: "/admin", element: <RequireAuth adminOnly><AdminPage /></RequireAuth> },
            { path: "/admin/skills", element: <RequireAuth adminOnly><AdminSkillReview /></RequireAuth> },
            { path: "/admin/model-pricing", element: <RequireAuth adminOnly><AdminModelPricing /></RequireAuth> },
            { path: "/admin/audit-logs", element: <RequireAuth adminOnly><AdminAuditLogs /></RequireAuth> },
        ],
    },
    { path: "/login", element: <LoginPage /> },
    { path: "/register", element: <RegisterPage /> },
    { path: "*", element: <NotFound /> },
]);
