import { useState } from "react";
import { App, Form, Input, Modal } from "antd";

import { changePassword, getBackendErrorMessage } from "@/services/api/backend";

type FormValues = { oldPassword: string; newPassword: string; confirm: string };

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { message } = App.useApp();
    const [form] = Form.useForm<FormValues>();
    const [saving, setSaving] = useState(false);

    const handleSubmit = async () => {
        const values = await form.validateFields();
        if (values.newPassword !== values.confirm) {
            message.error("两次输入的新密码不一致");
            return;
        }
        setSaving(true);
        try {
            await changePassword(values.oldPassword, values.newPassword);
            message.success("密码已修改，请重新登录");
            form.resetFields();
            onClose();
        } catch (e) {
            message.error(getBackendErrorMessage(e, "修改失败"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open={open}
            title="修改密码"
            okText="确认修改"
            cancelText="取消"
            confirmLoading={saving}
            onOk={handleSubmit}
            onCancel={() => {
                form.resetFields();
                onClose();
            }}
            width={420}
        >
            <Form form={form} layout="vertical" className="mt-4">
                <Form.Item name="oldPassword" label="旧密码" rules={[{ required: true, message: "请输入旧密码" }]}>
                    <Input.Password placeholder="当前密码" />
                </Form.Item>
                <Form.Item
                    name="newPassword"
                    label="新密码"
                    rules={[
                        { required: true, message: "请输入新密码" },
                        { min: 8, message: "至少 8 位" },
                        { pattern: /(?=.*[A-Za-z])(?=.*\d)/, message: "需同时包含字母和数字" },
                    ]}
                >
                    <Input.Password placeholder="8 位以上，含字母和数字" />
                </Form.Item>
                <Form.Item name="confirm" label="确认新密码" rules={[{ required: true, message: "请再次输入新密码" }]}>
                    <Input.Password placeholder="再次输入新密码" />
                </Form.Item>
            </Form>
        </Modal>
    );
}
