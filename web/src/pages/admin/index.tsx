import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { App, Tabs } from "antd";

import { PageContainer } from "@/components/layout/page-container";
import { AppConfigPanel } from "@/components/layout/app-config-modal";
import { useUserStore } from "@/stores/use-user-store";
import AdminDashboard from "@/pages/admin/admin-dashboard";
import AdminModels from "@/pages/admin/admin-models";
import AdminVariables from "@/pages/admin/admin-variables";
import AdminUsers from "@/pages/admin/admin-users";
import AdminLogs from "@/pages/admin/admin-logs";
import { AdminAgentConfig } from "@/pages/admin/admin-agent-config";
import AdminSkillReview from "@/pages/admin-skill-review";
import AdminModelPricing from "@/pages/admin-model-pricing";
import AdminAuditLogs from "@/pages/admin-audit-logs";

const TABS = [
    { key: "dashboard", label: "数据总览" },
    { key: "models", label: "模型管理" },
    { key: "variables", label: "变量映射" },
    { key: "agent-config", label: "Agent 配置" },
    { key: "users", label: "用户管理" },
    { key: "logs", label: "调用日志" },
    { key: "skills", label: "Skill 审核" },
    { key: "model-pricing", label: "Agent内置模型" },
    { key: "audit-logs", label: "审计日志" },
    { key: "config", label: "设置" },
];

const TAB_CONTENT: Record<string, React.ReactNode> = {
    dashboard: <AdminDashboard />,
    models: <AdminModels />,
    variables: <AdminVariables />,
    "agent-config": <AdminAgentConfig />,
    users: <AdminUsers />,
    logs: <AdminLogs />,
    skills: <AdminSkillReview />,
    "model-pricing": <AdminModelPricing />,
    "audit-logs": <AdminAuditLogs />,
    config: <AppConfigPanel />,
};

export default function AdminPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const { tab } = useParams();
    const currentUser = useUserStore((state) => state.user);
    const [activeTab, setActiveTab] = useState(tab && TAB_CONTENT[tab] ? tab : "dashboard");

    useEffect(() => {
        if (!currentUser) {
            navigate("/login", { state: { from: "/admin" } });
            return;
        }
        if (currentUser.role !== "admin") {
            message.error("无权访问管理后台");
            navigate("/");
        }
    }, [currentUser, navigate, message]);

    useEffect(() => {
        if (tab && TAB_CONTENT[tab]) setActiveTab(tab);
    }, [tab]);

    return (
        <main className="h-full overflow-hidden bg-background text-foreground">
            <PageContainer scroll>
                <h1 className="mb-4 mt-6 text-2xl font-semibold">管理后台</h1>
                <Tabs
                    activeKey={activeTab}
                    onChange={(key) => {
                        setActiveTab(key);
                        navigate(key === "dashboard" ? "/admin" : `/admin/${key}`, { replace: true });
                    }}
                    items={TABS.map((t) => ({ key: t.key, label: t.label, children: TAB_CONTENT[t.key] }))}
                />
            </PageContainer>
        </main>
    );
}
