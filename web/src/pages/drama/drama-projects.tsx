import { Clapperboard, Edit3, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { App, Button, Empty, Form, Input, Modal, Select, Spin } from "antd";

import {
    createDramaProject,
    deleteDramaProject,
    getBackendErrorMessage,
    listDramaProjects,
    updateDramaProject,
    type DramaProject,
} from "@/services/api/backend";

type DramaProjectForm = {
    name: string;
    intro?: string;
    project_type?: string;
    type?: string;
    art_style?: string;
    director_manual?: string;
    video_ratio?: string;
    image_model?: string;
    video_model?: string;
    image_quality?: string;
    mode?: string;
};

const PROJECT_TYPE_OPTIONS = [
    { label: "竖屏短剧", value: "short-drama" },
    { label: "横屏短剧", value: "horizontal" },
    { label: "动画", value: "animation" },
    { label: "其他", value: "other" },
];

const VIDEO_RATIO_OPTIONS = [
    { label: "9:16 竖屏", value: "9:16" },
    { label: "16:9 横屏", value: "16:9" },
    { label: "3:4 竖屏", value: "3:4" },
    { label: "1:1 方形", value: "1:1" },
];

const IMAGE_QUALITY_OPTIONS = [
    { label: "标清 SD", value: "sd" },
    { label: "高清 HD", value: "hd" },
    { label: "2K", value: "2k" },
    { label: "4K", value: "4k" },
];

const MODE_OPTIONS = [
    { label: "标准", value: "standard" },
    { label: "快速", value: "fast" },
    { label: "高质量", value: "quality" },
];

function projectSubtitle(p: DramaProject): string {
    const parts = [p.project_type, p.art_style, p.video_ratio].filter(Boolean);
    return parts.length ? parts.join(" · ") : "未设置";
}

export default function DramaProjectsPage() {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<DramaProjectForm>();
    const [projects, setProjects] = useState<DramaProject[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<DramaProject | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setProjects(await listDramaProjects());
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载项目失败"));
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => {
        void load();
    }, [load]);

    const openCreate = () => {
        setEditing(null);
        form.resetFields();
        setModalOpen(true);
    };

    const openEdit = (p: DramaProject) => {
        setEditing(p);
        form.setFieldsValue({
            name: p.name,
            intro: p.intro ?? undefined,
            project_type: p.project_type ?? undefined,
            type: p.type ?? undefined,
            art_style: p.art_style ?? undefined,
            director_manual: p.director_manual ?? undefined,
            video_ratio: p.video_ratio ?? undefined,
            image_model: p.image_model ?? undefined,
            video_model: p.video_model ?? undefined,
            image_quality: p.image_quality ?? undefined,
            mode: p.mode ?? undefined,
        });
        setModalOpen(true);
    };

    const handleSubmit = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            if (editing) {
                await updateDramaProject(editing.id, values);
                message.success("项目已更新");
            } else {
                await createDramaProject(values);
                message.success("项目已创建");
            }
            setEditing(null);
            setModalOpen(false);
            await load();
        } catch (e) {
            if ((e as { errorFields?: unknown[] }).errorFields) return; // 表单校验失败，静默
            message.error(getBackendErrorMessage(e, "保存失败"));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = (p: DramaProject) => {
        modal.confirm({
            title: `删除项目「${p.name}」？`,
            content: "删除后无法恢复，项目内的剧本、资产、分镜数据将一并不可见。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteDramaProject(p.id);
                    message.success("项目已删除");
                    await load();
                } catch (e) {
                    message.error(getBackendErrorMessage(e, "删除失败"));
                }
            },
        });
    };

    return (
        <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto py-6">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-card text-stone-700 dark:border-stone-800 dark:text-stone-200">
                        <Clapperboard className="size-5" />
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">项目</h1>
                        <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">管理你的短剧项目，每个项目包含剧本、资产、分镜与合成设置。</p>
                    </div>
                </div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                    新建项目
                </Button>
            </div>

            <div className="mt-6">
                {loading ? (
                    <div className="flex h-64 items-center justify-center">
                        <Spin />
                    </div>
                ) : projects.length === 0 ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-stone-200 dark:border-stone-800">
                        <Empty description="还没有项目" />
                        <Button type="primary" ghost icon={<Plus className="size-4" />} onClick={openCreate}>
                            新建第一个项目
                        </Button>
                    </div>
                ) : (
                    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {projects.map((p) => (
                            <li
                                key={p.id}
                                className="group relative overflow-hidden rounded-lg border border-stone-200 bg-card p-4 transition hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-700"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <h3 className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{p.name}</h3>
                                        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{projectSubtitle(p)}</p>
                                    </div>
                                </div>
                                {p.intro ? (
                                    <p className="mt-2 line-clamp-2 text-xs text-stone-500 dark:text-stone-400">{p.intro}</p>
                                ) : (
                                    <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">暂无简介</p>
                                )}
                                <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3 dark:border-stone-800">
                                    <span className="text-[11px] text-stone-400">
                                        {new Date(p.updated_at).toLocaleString("zh-CN", { hour12: false })}
                                    </span>
                                    <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                                        <Button size="small" type="text" icon={<Edit3 className="size-3.5" />} onClick={() => openEdit(p)}>
                                            编辑
                                        </Button>
                                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={() => handleDelete(p)}>
                                            删除
                                        </Button>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <Modal
                open={modalOpen}
                title={editing ? "编辑项目" : "新建项目"}
                okText={editing ? "保存" : "创建"}
                cancelText="取消"
                confirmLoading={saving}
                onOk={handleSubmit}
                onCancel={() => {
                    setEditing(null);
                    setModalOpen(false);
                    form.resetFields();
                }}
                width={560}
            >
                <Form form={form} layout="vertical" className="mt-4">
                    <Form.Item name="name" label="项目名称" rules={[{ required: true, message: "请输入项目名称" }]}>
                        <Input placeholder="例如：念念有爪" maxLength={255} />
                    </Form.Item>
                    <Form.Item name="intro" label="简介">
                        <Input.TextArea placeholder="一句话介绍这个项目" rows={2} maxLength={1000} />
                    </Form.Item>
                    <div className="grid grid-cols-2 gap-x-4">
                        <Form.Item name="project_type" label="项目类型">
                            <Select allowClear options={PROJECT_TYPE_OPTIONS} placeholder="选择类型" />
                        </Form.Item>
                        <Form.Item name="video_ratio" label="画面比例">
                            <Select allowClear options={VIDEO_RATIO_OPTIONS} placeholder="选择比例" />
                        </Form.Item>
                        <Form.Item name="art_style" label="画风">
                            <Input placeholder="例如：国风水墨" />
                        </Form.Item>
                        <Form.Item name="image_quality" label="图像质量">
                            <Select allowClear options={IMAGE_QUALITY_OPTIONS} placeholder="选择质量" />
                        </Form.Item>
                        <Form.Item name="mode" label="生成模式">
                            <Select allowClear options={MODE_OPTIONS} placeholder="选择模式" />
                        </Form.Item>
                        <Form.Item name="type" label="类型">
                            <Input placeholder="例如：vertical" />
                        </Form.Item>
                    </div>
                    <Form.Item name="director_manual" label="导演手册">
                        <Input.TextArea placeholder="导演风格、镜头语言等备注（可选）" rows={3} />
                    </Form.Item>
                    <div className="grid grid-cols-2 gap-x-4">
                        <Form.Item name="image_model" label="图像模型">
                            <Input placeholder="后续接入模型路由" />
                        </Form.Item>
                        <Form.Item name="video_model" label="视频模型">
                            <Input placeholder="后续接入模型路由" />
                        </Form.Item>
                    </div>
                </Form>
            </Modal>
        </div>
    );
}
