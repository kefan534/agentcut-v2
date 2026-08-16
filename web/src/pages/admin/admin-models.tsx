import { useEffect, useState } from "react";
import { App, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";

import {
    adminListModels,
    adminCreateModel,
    adminUpdateModel,
    adminDeleteModel,
    adminTestModel,
    adminGetModelStats,
    getBackendErrorMessage,
    type AdminApiSource,
} from "@/services/api/backend";

const CATEGORIES = [
    { value: "text", label: "文本" },
    { value: "image", label: "图像" },
    { value: "audio", label: "音频" },
    { value: "video", label: "视频" },
];
const LEVELS_OPTIONS = ["free", "paid", "vip", "admin"].map((v) => ({ value: v, label: v }));

export default function AdminModels() {
    const { message } = App.useApp();
    const [models, setModels] = useState<AdminApiSource[]>([]);
    const [stats, setStats] = useState<Record<number, { total: number; success_rate: number; avg_latency_ms: number }>>({});
    const [loading, setLoading] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<AdminApiSource | null>(null);
    const [testingId, setTestingId] = useState<number | null>(null);
    const [form] = Form.useForm();

    const load = async () => {
        setLoading(true);
        try {
            const [m, s] = await Promise.all([adminListModels(), adminGetModelStats()]);
            setModels(m);
            setStats(s.stats);
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载模型失败"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSubmit = async (values: Record<string, unknown>) => {
        try {
            const payload = {
                ...values,
                allowed_user_levels: (values.allowed_user_levels as string[] | undefined) || [],
                extra_headers: values.extra_headers ? JSON.parse(values.extra_headers as string) : null,
                extra_body: values.extra_body ? JSON.parse(values.extra_body as string) : null,
            } as Omit<AdminApiSource, "id" | "created_at" | "updated_at">;
            if (editing) {
                await adminUpdateModel(editing.id, payload);
                message.success("更新成功");
            } else {
                await adminCreateModel(payload);
                message.success("创建成功");
            }
            setModalOpen(false);
            setEditing(null);
            form.resetFields();
            await load();
        } catch (e) {
            message.error("保存失败：" + getBackendErrorMessage(e, "未知错误"));
        }
    };

    const openEdit = (model: AdminApiSource) => {
        setEditing(model);
        form.setFieldsValue({
            ...model,
            allowed_user_levels: Array.isArray(model.allowed_user_levels) ? model.allowed_user_levels : [],
            extra_headers: model.extra_headers ? JSON.stringify(model.extra_headers) : "",
            extra_body: model.extra_body ? JSON.stringify(model.extra_body) : "",
            api_key_plain: "",
        });
        setModalOpen(true);
    };

    const openCreate = () => {
        setEditing(null);
        form.resetFields();
        form.setFieldsValue({
            modal_category: "text", priority: 100, timeout_ms: 30000, retry_count: 2,
            is_active: true, cost_level: "medium", quality_level: "medium",
            allowed_user_levels: ["free", "paid", "vip", "admin"], endpoint_path: "/v1/chat/completions",
            balance_type: "credits",
        });
        setModalOpen(true);
    };

    const handleDelete = async (id: number) => {
        Modal.confirm({
            title: "确认删除",
            content: "删除后无法恢复，是否继续？",
            okText: "删除", okType: "danger", cancelText: "取消",
            onOk: async () => {
                try {
                    await adminDeleteModel(id);
                    message.success("删除成功");
                    await load();
                } catch (e) {
                    message.error("删除失败：" + getBackendErrorMessage(e, "未知错误"));
                }
            },
        });
    };

    const handleTest = async (id: number) => {
        setTestingId(id);
        try {
            const r = await adminTestModel(id);
            if (r.ok) message.success(`连接成功（HTTP ${r.status_code}）`);
            else message.error(`连接失败：${r.error || r.detail || "未知错误"}`);
        } catch (e) {
            message.error(getBackendErrorMessage(e, "测试失败"));
        } finally {
            setTestingId(null);
        }
    };

    const columns: ColumnsType<AdminApiSource> = [
        { title: "分类", dataIndex: "modal_category", key: "modal_category", render: (v) => <Tag>{v}</Tag> },
        { title: "厂商", dataIndex: "vendor", key: "vendor" },
        { title: "版本", dataIndex: "model_version", key: "model_version" },
        { title: "源", dataIndex: "source_name", key: "source_name" },
        { title: "优先级", dataIndex: "priority", key: "priority" },
        { title: "调用量", key: "calls", render: (_, r) => stats[r.id]?.total ?? 0 },
        {
            title: "成功率",
            key: "rate",
            render: (_, r) => {
                const s = stats[r.id];
                if (!s || !s.total) return "-";
                return <Tag color={s.success_rate >= 90 ? "green" : s.success_rate >= 60 ? "orange" : "red"}>{s.success_rate}%</Tag>;
            },
        },
        { title: "平均耗时", key: "latency", render: (_, r) => (stats[r.id] ? `${stats[r.id].avg_latency_ms}ms` : "-") },
        {
            title: "上游余额",
            key: "balance",
            render: (_, r) => {
                if (r.balance_remaining == null) return <span className="text-stone-400">未设置</span>;
                const unit = r.balance_type === "money" ? "¥" : " 积分";
                return <span>{unit}{r.balance_remaining}</span>;
            },
        },
        { title: "启用", dataIndex: "is_active", key: "is_active", render: (v) => <Switch checked={v} disabled size="small" /> },
        {
            title: "操作",
            key: "action",
            render: (_, record) => (
                <Space size="small">
                    <Button type="link" size="small" loading={testingId === record.id} onClick={() => handleTest(record.id)}>测试</Button>
                    <Button type="link" size="small" onClick={() => openEdit(record)}>编辑</Button>
                    <Button type="link" danger size="small" onClick={() => handleDelete(record.id)}>删除</Button>
                </Space>
            ),
        },
    ];

    return (
        <Card title="模型管理" extra={<Button type="primary" onClick={openCreate}>新增模型</Button>}>
            <Table rowKey="id" dataSource={models} columns={columns} loading={loading} pagination={{ pageSize: 10 }} scroll={{ x: 1100 }} />
            <Modal
                title={editing ? "编辑模型" : "新增模型"}
                open={modalOpen}
                onOk={() => form.submit()}
                onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}
                width={720}
            >
                <Form form={form} layout="vertical" onFinish={handleSubmit}>
                    <Form.Item name="modal_category" label="分类" rules={[{ required: true }]}>
                        <Select options={CATEGORIES} />
                    </Form.Item>
                    <Form.Item name="vendor" label="厂商" rules={[{ required: true }]}>
                        <Input placeholder="openai" />
                    </Form.Item>
                    <Form.Item name="model_version" label="模型版本" rules={[{ required: true }]}>
                        <Input placeholder="gpt-4o" />
                    </Form.Item>
                    <Form.Item name="source_name" label="源名称" rules={[{ required: true }]}>
                        <Input placeholder="official" />
                    </Form.Item>
                    <Form.Item name="base_url" label="Base URL" rules={[{ required: true }]}>
                        <Input placeholder="https://api.openai.com" />
                    </Form.Item>
                    <Form.Item name="endpoint_path" label="Endpoint Path" rules={[{ required: true }]}>
                        <Input placeholder="/v1/chat/completions" />
                    </Form.Item>
                    <Form.Item name="api_key_plain" label="API Key" rules={editing ? undefined : [{ required: true }]}>
                        <Input.Password autoComplete="new-password" placeholder={editing ? "留空表示不修改" : ""} />
                    </Form.Item>
                    <Form.Item name="priority" label="优先级">
                        <InputNumber className="w-full" />
                    </Form.Item>
                    <Form.Item name="timeout_ms" label="超时(ms)">
                        <InputNumber className="w-full" />
                    </Form.Item>
                    <Form.Item name="retry_count" label="重试次数">
                        <InputNumber className="w-full" />
                    </Form.Item>
                    <Form.Item name="cost_level" label="成本等级">
                        <Select options={["low", "medium", "high"].map((v) => ({ value: v, label: v }))} />
                    </Form.Item>
                    <Form.Item name="quality_level" label="质量等级">
                        <Select options={["low", "medium", "high"].map((v) => ({ value: v, label: v }))} />
                    </Form.Item>
                    <Form.Item name="allowed_user_levels" label="允许用户等级">
                        <Select mode="multiple" options={LEVELS_OPTIONS} />
                    </Form.Item>
                    <Form.Item name="extra_headers" label="额外 Headers (JSON)">
                        <Input.TextArea rows={2} placeholder='{"X-Custom":"value"}' />
                    </Form.Item>
                    <Form.Item name="extra_body" label="额外 Body (JSON)">
                        <Input.TextArea rows={2} placeholder='{"temperature":0.7}' />
                    </Form.Item>
                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="balance_type" label="余额类型">
                            <Select options={[{ value: "credits", label: "积分" }, { value: "money", label: "金额" }]} />
                        </Form.Item>
                        <Form.Item name="balance_remaining" label="上游余额">
                            <InputNumber className="w-full" min={0} precision={2} placeholder="剩余余额" />
                        </Form.Item>
                    </div>
                    <Form.Item name="is_active" valuePropName="checked" label={null}>
                        <Switch checkedChildren="启用" unCheckedChildren="禁用" />
                    </Form.Item>
                </Form>
            </Modal>
        </Card>
    );
}
