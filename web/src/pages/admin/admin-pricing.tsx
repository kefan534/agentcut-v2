import { useCallback, useEffect, useState } from "react";
import { App, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import {
    adminListVariables,
    adminListPricingRules,
    adminCreatePricingRule,
    adminUpdatePricingRule,
    adminDeletePricingRule,
    getBackendErrorMessage,
    type PricingRule,
    type AdminVariableMapping,
} from "@/services/api/backend";

export default function AdminPricing() {
    const { message } = App.useApp();
    const [variables, setVariables] = useState<AdminVariableMapping[]>([]);
    const [selectedVar, setSelectedVar] = useState<string>();
    const [rules, setRules] = useState<PricingRule[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<PricingRule | null>(null);
    const [form] = Form.useForm();

    const loadVariables = useCallback(async () => {
        try {
            setVariables(await adminListVariables());
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载变量失败"));
        }
    }, [message]);

    const loadRules = useCallback(async (varName?: string) => {
        if (!varName) {
            setRules([]);
            return;
        }
        setLoading(true);
        try {
            setRules(await adminListPricingRules(varName));
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载规则失败"));
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void loadVariables();
    }, [loadVariables]);

    useEffect(() => {
        void loadRules(selectedVar);
    }, [selectedVar, loadRules]);

    const openCreate = () => {
        setEditing(null);
        form.resetFields();
        form.setFieldsValue({ variable_name: selectedVar, param_conditions: "{}", credits: 5, sort_order: 0, enabled: true });
        setModalOpen(true);
    };

    const openEdit = (r: PricingRule) => {
        setEditing(r);
        form.setFieldsValue({ ...r, param_conditions: JSON.stringify(r.param_conditions || {}) });
        setModalOpen(true);
    };

    const handleSubmit = async () => {
        const values = await form.validateFields();
        let conditions: Record<string, unknown>;
        try {
            conditions = JSON.parse(values.param_conditions || "{}");
        } catch {
            message.error("参数条件必须是合法 JSON");
            return;
        }
        const payload = { ...values, param_conditions: conditions };
        try {
            if (editing) {
                await adminUpdatePricingRule(editing.id, payload);
                message.success("已更新");
            } else {
                await adminCreatePricingRule(payload);
                message.success("已新增");
            }
            setModalOpen(false);
            await loadRules(selectedVar);
        } catch (e) {
            message.error(getBackendErrorMessage(e, "保存失败"));
        }
    };

    const handleDelete = (r: PricingRule) => {
        Modal.confirm({
            title: "确认删除该规则？",
            okText: "删除", okType: "danger", cancelText: "取消",
            onOk: async () => {
                try {
                    await adminDeletePricingRule(r.id);
                    message.success("已删除");
                    await loadRules(selectedVar);
                } catch (e) {
                    message.error(getBackendErrorMessage(e, "删除失败"));
                }
            },
        });
    };

    const columns: ColumnsType<PricingRule> = [
        { title: "参数条件", dataIndex: "param_conditions", key: "param_conditions", render: (v) => <code className="text-xs">{JSON.stringify(v)}</code> },
        { title: "积分", dataIndex: "credits", key: "credits" },
        { title: "优先级", dataIndex: "sort_order", key: "sort_order" },
        { title: "启用", dataIndex: "enabled", key: "enabled", render: (v) => <Tag color={v ? "green" : "default"}>{v ? "启用" : "停用"}</Tag> },
        {
            title: "操作",
            key: "action",
            render: (_, record) => (
                <Space size="small">
                    <Button type="link" size="small" onClick={() => openEdit(record)}>编辑</Button>
                    <Button type="link" danger size="small" onClick={() => handleDelete(record)}>删除</Button>
                </Space>
            ),
        },
    ];

    return (
        <Card
            title="积分策略（定价规则）"
            extra={<Button type="primary" disabled={!selectedVar} onClick={openCreate}>新增规则</Button>}
        >
            <div className="mb-4 flex items-center gap-2">
                <span className="text-sm text-stone-600 dark:text-stone-300">选择模型：</span>
                <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="选择变量名（模型）"
                    className="w-80"
                    value={selectedVar}
                    onChange={(v) => setSelectedVar(v)}
                    options={variables.map((v) => ({ value: v.variable_name, label: `${v.variable_name}（${v.modal_category}）` }))}
                />
            </div>
            <p className="mb-4 text-sm text-stone-400">
                参数条件支持精确匹配（如 {`{"size":"2K"}`}）和范围匹配（如 {`{"input_tokens_max":1024}`}）。未命中任何规则时，按模态默认价扣费（text=1/image=5/audio=3/video=20）。
            </p>
            <Table rowKey="id" dataSource={rules} columns={columns} loading={loading} pagination={false} />

            <Modal
                title={editing ? "编辑规则" : "新增规则"}
                open={modalOpen}
                onOk={handleSubmit}
                onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields(); }}
            >
                <Form form={form} layout="vertical" className="mt-4">
                    <Form.Item name="variable_name" label="变量名" rules={[{ required: true }]}>
                        <Select showSearch optionFilterProp="label" options={variables.map((v) => ({ value: v.variable_name, label: v.variable_name }))} />
                    </Form.Item>
                    <Form.Item name="param_conditions" label="参数条件 (JSON)" rules={[{ required: true }]}
                        tooltip="精确匹配（size 等于 2K）或范围匹配（input_tokens 不超过 1024），格式见 placeholder">
                        <Input.TextArea rows={3} placeholder='{"size":"2K"}' />
                    </Form.Item>
                    <Form.Item name="credits" label="积分" rules={[{ required: true }]}>
                        <InputNumber min={0} className="w-full" />
                    </Form.Item>
                    <Form.Item name="sort_order" label="优先级（越小越先匹配）">
                        <InputNumber min={0} className="w-full" />
                    </Form.Item>
                    <Form.Item name="enabled" label="启用" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>
        </Card>
    );
}
