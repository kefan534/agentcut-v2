import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import CanvasProjectPage from "@/pages/canvas/project";
import AdminPage from "@/pages/admin";
import ConfigPage from "@/pages/config";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
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
            { path: "/assets", element: <RequireAuth><AssetsPage /></RequireAuth> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <RequireAuth><CanvasPage /></RequireAuth> },
            { path: "/canvas/:id", element: <RequireAuth><CanvasProjectPage /></RequireAuth> },
            { path: "/config", element: <ConfigPage /> },
            { path: "/admin", element: <RequireAuth adminOnly><AdminPage /></RequireAuth> },
        ],
    },
    { path: "/login", element: <LoginPage /> },
    { path: "/register", element: <RegisterPage /> },
    { path: "*", element: <NotFound /> },
]);
