import { useEffect, useState } from "react";
import { Card, Table, Tag, Switch, InputNumber, Input, message, Button, Modal, Statistic, Row, Col } from "antd";

type ModelPricing = {
    id: string; modelId: string; name: string; enabled: boolean;
    supportsTools: boolean; costPerTurn: number; notes?: string | null;
};

export default function AdminModelPricing() {
    const [items, setItems] = useState<ModelPricing[]>([]);
    const [loading, setLoading] = useState(true);
    const [newOpen, setNewOpen] = useState(false);
    const [newForm, setNewForm] = useState({ modelId: "", name: "", supportsTools: true, costPerTurn: 1, notes: "" });

    const load = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/v1/admin/model-pricing", { credentials: "include" });
            const data = await res.json();
            if (data.ok) setItems(data.items);
            else message.error(data.detail || "加载失败");
        } catch {
            message.error("网络错误");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const update = async (modelId: string, updates: Partial<ModelPricing>) => {
        const res = await fetch(`/api/v1/admin/model-pricing/${encodeURIComponent(modelId)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(updates),
        });
        if (res.ok) {
            message.success("已更新");
            load();
        } else {
            const d = await res.json().catch(() => ({}));
            message.error(d.detail || "更新失败");
        }
    };

    const create = async () => {
        const res = await fetch("/api/v1/admin/model-pricing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(newForm),
        });
        if (res.ok) {
            message.success("已添加");
            setNewOpen(false);
            setNewForm({ modelId: "", name: "", supportsTools: true, costPerTurn: 1, notes: "" });
            load();
        } else {
            const d = await res.json().catch(() => ({}));
            message.error(d.detail || "添加失败");
        }
    };

    const total = items.length;
    const enabled = items.filter((m) => m.enabled).length;
    const toolCapable = items.filter((m) => m.supportsTools && m.enabled).length;

    return (
        <div className="p-6">
            <h2 className="mb-4 text-lg font-bold">模型白名单（model_pricing）</h2>
            <Row gutter={16} className="mb-4">
                <Col span={8}><Card><Statistic title="模型总数" value={total} /></Card></Col>
                <Col span={8}><Card><Statistic title="已启用" value={enabled} /></Card></Col>
                <Col span={8}><Card><Statistic title="支持工具调用" value={toolCapable} /></Card></Col>
            </Row>
            <div className="mb-3 flex justify-end">
                <Button type="primary" onClick={() => setNewOpen(true)}>添加模型</Button>
            </div>
            <Table<ModelPricing>
                dataSource={items}
                rowKey="id"
                loading={loading}
                pagination={{ pageSize: 20 }}
                columns={[
                    { title: "模型 ID", dataIndex: "modelId", width: 240, ellipsis: true },
                    { title: "名称", dataIndex: "name", width: 200 },
                    {
                        title: "启用", dataIndex: "enabled", width: 80,
                        render: (v: boolean, r: ModelPricing) => (
                            <Switch checked={v} onChange={(c) => update(r.modelId, { enabled: c })} />
                        ),
                    },
                    {
                        title: "支持工具", dataIndex: "supportsTools", width: 100,
                        render: (v: boolean, r: ModelPricing) => (
                            <Tag color={v ? "green" : "default"}>{v ? "是" : "否"}</Tag>
                        ),
                    },
                    {
                        title: "单次积分", dataIndex: "costPerTurn", width: 100,
                        render: (v: number, r: ModelPricing) => (
                            <InputNumber
                                size="small"
                                min={0}
                                value={v}
                                onChange={(n) => update(r.modelId, { costPerTurn: n || 0 })}
                                style={{ width: 80 }}
                            />
                        ),
                    },
                    {
                        title: "操作", width: 100,
                        render: (_: unknown, r: ModelPricing) => (
                            <Button size="small" danger onClick={async () => {
                                const res = await fetch(`/api/v1/admin/model-pricing/${encodeURIComponent(r.modelId)}`, {
                                    method: "DELETE", credentials: "include",
                                });
                                if (res.ok) { message.success("已删除"); load(); }
                            }}>删除</Button>
                        ),
                    },
                ]}
            />
            <Modal title="添加模型" open={newOpen} onCancel={() => setNewOpen(false)} onOk={create} okText="添加">
                <div className="space-y-3">
                    <div>
                        <div className="mb-1 text-sm">模型 ID（@makers/xxx）</div>
                        <Input value={newForm.modelId} onChange={(e) => setNewForm({ ...newForm, modelId: e.target.value })} placeholder="@makers/deepseek-v4-flash" />
                    </div>
                    <div>
                        <div className="mb-1 text-sm">名称</div>
                        <Input value={newForm.name} onChange={(e) => setNewForm({ ...newForm, name: e.target.value })} />
                    </div>
                    <div className="flex gap-3">
                        <div>
                            <div className="mb-1 text-sm">单次积分</div>
                            <InputNumber min={0} value={newForm.costPerTurn} onChange={(n) => setNewForm({ ...newForm, costPerTurn: n || 0 })} />
                        </div>
                        <div className="flex items-end">
                            <Switch checked={newForm.supportsTools} onChange={(c) => setNewForm({ ...newForm, supportsTools: c })} checkedChildren="支持工具" unCheckedChildren="不支持" />
                        </div>
                    </div>
                    <div>
                        <div className="mb-1 text-sm">备注</div>
                        <Input.TextArea rows={2} value={newForm.notes} onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })} />
                    </div>
                </div>
            </Modal>
        </div>
    );
}