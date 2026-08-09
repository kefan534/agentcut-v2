import { useEffect, useState } from "react";
import { Card, Table, Tag, Select, Input, DatePicker, Button } from "antd";
import dayjs from "dayjs";

type AuditLog = {
    id: string; userId: string | null; event: string; targetId: string;
    toolName: string | null; status: string | null; meta: Record<string, unknown> | null;
    costCredits: number | null; createdAt: string;
};

const EVENT_COLORS: Record<string, string> = {
    skill_submit: "blue",
    skill_enable: "green",
    skill_admin_update: "orange",
    skill_admin_delete: "red",
    skill_review_hide: "default",
    ima_search: "cyan",
    asset_upload: "purple",
    model_switch: "magenta",
};

export default function AdminAuditLogs() {
    const [items, setItems] = useState<AuditLog[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState({ event: "", userId: "", days: 30 });

    const load = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ days: String(filters.days), limit: "200" });
            if (filters.event) params.set("event", filters.event);
            if (filters.userId) params.set("userId", filters.userId);
            const res = await fetch(`/api/v1/admin/audit-logs?${params}`, { credentials: "include" });
            const data = await res.json();
            if (data.ok) {
                setItems(data.items);
                setTotal(data.total);
            }
        } catch { /* */ }
        finally { setLoading(false); }
    };

    useEffect(() => { load(); }, [filters]);

    return (
        <div className="p-6">
            <h2 className="mb-4 text-lg font-bold">审计日志（最近 {filters.days} 天，共 {total} 条）</h2>
            <div className="mb-4 flex items-center gap-3">
                <Select value={filters.days} onChange={(v) => setFilters({ ...filters, days: v })}
                    style={{ width: 140 }} options={[7, 14, 30, 60, 90].map(d => ({ value: d, label: `最近 ${d} 天` }))} />
                <Select value={filters.event || undefined} onChange={(v) => setFilters({ ...filters, event: v || "" })}
                    allowClear style={{ width: 200 }} placeholder="事件类型"
                    options={Object.keys(EVENT_COLORS).map(e => ({ value: e, label: e }))} />
                <Input.Search placeholder="userId" allowClear style={{ width: 240 }}
                    onSearch={(v) => setFilters({ ...filters, userId: v })} />
                <Button onClick={load}>刷新</Button>
            </div>
            <Table<AuditLog>
                dataSource={items}
                rowKey="id"
                loading={loading}
                pagination={{ pageSize: 50 }}
                size="small"
                columns={[
                    {
                        title: "时间", dataIndex: "createdAt", width: 160,
                        render: (v: string) => dayjs(v).format("YYYY-MM-DD HH:mm:ss"),
                    },
                    {
                        title: "事件", dataIndex: "event", width: 180,
                        render: (e: string) => <Tag color={EVENT_COLORS[e] || "default"}>{e}</Tag>,
                    },
                    { title: "用户", dataIndex: "userId", width: 200, ellipsis: true, render: (v: string) => v ? v.slice(0, 8) + "…" : "—" },
                    { title: "对象", dataIndex: "targetId", width: 200, ellipsis: true },
                    {
                        title: "积分", dataIndex: "costCredits", width: 80,
                        render: (v: number) => v ? <Tag color="orange">{v}</Tag> : "—",
                    },
                    {
                        title: "状态", dataIndex: "status", width: 80,
                        render: (v: string) => <Tag color={v === "success" ? "green" : v === "failed" ? "red" : "default"}>{v || "—"}</Tag>,
                    },
                    {
                        title: "元数据", dataIndex: "meta",
                        render: (m: Record<string, unknown>) => m ? <pre className="max-w-md overflow-x-auto text-xs">{JSON.stringify(m)}</pre> : "—",
                    },
                ]}
            />
        </div>
    );
}