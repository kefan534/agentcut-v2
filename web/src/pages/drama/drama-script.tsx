import { Edit3, FileText, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { App, Button, Empty, Form, Input, Modal, Select, Spin } from "antd";

import { DramaScriptAgentDrawer } from "./drama-script-agent";
import {
    createDramaScript,
    deleteDramaScript,
    getBackendErrorMessage,
    listDramaProjects,
    listDramaScripts,
    updateDramaScript,
    type DramaProject,
    type DramaScript,
} from "@/services/api/backend";

type ScriptForm = { name: string; content?: string };

export default function DramaScriptPage() {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<ScriptForm>();
    const [projects, setProjects] = useState<DramaProject[]>([]);
    const [projectId, setProjectId] = useState<string | undefined>();
    const [scripts, setScripts] = useState<DramaScript[]>([]);
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState<DramaScript | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [agentOpen, setAgentOpen] = useState(false);

    const loadProjects = useCallback(async () => {
        try {
            const list = await listDramaProjects();
            setProjects(list);
            if (list.length) setProjectId((prev) => prev ?? list[0].id);
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载项目失败"));
        }
    }, [message]);

    useEffect(() => {
        void loadProjects();
    }, [loadProjects]);

    const loadScripts = useCallback(async () => {
        if (!projectId) {
            setScripts([]);
            return;
        }
        setLoading(true);
        try {
            setScripts(await listDramaScripts(projectId));
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载剧本失败"));
        } finally {
            setLoading(false);
        }
    }, [projectId, message]);

    useEffect(() => {
        void loadScripts();
    }, [loadScripts]);

    const openCreate = () => {
        setEditing(null);
        form.resetFields();
        setModalOpen(true);
    };

    const openEdit = (s: DramaScript) => {
        setEditing(s);
        form.setFieldsValue({ name: s.name, content: s.content ?? undefined });
        setModalOpen(true);
    };

    const handleSubmit = async () => {
        if (!projectId) return;
        const values = await form.validateFields();
        setSaving(true);
        try {
            if (editing) {
                await updateDramaScript(editing.id, values);
                message.success("剧本已更新");
            } else {
                await createDramaScript(projectId, values.name, values.content);
                message.success("剧本已创建");
            }
            setEditing(null);
            setModalOpen(false);
            await loadScripts();
        } catch (e) {
            if ((e as { errorFields?: unknown[] }).errorFields) return;
            message.error(getBackendErrorMessage(e, "保存失败"));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = (s: DramaScript) => {
        modal.confirm({
            title: `删除剧本「${s.name}」？`,
            content: "删除后无法恢复。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteDramaScript(s.id);
                    message.success("已删除");
                    await loadScripts();
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
                        <FileText className="size-5" />
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">剧本编辑</h1>
                        <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">编写与组织分集剧本，支持角色、场景与对白。</p>
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
                    <Button icon={<Sparkles className="size-4" />} disabled={!projectId} onClick={() => setAgentOpen(true)}>
                        AI 编剧
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} disabled={!projectId} onClick={openCreate}>
                        新建剧本
                    </Button>
                </div>
            </div>

            <div className="mt-6">
                {!projectId ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-stone-200 dark:border-stone-800">
                        <Empty description="请先在上方选择一个项目" />
                    </div>
                ) : loading ? (
                    <div className="flex h-64 items-center justify-center">
                        <Spin />
                    </div>
                ) : scripts.length === 0 ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-stone-200 dark:border-stone-800">
                        <Empty description="该项目还没有剧本" />
                        <Button type="primary" ghost icon={<Plus className="size-4" />} onClick={openCreate}>
                            新建剧本
                        </Button>
                    </div>
                ) : (
                    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {scripts.map((s) => (
                            <li
                                key={s.id}
                                className="group relative overflow-hidden rounded-lg border border-stone-200 bg-card p-4 transition hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-700"
                            >
                                <h3 className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{s.name}</h3>
                                {s.content ? (
                                    <p className="mt-2 line-clamp-3 whitespace-pre-line text-xs text-stone-500 dark:text-stone-400">{s.content}</p>
                                ) : (
                                    <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">暂无内容</p>
                                )}
                                <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3 dark:border-stone-800">
                                    <span className="text-[11px] text-stone-400">
                                        {new Date(s.updated_at).toLocaleString("zh-CN", { hour12: false })}
                                    </span>
                                    <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                                        <Button size="small" type="text" icon={<Edit3 className="size-3.5" />} onClick={() => openEdit(s)}>
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
                title={editing ? "编辑剧本" : "新建剧本"}
                okText={editing ? "保存" : "创建"}
                cancelText="取消"
                confirmLoading={saving}
                onOk={handleSubmit}
                onCancel={() => {
                    setEditing(null);
                    setModalOpen(false);
                    form.resetFields();
                }}
                width={640}
            >
                <Form form={form} layout="vertical" className="mt-4">
                    <Form.Item name="name" label="剧本名称" rules={[{ required: true, message: "请输入剧本名称" }]}>
                        <Input placeholder="例如：第一集 剧本" maxLength={255} />
                    </Form.Item>
                    <Form.Item name="content" label="剧本内容">
                        <Input.TextArea placeholder="场景、对白、镜头说明…" rows={14} />
                    </Form.Item>
                </Form>
            </Modal>

            {projectId ? (
                <DramaScriptAgentDrawer
                    projectId={projectId}
                    projectName={projects.find((p) => p.id === projectId)?.name || ""}
                    open={agentOpen}
                    onClose={() => setAgentOpen(false)}
                />
            ) : null}
        </div>
    );
}
