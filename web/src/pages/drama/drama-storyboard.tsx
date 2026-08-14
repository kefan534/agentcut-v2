import { Clapperboard, Film, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { App, Button, Empty, Form, Input, InputNumber, Modal, Select, Spin, Tag, Image } from "antd";

import {
    createDramaStoryboard,
    createDramaVideo,
    deleteDramaStoryboard,
    deleteDramaVideo,
    fetchAvailableModels,
    generateStoryboardImage,
    generateStoryboardsFromScript,
    getAssetUrl,
    getBackendErrorMessage,
    listDramaProjects,
    listDramaScripts,
    listDramaStoryboards,
    listDramaVideos,
    updateDramaStoryboard,
    type DramaProject,
    type DramaScript,
    type DramaStoryboard,
    type DramaVideo,
} from "@/services/api/backend";

type StoryboardForm = { index?: number; prompt?: string; video_desc?: string; duration?: number };

function videoStateTag(state: string) {
    if (state === "成功") return <Tag color="green">成功</Tag>;
    if (state === "生成中") return <Tag color="blue">生成中</Tag>;
    return <Tag color="red">失败</Tag>;
}

export default function DramaStoryboardPage() {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<StoryboardForm>();
    const [projects, setProjects] = useState<DramaProject[]>([]);
    const [scripts, setScripts] = useState<DramaScript[]>([]);
    const [projectId, setProjectId] = useState<string | undefined>();
    const [scriptId, setScriptId] = useState<string | undefined>();
    const [storyboards, setStoryboards] = useState<DramaStoryboard[]>([]);
    const [videos, setVideos] = useState<DramaVideo[]>([]);
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState<DramaStoryboard | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [imageModels, setImageModels] = useState<{ label: string; value: string }[]>([]);
    const [videoModels, setVideoModels] = useState<{ label: string; value: string }[]>([]);
    const [genImageTarget, setGenImageTarget] = useState<DramaStoryboard | null>(null);
    const [genVideoTarget, setGenVideoTarget] = useState<DramaStoryboard | null>(null);
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

    const loadModels = useCallback(async () => {
        try {
            const models = await fetchAvailableModels();
            setImageModels(models.filter((m) => m.modal_category === "image").map((m) => ({ label: m.variable_name, value: m.variable_name })));
            setVideoModels(models.filter((m) => m.modal_category === "video").map((m) => ({ label: m.variable_name, value: m.variable_name })));
        } catch {
            /* 静默 */
        }
    }, []);

    const loadScripts = useCallback(async () => {
        if (!projectId) {
            setScripts([]);
            return;
        }
        try {
            const list = await listDramaScripts(projectId);
            setScripts(list);
            if (list.length) setScriptId((prev) => prev ?? list[0].id);
            else setScriptId(undefined);
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载剧本失败"));
        }
    }, [projectId, message]);

    useEffect(() => {
        void loadProjects();
        void loadModels();
    }, [loadProjects, loadModels]);

    useEffect(() => {
        void loadScripts();
    }, [loadScripts]);

    const loadData = useCallback(async () => {
        if (!projectId) {
            setStoryboards([]);
            setVideos([]);
            return;
        }
        setLoading(true);
        try {
            setStoryboards(await listDramaStoryboards(projectId, scriptId));
            setVideos(await listDramaVideos(projectId));
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载失败"));
        } finally {
            setLoading(false);
        }
    }, [projectId, scriptId, message]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const openCreate = () => {
        setEditing(null);
        form.resetFields();
        setModalOpen(true);
    };

    const openEdit = (s: DramaStoryboard) => {
        setEditing(s);
        form.setFieldsValue({ index: s.index, prompt: s.prompt ?? undefined, video_desc: s.video_desc ?? undefined, duration: s.duration ?? 5 });
        setModalOpen(true);
    };

    const handleSubmit = async () => {
        if (!projectId) return;
        const values = await form.validateFields();
        setSaving(true);
        try {
            if (editing) {
                await updateDramaStoryboard(editing.id, values);
                message.success("分镜已更新");
            } else {
                await createDramaStoryboard({ project_id: projectId, script_id: scriptId, ...values });
                message.success("分镜已添加");
            }
            setEditing(null);
            setModalOpen(false);
            await loadData();
        } catch (e) {
            if ((e as { errorFields?: unknown[] }).errorFields) return;
            message.error(getBackendErrorMessage(e, "保存失败"));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = (s: DramaStoryboard) => {
        modal.confirm({
            title: `删除分镜 #${s.index}？`,
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                await deleteDramaStoryboard(s.id);
                message.success("已删除");
                await loadData();
            },
        });
    };

    const handleGenImage = async () => {
        if (!genImageTarget || !genModel) return;
        setGenerating(true);
        try {
            await generateStoryboardImage(genImageTarget.id, genModel);
            message.success("分镜图生成完成");
            setGenImageTarget(null);
            await loadData();
        } catch (e) {
            message.error(getBackendErrorMessage(e, "生成失败"));
        } finally {
            setGenerating(false);
        }
    };

    const handleGenVideo = async () => {
        if (!genVideoTarget || !genModel) return;
        setGenerating(true);
        try {
            await createDramaVideo({
                project_id: genVideoTarget.project_id,
                script_id: genVideoTarget.script_id ?? undefined,
                storyboard_id: genVideoTarget.id,
                prompt: genVideoTarget.video_desc || genVideoTarget.prompt || "",
                duration: genVideoTarget.duration ?? 5,
                model: genModel,
            });
            message.success("视频生成已开始");
            setGenVideoTarget(null);
            await loadData();
        } catch (e) {
            message.error(getBackendErrorMessage(e, "生成失败"));
        } finally {
            setGenerating(false);
        }
    };

    const handleAutoSplit = async () => {
        if (!projectId || !scriptId) {
            message.warning("请先选择项目和剧本");
            return;
        }
        setGenerating(true);
        try {
            const res = await generateStoryboardsFromScript(projectId, scriptId);
            message.success(`已从剧本拆解 ${res.count} 个分镜`);
            await loadData();
        } catch (e) {
            message.error(getBackendErrorMessage(e, "拆解失败"));
        } finally {
            setGenerating(false);
        }
    };

    return (
        <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto py-6">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-card text-stone-700 dark:border-stone-800 dark:text-stone-200">
                        <Clapperboard className="size-5" />
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">分镜</h1>
                        <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">把剧本拆成分镜序列，生成画面并合成为视频。</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Select className="w-40" placeholder="项目" value={projectId} onChange={setProjectId} options={projects.map((p) => ({ label: p.name, value: p.id }))} />
                    <Select className="w-44" placeholder="剧本" value={scriptId} onChange={setScriptId} options={scripts.map((s) => ({ label: s.name, value: s.id }))} allowClear />
                    <Button icon={<Wand2 className="size-4" />} loading={generating} disabled={!projectId || !scriptId} onClick={() => void handleAutoSplit()}>
                        从剧本生成分镜
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} disabled={!projectId} onClick={openCreate}>
                        添加分镜
                    </Button>
                </div>
            </div>

            <div className="mt-6">
                {!projectId ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-stone-200 dark:border-stone-800">
                        <Empty description="请先在上方选择项目" />
                    </div>
                ) : loading ? (
                    <div className="flex h-64 items-center justify-center">
                        <Spin />
                    </div>
                ) : storyboards.length === 0 ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-stone-200 dark:border-stone-800">
                        <Empty description="还没有分镜" />
                        <Button type="primary" ghost icon={<Plus className="size-4" />} onClick={openCreate}>
                            添加分镜
                        </Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {storyboards.map((s) => (
                            <div key={s.id} className="overflow-hidden rounded-lg border border-stone-200 bg-card dark:border-stone-800">
                                <div className="relative aspect-video w-full overflow-hidden bg-stone-100 dark:bg-stone-900">
                                    {s.image_url ? (
                                        <Image src={getAssetUrl(s.image_url)} alt={`分镜 ${s.index}`} className="size-full object-cover" />
                                    ) : (
                                        <div className="flex size-full items-center justify-center text-stone-400">
                                            <Clapperboard className="size-8" />
                                        </div>
                                    )}
                                    <span className="absolute left-2 top-2 rounded bg-stone-900/70 px-1.5 py-0.5 text-[11px] text-white">#{s.index}</span>
                                </div>
                                <div className="p-3">
                                    <p className="line-clamp-2 text-sm text-stone-800 dark:text-stone-200">{s.prompt || "（无提示词）"}</p>
                                    {s.video_desc ? <p className="mt-1 line-clamp-1 text-xs text-stone-400">运镜：{s.video_desc}</p> : null}
                                    <div className="mt-2 flex items-center gap-2 text-[11px] text-stone-400">
                                        <span>{s.duration}s</span>
                                        {s.image_state === "已完成" ? <Tag color="green">有图</Tag> : null}
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-1 border-t border-stone-100 pt-2 dark:border-stone-800">
                                        <Button size="small" type="text" icon={<Sparkles className="size-3.5" />} onClick={() => { setGenImageTarget(s); setGenModel(imageModels[0]?.value); }}>
                                            生成图
                                        </Button>
                                        <Button size="small" type="text" icon={<Film className="size-3.5" />} onClick={() => { setGenVideoTarget(s); setGenModel(videoModels[0]?.value); }}>
                                            生成视频
                                        </Button>
                                        <Button size="small" type="text" onClick={() => openEdit(s)}>
                                            编辑
                                        </Button>
                                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={() => handleDelete(s)}>
                                            删除
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* 视频列表 */}
            {videos.length > 0 ? (
                <div className="mt-8">
                    <h2 className="mb-3 text-sm font-semibold text-stone-800 dark:text-stone-200">已生成视频</h2>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {videos.map((v) => (
                            <div key={v.id} className="overflow-hidden rounded-lg border border-stone-200 bg-card dark:border-stone-800">
                                <div className="relative aspect-video w-full overflow-hidden bg-stone-100 dark:bg-stone-900">
                                    {v.video_url ? (
                                        <video src={getAssetUrl(v.video_url)} controls className="size-full object-cover" />
                                    ) : (
                                        <div className="flex size-full items-center justify-center text-stone-400">
                                            <Film className="size-8" />
                                        </div>
                                    )}
                                </div>
                                <div className="flex items-center justify-between p-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-xs text-stone-700 dark:text-stone-300">{v.prompt || "（无提示词）"}</p>
                                        <p className="mt-0.5 text-[11px] text-stone-400">{v.model} · {v.duration}s</p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {videoStateTag(v.state)}
                                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={() => deleteDramaVideo(v.id).then(() => loadData())} />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {/* 添加/编辑分镜 */}
            <Modal
                open={modalOpen}
                title={editing ? "编辑分镜" : "添加分镜"}
                okText={editing ? "保存" : "添加"}
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
                    <Form.Item name="index" label="序号">
                        <InputNumber min={0} className="w-full" placeholder="0" />
                    </Form.Item>
                    <Form.Item name="prompt" label="画面提示词">
                        <Input.TextArea placeholder="画面内容、构图、光线…" rows={3} />
                    </Form.Item>
                    <Form.Item name="video_desc" label="运镜/视频描述">
                        <Input placeholder="例如：镜头缓慢推近，人物抬头" />
                    </Form.Item>
                    <Form.Item name="duration" label="时长（秒）">
                        <InputNumber min={1} max={60} className="w-full" />
                    </Form.Item>
                </Form>
            </Modal>

            {/* 生成分镜图 */}
            <Modal
                open={!!genImageTarget}
                title={`生成分镜图 #${genImageTarget?.index ?? ""}`}
                okText="生成"
                cancelText="取消"
                confirmLoading={generating}
                onOk={handleGenImage}
                onCancel={() => setGenImageTarget(null)}
                width={440}
            >
                <div className="mt-4">
                    <p className="mb-1 text-sm text-stone-600 dark:text-stone-300">图像模型</p>
                    <Select className="w-full" value={genModel} onChange={setGenModel} options={imageModels} placeholder="选择图像模型" />
                </div>
            </Modal>

            {/* 生成视频 */}
            <Modal
                open={!!genVideoTarget}
                title={`生成视频（分镜 #${genVideoTarget?.index ?? ""}）`}
                okText="生成"
                cancelText="取消"
                confirmLoading={generating}
                onOk={handleGenVideo}
                onCancel={() => setGenVideoTarget(null)}
                width={440}
            >
                <div className="mt-4">
                    <p className="mb-1 text-sm text-stone-600 dark:text-stone-300">视频模型</p>
                    <Select className="w-full" value={genModel} onChange={setGenModel} options={videoModels} placeholder="选择视频模型" />
                    <p className="mt-3 text-xs text-stone-400">将以该分镜的图片作为首帧参考，结合运镜描述生成视频片段。</p>
                </div>
            </Modal>
        </div>
    );
}
