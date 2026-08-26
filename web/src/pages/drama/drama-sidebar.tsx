import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";

const groups = [
    {
        label: "工作台",
        items: [
            { to: "/drama/projects", label: "项目" },
            { to: "/drama/tasks", label: "任务看板" },
        ],
    },
    {
        label: "剧本创作",
        items: [
            { to: "/drama/script", label: "剧本编辑" },
            { to: "/drama/script-agent", label: "剧本智能体" },
            { to: "/drama/novel", label: "小说" },
        ],
    },
    {
        label: "资产管理",
        items: [
            { to: "/drama/assets", label: "资产库" },
            { to: "/drama/assets-generate", label: "资产生成" },
            { to: "/drama/art-style", label: "画风" },
            { to: "/drama/audio", label: "配音配乐" },
        ],
    },
    {
        label: "制作",
        items: [
            { to: "/drama/storyboard", label: "分镜" },
            { to: "/drama/production", label: "合成工作台" },
        ],
    },
    {
        label: "创作工具",
        items: [
            { to: "/drama/prompt-studio", label: "分段提示词" },
            { to: "/drama/media-lab", label: "多模态实验室" },
        ],
    },
    {
        label: "设置",
        items: [{ to: "/drama/settings", label: "模型与部署" }],
    },
];

export function DramaSidebar() {
    return (
        <aside className="flex h-full w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-5">
            <div className="px-2 text-sm font-semibold text-foreground">制片工坊</div>
            {groups.map((g) => (
                <div key={g.label} className="flex flex-col gap-1">
                    <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.label}</div>
                    {g.items.map((it) => (
                        <NavLink
                            key={it.to}
                            to={it.to}
                            className={({ isActive }) =>
                                cn(
                                    "rounded-md px-2 py-1.5 text-sm transition-colors",
                                    isActive
                                        ? "bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100"
                                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                                )
                            }
                        >
                            {it.label}
                        </NavLink>
                    ))}
                </div>
            ))}
            <div className="mt-auto px-2 pt-4 text-[11px] leading-relaxed text-muted-foreground/70">
                Powered by{" "}
                <a
                    href="https://github.com/HBAI-Ltd/Toonflow-app"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                    Toonflow
                </a>
                <div className="mt-0.5">Apache-2.0 + Supplemental License</div>
            </div>
        </aside>
    );
}
