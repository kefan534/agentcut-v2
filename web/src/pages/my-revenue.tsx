import { useEffect, useState } from "react";
import { Card, Table, Tag, Statistic, Row, Col, Empty } from "antd";

type MySkill = {
    id: string;
    name: string;
    description: string;
    category: string;
    status: string;
    priceCredits: number;
    enabledCount: number;
    totalRevenue: number;
    avgRating: number | null;
    reviewCount: number;
    reviewComment?: string | null;
};

export default function MyRevenuePage() {
    const [skills, setSkills] = useState<MySkill[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch("/api/v1/skills/my/list", { credentials: "include" });
                const data = await res.json();
                if (data.ok) setSkills(data.items);
            } catch { /* ignore */ }
            finally { setLoading(false); }
        })();
    }, []);

    const totalRevenue = skills.reduce((sum, s) => sum + (s.totalRevenue || 0), 0);
    const totalEnabled = skills.reduce((sum, s) => sum + (s.enabledCount || 0), 0);
    const publishedCount = skills.filter((s) => s.status === "published").length;
    const pendingCount = skills.filter((s) => s.status === "submitted" || s.status === "reviewing").length;

    return (
        <div className="mx-auto max-w-5xl px-6 py-8">
            <h1 className="mb-6 text-2xl font-bold">我的投稿与收入</h1>
            <Row gutter={16} className="mb-6">
                <Col span={6}>
                    <Card><Statistic title="累计收入（积分）" value={totalRevenue} /></Card>
                </Col>
                <Col span={6}>
                    <Card><Statistic title="累计解锁次数" value={totalEnabled} /></Card>
                </Col>
                <Col span={6}>
                    <Card><Statistic title="已上架" value={publishedCount} /></Card>
                </Col>
                <Col span={6}>
                    <Card><Statistic title="审核中" value={pendingCount} /></Card>
                </Col>
            </Row>

            <Table<MySkill>
                dataSource={skills}
                rowKey="id"
                loading={loading}
                pagination={{ pageSize: 20 }}
                locale={{ emptyText: <Empty description="暂无投稿，去 Skill 商店投稿吧" /> }}
                columns={[
                    { title: "名称", dataIndex: "name", width: 160, ellipsis: true },
                    { title: "分类", dataIndex: "category", width: 100 },
                    {
                        title: "状态", dataIndex: "status", width: 100,
                        render: (s: string) => {
                            const colors: Record<string, string> = { draft: "default", submitted: "blue", reviewing: "processing", published: "success", disabled: "warning", rejected: "error" };
                            return <Tag color={colors[s] || "default"}>{s}</Tag>;
                        },
                    },
                    { title: "定价", dataIndex: "priceCredits", width: 80, render: (v: number) => v > 0 ? `${v} 积分` : "免费" },
                    { title: "解锁数", dataIndex: "enabledCount", width: 80 },
                    { title: "累计收入", dataIndex: "totalRevenue", width: 100, render: (v: number) => `${v || 0} 积分` },
                    {
                        title: "评分", width: 100,
                        render: (_: unknown, r: MySkill) => r.avgRating ? `${r.avgRating} (${r.reviewCount})` : "—"
                    },
                    {
                        title: "审核反馈", dataIndex: "reviewComment", ellipsis: true,
                        render: (v: string | null) => v || "—"
                    },
                ]}
            />
        </div>
    );
}
