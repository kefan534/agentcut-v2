import { BookOpen, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Input, Modal, Select, Spin, Tag } from "antd";

import {
    createDramaNovels,
    deleteDramaNovel,
    extractDramaNovelEvents,
    getBackendErrorMessage,
    listDramaNovels,
    listDramaProjects,
    type DramaNovel,
    type DramaProject,
} from "@/services/api/backend";

function eventStateTag(state: number) {
    if (state === 1) return <Tag color="green">已抽取事件</Tag>;
    if (state === -1) return <Tag color="red">抽取失败</Tag>;
    return <Tag>未抽取</Tag>;
}

/** 按空行切分粘贴的全文，每章首行作章节名，其余作正文。 */
function splitChapters(text: string): { chapter: string; chapter_data: string }[] {
    const blocks = text
        .split(/\n\s*\n/)
        .map((b) => b.trim())
        .filter(Boolean);
    return blocks.map((block) => {
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
        if (lines.length === 0) return { chapter: "", chapter_data: "" };
        return { chapter: lines[0], chapter_data: lines.slice(1).join("\n") };
    });
}

export default function DramaNovelPage() {
    const { message, modal } = App.useApp();
    const [projects, setProjects] = useState<DramaProject[]>([]);
    const [projectId, setProjectId] = useState<string | undefined>();
    const [novels, setNovels] = useState<DramaNovel[]>([]);
    const [loading, setLoading] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [importText, setImportText] = useState("");
    const [saving, setSaving] = useState(false);

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

    const loadNovels = useCallback(async () => {
        if (!projectId) {
            setNovels([]);
            return;
        }
        setLoading(true);
        try {
            setNovels(await listDramaNovels(projectId));
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载章节失败"));
        } finally {
            setLoading(false);
        }
    }, [projectId, message]);

    useEffect(() => {
        void loadNovels();
    }, [loadNovels]);

    const previewChapters = useMemo(() => splitChapters(importText), [importText]);

    const handleImport = async () => {
        if (!projectId) return;
        if (!previewChapters.length) {
            message.warning("请输入小说内容");
            return;
        }
        setSaving(true);
        try {
            await createDramaNovels(
                projectId,
                previewChapters.map((c) => ({ chapter: c.chapter, chapter_data: c.chapter_data })),
            );
            message.success(`已导入 ${previewChapters.length} 章`);
            setImportOpen(false);
            setImportText("");
            await loadNovels();
        } catch (e) {
            message.error(getBackendErrorMessage(e, "导入失败"));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = (n: DramaNovel) => {
        modal.confirm({
            title: `删除章节「${n.chapter || `第 ${n.chapter_index + 1} 章`}」？`,
            content: "删除后无法恢复。",
            okText: "删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteDramaNovel(n.id);
                    message.success("已删除");
                    await loadNovels();
                } catch (e) {
                    message.error(getBackendErrorMessage(e, "删除失败"));
                }
            },
        });
    };

    const handleExtract = async () => {
        if (!projectId || !novels.length) return;
        try {
            await extractDramaNovelEvents(projectId);
            message.success("事件抽取已开始，正在后台处理…");
            // 轮询直到全部完成
            const poll = async () => {
                const latest = await listDramaNovels(projectId);
                setNovels(latest);
                if (latest.some((n) => n.event_state === 0)) {
                    setTimeout(poll, 3000);
                } else {
                    message.success("事件抽取完成");
                }
            };
            setTimeout(poll, 3000);
        } catch (e) {
            message.error(getBackendErrorMessage(e, "抽取失败"));
        }
    };

    return (
        <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto py-6">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-card text-stone-700 dark:border-stone-800 dark:text-stone-200">
                        <BookOpen className="size-5" />
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">小说</h1>
                        <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">导入小说原文，按章节拆分为短剧脚本素材。</p>
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
                    <Button icon={<Sparkles className="size-4" />} disabled={!projectId || !novels.length} onClick={() => void handleExtract()}>
                        抽取事件
                    </Button>
                    <Button type="primary" icon={<Plus className="size-4" />} disabled={!projectId} onClick={() => setImportOpen(true)}>
                        导入小说
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
                ) : novels.length === 0 ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-stone-200 dark:border-stone-800">
                        <Empty description="该项目还没有小说章节" />
                        <Button type="primary" ghost icon={<Plus className="size-4" />} onClick={() => setImportOpen(true)}>
                            导入小说
                        </Button>
                    </div>
                ) : (
                    <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 dark:divide-stone-800 dark:border-stone-800">
                        {novels.map((n) => (
                            <li key={n.id} className="group flex items-start gap-4 p-4">
                                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded bg-stone-100 text-xs font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                                    {n.chapter_index + 1}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        {n.reel ? <span className="text-xs text-stone-400">{n.reel}</span> : null}
                                        <h3 className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{n.chapter || "未命名章节"}</h3>
                                        {eventStateTag(n.event_state)}
                                    </div>
                                    {n.chapter_data ? (
                                        <p className="mt-1 line-clamp-2 text-xs text-stone-500 dark:text-stone-400">{n.chapter_data}</p>
                                    ) : null}
                                    {n.event ? (
                                        <div className="mt-2 rounded-md bg-stone-50 p-2 text-xs text-stone-600 dark:bg-stone-800/60 dark:text-stone-300">
                                            <span className="font-medium text-stone-700 dark:text-stone-200">事件：</span>
                                            <span className="whitespace-pre-wrap">{n.event}</span>
                                        </div>
                                    ) : null}
                                </div>
                                <Button
                                    size="small"
                                    type="text"
                                    danger
                                    className="opacity-0 transition group-hover:opacity-100"
                                    icon={<Trash2 className="size-3.5" />}
                                    onClick={() => handleDelete(n)}
                                >
                                    删除
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <Modal
                open={importOpen}
                title="导入小说"
                okText={`导入 ${previewChapters.length} 章`}
                cancelText="取消"
                confirmLoading={saving}
                onOk={handleImport}
                onCancel={() => {
                    setImportOpen(false);
                    setImportText("");
                }}
                width={640}
            >
                <p className="mt-4 text-xs text-stone-500">
                    粘贴小说全文，按「空行」自动切分章节：每段的第一行作为章节名，其余作为正文。
                </p>
                <Input.TextArea
                    className="mt-2"
                    rows={12}
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder={"第一章 陈索村的清晨\n天还没亮，陈索村的公鸡就叫了。\n\n第二章 独石庙\n村口的独石庙香火依旧。"}
                />
                {previewChapters.length > 0 ? (
                    <p className="mt-2 text-xs text-stone-500">
                        将导入 <span className="font-medium text-stone-700">{previewChapters.length}</span> 章：
                        {previewChapters.slice(0, 5).map((c, i) => (
                            <span key={i} className="ml-1 rounded bg-stone-100 px-1.5 py-0.5 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                                {c.chapter || "未命名"}
                            </span>
                        ))}
                        {previewChapters.length > 5 ? " …" : ""}
                    </p>
                ) : null}
            </Modal>
        </div>
    );
}
