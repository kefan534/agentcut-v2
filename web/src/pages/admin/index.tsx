import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import {
    adminListModels,
    adminCreateModel,
    adminUpdateModel,
    adminDeleteModel,
    adminListVariables,
    adminCreateVariable,
    adminUpdateVariable,
    adminDeleteVariable,
    adminListUsers,
    adminAddCredits,
    adminBanUser,
    adminListLogs,
    getBackendErrorMessage,
    type AdminApiSource,
    type AdminVariableMapping,
    type AdminCallLog,
    type BackendUser,
} from "@/services/api/backend";
import { useUserStore } from "@/stores/use-user-store";

const CATEGORIES = [
    { value: "text", label: "文本" },
    { value: "image", label: "图像" },
    { value: "audio", label: "音频" },
    { value: "video", label: "视频" },
];

const LEVELS_OPTIONS = ["free", "paid", "vip", "admin"].map((v) => ({ value: v, label: v }));

export default function AdminPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const currentUser = useUserStore((state) => state.user);
    const [activeTab, setActiveTab] = useState("models");

    useEffect(() => {
        if (!currentUser) {
            navigate("/login", { state: { from: "/admin" } });
            return;
        }
        if (currentUser.role !== "admin") {
            message.error("无权访问管理后台");
            navigate("/");
        }
    }, [currentUser, navigate, message]);

    return (
        <main className="h-full overflow-y-auto bg-background p-6 text-foreground">
            <div className="mx-auto max-w-7xl">
                <h1 className="mb-6 text-2xl font-semibold">管理后台</h1>
                <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
                    { key: "models", label: "模型管理", children: <ModelsTab /> },
                    { key: "variables", label: "变量映射", children: <VariablesTab /> },
                    { key: "users", label: "用户管理", children: <UsersTab /> },
                    { key: "logs", label: "调用日志", children: <LogsTab /> },
                    { key: "skills", label: "Skill 审核", children: <SkillReviewTab /> },
                    { key: "modelPricing", label: "模型白名单", children: <ModelPricingTab /> },
                    { key: "auditLogs", label: "审计日志", children: <AuditLogsTab /> },
                ]} />
            </div>
        </main>
    );
}

function SkillReviewTab() {
    // 跳转到独立 Skill 审核页（或嵌入 iframe）
    const navigate = useNavigate();
    useEffect(() => {
        navigate("/admin/skills");
    }, [navigate]);
    return <div className="py-8 text-center text-gray-400">正在跳转到 Skill 审核…</div>;
}

function ModelPricingTab() {
    const navigate = useNavigate();
    useEffect(() => { navigate("/admin/model-pricing"); }, [navigate]);
    return <div className="py-8 text-center text-gray-400">正在跳转到模型白名单…</div>;
}

function AuditLogsTab() {
    const navigate = useNavigate();
    useEffect(() => { navigate("/admin/audit-logs"); }, [navigate]);
    return <div className="py-8 text-center text-gray-400">正在跳转到审计日志…</div>;
}

function ModelsTab() {
    const { message } = App.useApp();
    const [models, setModels] = useState<AdminApiSource[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<AdminApiSource | null>(null);
    const [form] = Form.useForm();

    const load = async () => {
        setLoading(true);
        try {
            setModels(await adminListModels());
        } catch (e) {
            message.error("加载模型失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
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
            modal_category: "text",
            priority: 100,
            timeout_ms: 30000,
            retry_count: 2,
            is_active: true,
            cost_level: "medium",
            quality_level: "medium",
            allowed_user_levels: ["free", "paid", "vip", "admin"],
            endpoint_path: "/v1/chat/completions",
        });
        setModalOpen(true);
    };

    const handleDelete = async (id: number) => {
        Modal.confirm({
            title: "确认删除",
            content: "删除后无法恢复，是否继续？",
            okText: "删除",
            okType: "danger",
            cancelText: "取消",
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

    const columns: ColumnsType<AdminApiSource> = [
        { title: "分类", dataIndex: "modal_category", key: "modal_category" },
        { title: "厂商", dataIndex: "vendor", key: "vendor" },
        { title: "版本", dataIndex: "model_version", key: "model_version" },
        { title: "源", dataIndex: "source_name", key: "source_name" },
        { title: "Base URL", dataIndex: "base_url", key: "base_url", ellipsis: true },
        { title: "Endpoint", dataIndex: "endpoint_path", key: "endpoint_path" },
        { title: "优先级", dataIndex: "priority", key: "priority" },
        { title: "启用", dataIndex: "is_active", key: "is_active", render: (v) => <Switch checked={v} disabled size="small" /> },
        {
            title: "操作",
            key: "action",
            render: (_, record) => (
                <Space>
                    <Button type="link" size="small" onClick={() => openEdit(record)}>编辑</Button>
                    <Button type="link" danger size="small" onClick={() => handleDelete(record.id)}>删除</Button>
                </Space>
            ),
        },
    ];

    return (
        <Card
            title="模型管理"
            extra={<Button type="primary" onClick={openCreate}>新增模型</Button>}
        >
            <Table rowKey="id" dataSource={models} columns={columns} loading={loading} pagination={{ pageSize: 10 }} />
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
                        <Input.Password
                            autoComplete="new-password"
                            placeholder={editing ? "留空表示不修改" : ""}
                        />
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
                    <Form.Item name="is_active" valuePropName="checked" label={null}>
                        <Switch checkedChildren="启用" unCheckedChildren="禁用" />
                    </Form.Item>
                </Form>
            </Modal>
        </Card>
    );
}

function VariablesTab() {
    const { message } = App.useApp();
    const [variables, setVariables] = useState<AdminVariableMapping[]>([]);
    const [models, setModels] = useState<AdminApiSource[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<AdminVariableMapping | null>(null);
    const [form] = Form.useForm();

    const load = async () => {
        setLoading(true);
        try {
            const [v, m] = await Promise.all([adminListVariables(), adminListModels()]);
            setVariables(v);
            setModels(m);
        } catch (e) {
            message.error("加载失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const handleSubmit = async (values: Record<string, unknown>) => {
        try {
            const payload = {
                ...values,
                fallback_source_ids: (values.fallback_source_ids as number[]) || [],
                condition_rules: values.condition_rules ? JSON.parse(values.condition_rules as string) : {},
            } as Omit<AdminVariableMapping, "id" | "created_at" | "updated_at">;
            if (editing) {
                await adminUpdateVariable(editing.id, payload);
                message.success("更新成功");
            } else {
                await adminCreateVariable(payload);
                message.success("创建成功");
            }
            setModalOpen(false);
            setEditing(null);
            form.resetFields();
            await load();
        } catch (e) {
            message.error("保存失败：" + (e instanceof Error ? e.message : String(e)));
        }
    };

    const openEdit = (v: AdminVariableMapping) => {
        setEditing(v);
        form.setFieldsValue({
            ...v,
            fallback_source_ids: v.fallback_source_ids || [],
            condition_rules: v.condition_rules ? JSON.stringify(v.condition_rules) : "",
        });
        setModalOpen(true);
    };

    const openCreate = () => {
        setEditing(null);
        form.resetFields();
        form.setFieldsValue({ modal_category: "image", fallback_source_ids: [], condition_rules: "{}" });
        setModalOpen(true);
    };

    const handleDelete = async (id: number) => {
        Modal.confirm({
            title: "确认删除",
            content: "删除后无法恢复，是否继续？",
            okText: "删除",
            okType: "danger",
            cancelText: "取消",
            onOk: async () => {
                try {
                    await adminDeleteVariable(id);
                    message.success("删除成功");
                    await load();
                } catch (e) {
                    message.error("删除失败");
                }
            },
        });
    };

    const columns: ColumnsType<AdminVariableMapping> = [
        { title: "变量名", dataIndex: "variable_name", key: "variable_name" },
        { title: "分类", dataIndex: "modal_category", key: "modal_category" },
        { title: "默认源", dataIndex: "default_source_id", key: "default_source_id" },
        { title: "Fallback IDs", dataIndex: "fallback_source_ids", key: "fallback_source_ids", render: (v) => (v || []).join(", ") },
        {
            title: "操作",
            key: "action",
            render: (_, record) => (
                <Space>
                    <Button type="link" size="small" onClick={() => openEdit(record)}>编辑</Button>
                    <Button type="link" danger size="small" onClick={() => handleDelete(record.id)}>删除</Button>
                </Space>
            ),
        },
    ];

    return (
        <Card title="变量映射" extra={<Button type="primary" onClick={openCreate}>新增变量</Button>}>
            <Table rowKey="id" dataSource={variables} columns={columns} loading={loading} pagination={{ pageSize: 10 }} />
            <Modal
                title={editing ? "编辑变量映射" : "新增变量映射"}
                open={modalOpen}
                onOk={() => form.submit()}
                onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}
            >
                <Form form={form} layout="vertical" onFinish={handleSubmit}>
                    <Form.Item name="variable_name" label="变量名" rules={[{ required: true }]}>
                        <Input placeholder="TEXT_MODEL" />
                    </Form.Item>
                    <Form.Item name="modal_category" label="分类" rules={[{ required: true }]}>
                        <Select options={CATEGORIES} />
                    </Form.Item>
                    <Form.Item name="default_source_id" label="默认源" rules={[{ required: true }]}>
                        <Select
                            options={models.map((m) => ({ value: m.id, label: `${m.vendor}/${m.model_version}(${m.source_name})`, category: m.modal_category }))}
                            onChange={(value: number) => {
                                const model = models.find((m) => m.id === value);
                                if (model?.modal_category) {
                                    form.setFieldValue("modal_category", model.modal_category);
                                }
                            }}
                        />
                    </Form.Item>
                    <Form.Item name="fallback_source_ids" label="Fallback 源">
                        <Select mode="multiple" options={models.map((m) => ({ value: m.id, label: `${m.vendor}/${m.model_version}(${m.source_name})` }))} />
                    </Form.Item>
                    <Form.Item name="condition_rules" label="条件规则 (JSON)">
                        <Input.TextArea rows={3} placeholder='{"user_level":{"vip":2}}' />
                    </Form.Item>
                    <Form.Item name="description" label="描述">
                        <Input.TextArea rows={2} />
                    </Form.Item>
                </Form>
            </Modal>
        </Card>
    );
}

function UsersTab() {
    const { message } = App.useApp();
    const [users, setUsers] = useState<BackendUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");

    const load = async () => {
        setLoading(true);
        try {
            setUsers(await adminListUsers(search));
        } catch (e) {
            message.error("加载用户失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, [search]);

    const handleRecharge = async (userId: string) => {
        const value = window.prompt("请输入充值积分数量", "100");
        if (!value) return;
        const delta = Number(value);
        if (!Number.isFinite(delta) || delta <= 0) {
            message.error("请输入正整数");
            return;
        }
        try {
            const result = await adminAddCredits(userId, delta);
            message.success(`充值成功，当前余额：${result.new_balance}`);
            await load();
        } catch (e) {
            message.error("充值失败");
        }
    };

    const handleBan = async (userId: string) => {
        if (!window.confirm("确定禁用该用户吗？")) return;
        try {
            await adminBanUser(userId);
            message.success("已禁用");
            await load();
        } catch (e) {
            message.error("禁用失败");
        }
    };

    const columns: ColumnsType<BackendUser> = [
        { title: "邮箱", dataIndex: "email", key: "email" },
        { title: "昵称", dataIndex: "nickname", key: "nickname" },
        { title: "角色", dataIndex: "role", key: "role", render: (v) => <Tag color={v === "admin" ? "red" : "blue"}>{v}</Tag> },
        { title: "等级", dataIndex: "level", key: "level" },
        { title: "积分", dataIndex: "credits", key: "credits" },
        { title: "状态", dataIndex: "status", key: "status" },
        { title: "注册时间", dataIndex: "created_at", key: "created_at" },
        {
            title: "操作",
            key: "action",
            render: (_, record) => (
                <Space>
                    <Button type="link" size="small" onClick={() => handleRecharge(record.id)}>充值</Button>
                    <Button type="link" danger size="small" onClick={() => handleBan(record.id)}>禁用</Button>
                </Space>
            ),
        },
    ];

    return (
        <Card title="用户管理">
            <div className="mb-4 flex gap-2">
                <Input.Search placeholder="搜索邮箱" allowClear onSearch={setSearch} />
            </div>
            <Table rowKey="id" dataSource={users} columns={columns} loading={loading} pagination={{ pageSize: 10 }} />
        </Card>
    );
}

function LogsTab() {
    const { message } = App.useApp();
    const [logs, setLogs] = useState<AdminCallLog[]>([]);
    const [loading, setLoading] = useState(false);
    const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });

    const load = async (page = pagination.current, pageSize = pagination.pageSize) => {
        setLoading(true);
        try {
            const offset = (page - 1) * pageSize;
            const data = await adminListLogs({ limit: pageSize, offset });
            setLogs(data);
            // Best-effort total: if we got a full page, assume there may be more.
            setPagination((prev) => ({
                ...prev,
                current: page,
                pageSize,
                total: data.length === pageSize ? offset + data.length + 1 : offset + data.length,
            }));
        } catch (e) {
            message.error("加载日志失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load(1, pagination.pageSize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const columns: ColumnsType<AdminCallLog> = [
        { title: "变量", dataIndex: "variable_name", key: "variable_name" },
        { title: "分类", dataIndex: "modal_category", key: "modal_category" },
        { title: "状态", dataIndex: "status", key: "status", render: (v) => <Tag color={v === "success" ? "green" : v === "failed" ? "red" : "default"}>{v}</Tag> },
        { title: "状态码", dataIndex: "status_code", key: "status_code" },
        { title: "耗时(ms)", dataIndex: "latency_ms", key: "latency_ms" },
        { title: "积分", dataIndex: "cost_credits", key: "cost_credits" },
        { title: "错误", dataIndex: "error_message", key: "error_message", ellipsis: true },
        { title: "时间", dataIndex: "created_at", key: "created_at" },
    ];

    return (
        <Card title="调用日志" extra={<Button onClick={() => load()}>刷新</Button>}>
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
                    onChange: (page, size) => load(page, size || 20),
                }}
            />
        </Card>
    );
}
