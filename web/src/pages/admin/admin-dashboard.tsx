import { Activity, Coins, Users, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { App, Card, Progress, Spin, Tag } from "antd";

import { adminGetDashboard, getBackendErrorMessage, type AdminDashboard } from "@/services/api/backend";

export default function AdminDashboard() {
    const { message } = App.useApp();
    const [data, setData] = useState<AdminDashboard | null>(null);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setData(await adminGetDashboard());
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载仪表盘失败"));
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void load();
    }, [load]);

    if (loading && !data) {
        return <div className="flex h-64 items-center justify-center"><Spin /></div>;
    }
    if (!data) return null;

    const successRate = data.calls.total ? Math.round((data.calls.success / data.calls.total) * 100) : 0;
    const maxTrend = Math.max(1, ...data.trend.map((t) => t.count));

    const cards = [
        { icon: Users, label: "用户总数", value: data.users.total, sub: `活跃 ${data.users.active} · 今日新增 ${data.users.new_today}` },
        { icon: Zap, label: "总调用量", value: data.calls.total, sub: `今日 ${data.calls.today} · 成功率 ${successRate}%` },
        { icon: Coins, label: "积分消耗", value: data.credits.total_cost, sub: `今日 ${data.credits.cost_today}` },
    ];

    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {cards.map((c) => (
                    <Card key={c.label}>
                        <div className="flex items-center gap-3">
                            <div className="flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">
                                <c.icon className="size-5" />
                            </div>
                            <div>
                                <div className="text-sm text-stone-500 dark:text-stone-400">{c.label}</div>
                                <div className="text-2xl font-semibold text-stone-900 dark:text-stone-100">{c.value}</div>
                                <div className="text-xs text-stone-400">{c.sub}</div>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                <Card title="近 7 天调用趋势" className="lg:col-span-3">
                    <div className="flex h-40 items-end gap-2">
                        {data.trend.map((t) => (
                            <div key={t.date} className="flex flex-1 flex-col items-center gap-1">
                                <div className="text-xs text-stone-500">{t.count}</div>
                                <div
                                    className="w-full rounded-t bg-stone-800 transition-all dark:bg-stone-200"
                                    style={{ height: `${(t.count / maxTrend) * 100}%`, minHeight: t.count ? 4 : 2 }}
                                    title={`${t.date}: ${t.count}`}
                                />
                                <div className="text-xs text-stone-400">{t.date}</div>
                            </div>
                        ))}
                    </div>
                </Card>

                <Card title="模型调用分布" className="lg:col-span-2">
                    {data.by_variable.length === 0 ? (
                        <p className="py-8 text-center text-sm text-stone-400">暂无调用记录</p>
                    ) : (
                        <ul className="flex flex-col gap-3">
                            {data.by_variable.map((v) => (
                                <li key={v.variable_name} className="flex flex-col gap-1">
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="font-medium text-stone-700 dark:text-stone-300">{v.variable_name}</span>
                                        <Tag>{v.count}</Tag>
                                    </div>
                                    <Progress
                                        percent={Math.round((v.count / (data.by_variable[0]?.count || 1)) * 100)}
                                        showInfo={false}
                                        strokeColor="#171717"
                                    />
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            </div>

            <Card title="系统状态">
                <div className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-300">
                    <Activity className="size-4" />
                    <span>运行正常</span>
                    <Tag color="green">online</Tag>
                </div>
            </Card>
        </div>
    );
}
