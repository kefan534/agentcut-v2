import { Outlet } from "react-router-dom";

import { DramaSidebar } from "./drama-sidebar";

/**
 * 制片工坊整体布局：保留 AgentCut 通栏导航（由 UserLayout 提供）。
 * 下方整体套用与通栏同款的 `mx-auto max-w-7xl px-6` 容器，
 * 使左侧栏左边缘、工作区右边缘与全站（通栏/其它页）左右留白完全对齐。
 * 左栏为 Toonflow 模块导航，右栏为各模块工作区（Outlet）。
 */
export default function DramaLayout() {
    return (
        <div className="mx-auto flex h-full min-h-0 w-full max-w-7xl px-6">
            <DramaSidebar />
            <div className="min-w-0 flex-1 overflow-hidden pl-6">
                <Outlet />
            </div>
        </div>
    );
}
