import { BookMarked, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { App, Button, Card, Input, Select, Spin } from "antd";
import { PageContainer } from "@/components/layout/page-container";
import { backend, listDramaProjects, type DramaProject } from "@/services/api/backend";

interface LockCard {
    exists: boolean;
    project_id: string;
    style: string | null;
    characters: string | null;
    scenes: string | null;
    props: string | null;
    hard_rules: string | null;
}

type LockCardFields = Omit<LockCard, "exists" | "project_id">;

const FIELDS: { key: keyof LockCardFields; label: string; placeholder: string }[] = [
    { key: "style", label: "全局风格 / 画风", placeholder: "例：写实电影感，冷色调，低饱和，胶片颗粒，浅景深" },
    { key: "characters", label: "角色外观圣经", placeholder: "例：顾念，22 岁，齐肩黑发，左眼角泪痣，常穿米白针织衫；二叔，轮椅，左手变形…" },
    { key: "scenes", label: "场景圣经", placeholder: "例：陈索村，青砖镬耳楼，午后斜光，芭蕉叶影，古井青苔" },
    { key: "props", label: "道具圣经", placeholder: "例：铜钥匙、旧搪瓷缸、红绳、龙头桩" },
    { key: "hard_rules", label: "硬性规则（不可违背）", placeholder: "例：角色不可改发型/年龄；场景不得出现现代高楼；季节须与物候一致" },
];

export default function DramaLockCardPage() {
    const { message } = App.useApp();
    const [searchParams, setSearchParams] = useSearchParams();
    const [projectId, setProjectId] = useState(searchParams.get("projectId") ?? "");
    const [projects, setProjects] = useState<DramaProject[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [data, setData] = useState<LockCardFields>({ style: "", characters: "", scenes: "", props: "", hard_rules: "" });

    // R3-4: 加载当前用户的项目列表，供下拉选择（无需手工粘贴 ID）
    const loadProjects = useCallback(async () => {
        try {
            const list = await listDramaProjects();
            setProjects(list.filter((p) => p.id && p.name));
        } catch {
            // 列表加载失败时保留手工输入兜底
        }
    }, []);

    const load = useCallback(async (id: string) => {
        if (!id) return;
        setLoading(true);
        try {
            const { data: res } = await backend.get<LockCard>(`/drama/${id}/lock-card`);
            setData({
                style: res.style ?? "",
                characters: res.characters ?? "",
                scenes: res.scenes ?? "",
                props: res.props ?? "",
                hard_rules: res.hard_rules ?? "",
            });
        } catch {
            message.error("加载锁定卡失败，请检查项目 ID 是否正确");
        } finally {
            setLoading(false);
        }
    }, [message]);

    const pickProject = useCallback(
        (id: string) => {
            setProjectId(id);
            setSearchParams({ projectId: id });
            void load(id);
        },
        [load, setSearchParams],
    );

    useEffect(() => {
        void loadProjects();
        if (projectId) void load(projectId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const save = async () => {
        if (!projectId) {
            message.warning("请填写项目 ID");
            return;
        }
        setSaving(true);
        try {
            await backend.put(`/drama/${projectId}/lock-card`, data);
            message.success("全局锁定卡已保存");
        } catch {
            message.error("保存失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <PageContainer>
            <div className="mx-auto max-w-3xl space-y-4 py-4">
                <header>
                    <h1 className="flex items-center gap-2 text-xl font-semibold text-stone-950 dark:text-stone-100">
                        <BookMarked className="size-5" /> 全局锁定卡
                    </h1>
                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                        在编剧 / 分镜前锚定风格、角色外观、场景、道具与硬性规则，后续资产与分镜严格引用，直接解决角色 / 场景一致性痛点（如《门朝北》《念念有爪》）。每个项目唯一一张。
                    </p>
                </header>

                <Card>
                    <div className="flex flex-wrap gap-2">
                        <Select
                            showSearch
                            allowClear
                            placeholder="选择项目（自动带入 ID）"
                            value={projectId || undefined}
                            onChange={(value) => {
                                if (value) pickProject(value);
                            }}
                            optionFilterProp="label"
                            options={projects.map((p) => ({
                                value: p.id,
                                label: `${p.name}（${p.id.slice(0, 8)}…）`,
                            }))}
                            className="min-w-64 flex-1"
                            notFoundContent="暂无项目"
                        />
                        <Input
                            placeholder="或直接输入 Drama 项目 ID"
                            value={projectId}
                            onChange={(event) => setProjectId(event.target.value)}
                            allowClear
                            className="flex-1"
                        />
                        <Button
                            onClick={() => {
                                setSearchParams({ projectId });
                                void load(projectId);
                            }}
                        >
                            加载
                        </Button>
                    </div>
                </Card>

                <Spin spinning={loading}>
                    <div className="space-y-4">
                        {FIELDS.map((field) => (
                            <div key={field.key}>
                                <label className="mb-1 block text-sm font-semibold text-stone-800 dark:text-stone-200">{field.label}</label>
                                <Input.TextArea
                                    rows={4}
                                    value={data[field.key] ?? ""}
                                    placeholder={field.placeholder}
                                    onChange={(event) => setData((prev) => ({ ...prev, [field.key]: event.target.value } as LockCardFields))}
                                />
                            </div>
                        ))}
                        <Button type="primary" icon={<Save className="size-4" />} loading={saving} onClick={() => void save()}>
                            保存锁定卡
                        </Button>
                    </div>
                </Spin>
            </div>
        </PageContainer>
    );
}
