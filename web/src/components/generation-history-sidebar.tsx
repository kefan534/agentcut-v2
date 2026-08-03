import { useMemo } from "react";
import { Empty, Spin } from "antd";
import { ImageIcon, Video } from "lucide-react";
import type { GenerationSession } from "@/services/api/backend";

export function GenerationHistorySidebar({
    sessions,
    loading,
    mediaType,
    selectedId,
    onSelect,
}: {
    sessions: GenerationSession[];
    loading: boolean;
    mediaType: "image" | "video";
    selectedId?: string;
    onSelect?: (session: GenerationSession) => void;
}) {
    const sorted = useMemo(() => {
        return [...sessions].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }, [sessions]);

    return (
        <div className="thin-scrollbar flex h-full flex-col overflow-y-auto">
            <div className="sticky top-0 z-10 border-b border-stone-200 bg-stone-50/95 px-3 py-2 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95">
                <h2 className="text-sm font-semibold text-stone-950 dark:text-stone-100">生成记录</h2>
            </div>

            {loading && !sorted.length ? (
                <div className="flex flex-1 items-center justify-center py-8">
                    <Spin size="small" />
                </div>
            ) : sorted.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
                    <Empty description={`暂无${mediaType === "video" ? "视频" : "图片"}生成记录`} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                </div>
            ) : (
                <div className="divide-y divide-stone-100 dark:divide-stone-900">
                    {sorted.map((session) => {
                        const isSelected = selectedId === session.id;
                        const firstUrl = session.result_urls?.[0];
                        const timeLabel = formatTime(session.created_at);
                        return (
                            <button
                                key={session.id}
                                type="button"
                                onClick={() => onSelect?.(session)}
                                className={`flex w-full gap-3 px-3 py-3 text-left transition-colors ${
                                    isSelected
                                        ? "bg-stone-200/70 dark:bg-stone-800/70"
                                        : "hover:bg-stone-100 dark:hover:bg-stone-900/60"
                                }`}
                            >
                                <div className="relative shrink-0 overflow-hidden rounded-md border border-stone-200 bg-stone-100 dark:border-stone-800 dark:bg-stone-900">
                                    {firstUrl ? (
                                        mediaType === "video" || firstUrl.endsWith(".mp4") || firstUrl.endsWith(".webm") ? (
                                            <video src={firstUrl} className="size-14 object-cover" muted />
                                        ) : (
                                            <img src={firstUrl} alt="" className="size-14 object-cover" loading="lazy" />
                                        )
                                    ) : (
                                        <div className="flex size-14 items-center justify-center text-stone-400">
                                            {mediaType === "video" ? <Video className="size-5" /> : <ImageIcon className="size-5" />}
                                        </div>
                                    )}
                                    {session.status === "pending" && (
                                        <span className="absolute right-1 top-1 h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                                    )}
                                    {session.status === "failed" && (
                                        <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="line-clamp-2 text-xs text-stone-700 dark:text-stone-300">{session.prompt}</p>
                                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-stone-400">
                                        <span className="truncate">{session.model}</span>
                                        <span className="shrink-0">{timeLabel}</span>
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function formatTime(iso: string) {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "刚刚";
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    if (diffDays < 7) return `${diffDays} 天前`;
    return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}
