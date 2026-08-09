import { useEffect, useState, useCallback } from "react";
import { Button, Input, message, Modal, Select, Form } from "antd";
import { Search, Plus, Zap } from "lucide-react";
import { SkillGallery } from "@/components/skill-store/skill-gallery";
import { SkillDetailDrawer } from "@/components/skill-store/skill-detail-drawer";
import type { Skill, SkillCategory } from "@/components/skill-store/skills-data";
import { useAgentStore } from "@/stores/use-agent-store";

type ApiSkill = {
    id: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    palette: [string, string] | null;
    badge: string;
    priceCredits: number;
    status: string;
    enabledCount: number;
    avgRating: number;
    reviewCount: number;
    submitterId: string | null;
    submitterName?: string | null;
    promptFragment?: string | null;
};

type SkillLike = Skill & { priceCredits?: number; submitterName?: string; promptFragment?: string; avgRating?: number | null; reviewCount?: number };

const FAV_KEY = "skill-favorites";

export default function SkillStorePage() {
    const [skills, setSkills] = useState<SkillLike[]>([]);
    const [loading, setLoading] = useState(true);
    const [category, setCategory] = useState<SkillCategory>("推荐");
    const [keyword, setKeyword] = useState("");
    const [submitOpen, setSubmitOpen] = useState(false);
    const [submitForm] = Form.useForm();
    const [detailSkill, setDetailSkill] = useState<SkillLike | null>(null);
    const [favorites, setFavorites] = useState<Set<string>>(() => {
        try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]")); } catch { return new Set(); }
    });

    const addAssetRef = useAgentStore((s) => s.addAssetRef);

    const fetchSkills = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ limit: "100" });
            if (category && category !== "推荐") params.set("category", category);
            if (keyword) params.set("keyword", keyword);
            const res = await fetch(`/api/v1/skills?${params}`, { credentials: "include" });
            const data = await res.json();
            if (data.ok) {
                const validCats = new Set(["推荐", "专业影视", "商业广告", "短剧漫剧", "动漫游戏", "音乐MV", "自媒体创作", "通用技能", "发现"]);
                setSkills(data.items.map((s: ApiSkill) => ({
                    id: s.id,
                    title: s.name,
                    description: s.description,
                    author: s.submitterName || "AgentCut",
                    submitterName: s.submitterName || undefined,
                    badge: s.badge || "技能",
                    usage: String(s.enabledCount || 0),
                    category: (validCats.has(s.category) ? s.category : "通用技能") as Skill["category"],
                    palette: s.palette || ["#3a2b5e", "#7c4ad0"],
                    motif: s.name.slice(0, 8),
                    priceCredits: s.priceCredits,
                    promptFragment: s.promptFragment || undefined,
                    avgRating: s.avgRating,
                    reviewCount: s.reviewCount,
                })));
            } else {
                message.error(data.detail || "加载失败");
            }
        } catch {
            message.error("网络错误");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchSkills(); }, [category, keyword]);

    useEffect(() => {
        localStorage.setItem(FAV_KEY, JSON.stringify([...favorites]));
    }, [favorites]);

    const toggleFavorite = useCallback((skill: SkillLike) => {
        setFavorites((prev) => {
            const next = new Set(prev);
            if (next.has(skill.id)) {
                next.delete(skill.id);
            } else {
                next.add(skill.id);
                message.success(`已收藏「${skill.title}」`);
            }
            return next;
        });
    }, []);

    const useSkill = useCallback(async (skill: SkillLike) => {
        const price = skill.priceCredits || 0;
        if (price > 0) {
            try {
                const res = await fetch(`/api/v1/skills/${skill.id}/unlock`, {
                    method: "POST",
                    credentials: "include",
                });
                const d = await res.json();
                if (!d.ok) {
                    message.error(d.detail || d.error || "解锁失败");
                    return;
                }
                message.success(d.alreadyUnlocked ? `已解锁，添加「${skill.title}」到对话` : `已解锁（${d.costPaid} 积分），添加到对话`);
            } catch {
                message.error("网络错误");
                return;
            }
        } else {
            message.success(`已添加「${skill.title}」到对话`);
        }
        addAssetRef({
            assetId: `skill-${skill.id}`,
            name: skill.title,
            kind: "skill",
            url: "",
            skillId: skill.id,
            promptFragment: skill.promptFragment,
        });
        setDetailSkill(null);
    }, [addAssetRef]);

    const openDetail = useCallback((skill: SkillLike) => {
        setDetailSkill(skill);
    }, []);

    return (
        <div className="min-h-[calc(100vh-3.5rem)] bg-[#0b0b0e] text-white">
            <div className="mx-auto max-w-7xl px-6 pb-16 pt-6">
                <div className="mb-6 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Zap className="size-5 text-purple-400" />
                        <h1 className="text-xl font-semibold tracking-tight">Skill 商店</h1>
                    </div>
                    <div className="flex items-center gap-3">
                        <Input
                            prefix={<Search className="size-4 opacity-50" />}
                            placeholder="搜索 Skill..."
                            className="w-64 [&_input]:!bg-white/5 [&_input]:!border-white/10 [&_input]:!text-white placeholder:text-white/40"
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                            allowClear
                        />
                        <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setSubmitOpen(true)}>投稿</Button>
                    </div>
                </div>

                <SkillGallery
                    skills={skills}
                    loading={loading}
                    activeCategory={category}
                    onCategoryChange={setCategory}
                    onUse={useSkill}
                    onOpen={openDetail}
                    isFavorite={(id) => favorites.has(id)}
                    onToggleFavorite={toggleFavorite}
                />

                <Modal
                    title="投稿 Skill"
                    open={submitOpen}
                    onCancel={() => setSubmitOpen(false)}
                    okText="提交审核"
                    cancelText="取消"
                    onOk={async () => {
                        let vals;
                        try {
                            vals = await submitForm.validateFields();
                        } catch {
                            return;
                        }
                        const res = await fetch("/api/v1/skills/submit", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify(vals),
                        });
                        const data = await res.json();
                        if (data.ok) {
                            message.success("投稿已提交，等待审核");
                            setSubmitOpen(false);
                            submitForm.resetFields();
                            fetchSkills();
                        } else {
                            message.error(data.detail || "投稿失败");
                        }
                    }}
                >
                    <Form form={submitForm} layout="vertical">
                        <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
                            <Input placeholder="Skill 名称" />
                        </Form.Item>
                        <Form.Item name="description" label="描述">
                            <Input.TextArea rows={2} placeholder="简要描述 Skill 功能" />
                        </Form.Item>
                        <Form.Item name="category" label="分类" initialValue="通用技能">
                            <Select options={["推荐", "专业影视", "商业广告", "短剧漫剧", "动漫游戏", "音乐MV", "自媒体创作", "通用技能", "发现"].map(c => ({ label: c, value: c }))} />
                        </Form.Item>
                        <Form.Item name="promptFragment" label="Prompt 片段">
                            <Input.TextArea rows={4} placeholder="Agent 系统提示注入内容" />
                        </Form.Item>
                        <Form.Item name="toolOverrides" label="工具覆盖（JSON）">
                            <Input.TextArea rows={2} placeholder='{"temperature": 0.7}' />
                        </Form.Item>
                    </Form>
                </Modal>

                <SkillDetailDrawer
                    skill={detailSkill}
                    related={skills}
                    onClose={() => setDetailSkill(null)}
                    onUse={useSkill}
                    onOpen={openDetail}
                />
            </div>
        </div>
    );
}