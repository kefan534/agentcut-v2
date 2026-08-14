import { useEffect, useState } from "react";
import { Button, Table, Tag, Select, Input, message, Modal, Space } from "antd";
import { CheckOutlined, CloseOutlined, StopOutlined } from "@ant-design/icons";

type Skill = {
    id: string; name: string; description: string; category: string;
    tags: string[]; status: string; priceCredits: number;
    submitterId: string | null; submitterName?: string | null;
    enabledCount: number; reviewComment?: string;
    avgRating?: number | null; reviewCount?: number;
};

export default function AdminSkillReview() {
    const [skills, setSkills] = useState<Skill[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<string>("submitted");
    const [rejectTarget, setRejectTarget] = useState<Skill | null>(null);
    const [rejectReason, setRejectReason] = useState("");

    const fetchSkills = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (statusFilter) params.set("status", statusFilter);
            const res = await fetch(`/api/v1/admin/skills?${params}`, { credentials: "include" });
            const data = await res.json();
            if (data.ok) setSkills(data.items);
            else message.error(data.detail || "加载失败");
        } catch {
            message.error("网络错误");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchSkills(); }, [statusFilter]);

    const updateSkill = async (id: string, updates: Partial<Skill> & { reviewComment?: string }) => {
        // 前端 → 后端字段映射：camelCase
        const body: Record<string, unknown> = {};
        if (updates.priceCredits !== undefined) body.priceCredits = updates.priceCredits;
        if (updates.status !== undefined) body.status = updates.status;
        if (updates.reviewComment !== undefined) body.reviewComment = updates.reviewComment;
        const res = await fetch(`/api/v1/admin/skills/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(body),
        });
        if (res.ok) { message.success("已更新"); fetchSkills(); }
        else {
            const d = await res.json().catch(() => ({}));
            message.error(d.detail || "更新失败");
        }
    };

    const openReject = (skill: Skill) => {
        setRejectTarget(skill);
        setRejectReason("");
    };

    const confirmReject = async () => {
        if (!rejectTarget) return;
        await updateSkill(rejectTarget.id, { status: "rejected", reviewComment: rejectReason });
        setRejectTarget(null);
        setRejectReason("");
    };

    const columns = [
        { title: "名称", dataIndex: "name", width: 160, ellipsis: true },
        { title: "描述", dataIndex: "description", width: 200, ellipsis: true },
        { title: "分类", dataIndex: "category", width: 100 },
        {
            title: "投稿者", dataIndex: "submitterName", width: 100, ellipsis: true,
            render: (v: string | null) => v || "平台",
        },
        {
            title: "状态", dataIndex: "status", width: 90,
            render: (s: string) => {
                const colors: Record<string, string> = { draft: "default", submitted: "blue", reviewing: "processing", published: "success", disabled: "warning", rejected: "error" };
                return <Tag color={colors[s] || "default"}>{s}</Tag>;
            },
        },
        {
            title: "定价", dataIndex: "priceCredits", width: 110,
            render: (_: number, record: Skill) => (
                <Select
                    size="small"
                    value={record.priceCredits || 0}
                    style={{ width: 100 }}
                    onChange={(v) => updateSkill(record.id, { priceCredits: v })}
                    options={[
                        { label: "免费 0", value: 0 },
                        { label: "基础 10", value: 10 },
                        { label: "基础 30", value: 30 },
                        { label: "高级 50", value: 50 },
                        { label: "高级 100", value: 100 },
                        { label: "高级 200", value: 200 },
                    ]}
                />
            ),
        },
        { title: "使用", dataIndex: "enabledCount", width: 60 },
        {
            title: "操作", key: "action", width: 240, fixed: "right" as const,
            render: (_: unknown, record: Skill) => (
                <Space size="small">
                    {(record.status === "submitted" || record.status === "reviewing") ? (
                        <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => updateSkill(record.id, { status: "published" })}>批准</Button>
                    ) : null}
                    {(record.status === "submitted" || record.status === "reviewing") ? (
                        <Button size="small" danger icon={<CloseOutlined />} onClick={() => openReject(record)}>拒绝</Button>
                    ) : null}
                    {record.status === "published" ? (
                        <Button size="small" icon={<StopOutlined />} onClick={() => updateSkill(record.id, { status: "disabled" })}>下架</Button>
                    ) : null}
                    {record.status === "disabled" || record.status === "rejected" ? (
                        <Button size="small" onClick={() => updateSkill(record.id, { status: "published" })}>重新上架</Button>
                    ) : null}
                </Space>
            ),
        },
    ];

    return (
        <div>
            <div className="mb-4 flex items-center gap-3">
                <span className="text-sm text-gray-500">状态筛选：</span>
                <Select
                    value={statusFilter}
                    onChange={setStatusFilter}
                    style={{ width: 160 }}
                    options={[
                        { label: "待审核 submitted", value: "submitted" },
                        { label: "审核中 reviewing", value: "reviewing" },
                        { label: "已上架 published", value: "published" },
                        { label: "已下架 disabled", value: "disabled" },
                        { label: "已拒绝 rejected", value: "rejected" },
                        { label: "全部", value: "" },
                    ]}
                />
                <Button onClick={fetchSkills}>刷新</Button>
            </div>
            <Table<Skill>
                dataSource={skills}
                columns={columns}
                rowKey="id"
                loading={loading}
                pagination={{ pageSize: 20 }}
                size="small"
                scroll={{ x: 1000 }}
            />
            <Modal
                title="拒绝原因"
                open={!!rejectTarget}
                onCancel={() => setRejectTarget(null)}
                onOk={confirmReject}
                okText="确认拒绝"
                cancelText="取消"
                okButtonProps={{ danger: true }}
            >
                <Input.TextArea
                    rows={3}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="请填写拒绝原因（会展示给投稿者）"
                    autoFocus
                />
            </Modal>
        </div>
    );
}
