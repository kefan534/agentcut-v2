import { useCallback, useEffect, useState } from "react";
import { App, Button, Card, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import {
    adminListLogs,
    adminListUsers,
    getBackendErrorMessage,
    type AdminCallLog,
    type BackendUser,
} from "@/services/api/backend";

export default function AdminLogs() {
    const { message } = App.useApp();
    const [logs, setLogs] = useState<AdminCallLog[]>([]);
    const [users, setUsers] = useState<BackendUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
    const [filters, setFilters] = useState<{ user_id?: string; variable_name?: string; status?: string }>({});

    const loadUsers = useCallback(async () => {
        try {
            setUsers(await adminListUsers());
        } catch {
            /* 忽略：下拉可选可不选 */
        }
    }, []);

    useEffect(() => {
        void loadUsers();
    }, [loadUsers]);

    const load = useCallback(async (page = 1, pageSize = 20) => {
        setLoading(true);
        try {
            const offset = (page - 1) * pageSize;
            const data = await adminListLogs({ ...filters, limit: pageSize, offset });
            setLogs(data.items);
            setPagination({ current: page, pageSize, total: data.total });
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载日志失败"));
        } finally {
            setLoading(false);
        }
    }, [filters, message]);

    useEffect(() => {
        void load(1, pagination.pageSize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]);

    const columns: ColumnsType<AdminCallLog> = [
        { title: "用户", dataIndex: "user_id", key: "user_id", ellipsis: true, render: (v) => v?.slice(0, 8) ?? "-" },
        { title: "模型", dataIndex: "variable_name", key: "variable_name" },
        { title: "分类", dataIndex: "modal_category", key: "modal_category" },
        { title: "状态", dataIndex: "status", key: "status", render: (v) => <Tag color={v === "success" ? "green" : v === "failed" ? "red" : "default"}>{v}</Tag> },
        { title: "状态码", dataIndex: "status_code", key: "status_code" },
        { title: "耗时(ms)", dataIndex: "latency_ms", key: "latency_ms" },
        { title: "积分", dataIndex: "cost_credits", key: "cost_credits" },
        { title: "错误", dataIndex: "error_message", key: "error_message", ellipsis: true },
        { title: "时间", dataIndex: "created_at", key: "created_at", render: (v) => (v ? new Date(v).toLocaleString() : "-") },
    ];

    return (
        <Card title="调用日志">
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <Select
                    allowClear
                    showSearch
                    placeholder="按用户筛选"
                    className="w-56"
                    optionFilterProp="label"
                    value={filters.user_id}
                    onChange={(v) => setFilters((f) => ({ ...f, user_id: v }))}
                    options={users.map((u) => ({ value: u.id, label: u.email }))}
                />
                <Select
                    allowClear
                    placeholder="按状态筛选"
                    className="w-32"
                    value={filters.status}
                    onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
                    options={[
                        { value: "success", label: "成功" },
                        { value: "failed", label: "失败" },
                    ]}
                />
                <Button onClick={() => setFilters({})}>重置</Button>
                <Button type="primary" onClick={() => load(1, pagination.pageSize)}>查询</Button>
            </div>
            <Table
                rowKey="id"
                dataSource={logs}
                columns={columns}
                loading={loading}
                pagination={{
                    current: pagination.current,
                    pageSize: pagination.pageSize,
                    total: pagination.total,
                    showSizeChanger: true,
                    showTotal: (t) => `共 ${t} 条`,
                    onChange: (page, size) => load(page, size || 20),
                }}
            />
        </Card>
    );
}
