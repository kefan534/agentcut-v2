import { useEffect, useState } from "react";
import { Button, Card, Spin, message } from "antd";
import { CheckCircle2 } from "lucide-react";

const MAKERS_BUILTIN_MODELS = [
    "@makers/hy3",
    "@makers/hy3-preview",
    "@makers/deepseek-v4-pro",
    "@makers/deepseek-v4-flash",
    "@makers/minimax-m3",
    "@makers/minimax-m2.7",
    "@makers/kimi-k2.6",
];

function displayName(modelId: string): string {
    return modelId.replace("@makers/", "");
}

function capabilityTag(modelId: string): { label: string; color: string } | null {
    if (modelId.includes("deepseek-v4-pro")) return { label: "能力强", color: "bg-stone-700 text-stone-300" };
    if (modelId.includes("deepseek-v4-flash")) return { label: "速度快", color: "bg-purple-500/20 text-purple-300" };
    if (modelId.includes("kimi-k2.6")) return { label: "长文本", color: "bg-stone-700 text-stone-300" };
    if (modelId.includes("hy3")) return { label: "多模态", color: "bg-stone-700 text-stone-300" };
    return null;
}

export default function AdminModelPricing() {
    const [selected, setSelected] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/v1/admin/model-pricing", { credentials: "include" });
            const data = await res.json();
            if (data.ok) {
                const enabled = data.items.find((m: { enabled: boolean; modelId: string }) => m.enabled);
                setSelected(enabled?.modelId || "");
            } else {
                message.error(data.detail || "加载失败");
            }
        } catch {
            message.error("网络错误");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { void load(); }, []);

    const save = async () => {
        if (!selected) {
            message.warning("请先选择一个模型");
            return;
        }
        setSaving(true);
        try {
            const res = await fetch("/api/v1/admin/model-pricing/select-builtin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ modelId: selected }),
            });
            const data = await res.json();
            if (res.ok && data.ok) {
                message.success("已保存");
            } else {
                message.error(data.detail || "保存失败");
            }
        } catch {
            message.error("网络错误");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="w-full max-w-7xl">
            <h2 className="mb-2 text-2xl font-semibold text-stone-900 dark:text-stone-100">Agent内置模型</h2>
            <p className="mb-6 text-sm text-stone-500 dark:text-stone-400">
                选择当前 Agent 使用的 Makers 内置模型，每次只能选择一个。模型名称必须携带 <code className="rounded bg-stone-100 px-1 py-0.5 text-stone-700 dark:bg-stone-800 dark:text-stone-300">@makers/</code> 前缀。
            </p>

            <Card loading={loading} className="border-0 bg-transparent shadow-none" bodyStyle={{ padding: 0 }}>
                <Spin spinning={loading}>
                    <div className="flex flex-col gap-2">
                        {MAKERS_BUILTIN_MODELS.map((modelId) => {
                            const active = selected === modelId;
                            const tag = capabilityTag(modelId);
                            return (
                                <button
                                    key={modelId}
                                    type="button"
                                    onClick={() => setSelected(modelId)}
                                    className={[
                                        "group flex w-full items-center gap-4 rounded-xl border px-5 py-4 text-left transition",
                                        "focus:outline-none focus:ring-2 focus:ring-purple-500/50",
                                        active
                                            ? "border-purple-500 bg-purple-500/10"
                                            : "border-stone-200 bg-white hover:border-stone-400 dark:border-stone-700 dark:bg-stone-900/50 dark:hover:border-stone-500",
                                    ].join(" ")}
                                >
                                    <div className={[
                                        "flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition",
                                        active
                                            ? "border-purple-500 bg-purple-500 text-white"
                                            : "border-stone-300 dark:border-stone-600",
                                    ].join(" ")}>
                                        {active ? <CheckCircle2 className="size-4" /> : <div className="size-2.5 rounded-full bg-transparent" />}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-3">
                                            <span className={["text-base font-medium", active ? "text-stone-900 dark:text-white" : "text-stone-700 dark:text-stone-200"].join(" ")}>
                                                {displayName(modelId)}
                                            </span>
                                            {tag ? (
                                                <span className={["rounded px-2 py-0.5 text-xs", tag.color].join(" ")}>
                                                    {tag.label}
                                                </span>
                                            ) : null}
                                        </div>
                                        <div className="mt-0.5 font-mono text-xs text-stone-400 dark:text-stone-500">
                                            {modelId}
                                        </div>
                                    </div>

                                    {active ? (
                                        <span className="shrink-0 rounded bg-purple-500 px-2.5 py-1 text-xs font-medium text-white">
                                            当前启用
                                        </span>
                                    ) : (
                                        <span className="shrink-0 rounded bg-stone-100 px-2.5 py-1 text-xs text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                                            未启用
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </Spin>

                <div className="mt-6 flex justify-end">
                    <Button type="primary" size="large" loading={saving} onClick={() => void save()}>
                        保存
                    </Button>
                </div>
            </Card>
        </div>
    );
}
