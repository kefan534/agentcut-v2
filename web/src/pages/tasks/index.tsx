import { useEffect, useState, useCallback } from "react";
import { App, Button, Empty, Table, Tag } from "antd";
import { ListChecks } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { listJobs, retryJob, type TaskItem } from "@/services/api/backend";

const STATUS_META: Record<string, { color: string; label: string }> = {
    queued: { color: "blue", label: "排队中" },
    running: { color: "processing", label: "生成中" },
    succeeded: { color: "success", label: "已完成" },
    failed: { color: "error", label: "失败" },
};

export default function TasksPage() {
    const { message } = App.useApp();
    const [jobs, setJobs] = useState<TaskItem[]>([]);
    const [retrying, setRetrying] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setJobs(await listJobs());
        } catch {
            // 轮询静默失败，避免刷屏
        }
    }, []);

    useEffect(() => {
        void load();
        const timer = window.setInterval(() => void load(), 3000);
        return () => window.clearInterval(timer);
    }, [load]);

    const handleRetry = async (jobId: string) => {
        setRetrying(jobId);
        try {
            await retryJob(jobId);
            message.success("已重新提交任务");
            await load();
        } catch {
            message.error("重试失败，请稍后再试");
        } finally {
            setRetrying(null);
        }
    };

    const columns = [
        {
            title: "类型 / 模型",
            dataIndex: "variable_name",
            key: "variable_name",
            render: (v: string) => <span className="font-mono text-xs">{v}</span>,
        },
        {
            title: "状态",
            dataIndex: "status",
            key: "status",
            render: (s: string) => {
                const m = STATUS_META[s] ?? { color: "default", label: s };
                return <Tag color={m.color}>{m.label}</Tag>;
            },
        },
        {
            title: "消耗",
            dataIndex: "cost_credits",
            key: "cost_credits",
            render: (c: number | null) => (c == null ? "-" : `${c} 积分`),
        },
        {
            title: "创建时间",
            dataIndex: "created_at",
            key: "created_at",
            render: (t: number | null) =>
                t ? new Date(t).toLocaleString("zh-CN", { hour12: false }) : "-",
        },
        {
            title: "结果",
            dataIndex: "result_urls",
            key: "result_urls",
            render: (urls: string[] | null) => {
                if (!urls || !urls.length) return <span className="text-stone-400">-</span>;
                return (
                    <a href={urls[0]} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                        查看
                    </a>
                );
            },
        },
        {
            title: "操作",
            key: "action",
            render: (_: unknown, record: TaskItem) =>
                record.status === "failed" ? (
                    <Button size="small" loading={retrying === record.job_id} onClick={() => void handleRetry(record.job_id)}>
                        重试
                    </Button>
                ) : (
                    <span className="text-stone-400">-</span>
                ),
        },
    ];

    return (
        <PageContainer scroll>
            <div className="mx-auto w-full max-w-5xl py-8">
                <header className="mb-6 flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-card text-stone-700 dark:border-stone-800 dark:text-stone-200">
                        <ListChecks className="size-5" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">任务中心</h1>
                        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">查看生成任务状态，失败或需要时可一键重试</p>
                    </div>
                </header>

                {jobs.length === 0 ? (
                    <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-stone-200 dark:border-stone-800">
                        <Empty description="暂无任务" />
                    </div>
                ) : (
                    <Table rowKey="job_id" dataSource={jobs} columns={columns} pagination={{ pageSize: 10 }} scroll={{ x: 800 }} />
                )}
            </div>
        </PageContainer>
    );
}
