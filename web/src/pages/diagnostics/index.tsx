import { useState, useCallback } from "react";
import { App, Button, Empty, Spin, Table, Tag } from "antd";
import { Activity } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { backend } from "@/services/api/backend";

type DiagnosticResult = {
    name: string;
    url: string;
    ok: boolean;
    status_code: number | null;
    latency_ms: number | null;
    error: string | null;
};

type NetworkDiagnosticResponse = {
    results: DiagnosticResult[];
};

export default function DiagnosticsPage() {
    const { message } = App.useApp();
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<DiagnosticResult[]>([]);

    const runDiagnostic = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await backend.post<NetworkDiagnosticResponse>("/diagnostics/network");
            setResults(data.results ?? []);
            if (!data.results?.length) {
                message.info("暂无可探测的目标地址");
            }
        } catch {
            message.error("诊断失败，请稍后再试");
        } finally {
            setLoading(false);
        }
    }, [message]);

    const columns = [
        {
            title: "名称",
            dataIndex: "name",
            key: "name",
            render: (v: string) => <span className="font-medium">{v}</span>,
        },
        {
            title: "URL",
            dataIndex: "url",
            key: "url",
            render: (v: string) => <span className="font-mono text-xs break-all">{v}</span>,
        },
        {
            title: "状态",
            dataIndex: "ok",
            key: "ok",
            render: (ok: boolean) => (
                <Tag color={ok ? "success" : "error"}>{ok ? "正常" : "异常"}</Tag>
            ),
        },
        {
            title: "状态码",
            dataIndex: "status_code",
            key: "status_code",
            render: (c: number | null) => (c == null ? "-" : c),
        },
        {
            title: "延迟",
            dataIndex: "latency_ms",
            key: "latency_ms",
            render: (l: number | null) => (l == null ? "-" : `${l} ms`),
        },
        {
            title: "错误",
            dataIndex: "error",
            key: "error",
            render: (e: string | null) =>
                e ? (
                    <span className="text-red-600 text-xs">{e}</span>
                ) : (
                    <span className="text-stone-400">-</span>
                ),
        },
    ];

    return (
        <PageContainer scroll>
            <div className="mx-auto w-full max-w-5xl py-8">
                <header className="mb-6 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-card text-stone-700 dark:border-stone-800 dark:text-stone-200">
                            <Activity className="size-5" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">网络诊断</h1>
                            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">对 EdgeOne Makers Agent 与已配置模型接口的连通性进行探测</p>
                        </div>
                    </div>
                    <Button type="primary" icon={<Activity className="size-4" />} loading={loading} onClick={() => void runDiagnostic()}>
                        开始诊断
                    </Button>
                </header>

                {loading ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-stone-200 dark:border-stone-800">
                        <Spin size="large" />
                        <span className="text-sm text-stone-500 dark:text-stone-400">正在探测连通性…</span>
                    </div>
                ) : results.length === 0 ? (
                    <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-stone-200 dark:border-stone-800">
                        <Empty description="点击「开始诊断」进行网络连通性探测" />
                    </div>
                ) : (
                    <Table
                        rowKey={(r) => `${r.name}-${r.url}`}
                        dataSource={results}
                        columns={columns}
                        pagination={{ pageSize: 10 }}
                        scroll={{ x: 800 }}
                    />
                )}
            </div>
        </PageContainer>
    );
}
