import type { ReactNode } from "react";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { SiteFooter } from "@/components/layout/site-footer";

export default function UserLayout({ children }: { children: ReactNode }) {
    return (
        <div className="bg-background text-foreground">
            <div className="flex h-dvh overflow-hidden">
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <AppTopNav />
                    <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
                </div>
                <AgentPanel />
            </div>
            {/* 页脚排在视口之外，拉到页面最底部才可见 */}
            <SiteFooter />
        </div>
    );
}
