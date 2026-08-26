import { useCallback, useEffect, useState } from "react";
import {
    App,
    Button,
    Card,
    Form,
    Input,
    InputNumber,
    Rate,
    Select,
    Space,
    Table,
    Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { ClipboardCheck, Plus } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { backend } from "@/services/api/backend";

type QAReviewItem = {
    id: string;
    user_id: string;
    target_type: string;
    target_id: string;
    score: number;
    comment: string | null;
    created_at: string;
    updated_at: string;
};

const TARGET_TYPE_OPTIONS = [
    { value: "asset", label: "素材 (asset)" },
    { value: "storyboard", label: "分镜 (storyboard)" },
    { value: "video", label: "视频 (video)" },
    { value: "image", label: "图片 (image)" },
    { value: "project", label: "项目 (project)" },
];

const TARGET_TYPE_COLOR: Record<string, string> = {
    asset: "blue",
    storyboard: "purple",
    video: "red",
    image: "green",
    project: "gold",
};

export default function QAPage() {
    const { message } = App.useApp();
    const [form] = Form.useForm();
    const [reviews, setReviews] = useState<QAReviewItem[]>([]);
    const [loadingList, setLoadingList] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const load = useCallback(async () => {
        setLoadingList(true);
        try {
            const { data } = await backend.get<QAReviewItem[]>("/qa");
            setReviews(data);
        } catch {
            // 列表静默失败，避免刷屏
        } finally {
            setLoadingList(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const handleSubmit = async (values: {
        target_type: string;
        target_id: string;
        score: number;
        comment?: string;
    }) => {
        setSubmitting(true);
        try {
            await backend.post<QAReviewItem>("/qa", {
                target_type: values.target_type,
                target_id: values.target_id,
                score: values.score,
                comment: values.comment ?? null,
            });
            message.success("评分已提交");
            form.resetFields();
            await load();
        } catch {
            message.error("提交失败，请稍后再试");
        } finally {
            setSubmitting(false);
        }
    };

    const columns: ColumnsType<QAReviewItem> = [
        {
            title: "目标类型",
            dataIndex: "target_type",
            key: "target_type",
            render: (t: string) => <Tag color={TARGET_TYPE_COLOR[t] ?? "default"}>{t}</Tag>,
        },
        {
            title: "目标 ID",
            dataIndex: "target_id",
            key: "target_id",
            render: (t: string) => <span className="font-mono text-xs">{t}</span>,
        },
        {
            title: "评分",
            dataIndex: "score",
            key: "score",
            render: (s: number) => <Rate disabled defaultValue={s} />,
        },
        {
            title: "评语",
            dataIndex: "comment",
            key: "comment",
            render: (c: string | null) =>
                c ? <span className="text-sm">{c}</span> : <span className="text-stone-400">-</span>,
        },
        {
            title: "时间",
            dataIndex: "created_at",
            key: "created_at",
            render: (t: string) =>
                t ? dayjs(t).format("YYYY-MM-DD HH:mm:ss") : "-",
        },
    ];

    return (
        <PageContainer scroll>
            <div className="mx-auto w-full max-w-5xl py-8">
                <header className="mb-6 flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-card text-stone-700 dark:border-stone-800 dark:text-stone-200">
                        <ClipboardCheck className="size-5" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">质量中心</h1>
                        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">对素材、分镜、视频等内容提交质量评分，并查看历史评分记录</p>
                    </div>
                </header>

                <Card className="mb-6" title="提交评分">
                    <Form
                        form={form}
                        layout="vertical"
                        onFinish={handleSubmit}
                        initialValues={{ target_type: "asset", score: 5 }}
                    >
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <Form.Item
                                name="target_type"
                                label="目标类型"
                                rules={[{ required: true, message: "请选择目标类型" }]}
                            >
                                <Select options={TARGET_TYPE_OPTIONS} placeholder="选择目标类型" />
                            </Form.Item>

                            <Form.Item
                                name="target_id"
                                label="目标 ID"
                                rules={[{ required: true, message: "请输入目标 ID" }]}
                            >
                                <Input placeholder="例如 asset / storyboard / video 的 ID" />
                            </Form.Item>
                        </div>

                        <Form.Item
                            name="score"
                            label="评分（1-5）"
                            rules={[{ required: true, message: "请选择评分" }]}
                        >
                            <InputNumber min={1} max={5} className="w-32" />
                        </Form.Item>

                        <Form.Item name="comment" label="评语">
                            <Input.TextArea rows={3} placeholder="可选，填写质量反馈" allowClear />
                        </Form.Item>

                        <Space>
                            <Button type="primary" htmlType="submit" loading={submitting} icon={<Plus className="size-4" />}>
                                提交评分
                            </Button>
                            <Button onClick={() => form.resetFields()}>重置</Button>
                        </Space>
                    </Form>
                </Card>

                <Card title="评分记录">
                    <Table
                        rowKey="id"
                        dataSource={reviews}
                        columns={columns}
                        loading={loadingList}
                        pagination={{ pageSize: 10 }}
                        locale={{ emptyText: "暂无评分记录" }}
                        scroll={{ x: 800 }}
                    />
                </Card>
            </div>
        </PageContainer>
    );
}
