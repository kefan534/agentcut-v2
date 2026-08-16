import { useEffect, useState } from "react";
import { App, Button, Card, Form, Input, Modal, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import {
    adminListModels,
    adminListVariables,
    adminCreateVariable,
    adminUpdateVariable,
    adminDeleteVariable,
    getBackendErrorMessage,
    type AdminApiSource,
    type AdminVariableMapping,
} from "@/services/api/backend";

const CATEGORIES = [
    { value: "text", label: "文本" },
    { value: "image", label: "图像" },
    { value: "audio", label: "音频" },
    { value: "video", label: "视频" },
];

export default function AdminVariables() {
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
            message.error(getBackendErrorMessage(e, "加载失败"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const modelOptions = models.map((m) => ({
        value: m.id,
        label: `${m.vendor}/${m.model_version}(${m.source_name})`,
    }));

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
            message.error("保存失败：" + getBackendErrorMessage(e, "未知错误"));
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
            okText: "删除", okType: "danger", cancelText: "取消",
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
        { title: "分类", dataIndex: "modal_category", key: "modal_category", render: (v) => <Tag>{v}</Tag> },
        { title: "默认源", dataIndex: "default_source_id", key: "default_source_id", render: (id) => modelOptions.find((m) => m.value === id)?.label ?? id },
        { title: "Fallback", dataIndex: "fallback_source_ids", key: "fallback_source_ids", render: (v) => (v || []).length || "-" },
        {
            title: "操作",
            key: "action",
            render: (_, record) => (
                <Space size="small">
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
                            showSearch
                            optionFilterProp="label"
                            options={modelOptions}
                            onChange={(value: number) => {
                                const model = models.find((m) => m.id === value);
                                if (model?.modal_category) form.setFieldValue("modal_category", model.modal_category);
                            }}
                        />
                    </Form.Item>
                    <Form.Item name="fallback_source_ids" label="Fallback 源" tooltip="默认源不可用时依次尝试">
                        <Select mode="multiple" options={modelOptions} />
                    </Form.Item>
                    <Form.Item name="condition_rules" label="条件规则 (JSON)" tooltip="按用户等级等条件路由到不同源，格式见 placeholder">
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
