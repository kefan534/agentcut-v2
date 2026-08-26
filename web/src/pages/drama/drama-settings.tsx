import { ServerCog } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { App, Empty, Spin, Tag } from "antd";

import { getBackendErrorMessage, getDramaModels, type DramaModels } from "@/services/api/backend";

const CATEGORY_LABELS: Record<string, string> = {
    text: "文本模型",
    image: "图像模型",
    video: "视频模型",
    audio: "音频模型",
};

export default function DramaSettingsPage() {
    const { message } = App.useApp();
    const [models, setModels] = useState<DramaModels | null>(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setModels(await getDramaModels());
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载模型失败"));
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto py-6">
            <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-card text-stone-700 dark:border-stone-800 dark:text-stone-200">
                    <ServerCog className="size-5" />
                </div>
                <div>
                    <h1 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">模型与部署</h1>
                    <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">制片工坊使用的模型由 AgentCut 模型路由统一管理。</p>
                </div>
            </div>

            <div className="mt-6">
                {loading ? (
                    <div className="flex h-64 items-center justify-center">
                        <Spin />
                    </div>
                ) : !models ? null : (
                    <div className="flex flex-col gap-4">
                        {(Object.keys(models.models) as Array<keyof DramaModels["models"]>).map((cat) => {
                            const items = models.models[cat] || [];
                            return (
                                <div key={cat} className="rounded-lg border border-stone-200 bg-card p-5 dark:border-stone-800">
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-sm font-medium text-stone-800 dark:text-stone-200">{CATEGORY_LABELS[cat]}</h2>
                                        <Tag>{items.length}</Tag>
                                    </div>
                                    {items.length === 0 ? (
                                        <p className="mt-2 text-xs text-stone-400">未配置，请在 AgentCut 管理后台「模型路由」中添加。</p>
                                    ) : (
                                        <ul className="mt-3 flex flex-col gap-2">
                                            {items.map((m) => (
                                                <li key={m.variable_name} className="flex items-center justify-between rounded-md border border-stone-100 px-3 py-2 text-sm dark:border-stone-800">
                                                    <span className="font-medium text-stone-700 dark:text-stone-300">{m.variable_name}</span>
                                                    <span className="text-xs text-stone-400">
                                                        {m.vendor} · {m.model_version}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            );
                        })}
                        {Object.values(models.models).every((arr) => (arr || []).length === 0) ? (
                            <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-stone-200 dark:border-stone-800">
                                <Empty description="尚未配置任何模型" />
                            </div>
                        ) : null}
                    </div>
                )}
            </div>

            <div className="mt-6 rounded-lg border border-stone-200 bg-stone-50 p-4 text-xs leading-relaxed text-stone-500 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-400">
                模型、API 密钥与积分计费在 AgentCut「管理后台 → 模型路由」中统一维护，制片工坊直接复用。如需更换文本/图像/视频模型，请在管理后台调整对应的模型源与映射。
            </div>
        </div>
    );
}
