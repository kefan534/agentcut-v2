import { Palette, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { App, Button, Empty, Form, Input, Modal, Spin, Image } from "antd";

import {
    createDramaArtStyle,
    deleteDramaArtStyle,
    getAssetUrl,
    getBackendErrorMessage,
    listDramaArtStyles,
    updateDramaArtStyle,
    type DramaArtStyle,
} from "@/services/api/backend";

type StyleForm = { name: string; prompt?: string; image_url?: string };

export default function DramaArtStylePage() {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<StyleForm>();
    const [styles, setStyles] = useState<DramaArtStyle[]>([]);
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState<DramaArtStyle | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setStyles(await listDramaArtStyles());
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载画风失败"));
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

    const openEdit = (s: DramaArtStyle) => {
        setEditing(s);
        form.setFieldsValue({ name: s.name, prompt: s.prompt ?? undefined, image_url: s.image_url ?? undefined });
        setModalOpen(true);
    };

    const handleSubmit = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            if (editing) {
                await updateDramaArtStyle(editing.id, values);
                message.success("画风已更新");
            } else {
                await createDramaArtStyle(values);
                message.success("画风已创建");
            }
            setEditing(null);
            setModalOpen(false);
            await load();
        } catch (e) {
            if ((e as { errorFields?: unknown[] }).errorFields) return;
            message.error(getBackendErrorMessage(e, "保存失败"));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = (s: DramaArtStyle) => {
        modal.confirm({
            title: `删除画风「${s.name}」？`,
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                await deleteDramaArtStyle(s.id);
                message.success("已删除");
                await load();
            },
        });
    };

    return (
        <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto py-6">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-card text-stone-700 dark:border-stone-800 dark:text-stone-200">
                        <Palette className="size-5" />
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">画风</h1>
                        <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">管理可复用的视觉画风预设。</p>
                    </div>
                </div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                    新建画风
                </Button>
            </div>

            <div className="mt-6">
                {loading ? (
                    <div className="flex h-64 items-center justify-center">
                        <Spin />
                    </div>
                ) : styles.length === 0 ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-stone-200 dark:border-stone-800">
                        <Empty description="暂无画风预设" />
                        <Button type="primary" ghost icon={<Plus className="size-4" />} onClick={openCreate}>
                            新建画风
                        </Button>
                    </div>
                ) : (
                    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                        {styles.map((s) => (
                            <li key={s.id} className="overflow-hidden rounded-lg border border-stone-200 bg-card dark:border-stone-800">
                                <div className="aspect-video w-full overflow-hidden bg-stone-100 dark:bg-stone-900">
                                    {s.image_url ? (
                                        <Image src={getAssetUrl(s.image_url)} alt={s.name} className="size-full object-cover" />
                                    ) : (
                                        <div className="flex size-full items-center justify-center text-stone-400">
                                            <Palette className="size-8" />
                                        </div>
                                    )}
                                </div>
                                <div className="p-3">
                                    <h3 className="text-sm font-medium text-stone-900 dark:text-stone-100">{s.name}</h3>
                                    {s.prompt ? <p className="mt-1 line-clamp-2 text-xs text-stone-500 dark:text-stone-400">{s.prompt}</p> : null}
                                    <div className="mt-3 flex gap-1 border-t border-stone-100 pt-2 dark:border-stone-800">
                                        <Button size="small" type="text" onClick={() => openEdit(s)}>
                                            编辑
                                        </Button>
                                        <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={() => handleDelete(s)}>
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
                title={editing ? "编辑画风" : "新建画风"}
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
                        <Input placeholder="例如：国风水墨 / 赛博朋克" maxLength={255} />
                    </Form.Item>
                    <Form.Item name="prompt" label="画风描述（用于生成 prompt）">
                        <Input.TextArea placeholder="描述这个画风的视觉特征…" rows={3} />
                    </Form.Item>
                    <Form.Item name="image_url" label="示例图 URL（可选）">
                        <Input placeholder="https://... 或本地上传路径" />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
}
