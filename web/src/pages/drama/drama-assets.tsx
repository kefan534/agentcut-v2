import { Boxes, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { App, Button, Empty, Form, Input, Modal, Select, Segmented, Spin, Tag, Image } from "antd";

import {
    createDramaAsset,
    deleteDramaAsset,
    fetchAvailableModels,
    generateDramaAsset,
    getAssetUrl,
    getBackendErrorMessage,
    listDramaAssets,
    listDramaProjects,
    updateDramaAsset,
    type DramaAsset,
    type DramaProject,
} from "@/services/api/backend";

type AssetForm = { name: string; type?: string; describe?: string; prompt?: string; remark?: string };

const TYPE_OPTIONS = [
    { label: "角色", value: "role" },
    { label: "场景", value: "scene" },
    { label: "道具", value: "tool" },
];

const TYPE_LABELS: Record<string, string> = { role: "角色", scene: "场景", tool: "道具" };

function stateTag(state: string | null) {
    if (state === "已完成") return <Tag color="green">已生成</Tag>;
    if (state === "生成中") return <Tag color="blue">生成中</Tag>;
    if (state === "生成失败") return <Tag color="red">生成失败</Tag>;
    return <Tag>未生成</Tag>;
}

export default function DramaAssetsPage() {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<AssetForm>();
    const [projects, setProjects] = useState<DramaProject[]>([]);
    const [projectId, setProjectId] = useState<string | undefined>();
    const [assets, setAssets] = useState<DramaAsset[]>([]);
    const [loading, setLoading] = useState(false);
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [editing, setEditing] = useState<DramaAsset | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [genTarget, setGenTarget] = useState<DramaAsset | null>(null);
    const [imageModels, setImageModels] = useState<{ label: string; value: string }[]>([]);
    const [genModel, setGenModel] = useState<string>();
    const [generating, setGenerating] = useState(false);

    const loadProjects = useCallback(async () => {
        try {
            const list = await listDramaProjects();
            setProjects(list);
            if (list.length) setProjectId((prev) => prev ?? list[0].id);
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载项目失败"));
        }
    }, [message]);

    const loadImageModels = useCallback(async () => {
        try {
            const models = (await fetchAvailableModels()).filter((m) => m.modal_category === "image");
            setImageModels(models.map((m) => ({ label: m.variable_name, value: m.variable_name })));
            if (models.length) setGenModel((prev) => prev ?? models[0].variable_name);
        } catch {
            /* 模型列表加载失败时静默 */
        }
    }, []);

    useEffect(() => {
        void loadProjects();
        void loadImageModels();
    }, [loadProjects, loadImageModels]);

    const loadAssets = useCallback(async () => {
        if (!projectId) {
            setAssets([]);
            return;
        }
        setLoading(true);
        try {
            setAssets(await listDramaAssets(projectId, typeFilter === "all" ? undefined : typeFilter));
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载资产失败"));
        } finally {
            setLoading(false);
        }
    }, [projectId, typeFilter, message]);

    useEffect(() => {
        void loadAssets();
    }, [loadAssets]);

    const openCreate = () => {
        setEditing(null);
        form.resetFields();
        setModalOpen(true);
    };

    const openEdit = (a: DramaAsset) => {
        setEditing(a);
        form.setFieldsValue({ name: a.name, type: a.type ?? undefined, describe: a.describe ?? undefined, prompt: a.prompt ?? undefined, remark: a.remark ?? undefined });
        setModalOpen(true);
    };

    const handleSubmit = async () => {
        if (!projectId) return;
        const values = await form.validateFields();
        setSaving(true);
        try {
            if (editing) {
                await updateDramaAsset(editing.id, values);
                message.success("资产已更新");
            } else {
                await createDramaAsset({ project_id: projectId, ...values });
                message.success("资产已创建");
            }
            setEditing(null);
            setModalOpen(false);
            await loadAssets();
        } catch (e) {
            if ((e as { errorFields?: unknown[] }).errorFields) return;
            message.error(getBackendErrorMessage(e, "保存失败"));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = (a: DramaAsset) => {
        modal.confirm({
            title: `删除资产「${a.name}」？`,
            content: "删除后无法恢复。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteDramaAsset(a.id);
                    message.success("已删除");
                    await loadAssets();
                } catch (e) {
                    message.error(getBackendErrorMessage(e, "删除失败"));
                }
            },
        });
    };

    const handleGenerate = async () => {
        if (!genTarget || !genModel) return;
        setGenerating(true);
        try {
            await generateDramaAsset(genTarget.id, genModel);
            message.success("生成完成");
            setGenTarget(null);
            await loadAssets();
        } catch (e) {
            message.error(getBackendErrorMessage(e, "生成失败"));
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto py-6">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-card text-stone-700 dark:border-stone-800 dark:text-stone-200">
                        <Boxes className="size-5" />
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">资产库</h1>
                        <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">管理角色、场景、道具等生成资产。</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Select
                        className="w-52"
                        placeholder="选择项目"
                        value={projectId}
                        onChange={setProjectId}
                        options={projects.map((p) => ({ label: p.name, value: p.id }))}
                    />
                    <Button type="primary" icon={<Plus className="size-4" />} disabled={!projectId} onClick={openCreate}>
                        新建资产
                    </Button>
                </div>
            </div>

            <div className="mt-4">
                <Segmented
                    value={typeFilter}
                    onChange={(v) => setTypeFilter(v as string)}
                    options={[
                        { label: "全部", value: "all" },
                        { label: "角色", value: "role" },
                        { label: "场景", value: "scene" },
                        { label: "道具", value: "tool" },
                    ]}
                />
            </div>

            <div className="mt-4">
                {!projectId ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-stone-200 dark:border-stone-800">
                        <Empty description="请先在上方选择一个项目" />
                    </div>
                ) : loading ? (
                    <div className="flex h-64 items-center justify-center">
                        <Spin />
                    </div>
                ) : assets.length === 0 ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-stone-200 dark:border-stone-800">
                        <Empty description="暂无资产" />
                        <Button type="primary" ghost icon={<Plus className="size-4" />} onClick={openCreate}>
                            新建资产
                        </Button>
                    </div>
                ) : (
                    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                        {assets.map((a) => (
                            <li key={a.id} className="group overflow-hidden rounded-lg border border-stone-200 bg-card transition hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-700">
                                <div className="relative aspect-square w-full overflow-hidden bg-stone-100 dark:bg-stone-900">
                                    {a.image_url ? (
                                        <Image src={getAssetUrl(a.image_url)} alt={a.name} className="size-full object-cover" />
                                    ) : (
                                        <div className="flex size-full flex-col items-center justify-center gap-1 text-stone-400">
                                            <Boxes className="size-8" />
                                            <span className="text-xs">未生成</span>
                                        </div>
                                    )}
                                    {a.type ? (
                                        <span className="absolute left-2 top-2 rounded bg-stone-900/70 px-1.5 py-0.5 text-[11px] text-white">
                                            {TYPE_LABELS[a.type] || a.type}
                                        </span>
                                    ) : null}
                                </div>
                                <div className="p-3">
                                    <div className="flex items-center justify-between">
                                        <h3 className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{a.name}</h3>
                                        {stateTag(a.image_state)}
                                    </div>
                                    {a.prompt ? <p className="mt-1 line-clamp-2 text-xs text-stone-500 dark:text-stone-400">{a.prompt}</p> : null}
                                    <div className="mt-3 flex gap-1 border-t border-stone-100 pt-2 dark:border-stone-800">
                                        <Button size="small" type="text" icon={<Sparkles className="size-3.5" />} onClick={() => setGenTarget(a)}>
                                            生成图片
                                        </Button>
                                        <Button size="small" type="text" onClick={() => openEdit(a)}>
                                            编辑
                                        </Button>
                                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={() => handleDelete(a)}>
                                            删除
                                        </Button>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* 新建/编辑资产 */}
            <Modal
                open={modalOpen}
                title={editing ? "编辑资产" : "新建资产"}
                okText={editing ? "保存" : "创建"}
                cancelText="取消"
                confirmLoading={saving}
                onOk={handleSubmit}
                onCancel={() => {
                    setEditing(null);
                    setModalOpen(false);
                    form.resetFields();
                }}
                width={520}
            >
                <Form form={form} layout="vertical" className="mt-4">
                    <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
                        <Input placeholder="例如：顾念 / 独石庙 / 玉佩" maxLength={255} />
                    </Form.Item>
                    <Form.Item name="type" label="类型">
                        <Select allowClear options={TYPE_OPTIONS} placeholder="选择类型" />
                    </Form.Item>
                    <Form.Item name="describe" label="描述">
                        <Input.TextArea placeholder="一句话描述这个资产" rows={2} />
                    </Form.Item>
                    <Form.Item name="prompt" label="生成提示词">
                        <Input.TextArea placeholder="用于生成图片的提示词" rows={3} />
                    </Form.Item>
                    <Form.Item name="remark" label="备注">
                        <Input placeholder="可选" />
                    </Form.Item>
                </Form>
            </Modal>

            {/* 生成图片 */}
            <Modal
                open={!!genTarget}
                title={`生成图片：${genTarget?.name || ""}`}
                okText="生成"
                cancelText="取消"
                confirmLoading={generating}
                onOk={handleGenerate}
                onCancel={() => setGenTarget(null)}
                width={480}
            >
                <div className="mt-4">
                    <p className="mb-1 text-sm text-stone-600 dark:text-stone-300">选择图像模型</p>
                    <Select
                        className="w-full"
                        value={genModel}
                        onChange={setGenModel}
                        options={imageModels}
                        placeholder="选择图像模型"
                    />
                    <p className="mt-3 text-xs text-stone-400">将根据资产的提示词 + 项目画风生成一张图，覆盖现有图片。</p>
                </div>
            </Modal>
        </div>
    );
}
