import { useEffect, useState, useCallback } from "react";
import { App, Button, Card, Col, InputNumber, Row, Statistic, Table } from "antd";
import dayjs from "dayjs";
import { Wallet } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { backend } from "@/services/api/backend";

type ByReasonItem = {
    reason: string;
    count: number;
    sum: number;
};

type LedgerItem = {
    id: string;
    created_at: string | null;
    reason: string;
    delta: number;
    balance_after: number;
    reference_id: string | null;
};

type BillingSummary = {
    balance: number;
    total_earned: number;
    total_spent: number;
    frozen_balance: number;
    budget_cap: number;
    by_reason: ByReasonItem[];
    recent: LedgerItem[];
};

const EVENTS_PAGE_SIZE = 20;

function formatTime(value: string | null): string {
    if (!value) return "-";
    const d = dayjs(value);
    return d.isValid() ? d.format("YYYY-MM-DD HH:mm:ss") : value;
}

export default function CostCenterPage() {
    const { message } = App.useApp();

    const [summary, setSummary] = useState<BillingSummary | null>(null);
    const [summaryLoading, setSummaryLoading] = useState(false);

    const [budgetValue, setBudgetValue] = useState<number>(1000);
    const [savingBudget, setSavingBudget] = useState(false);

    const [events, setEvents] = useState<LedgerItem[]>([]);
    const [eventsOffset, setEventsOffset] = useState(0);
    const [eventsHasMore, setEventsHasMore] = useState(false);
    const [eventsLoading, setEventsLoading] = useState(false);

    const loadSummary = useCallback(async () => {
        setSummaryLoading(true);
        try {
            const { data } = await backend.get<BillingSummary>("/billing/summary");
            setSummary(data);
            setBudgetValue(data.budget_cap);
        } catch {
            message.error("加载成本中心数据失败，请稍后再试");
        } finally {
            setSummaryLoading(false);
        }
    }, [message]);

    const loadEvents = useCallback(
        async (append: boolean) => {
            setEventsLoading(true);
            try {
                const nextOffset = append ? eventsOffset : 0;
                const { data } = await backend.get<LedgerItem[]>("/billing/events", {
                    params: { limit: EVENTS_PAGE_SIZE, offset: nextOffset },
                });
                setEvents((prev) => (append ? [...prev, ...data] : data));
                setEventsOffset(nextOffset + EVENTS_PAGE_SIZE);
                setEventsHasMore(data.length === EVENTS_PAGE_SIZE);
            } catch {
                message.error("加载计费事件失败，请稍后再试");
            } finally {
                setEventsLoading(false);
            }
        },
        [eventsOffset, message],
    );

    useEffect(() => {
        void loadSummary();
        void loadEvents(false);
    }, [loadSummary, loadEvents]);

    const handleSaveBudget = async () => {
        if (budgetValue == null || budgetValue < 0) {
            message.error("预算上限必须为非负整数");
            return;
        }
        setSavingBudget(true);
        try {
            await backend.put("/billing/budget", { budget_cap: budgetValue });
            message.success("预算上限已保存");
            await loadSummary();
        } catch {
            message.error("保存失败，请稍后再试");
        } finally {
            setSavingBudget(false);
        }
    };

    const reasonColumns = [
        { title: "类型", dataIndex: "reason", key: "reason" },
        { title: "笔数", dataIndex: "count", key: "count" },
        {
            title: "积分",
            dataIndex: "sum",
            key: "sum",
            render: (v: number) => (v >= 0 ? `+${v}` : `${v}`),
        },
    ];

    const eventColumns = [
        {
            title: "时间",
            dataIndex: "created_at",
            key: "created_at",
            render: (v: string | null) => formatTime(v),
        },
        { title: "类型", dataIndex: "reason", key: "reason" },
        {
            title: "变动",
            dataIndex: "delta",
            key: "delta",
            render: (v: number) => (
                <span style={{ color: v >= 0 ? "#16a34a" : "#dc2626" }}>
                    {v >= 0 ? `+${v}` : `${v}`}
                </span>
            ),
        },
        { title: "变动后余额", dataIndex: "balance_after", key: "balance_after" },
        {
            title: "关联",
            dataIndex: "reference_id",
            key: "reference_id",
            render: (v: string | null) => (v ? <span className="font-mono text-xs">{v}</span> : "-"),
        },
    ];

    return (
        <PageContainer scroll>
            <div className="mx-auto w-full max-w-7xl py-8">
                <header className="mb-6 flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-card text-stone-700 dark:border-stone-800 dark:text-stone-200">
                        <Wallet className="size-5" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">成本中心</h1>
                        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">查看积分余额、消费构成与计费明细</p>
                    </div>
                </header>

                <Card loading={summaryLoading} className="mb-6">
                    <Row gutter={[16, 16]}>
                        <Col xs={12} md={6} lg={4}>
                            <Statistic title="当前余额" value={summary?.balance ?? 0} suffix="积分" />
                        </Col>
                        <Col xs={12} md={6} lg={4}>
                            <Statistic title="累计获得" value={summary?.total_earned ?? 0} suffix="积分" valueStyle={{ color: "#16a34a" }} />
                        </Col>
                        <Col xs={12} md={6} lg={4}>
                            <Statistic title="累计消费" value={summary?.total_spent ?? 0} suffix="积分" valueStyle={{ color: "#dc2626" }} />
                        </Col>
                        <Col xs={12} md={6} lg={4}>
                            <Statistic title="冻结积分" value={summary?.frozen_balance ?? 0} suffix="积分" />
                        </Col>
                        <Col xs={24} md={12} lg={8}>
                            <Statistic title="预算上限" value={summary?.budget_cap ?? 0} suffix="积分" />
                            <div className="mt-2 flex items-center gap-2">
                                <InputNumber
                                    min={0}
                                    max={10000000}
                                    value={budgetValue}
                                    onChange={(v) => setBudgetValue(v ?? 0)}
                                    className="w-36"
                                    placeholder="预算上限"
                                />
                                <Button type="primary" loading={savingBudget} onClick={() => void handleSaveBudget()}>
                                    保存
                                </Button>
                            </div>
                        </Col>
                    </Row>
                </Card>

                <Card title="按类型消费" className="mb-6">
                    <Table
                        rowKey="reason"
                        dataSource={summary?.by_reason ?? []}
                        columns={reasonColumns}
                        pagination={false}
                        size="middle"
                        scroll={{ x: 480 }}
                    />
                </Card>

                <Card title="计费事件明细" className="mb-6">
                    <Table
                        rowKey="id"
                        dataSource={events}
                        columns={eventColumns}
                        loading={eventsLoading}
                        pagination={false}
                        size="middle"
                        scroll={{ x: 640 }}
                    />
                    <div className="mt-4 flex justify-center">
                        <Button
                            type="dashed"
                            loading={eventsLoading}
                            disabled={!eventsHasMore}
                            onClick={() => void loadEvents(true)}
                        >
                            {eventsHasMore ? "加载更多" : "没有更多了"}
                        </Button>
                    </div>
                </Card>
            </div>
        </PageContainer>
    );
}
