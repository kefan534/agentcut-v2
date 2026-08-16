import { BookOpen, ClipboardPaste, FolderPlus, History as HistoryIcon, Music2, Plus, SlidersHorizontal, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { App, Button, Drawer, Input } from "antd";
import { nanoid } from "nanoid";
import { Link } from "react-router-dom";

import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { GenerationFeed } from "@/components/generation-chat";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { VideoSettingsPanel, normalizeVideoResolutionValue, normalizeVideoSizeValue, videoSizeLabel } from "@/components/video-settings-panel";
import { PageContainer } from "@/components/layout/page-container";
import { canvasThemes } from "@/lib/canvas-theme";
import { formatDuration } from "@/lib/image-utils";
import { boolConfig, isSeedanceVideoConfig, normalizeSeedanceRatio, seedanceReferenceLabel, seedanceVideoReferenceError, seedanceVideoReferenceHint, SEEDANCE_REFERENCE_LIMITS, SEEDANCE_VIDEO_MIME_TYPES } from "@/lib/seedance-video";
import { isMetasoVideoConfig, isMetasoVideoModel, metasoAudioReferenceError, metasoReferenceLabel, metasoVideoReferenceError, metasoVideoReferenceHint, normalizeMetasoDuration, normalizeMetasoRatio, normalizeMetasoResolution } from "@/lib/metaso-video";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { createVideoGenerationTask, pollVideoGenerationTask, storeGeneratedVideo, type VideoGenerationTask } from "@/services/api/video";
import { useUserStore } from "@/stores/use-user-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { modelOptionLabel, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useGenerationHistory, type ChatMedia, type ChatMessage } from "@/hooks/use-generation-history";
import { quoteCredits, type GenerationSession } from "@/services/api/backend";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

export default function VideoPage() {
    const { message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const activeTaskIdsRef = useRef<Set<string>>(new Set());
    const runningModelsRef = useRef<Set<string>>(new Set());
    const modelQueuesRef = useRef<Record<string, Array<{ sessionId: string; task: VideoGenerationTask; taskConfig: AiConfig; agentTaskId?: string }>>>({});
    const config = useConfigStore((state) => state.config);
    const isAuthenticated = useUserStore((state) => state.isAuthenticated);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [videoReferences, setVideoReferences] = useState<ReferenceVideo[]>([]);
    const [audioReferences, setAudioReferences] = useState<ReferenceAudio[]>([]);
    const [running, setRunning] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [referenceDragTarget, setReferenceDragTarget] = useState<"image" | "video" | "audio" | null>(null);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const videoCommand = useWorkbenchAgentStore((state) => state.videoCommand);
    const clearVideoCommand = useWorkbenchAgentStore((state) => state.clearVideoCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);

    const { sessions, messages, loading: historyLoading, createSession, updateSession, deleteSession, removeResultUrl } = useGenerationHistory("video");
    const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);

    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const canGenerate = Boolean(prompt.trim());

    // 生成按钮积分预览
    const [creditCost, setCreditCost] = useState<number | null>(null);
    useEffect(() => {
        let cancelled = false;
        if (!model) { setCreditCost(null); return; }
        quoteCredits(model, { vquality: effectiveConfig.vquality, size: effectiveConfig.size, videoSeconds: effectiveConfig.videoSeconds }, "video")
            .then((c) => { if (!cancelled) setCreditCost(c); })
            .catch(() => { if (!cancelled) setCreditCost(null); });
        return () => { cancelled = true; };
    }, [model, effectiveConfig.vquality, effectiveConfig.size, effectiveConfig.videoSeconds]);

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    // 从 /history 页面跳转过来时，载入复用的提示词
    useEffect(() => {
        const reusePrompt = sessionStorage.getItem("agentcut:reuse-prompt");
        const reuseSource = sessionStorage.getItem("agentcut:reuse-source");
        if (reusePrompt && reuseSource === "video") {
            setPrompt(reusePrompt);
            sessionStorage.removeItem("agentcut:reuse-prompt");
            sessionStorage.removeItem("agentcut:reuse-source");
        }
    }, []);

    const addReferences = async (files?: FileList | null) => {
        const selectedFiles = Array.from(files || []);
        const unsupported = selectedFiles.filter((file) => !file.type.startsWith("image/") && !SEEDANCE_VIDEO_MIME_TYPES.includes(file.type) && !isSupportedAudioFile(file));
        if (unsupported.length) message.warning("已忽略不支持的参考资产，请使用图片、mp4/mov 视频或 mp3/wav 音频");
        const imageFiles = selectedFiles.filter((file) => file.type.startsWith("image/") && file.size <= SEEDANCE_REFERENCE_LIMITS.imageMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.images - references.length);
        const videoFiles = selectedFiles.filter((file) => SEEDANCE_VIDEO_MIME_TYPES.includes(file.type) && file.size <= SEEDANCE_REFERENCE_LIMITS.videoMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.videos - videoReferences.length);
        const audioFiles = selectedFiles.filter((file) => isSupportedAudioFile(file) && file.size <= SEEDANCE_REFERENCE_LIMITS.audioMaxBytes).slice(0, SEEDANCE_REFERENCE_LIMITS.audios - audioReferences.length);
        if (selectedFiles.some((file) => file.type.startsWith("image/") && file.size > SEEDANCE_REFERENCE_LIMITS.imageMaxBytes)) message.warning("已忽略超过 30MB 的参考图");
        if (selectedFiles.some((file) => SEEDANCE_VIDEO_MIME_TYPES.includes(file.type) && file.size > SEEDANCE_REFERENCE_LIMITS.videoMaxBytes)) message.warning("已忽略超过 200MB 的参考视频");
        if (selectedFiles.some((file) => isSupportedAudioFile(file) && file.size > SEEDANCE_REFERENCE_LIMITS.audioMaxBytes)) message.warning("已忽略超过 15MB 的参考音频");
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file);
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        const nextVideoReferences = await Promise.all(
            videoFiles.map(async (file) => {
                const video = await uploadMediaFile(file, "video-reference");
                return { id: nanoid(), name: file.name, type: video.mimeType, url: video.url, storageKey: video.storageKey, bytes: video.bytes, width: video.width, height: video.height, durationMs: video.durationMs };
            }),
        );
        const nextAudioReferences = filterAudioReferencesByDuration(
            audioReferences,
            await Promise.all(
                audioFiles.map(async (file) => {
                    const audio = await uploadMediaFile(file, "audio-reference");
                    return { id: nanoid(), name: file.name, type: audio.mimeType, url: audio.url, storageKey: audio.storageKey, durationMs: audio.durationMs };
                }),
            ),
            message.warning,
        );
        setReferences((value) => [...value, ...nextReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
        setVideoReferences((value) => [...value, ...nextVideoReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.videos));
        setAudioReferences((value) => [...value, ...nextAudioReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.audios));
    };

    const handleReferenceDragEnter = (event: DragEvent<HTMLDivElement>, target: "image" | "video" | "audio") => {
        event.preventDefault();
        dragDepthRef.current += 1;
        if (event.dataTransfer.types.includes("Files")) setReferenceDragTarget(target);
    };

    const handleReferenceDragLeave = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (!dragDepthRef.current) setReferenceDragTarget(null);
    };

    const handleReferenceDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setReferenceDragTarget(null);
        void addReferences(event.dataTransfer.files);
    };

    const addReferencesFromClipboard = async () => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error("剪切板里没有可读取的图片");
                return;
            }
            const nextReferences = await Promise.all(
                blobs.slice(0, SEEDANCE_REFERENCE_LIMITS.images - references.length).map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
            message.success(`已读取 ${nextReferences.length} 张参考图`);
        } catch {
            message.error("剪切板里没有可读取的图片");
        }
    };

    const generate = async () => {
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        if (!isAuthenticated) {
            message.warning("请先登录");
            const current = window.location.pathname + window.location.search;
            window.location.href = `/login?redirect=${encodeURIComponent(current)}`;
            return;
        }
        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: "视频生成参数无效" });
            return;
        }

        const hasReference = snapshot.references.length > 0 || snapshot.videoReferences.length > 0 || snapshot.audioReferences.length > 0;
        const taskType: "text" | "reference" = hasReference ? "reference" : "text";
        const referenceUrls = snapshot.references.map((ref) => ref.dataUrl);
        const sessionId = await createSession(snapshot.text, model, taskType, referenceUrls);
        // 新创建的 session 先标记为排队等待
        void markSessionPhase(sessionId, "queued");

        try {
            const task = await createVideoGenerationTask(snapshot.config, snapshot.text, snapshot.references, snapshot.videoReferences, snapshot.audioReferences);
            scheduleTask(sessionId, task, snapshot.config, agentTaskId);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "生成失败";
            await updateSession(sessionId, "failed", [], errorMessage);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            message.error(errorMessage);
        }
    };

    const scheduleTask = (sessionId: string, task: VideoGenerationTask, taskConfig: AiConfig, agentTaskId?: string) => {
        const taskModel = taskConfig.videoModel || taskConfig.model;
        if (runningModelsRef.current.has(taskModel)) {
            // 同一模型已有任务正在生成，加入该模型队列
            if (!modelQueuesRef.current[taskModel]) modelQueuesRef.current[taskModel] = [];
            modelQueuesRef.current[taskModel].push({ sessionId, task, taskConfig, agentTaskId });
            return;
        }
        startTask(sessionId, task, taskConfig, agentTaskId);
    };

    const startTask = (sessionId: string, task: VideoGenerationTask, taskConfig: AiConfig, agentTaskId?: string) => {
        const taskModel = taskConfig.videoModel || taskConfig.model;
        runningModelsRef.current.add(taskModel);
        if (runningModelsRef.current.size === 1) {
            setElapsedMs(0);
            setStartedAt(performance.now());
        }
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        void markSessionPhase(sessionId, "running");
        void pollTask(sessionId, task, taskConfig, agentTaskId);
    };

    const pollTask = async (sessionId: string, task: VideoGenerationTask, taskConfig: AiConfig, agentTaskId?: string) => {
        if (activeTaskIdsRef.current.has(sessionId)) return;
        activeTaskIdsRef.current.add(sessionId);
        try {
            for (let attempt = 0; attempt < 120; attempt += 1) {
                const state = await pollVideoGenerationTask(taskConfig, task);
                if (state.status === "completed") {
                    const stored = await storeGeneratedVideo(state.result);
                    const media: ChatMedia[] = [{
                        id: nanoid(),
                        url: stored.url,
                        mimeType: stored.mimeType || "video/mp4",
                        width: stored.width || 1280,
                        height: stored.height || 720,
                        bytes: stored.bytes,
                    }];
                    await updateSession(sessionId, "success", media);
                    if (agentTaskId) updateAgentTask(agentTaskId, { status: "succeeded", successCount: 1, failCount: 0, error: undefined });
                    message.success("视频已生成");
                    return;
                }
                if (state.status === "failed") throw new Error(state.error);
                if (attempt === 119) throw new Error("视频生成超时，请稍后重试");
                await delay(task.provider === "seedance" ? 5000 : 2500);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "生成失败";
            await updateSession(sessionId, "failed", [], errorMessage);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
            message.error(errorMessage);
        } finally {
            activeTaskIdsRef.current.delete(sessionId);
            const taskModel = taskConfig.videoModel || taskConfig.model;
            runningModelsRef.current.delete(taskModel);

            // 同一模型队列中的下一个任务立即开始
            const queue = modelQueuesRef.current[taskModel];
            if (queue && queue.length > 0) {
                const next = queue.shift();
                if (next) {
                    startTask(next.sessionId, next.task, next.taskConfig, next.agentTaskId);
                }
            }

            if (!runningModelsRef.current.size) {
                setRunning(false);
                setStartedAt(0);
            }
        }
    };

    // 响应 Agent 面板下发的视频命令：填入提示词，并按需自动触发生成。
    useEffect(() => {
        if (!videoCommand || videoCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = videoCommand.nonce;
        clearVideoCommand();
        if (typeof videoCommand.prompt === "string") setPrompt(videoCommand.prompt);
        if (videoCommand.run && running) {
            if (videoCommand.taskId) updateAgentTask(videoCommand.taskId, { status: "failed", error: "视频工作台已有任务正在运行" });
            return;
        }
        if (videoCommand.run) {
            agentTaskIdRef.current = videoCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [videoCommand, clearVideoCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error("请输入视频提示词");
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("请先完成配置");
            openConfigDialog(true);
            return null;
        }
        const metaso = isMetasoVideoModel(model);
        const videoReferenceError = metaso ? metasoVideoReferenceError(videoReferences) : seedanceVideoReferenceError(videoReferences);
        const audioReferenceError = metaso ? metasoAudioReferenceError(audioReferences) : "";
        if (videoReferenceError) {
            message.error(`${videoReferenceError}。${metaso ? metasoVideoReferenceHint : seedanceVideoReferenceHint}`);
            return null;
        }
        if (audioReferenceError) {
            message.error(audioReferenceError);
            return null;
        }
        return { text, config: buildVideoConfig(effectiveConfig, model), references: [...references], videoReferences: [...videoReferences], audioReferences: [...audioReferences] };
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }].slice(0, SEEDANCE_REFERENCE_LIMITS.images));
        } else if (payload.kind === "video") {
            setVideoReferences((value) => [...value, { id: nanoid(), name: payload.title, type: "video/mp4", url: payload.url, storageKey: payload.storageKey, width: payload.width, height: payload.height }].slice(0, SEEDANCE_REFERENCE_LIMITS.videos));
        }
        setAssetPickerOpen(false);
    };

    const resetSession = () => {
        setPrompt("");
        setReferences([]);
        setVideoReferences([]);
        setAudioReferences([]);
        setElapsedMs(0);
        setStartedAt(0);
        setSelectedSessionId(undefined);
    };

    const selectSession = (session: GenerationSession) => {
        setSelectedSessionId(session.id);
        setPrompt(session.prompt);
    };

    const handleReuse = (session: GenerationSession) => {
        setPrompt(session.prompt);
        setSelectedSessionId(session.id);
    };

    const handleRetry = (session: GenerationSession) => {
        if (session.prompt) {
            setPrompt(session.prompt);
            void generate();
        }
    };

    const markSessionPhase = (sessionId: string, phase: "queued" | "running") => {
        void updateSession(sessionId, "pending", [], undefined, phase);
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <PageContainer>
                <div className="flex h-full min-h-0 flex-col gap-4 py-4">
                    <header className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">视频创作台</h1>
                            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">描述镜头运动、主体动作、场景氛围和画面风格</p>
                        </div>
                        <div className="flex shrink-0 gap-2">
                            <Link to="/history" aria-label="查看历史">
                                <Button icon={<HistoryIcon className="size-4" />}>历史</Button>
                            </Link>
                            <div className="lg:hidden">
                                <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    参数
                                </Button>
                            </div>
                        </div>
                    </header>

                    <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
                        <aside className="thin-scrollbar flex min-h-0 flex-col overflow-y-auto rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800">
                            <div className="space-y-4">
                                <div>
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <span className="text-sm font-semibold">提示词</span>
                                        <div className="flex gap-2">
                                            <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                                提示词库
                                            </Button>
                                            <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                                我的资产
                                            </Button>
                                        </div>
                                    </div>
                                    <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={5} maxLength={20000} showCount placeholder="描述镜头运动、主体动作、场景氛围和画面风格" />
                                </div>

                                <ReferenceSection
                                    title="参考图"
                                    type="image"
                                    target={referenceDragTarget}
                                    onDragEnter={handleReferenceDragEnter}
                                    onDragLeave={handleReferenceDragLeave}
                                    onDrop={handleReferenceDrop}
                                    onUpload={() => fileInputRef.current?.click()}
                                    onClipboard={() => void addReferencesFromClipboard()}
                                >
                                    {references.map((item, index) => (
                                        <div key={item.id} className="group relative size-16 shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
                                            <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-medium text-white">{seedanceReferenceLabel("image", index)}</span>
                                            <button type="button" className="absolute right-1 top-1 hidden size-5 items-center justify-center rounded bg-black/60 text-white group-hover:flex" onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))} aria-label="移除参考图">
                                                <Trash2 className="size-3" />
                                            </button>
                                        </div>
                                    ))}
                                </ReferenceSection>

                                <ReferenceSection
                                    title="参考视频"
                                    type="video"
                                    target={referenceDragTarget}
                                    onDragEnter={handleReferenceDragEnter}
                                    onDragLeave={handleReferenceDragLeave}
                                    onDrop={handleReferenceDrop}
                                    onUpload={() => fileInputRef.current?.click()}
                                >
                                    {videoReferences.map((item, index) => (
                                        <div key={item.id} className="group relative h-16 w-28 shrink-0 overflow-hidden rounded-md border border-stone-200 bg-black dark:border-stone-800">
                                            <video src={item.url} className="size-full object-cover" muted preload="metadata" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-medium text-white">{seedanceReferenceLabel("video", index)}</span>
                                            <button type="button" className="absolute right-1 top-1 hidden size-5 items-center justify-center rounded bg-black/60 text-white group-hover:flex" onClick={() => setVideoReferences((value) => value.filter((ref) => ref.id !== item.id))} aria-label="移除参考视频">
                                                <Trash2 className="size-3" />
                                            </button>
                                        </div>
                                    ))}
                                </ReferenceSection>

                                <ReferenceSection
                                    title="参考音频"
                                    type="audio"
                                    target={referenceDragTarget}
                                    onDragEnter={handleReferenceDragEnter}
                                    onDragLeave={handleReferenceDragLeave}
                                    onDrop={handleReferenceDrop}
                                    onUpload={() => fileInputRef.current?.click()}
                                >
                                    {audioReferences.map((item, index) => (
                                        <div key={item.id} className="group relative flex h-16 w-44 shrink-0 flex-col justify-center gap-1 rounded-md border border-stone-200 bg-stone-50 px-2 dark:border-stone-800 dark:bg-stone-900">
                                            <div className="flex min-w-0 items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                                                <Music2 className="size-4 shrink-0" />
                                                <span className="shrink-0 rounded bg-stone-200 px-1 text-[10px] text-stone-700 dark:bg-stone-800 dark:text-stone-200">{seedanceReferenceLabel("audio", index)}</span>
                                                <span className="truncate">{item.name}</span>
                                            </div>
                                            <audio src={item.url} controls className="h-7 w-full" preload="metadata" />
                                            <button type="button" className="absolute right-1 top-1 hidden size-5 items-center justify-center rounded bg-black/60 text-white group-hover:flex" onClick={() => setAudioReferences((value) => value.filter((ref) => ref.id !== item.id))} aria-label="移除参考音频">
                                                <Trash2 className="size-3" />
                                            </button>
                                        </div>
                                    ))}
                                </ReferenceSection>

                                <div className="hidden sm:block">
                                    <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                                </div>
                            </div>

                            <div className="mt-auto pt-4">
                                <div className="mb-2 flex items-center justify-between text-xs text-stone-500">
                                    <span>{modelOptionLabel(effectiveConfig, model)} · {normalizeResolution(effectiveConfig.vquality)}p · {videoSizeLabel(effectiveConfig.size)} · {normalizeVideoSeconds(effectiveConfig.videoSeconds)}s</span>
                                    <span>{formatDuration(elapsedMs)}</span>
                                </div>
                                <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} disabled={!canGenerate} onClick={() => void generate()}>
                                    开始生成{creditCost != null ? `（${creditCost} 积分）` : ""}
                                </Button>
                                <Button className="mt-2" size="small" block icon={<Plus className="size-3.5" />} onClick={resetSession}>
                                    新建会话
                                </Button>
                            </div>
                        </aside>

                        <section className="thin-scrollbar overflow-hidden rounded-lg border border-stone-200 bg-card shadow-sm dark:border-stone-800">
                            <GenerationFeed sessions={sessions} loading={historyLoading} mediaType="video" onRetry={handleRetry} onDelete={deleteSession} onRemoveResult={removeResultUrl} onReuse={handleReuse} />
                        </section>
                    </main>
                </div>
            </PageContainer>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer title="参数" placement="bottom" height="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-3 pb-4">
                    <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
        </div>
    );
}

function ReferenceSection({
    title,
    type,
    target,
    onDragEnter,
    onDragLeave,
    onDrop,
    onUpload,
    onClipboard,
    children,
}: {
    title: string;
    type: "image" | "video" | "audio";
    target: string | null;
    onDragEnter: (event: DragEvent<HTMLDivElement>, target: "image" | "video" | "audio") => void;
    onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
    onDrop: (event: DragEvent<HTMLDivElement>) => void;
    onUpload: () => void;
    onClipboard?: () => void;
    children: React.ReactNode;
}) {
    const emptyText = {
        image: target === "image" ? "松开即可上传参考资产" : "暂无参考图，可拖入文件，最多 9 张",
        video: target === "video" ? "松开即可上传参考资产" : "暂无参考视频，可拖入文件，最多 3 个",
        audio: target === "audio" ? "松开即可上传参考资产" : "暂无参考音频，可拖入文件，最多 3 个，mp3/wav，单个 15MB 内",
    }[type];

    return (
        <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">{title}</span>
                <div className="flex gap-2">
                    {onClipboard ? (
                        <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={onClipboard}>
                            剪切板
                        </Button>
                    ) : null}
                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={onUpload}>
                        上传
                    </Button>
                </div>
            </div>
            <div
                className={`hover-scrollbar hover-scrollbar-hint flex min-h-20 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain transition-colors ${target === type ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700"}`}
                onDragEnter={(event) => onDragEnter(event, type)}
                onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                }}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
            >
                {children}
                {!children || (Array.isArray(children) && children.length === 0) ? <div className="flex min-w-full items-center justify-center text-xs text-stone-500">{emptyText}</div> : null}
            </div>
        </div>
    );
}

function GenerationSettings({ config, model, updateConfig, openConfigDialog }: { config: AiConfig; model: string; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">模型</span>
                <ModelPicker config={config} value={model} onChange={(value) => updateConfig("videoModel", value)} capability="video" fullWidth onMissingConfig={() => openConfigDialog(false)} />
            </label>
            <div className="col-span-2">
                <VideoSettingsPanel config={config} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" />
            </div>
        </>
    );
}

function isSupportedAudioFile(file: File) {
    return file.type === "audio/mpeg" || file.type === "audio/mp3" || file.type === "audio/wav" || file.type === "audio/x-wav" || /\.(mp3|wav)$/i.test(file.name);
}

function filterAudioReferencesByDuration(existing: ReferenceAudio[], next: ReferenceAudio[], warn: (content: string) => void) {
    let total = existing.reduce((sum, item) => sum + (item.durationMs || 0), 0);
    const accepted: ReferenceAudio[] = [];
    let skipped = false;
    for (const item of next) {
        if (item.durationMs && (item.durationMs < 2000 || item.durationMs > 15000)) {
            skipped = true;
            continue;
        }
        if (item.durationMs && total + item.durationMs > 15000) {
            skipped = true;
            continue;
        }
        total += item.durationMs || 0;
        accepted.push(item);
    }
    if (skipped) warn("已忽略不符合时长要求的参考音频：单个 2-15 秒，总时长不超过 15 秒");
    return accepted;
}

function buildVideoConfig(config: AiConfig, model: string): AiConfig {
    const metaso = isMetasoVideoConfig({ ...config, model });
    if (metaso) {
        return {
            ...config,
            model,
            videoModel: model,
            size: normalizeMetasoRatio(config.size),
            videoSeconds: String(normalizeMetasoDuration(config.videoSeconds)),
            vquality: normalizeMetasoResolution(config.vquality),
            videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, true)),
            videoWatermark: String(boolConfig(config.videoWatermark, false)),
        };
    }
    const seedance = isSeedanceVideoConfig({ ...config, model });
    return {
        ...config,
        model,
        videoModel: model,
        size: seedance ? normalizeSeedanceRatio(config.size) : normalizeVideoSize(config.size),
        videoSeconds: normalizeVideoSeconds(config.videoSeconds),
        vquality: normalizeResolution(config.vquality),
        videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, true)),
        videoWatermark: String(boolConfig(config.videoWatermark, false)),
    };
}

function normalizeVideoSeconds(value: string) {
    if (String(value).trim() === "-1") return "-1";
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeVideoSize(value: string) {
    return normalizeVideoSizeValue(value);
}

function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}

function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
