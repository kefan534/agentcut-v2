import { CheckSquare } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { App, Empty, Progress, Select, Spin } from "antd";

import {
    getBackendErrorMessage,
    getDramaTasksSummary,
    listDramaProjects,
    type DramaProject,
    type DramaTaskSummary,
} from "@/services/api/backend";

export default function DramaTasksPage() {
    const { message } = App.useApp();
    const [projects, setProjects] = useState<DramaProject[]>([]);
    const [projectId, setProjectId] = useState<string | undefined>();
    const [summary, setSummary] = useState<DramaTaskSummary | null>(null);
    const [loading, setLoading] = useState(false);

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

    const loadSummary = useCallback(async () => {
        if (!projectId) {
            setSummary(null);
            return;
        }
        setLoading(true);
        try {
            setSummary(await getDramaTasksSummary(projectId));
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载进度失败"));
        } finally {
            setLoading(false);
        }
    }, [projectId, message]);

    useEffect(() => {
        void loadSummary();
    }, [loadSummary]);

    const progress = (done: number, total: number) => (total === 0 ? 0 : Math.round((done / total) * 100));

    const cards = summary
        ? [
              { label: "剧本", done: summary.scripts.with_content, total: summary.scripts.total, hint: "已填写内容" },
              { label: "资产", done: summary.assets.done, total: summary.assets.total, hint: `已生成图 ${summary.assets.done} · 失败 ${summary.assets.failed}` },
              { label: "分镜", done: summary.storyboards.done, total: summary.storyboards.total, hint: "已生成画面" },
              { label: "视频", done: summary.videos.success, total: summary.videos.total, hint: `成功 ${summary.videos.success} · 失败 ${summary.videos.failed}` },
          ]
        : [];

    return (
        <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto py-6">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-card text-stone-700 dark:border-stone-800 dark:text-stone-200">
                        <CheckSquare className="size-5" />
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">任务看板</h1>
                        <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">聚合项目各模块的创作进度。</p>
                    </div>
                </div>
                <Select className="w-52" placeholder="选择项目" value={projectId} onChange={setProjectId} options={projects.map((p) => ({ label: p.name, value: p.id }))} />
            </div>

            <div className="mt-6">
                {!projectId ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-stone-200 dark:border-stone-800">
                        <Empty description="请先选择项目" />
                    </div>
                ) : loading ? (
                    <div className="flex h-64 items-center justify-center">
                        <Spin />
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {cards.map((c) => (
                            <div key={c.label} className="rounded-lg border border-stone-200 bg-card p-5 dark:border-stone-800">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-stone-800 dark:text-stone-200">{c.label}</span>
                                    <span className="text-sm text-stone-500 dark:text-stone-400">
                                        {c.done}/{c.total}
                                    </span>
                                </div>
                                <Progress percent={progress(c.done, c.total)} strokeColor="#171717" showInfo={false} className="mt-3 mb-2" />
                                <p className="text-xs text-stone-400">{c.hint}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
