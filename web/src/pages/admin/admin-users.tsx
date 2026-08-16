import { useCallback, useEffect, useState } from "react";
import { App, Button, Card, Descriptions, Drawer, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import {
    adminAddCredits,
    adminBanUser,
    adminGetUserDetail,
    adminListUsers,
    adminUnbanUser,
    adminUpdateUser,
    getBackendErrorMessage,
    type AdminUserDetail,
    type BackendUser,
} from "@/services/api/backend";

const LEVEL_OPTIONS = ["free", "paid", "vip", "admin"].map((v) => ({ value: v, label: v }));
const ROLE_OPTIONS = ["user", "admin"].map((v) => ({ value: v, label: v }));

export default function AdminUsers() {
    const { message, modal } = App.useApp();
    const [users, setUsers] = useState<BackendUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");

    // 充值 Modal
    const [rechargeOpen, setRechargeOpen] = useState(false);
    const [rechargeUser, setRechargeUser] = useState<BackendUser | null>(null);
    const [rechargeForm] = Form.useForm();

    // 编辑 Modal
    const [editOpen, setEditOpen] = useState(false);
    const [editUser, setEditUser] = useState<BackendUser | null>(null);
    const [editForm] = Form.useForm();

    // 详情抽屉
    const [detailOpen, setDetailOpen] = useState(false);
    const [detail, setDetail] = useState<AdminUserDetail | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setUsers(await adminListUsers(search));
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载用户失败"));
        } finally {
            setLoading(false);
        }
    }, [search, message]);

    useEffect(() => {
        void load();
    }, [load]);

    const openRecharge = (u: BackendUser) => {
        setRechargeUser(u);
        rechargeForm.resetFields();
        rechargeForm.setFieldsValue({ delta: 100, reason: "admin_recharge" });
        setRechargeOpen(true);
    };

    const submitRecharge = async () => {
        const values = await rechargeForm.validateFields();
        try {
            const result = await adminAddCredits(rechargeUser!.id, values.delta, values.reason);
            message.success(`充值成功，当前余额 ${result.new_balance}`);
            setRechargeOpen(false);
            await load();
        } catch (e) {
            message.error(getBackendErrorMessage(e, "充值失败"));
        }
    };

    const openEdit = (u: BackendUser) => {
        setEditUser(u);
        editForm.setFieldsValue({ role: u.role, level: u.level, nickname: u.nickname });
        setEditOpen(true);
    };

    const submitEdit = async () => {
        const values = await editForm.validateFields();
        try {
            await adminUpdateUser(editUser!.id, values);
            message.success("已更新");
            setEditOpen(false);
            await load();
        } catch (e) {
            message.error(getBackendErrorMessage(e, "更新失败"));
        }
    };

    const toggleBan = (u: BackendUser) => {
        const isBanned = u.status === "banned";
        modal.confirm({
            title: isBanned ? "解禁该用户？" : "禁用该用户？",
            okText: isBanned ? "解禁" : "禁用",
            okButtonProps: { danger: !isBanned },
            cancelText: "取消",
            onOk: async () => {
                try {
                    if (isBanned) await adminUnbanUser(u.id);
                    else await adminBanUser(u.id);
                    message.success(isBanned ? "已解禁" : "已禁用");
                    await load();
                } catch (e) {
                    message.error(getBackendErrorMessage(e, "操作失败"));
                }
            },
        });
    };

    const openDetail = async (u: BackendUser) => {
        try {
            setDetail(await adminGetUserDetail(u.id));
            setDetailOpen(true);
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载详情失败"));
        }
    };

    const columns: ColumnsType<BackendUser> = [
        { title: "邮箱", dataIndex: "email", key: "email", ellipsis: true },
        { title: "昵称", dataIndex: "nickname", key: "nickname" },
        { title: "角色", dataIndex: "role", key: "role", render: (v) => <Tag color={v === "admin" ? "red" : "blue"}>{v}</Tag> },
        { title: "等级", dataIndex: "level", key: "level" },
        { title: "积分", dataIndex: "credits", key: "credits" },
        { title: "状态", dataIndex: "status", key: "status", render: (v) => <Tag color={v === "active" ? "green" : "red"}>{v}</Tag> },
        { title: "注册时间", dataIndex: "created_at", key: "created_at", render: (v) => (v ? new Date(v).toLocaleString() : "-") },
        {
            title: "操作",
            key: "action",
            render: (_, record) => (
                <Space size="small">
                    <Button type="link" size="small" onClick={() => openDetail(record)}>详情</Button>
                    <Button type="link" size="small" onClick={() => openRecharge(record)}>充值</Button>
                    <Button type="link" size="small" onClick={() => openEdit(record)}>编辑</Button>
                    <Button type="link" danger={record.status !== "banned"} size="small" onClick={() => toggleBan(record)}>
                        {record.status === "banned" ? "解禁" : "禁用"}
                    </Button>
                </Space>
            ),
        },
    ];

    return (
        <Card title="用户管理">
            <div className="mb-4 flex gap-2">
                <Input.Search placeholder="搜索邮箱" allowClear onSearch={setSearch} className="max-w-xs" />
            </div>
            <Table rowKey="id" dataSource={users} columns={columns} loading={loading} pagination={{ pageSize: 10 }} />

            {/* 充值 Modal */}
            <Modal open={rechargeOpen} title={`充值 - ${rechargeUser?.email ?? ""}`} okText="确认充值" cancelText="取消" onOk={submitRecharge} onCancel={() => setRechargeOpen(false)}>
                <Form form={rechargeForm} layout="vertical" className="mt-4">
                    <Form.Item name="delta" label="充值积分" rules={[{ required: true }]}>
                        <InputNumber min={1} className="w-full" />
                    </Form.Item>
                    <Form.Item name="reason" label="原因备注">
                        <Input placeholder="admin_recharge" />
                    </Form.Item>
                </Form>
            </Modal>

            {/* 编辑 Modal */}
            <Modal open={editOpen} title={`编辑 - ${editUser?.email ?? ""}`} okText="保存" cancelText="取消" onOk={submitEdit} onCancel={() => setEditOpen(false)}>
                <Form form={editForm} layout="vertical" className="mt-4">
                    <Form.Item name="nickname" label="昵称">
                        <Input />
                    </Form.Item>
                    <Form.Item name="role" label="角色">
                        <Select options={ROLE_OPTIONS} />
                    </Form.Item>
                    <Form.Item name="level" label="等级">
                        <Select options={LEVEL_OPTIONS} />
                    </Form.Item>
                </Form>
            </Modal>

            {/* 详情抽屉 */}
            <Drawer open={detailOpen} title="用户详情" width={560} onClose={() => setDetailOpen(false)}>
                {detail && (
                    <div className="flex flex-col gap-5">
                        <Descriptions column={1} bordered size="small">
                            <Descriptions.Item label="邮箱">{detail.user.email}</Descriptions.Item>
                            <Descriptions.Item label="昵称">{detail.user.nickname ?? "-"}</Descriptions.Item>
                            <Descriptions.Item label="角色">{detail.user.role}</Descriptions.Item>
                            <Descriptions.Item label="等级">{detail.user.level}</Descriptions.Item>
                            <Descriptions.Item label="积分">{detail.user.credits}</Descriptions.Item>
                            <Descriptions.Item label="状态">{detail.user.status}</Descriptions.Item>
                            <Descriptions.Item label="注册时间">{detail.user.created_at ? new Date(detail.user.created_at).toLocaleString() : "-"}</Descriptions.Item>
                        </Descriptions>

                        <div>
                            <h4 className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">积分流水（最近 50 条）</h4>
                            <Table
                                rowKey="id"
                                size="small"
                                dataSource={detail.ledger}
                                pagination={false}
                                columns={[
                                    { title: "变动", dataIndex: "delta", render: (v) => <span className={v > 0 ? "text-green-600" : "text-red-600"}>{v > 0 ? "+" : ""}{v}</span> },
                                    { title: "余额", dataIndex: "balance_after" },
                                    { title: "原因", dataIndex: "reason" },
                                    { title: "时间", dataIndex: "created_at", render: (v) => (v ? new Date(v).toLocaleString() : "-") },
                                ]}
                            />
                        </div>

                        <div>
                            <h4 className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">最近调用（20 条）</h4>
                            <Table
                                rowKey="id"
                                size="small"
                                dataSource={detail.recent_calls}
                                pagination={false}
                                columns={[
                                    { title: "模型", dataIndex: "variable_name" },
                                    { title: "状态", dataIndex: "status", render: (v) => <Tag color={v === "success" ? "green" : "red"}>{v}</Tag> },
                                    { title: "积分", dataIndex: "cost_credits" },
                                    { title: "时间", dataIndex: "created_at", render: (v) => (v ? new Date(v).toLocaleString() : "-") },
                                ]}
                            />
                        </div>

                        <div>
                            <h4 className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">资产（20 个）</h4>
                            <Table
                                rowKey="id"
                                size="small"
                                dataSource={detail.assets}
                                pagination={false}
                                columns={[
                                    { title: "名称", dataIndex: "name" },
                                    { title: "类型", dataIndex: "asset_type" },
                                    { title: "时间", dataIndex: "created_at", render: (v) => (v ? new Date(v).toLocaleString() : "-") },
                                ]}
                            />
                        </div>
                    </div>
                )}
            </Drawer>
        </Card>
    );
}
