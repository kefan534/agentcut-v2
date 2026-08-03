import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { App, Button, Card, Form, Input } from "antd";

import { useUserStore } from "@/stores/use-user-store";

export default function RegisterPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const { register, isAuthenticated } = useUserStore();
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isAuthenticated) navigate("/");
    }, [isAuthenticated, navigate]);

    const handleSubmit = async (values: { email: string; password: string; nickname?: string }) => {
        setLoading(true);
        try {
            await register(values.email.trim(), values.password, values.nickname?.trim());
            message.success("注册成功");
            navigate("/");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "注册失败");
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="flex h-full items-center justify-center bg-background p-6">
            <Card title="注册" className="w-full max-w-md">
                <Form layout="vertical" onFinish={handleSubmit}>
                    <Form.Item
                        name="email"
                        label="邮箱"
                        normalize={(value) => (typeof value === "string" ? value.trim() : value)}
                        rules={[
                            { required: true, message: "请输入邮箱" },
                            {
                                validator(_, value) {
                                    const trimmed = typeof value === "string" ? value.trim() : value;
                                    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
                                        return Promise.reject(new Error("请输入有效邮箱"));
                                    }
                                    return Promise.resolve();
                                },
                            },
                        ]}
                    >
                        <Input placeholder="your@email.com" autoFocus autoComplete="email" />
                    </Form.Item>
                    <Form.Item name="nickname" label="昵称">
                        <Input placeholder="选填" />
                    </Form.Item>
                    <Form.Item name="password" label="密码" rules={[{ required: true, min: 6, message: "密码至少 6 位" }]}>
                        <Input.Password placeholder="******" autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item
                        name="confirm"
                        label="确认密码"
                        dependencies={["password"]}
                        rules={[
                            { required: true, message: "请确认密码" },
                            ({ getFieldValue }) => ({
                                validator(_, value) {
                                    if (!value || getFieldValue("password") === value) return Promise.resolve();
                                    return Promise.reject(new Error("两次输入的密码不一致"));
                                },
                            }),
                        ]}
                    >
                        <Input.Password placeholder="******" autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item>
                        <Button type="primary" htmlType="submit" loading={loading} className="w-full">
                            注册
                        </Button>
                    </Form.Item>
                </Form>
                <div className="text-center text-sm text-stone-500">
                    已有账号？ <Link to="/login" className="text-blue-600 hover:underline">立即登录</Link>
                </div>
            </Card>
        </main>
    );
}
