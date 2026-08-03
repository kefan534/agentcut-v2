import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { App, Button, Card, Form, Input } from "antd";

import { useUserStore } from "@/stores/use-user-store";

export default function LoginPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const { login, isAuthenticated } = useUserStore();
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isAuthenticated) navigate("/");
    }, [isAuthenticated, navigate]);

    const handleSubmit = async (values: { email: string; password: string }) => {
        setLoading(true);
        try {
            await login(values.email.trim(), values.password);
            message.success("登录成功");
            navigate("/");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登录失败");
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="flex h-full items-center justify-center bg-background p-6">
            <Card title="登录" className="w-full max-w-md">
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
                    <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
                        <Input.Password placeholder="******" autoComplete="current-password" />
                    </Form.Item>
                    <Form.Item>
                        <Button type="primary" htmlType="submit" loading={loading} className="w-full">
                            登录
                        </Button>
                    </Form.Item>
                </Form>
                <div className="text-center text-sm text-stone-500">
                    还没有账号？ <Link to="/register" className="text-blue-600 hover:underline">立即注册</Link>
                </div>
            </Card>
        </main>
    );
}
