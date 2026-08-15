import type { ReactNode } from "react";

function ModuleShell({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children?: ReactNode }) {
    return (
        <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto py-6">
            <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <h1 className="text-xl font-medium text-foreground">{title}</h1>
                    {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
                </div>
                {action}
            </div>
            <div className="mt-6">{children}</div>
        </div>
    );
}

function EmptyState({ hint }: { hint: string }) {
    return (
        <div className="flex h-72 flex-col items-center justify-center rounded-xl border border-dashed border-border text-center text-muted-foreground">
            <p className="text-sm">暂无数据</p>
            <p className="mt-1 text-xs">{hint}</p>
        </div>
    );
}

export function DramaScriptAgentPage() {
    return (
        <ModuleShell title="剧本智能体" description="用 Agent 辅助扩写、润色与拆解剧本。">
            <EmptyState hint="配置 Agent 后即可使用" />
        </ModuleShell>
    );
}

export function DramaAudioPage() {
    return (
        <ModuleShell title="配音配乐" description="为对白与场景生成配音与背景音乐。">
            <EmptyState hint="暂无音频资产" />
        </ModuleShell>
    );
}
