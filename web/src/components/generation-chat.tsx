import { useEffect, useRef } from "react";
import { App, Button, Empty, Image, Spin, Tag, Tooltip } from "antd";
import { Bookmark, Clapperboard, Download, ImageIcon, RotateCcw, Send, Trash2, Wand2, X } from "lucide-react";
import { createAsset, fetchBackendFile, getBackendErrorMessage, uploadFile, type GenerationSession } from "@/services/api/backend";

const STATUS_MAP: Record<string, { label: string; color: string }> = {
    pending: { label: "生成中", color: "blue" },
    success: { label: "已完成", color: "green" },
    failed: { label: "失败", color: "red" },
};

export function GenerationFeed({
    sessions,
    loading,
    mediaType,
    onRetry,
    onDelete,
    onRemoveResult,
    onReuse,
}: {
    sessions: GenerationSession[];
    loading?: boolean;
    mediaType: "image" | "video";
    onRetry?: (session: GenerationSession) => void;
    onDelete?: (id: string) => void;
    onRemoveResult?: (sessionId: string, url: string) => void;
    onReuse?: (session: GenerationSession) => void;
}) {
    const topRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        topRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [sessions, loading]);

    const sorted = [...sessions].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    return (
        <div className="thin-scrollbar flex h-full flex-col overflow-y-auto bg-stone-50 p-4 dark:bg-stone-950">
            {sorted.length === 0 && !loading ? (
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                    <Empty description={`还没有生成${mediaType === "video" ? "视频" : "图片"}，在中间输入提示词开始创作`} />
                </div>
            ) : (
                <div className="mx-auto w-full max-w-4xl space-y-4">
                    <div ref={topRef} />
                    {sorted.map((session) => (
                        <SessionCard
                            key={session.id}
                            session={session}
                            mediaType={mediaType}
                            onRetry={onRetry}
                            onDelete={onDelete}
                            onRemoveResult={onRemoveResult}
                            onReuse={onReuse}
                        />
                    ))}
                    {loading && (
                        <div className="flex items-center justify-center gap-2 py-4 text-stone-500">
                            <Spin size="small" />
                            <span>加载历史记录...</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function SessionCard({
    session,
    mediaType,
    onRetry,
    onDelete,
    onRemoveResult,
    onReuse,
}: {
    session: GenerationSession;
    mediaType: "image" | "video";
    onRetry?: (session: GenerationSession) => void;
    onDelete?: (id: string) => void;
    onRemoveResult?: (sessionId: string, url: string) => void;
    onReuse?: (session: GenerationSession) => void;
}) {
    const { message } = App.useApp();
    const status = STATUS_MAP[session.status] || { label: session.status, color: "default" };
    const createdAt = new Date(session.created_at).toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });

    const isReference = session.task_type === "reference";
    const title =
        mediaType === "video"
            ? isReference
                ? "参考生视频"
                : "文生视频"
            : isReference
              ? "参考生图"
              : "文生图";

    const handleDownload = async () => {
        const urls = session.result_urls || [];
        if (!urls.length) {
            message.warning("没有可下载的结果");
            return;
        }
        try {
            for (const url of urls) {
                await downloadMedia(url);
            }
            message.success("下载已开始");
        } catch (e) {
            message.error("下载失败，请重试");
            console.error(e);
        }
    };

    const handleSaveAsAsset = async () => {
        const urls = session.result_urls || [];
        if (!urls.length) {
            message.warning("没有可保存的结果");
            return;
        }
        try {
            for (const url of urls) {
                await saveResultAsAsset(session, url, mediaType);
            }
            message.success("已保存到我的资产");
        } catch (e) {
            message.error(getBackendErrorMessage(e, "保存资产失败"));
            console.error(e);
        }
    };

    return (
        <div className="relative overflow-hidden rounded-xl border border-stone-200 bg-card text-card-foreground shadow-sm dark:border-stone-800">
            {/* 右上角关闭：删除整条记录 */}
            {onDelete ? (
                <button
                    type="button"
                    onClick={() => onDelete(session.id)}
                    className="absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded-full bg-stone-100 text-stone-500 opacity-70 transition-opacity hover:bg-red-50 hover:text-red-500 hover:opacity-100 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                    aria-label="删除记录"
                >
                    <X className="size-3.5" />
                </button>
            ) : null}

            {/* 头部 */}
            <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-4 py-3 pr-10 dark:border-stone-800/60">
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                        {mediaType === "video" ? <Clapperboard className="size-4" /> : <ImageIcon className="size-4" />}
                    </div>
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{title}</div>
                        <div className="text-xs text-stone-500">{createdAt}</div>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <Tag color={status.color} className="!m-0 !text-xs">
                        {status.label}
                    </Tag>
                    {onDelete ? (
                        <Button
                            type="text"
                            size="small"
                            danger
                            icon={<Trash2 className="size-3.5" />}
                            onClick={() => onDelete(session.id)}
                        />
                    ) : null}
                </div>
            </div>

            {/* 参考图缩略图条 */}
            {session.reference_urls.length > 0 && (
                <div className="flex gap-2 overflow-x-auto border-b border-stone-100 px-4 py-3 dark:border-stone-800/60">
                    {session.reference_urls.map((url, index) => (
                        <div key={index} className="relative shrink-0">
                            <img
                                src={url}
                                alt={`参考${index + 1}`}
                                className="size-16 rounded-lg object-cover"
                            />
                        </div>
                    ))}
                </div>
            )}

            {/* 提示词：最多两行，hover 显示完整 */}
            <div className="px-4 py-3">
                <Tooltip title={session.prompt} placement="topLeft" overlayClassName="max-w-md">
                    <p className="line-clamp-2 whitespace-pre-wrap text-sm leading-relaxed">{session.prompt}</p>
                </Tooltip>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                    <span className="rounded-md bg-stone-100 px-2 py-1 dark:bg-stone-800">{session.model}</span>
                </div>
            </div>

            {/* 结果区：大面积 */}
            <div className="bg-stone-50/50 px-4 py-4 dark:bg-black/20">
                <ResultArea session={session} mediaType={mediaType} onRetry={onRetry} onRemoveResult={onRemoveResult} />
            </div>

            {/* 底部操作栏 */}
            {session.status === "success" && (
                <div className="flex items-center justify-between border-t border-stone-100 px-3 py-2 dark:border-stone-800/60">
                    <div className="flex items-center gap-1">
                        <Button type="text" size="small" icon={<Wand2 className="size-3.5" />} onClick={() => onReuse?.(session)}>
                            继续创作
                        </Button>
                        <Button type="text" size="small" icon={<RotateCcw className="size-3.5" />} onClick={() => onRetry?.(session)}>
                            重新编辑
                        </Button>
                    </div>
                    <div className="flex items-center gap-1">
                        <Button type="text" size="small" icon={<Download className="size-3.5" />} onClick={() => void handleDownload()}>
                            下载
                        </Button>
                        <Button type="text" size="small" icon={<Bookmark className="size-3.5" />} onClick={() => void handleSaveAsAsset()}>
                            保存为资产
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

function ResultArea({
    session,
    mediaType,
    onRetry,
    onRemoveResult,
}: {
    session: GenerationSession;
    mediaType: "image" | "video";
    onRetry?: (session: GenerationSession) => void;
    onRemoveResult?: (sessionId: string, url: string) => void;
}) {
    if (session.status === "pending") {
        return (
            <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 py-8 text-stone-500">
                <Spin size="default" />
                <div className="text-center">
                    <div className="text-base font-medium">排队中</div>
                    <div className="text-xs">已将您的任务加入队列，请耐心等待</div>
                </div>
            </div>
        );
    }

    if (session.status === "failed") {
        return (
            <div className="space-y-3 py-2">
                <p className="text-sm text-red-500">生成失败：{session.error_message || "未知错误"}</p>
                {onRetry ? (
                    <Button size="small" icon={<RotateCcw className="size-3.5" />} onClick={() => onRetry(session)}>
                        重试
                    </Button>
                ) : null}
            </div>
        );
    }

    const urls = session.result_urls || [];
    if (!urls.length) {
        return <div className="py-4 text-sm text-stone-500">生成完成，但没有返回可显示的内容</div>;
    }

    if (mediaType === "video") {
        return (
            <div className="space-y-3">
                {urls.map((url, index) => (
                    <div key={`${session.id}-${index}`} className="relative">
                        {onRemoveResult ? (
                            <button
                                type="button"
                                onClick={() => onRemoveResult(session.id, url)}
                                className="absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded-full bg-black/50 text-white opacity-70 transition-opacity hover:bg-red-500 hover:opacity-100"
                                aria-label="删除该结果"
                            >
                                <X className="size-3.5" />
                            </button>
                        ) : null}
                        <video
                            src={url}
                            controls
                            className="w-full rounded-lg bg-black"
                            preload="metadata"
                        />
                    </div>
                ))}
            </div>
        );
    }

    return (
        <Image.PreviewGroup>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                {urls.map((url, index) => (
                    <div key={`${session.id}-${index}`} className="relative aspect-square w-full">
                        {onRemoveResult ? (
                            <button
                                type="button"
                                onClick={() => onRemoveResult(session.id, url)}
                                className="absolute right-2 top-2 z-10 flex size-6 items-center justify-center rounded-full bg-black/50 text-white opacity-70 transition-opacity hover:bg-red-500 hover:opacity-100"
                                aria-label="删除该结果"
                            >
                                <X className="size-3.5" />
                            </button>
                        ) : null}
                        <Image
                            src={url}
                            alt="生成结果"
                            className="!h-full !w-full rounded-lg object-cover"
                            placeholder={<div className="size-full animate-pulse bg-stone-200 dark:bg-stone-800" />}
                        />
                    </div>
                ))}
            </div>
        </Image.PreviewGroup>
    );
}

async function downloadMedia(url: string) {
    const filename = url.split("/").pop() || "download";
    // Same-origin URLs can use a simple anchor download.
    if (url.startsWith("/")) {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        return;
    }
    // Cross-origin: fetch as blob then save.
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
}

function mimeTypeFromUrl(url: string): string | null {
    const ext = url.split(".").pop()?.toLowerCase();
    switch (ext) {
        case "png":
            return "image/png";
        case "jpg":
        case "jpeg":
            return "image/jpeg";
        case "webp":
            return "image/webp";
        case "gif":
            return "image/gif";
        case "mp4":
            return "video/mp4";
        case "mov":
            return "video/quicktime";
        case "webm":
            return "video/webm";
        default:
            return null;
    }
}

function extractStorageKey(url: string): string | null {
    const prefix = "/api/v1/upload/";
    if (url.startsWith(prefix)) return url.slice(prefix.length);
    return null;
}

async function saveResultAsAsset(session: GenerationSession, url: string, mediaType: "image" | "video") {
    const mimeType = mimeTypeFromUrl(url);
    let storageKey = extractStorageKey(url);
    let sizeBytes: number | null = null;

    if (storageKey) {
        // File is already stored on the backend; just need its size.
        try {
            const blob = await fetchBackendFile(storageKey);
            sizeBytes = blob.size;
        } catch {
            // size unknown is acceptable
        }
    } else {
        // External URL: fetch and upload.
        const response = await fetch(url);
        if (!response.ok) throw new Error(`无法获取资源: ${url}`);
        const blob = await response.blob();
        const file = new File([blob], url.split("/").pop() || "asset", { type: blob.type || mimeType || undefined });
        const uploaded = await uploadFile(file);
        storageKey = uploaded.storage_key;
        sizeBytes = file.size;
    }

    if (!storageKey) throw new Error("无法确定存储 key");

    const name = session.prompt.slice(0, 30) || (mediaType === "video" ? "生成视频" : "生成图片");
    await createAsset({
        asset_type: mediaType,
        name: `${name}_${Date.now()}`,
        storage_key: storageKey,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        width: null,
        height: null,
        duration_seconds: null,
        prompt: session.prompt,
        meta: { task_type: session.task_type, model: session.model, source: "generation" },
        project_id: null,
    });
}
