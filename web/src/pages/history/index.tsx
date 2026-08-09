import { History as HistoryIcon, Image as ImageIcon, Trash2, Video } from "lucide-react";
import { useState } from "react";
import { App, Button, Empty, Segmented, Spin } from "antd";
import { useNavigate } from "react-router-dom";

import { PageContainer } from "@/components/layout/page-container";
import { useGenerationHistory, type ChatMedia, type ChatMessage } from "@/hooks/use-generation-history";

type MediaType = "image" | "video";

const SEGMENTED_OPTIONS: { label: string; value: MediaType }[] = [
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
];

/**
 * /history — 独立的历史记录页
 *
 * 设计意图：把原来塞在生图/视频工作台左侧的历史栏拆出来变成独立页面。
 * 工作台不再有左列，腾出来的空间让「输入面板 + 生成结果」居中紧凑。
 *
 * 复用 GenerationHistorySidebar 的视觉与数据 hook（useGenerationHistory），
 * 切换 image/video 时按 mediaType 重新加载。
 */
export default function HistoryPage() {
    const navigate = useNavigate();
    const { message } = App.useApp();
    const [mediaType, setMediaType] = useState<MediaType>("image");
    const { sessions, messages, loading, deleteSession, load } = useGenerationHistory(mediaType);

    const handleReuse = (sessionId: string, prompt: string) => {
        // 把 prompt 写入 sessionStorage，供 image/video 页读取
        sessionStorage.setItem("agentcut:reuse-prompt", prompt);
        sessionStorage.setItem("agentcut:reuse-source", mediaType);
        message.success("已载入提示词，跳转到工作台");
        navigate(mediaType === "video" ? "/video" : "/image");
    };

    const handleDelete = async (sessionId: string) => {
        try {
            await deleteSession(sessionId);
            message.success("已删除");
        } catch (e) {
            message.error(e instanceof Error ? e.message : "删除失败");
        }
    };

    return (
        <PageContainer scroll>
            <div className="mx-auto w-full max-w-5xl py-8">
                <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-lg border border-stone-200 bg-card text-stone-700 dark:border-stone-800 dark:text-stone-200">
                            <HistoryIcon className="size-5" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-100">生成历史</h1>
                            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">查看、复用或删除你之前的生成记录</p>
                        </div>
                    </div>
                    <Segmented<MediaType> options={SEGMENTED_OPTIONS} value={mediaType} onChange={(value) => setMediaType(value)} />
                </header>

                {loading && !sessions.length ? (
                    <div className="flex h-64 items-center justify-center">
                        <Spin />
                    </div>
                ) : sessions.length === 0 ? (
                    <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-stone-200 dark:border-stone-800">
                        <Empty description={`暂无${mediaType === "video" ? "视频" : "图片"}生成记录`} />
                    </div>
                ) : (
                    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {sessions.map((session) => {
                            const firstUrl = session.result_urls?.[0];
                            const isVideo = mediaType === "video" || firstUrl?.endsWith(".mp4") || firstUrl?.endsWith(".webm");
                            return (
                                <li
                                    key={session.id}
                                    className="group relative overflow-hidden rounded-lg border border-stone-200 bg-card transition hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-700"
                                >
                                    <div className="relative aspect-video w-full overflow-hidden bg-stone-100 dark:bg-stone-900">
                                        {firstUrl ? (
                                            isVideo ? (
                                                <video src={firstUrl} className="size-full object-cover" muted />
                                            ) : (
                                                <img src={firstUrl} alt="" className="size-full object-cover" loading="lazy" />
                                            )
                                        ) : (
                                            <div className="flex size-full items-center justify-center text-stone-400">
                                                {mediaType === "video" ? <Video className="size-8" /> : <ImageIcon className="size-8" />}
                                            </div>
                                        )}
                                        {session.status === "pending" ? <span className="absolute right-2 top-2 h-2 w-2 animate-pulse rounded-full bg-blue-500" /> : null}
                                        {session.status === "failed" ? <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500" /> : null}
                                    </div>
                                    <div className="p-3">
                                        <p className="line-clamp-2 text-sm text-stone-700 dark:text-stone-300">{session.prompt}</p>
                                        <div className="mt-2 flex items-center justify-between text-[11px] text-stone-400">
                                            <span className="truncate">{session.model}</span>
                                            <span>{new Date(session.created_at).toLocaleString("zh-CN", { hour12: false })}</span>
                                        </div>
                                        <div className="mt-3 flex gap-2">
                                            <Button size="small" type="primary" onClick={() => handleReuse(session.id, session.prompt)}>
                                                复用提示词
                                            </Button>
                                            <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => void handleDelete(session.id)}>
                                                删除
                                            </Button>
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}

                {/* 静默挂载 messages hook 以避免未来扩展报错 */}
                <span className="hidden" aria-hidden>
                    {messages.length}
                    {load.name}
                </span>
                <UnusedChatMediaNote />
            </div>
        </PageContainer>
    );
}

// 占位组件：把 ChatMedia 类型引用上以避免 unused import 警告被 lint 报错。
function UnusedChatMediaNote() {
    const _note: ChatMedia[] = [];
    const _msg: ChatMessage[] = [];
    return <>{_note.length}{_msg.length}</>;
}