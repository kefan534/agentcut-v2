import { BookOpen, ClipboardPaste, FolderPlus, History as HistoryIcon, Plus, SlidersHorizontal, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import { App, Button, Drawer, Input, Modal, Select } from "antd";
import { Link } from "react-router-dom";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { GenerationFeed } from "@/components/generation-chat";
import { PageContainer } from "@/components/layout/page-container";
import { canvasThemes } from "@/lib/canvas-theme";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { imageCapabilitiesFor } from "@/lib/image-model-capabilities";
import { modelOptionLabel, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { nanoid } from "nanoid";
import { formatDuration, getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { uploadImage } from "@/services/image-storage";
import { useUserStore } from "@/stores/use-user-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { useGenerationHistory, type ChatMedia, type ChatMessage } from "@/hooks/use-generation-history";
import { quoteCredits, type GenerationSession } from "@/services/api/backend";
import type { ReferenceImage } from "@/types/image";

type GeneratedImage = {
    id: string;
    dataUrl: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
};

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

export default function ImagePage() {
    const { message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const config = useConfigStore((state) => state.config);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isAuthenticated = useUserStore((state) => state.isAuthenticated);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [running, setRunning] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const imageCommand = useWorkbenchAgentStore((state) => state.imageCommand);
    const clearImageCommand = useWorkbenchAgentStore((state) => state.clearImageCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);

    const { sessions, messages, loading: historyLoading, createSession, updateSession, deleteSession, removeResultUrl, load } = useGenerationHistory("image");
    const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);

    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const canGenerate = Boolean(prompt.trim());
    // —— 左栏联动：模型 → 输入模态 → 参考图显隐（对齐视频创作台机制）
    const [modality, setModality] = useState<"text" | "reference">("text");
    const imageCaps = imageCapabilitiesFor(effectiveConfig, model);
    useEffect(() => {
        setReferences((value) => value.slice(0, imageCaps.refMax));
    }, [imageCaps.refMax]);

    /** 上传单张图片并加入参考图列表 */
    const addSingleImageReference = async (blob: Blob, name: string): Promise<boolean> => {
        if (references.length >= imageCaps.refMax) {
            message.warning(`参考图最多 ${imageCaps.refMax} 张`);
            return false;
        }
        const image = await uploadImage(blob);
        setReferences((value) => [...value, { id: nanoid(), name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey }]);
        return true;
    };

    /** 提示词框内 Ctrl/Cmd+V 粘贴图片：自动切参考生成 + 加参考图 */
    const handlePromptPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
        const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));
        if (!files.length) return;
        event.preventDefault();
        void (async () => {
            if (modality !== "reference") setModality("reference");
            let added = 0;
            for (const file of files) {
                const ok = await addSingleImageReference(file, file.name || `clipboard-${Date.now()}.png`);
                if (ok) added += 1;
            }
            if (added) message.success(`已添加 ${added} 张参考图（参考生成模式）`);
        })();
    };
    const generationCount = Math.max(1, Math.min(10, Number(config.count) || 1));

    // 生成按钮积分预览
    const [creditCost, setCreditCost] = useState<number | null>(null);
    useEffect(() => {
        let cancelled = false;
        if (!model) { setCreditCost(null); return; }
        quoteCredits(model, { size: config.size, quality: config.quality, count: config.count, resolution: config.resolution }, "image")
            .then((c) => { if (!cancelled) setCreditCost(c); })
            .catch(() => { if (!cancelled) setCreditCost(null); });
        return () => { cancelled = true; };
    }, [model, config.size, config.quality, config.count, config.resolution]);

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    // 从 /history 页面跳转过来时，载入复用的提示词
    useEffect(() => {
        const reusePrompt = sessionStorage.getItem("agentcut:reuse-prompt");
        const reuseSource = sessionStorage.getItem("agentcut:reuse-source");
        if (reusePrompt && reuseSource === "image") {
            setPrompt(reusePrompt);
            sessionStorage.removeItem("agentcut:reuse-prompt");
            sessionStorage.removeItem("agentcut:reuse-source");
        }
    }, []);

    const addReferences = async (files?: FileList | null) => {
        const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/")).slice(0, imageCaps.refMax - references.length);
        if (imageFiles.length < Array.from(files || []).filter((file) => file.type.startsWith("image/")).length) {
            message.warning(`参考图最多 ${imageCaps.refMax} 张，超出部分已忽略`);
        }
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file);
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        setReferences((value) => [...value, ...nextReferences]);
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
                blobs.map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences]);
            message.success(`已读取 ${nextReferences.length} 张参考图`);
        } catch {
            message.error("剪切板里没有可读取的图片");
        }
    };

    const generate = async () => {
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const text = prompt.trim();
        if (!text) {
            message.error("请输入生图提示词");
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: "请输入生图提示词" });
            return;
        }
        if (!isAuthenticated) {
            message.warning("请先登录");
            const current = window.location.pathname + window.location.search;
            window.location.href = `/login?redirect=${encodeURIComponent(current)}`;
            return;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("暂无可用模型，请先在管理后台添加变量映射");
            return;
        }

        // P0-1: 生成前余额拦截 + 确认弹窗（agent 自动触发时跳过弹窗）
        if (!agentTaskId) {
            const balance = useUserStore.getState().user?.credits ?? 0;
            let cost = creditCost;
            if (cost == null) {
                try {
                    cost = await quoteCredits(model, { size: config.size, quality: config.quality, count: config.count, resolution: config.resolution }, "image");
                } catch {
                    cost = 0;
                }
            }
            if (cost && balance < cost) {
                message.error(`积分不足，本次生图约需 ${cost} credits，当前余额 ${balance}。请先获取积分后再生成。`);
                return;
            }
            const confirmed = await new Promise<boolean>((resolve) => {
                Modal.confirm({
                    title: "确认生成",
                    content: `本次生图约消耗 ${cost ?? 0} credits，当前余额 ${balance}。确认生成？`,
                    okText: "确认生成",
                    cancelText: "取消",
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            });
            if (!confirmed) return;
        }

        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: "生图参数无效" });
            return;
        }

        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);

        const taskType: "text" | "reference" = references.length > 0 ? "reference" : "text";
        const referenceUrls = references.map((ref) => ref.url || ref.dataUrl);
        const sessionId = await createSession(text, model, taskType, referenceUrls);

        try {
            const tasks = Array.from({ length: generationCount }, (_, index) => runGenerationSlot(index, snapshot));
            const result = await Promise.allSettled(tasks);
            const successImages = result.filter((item): item is PromiseFulfilledResult<GeneratedImage> => item.status === "fulfilled").map((item) => item.value);
            const successCount = successImages.length;
            const failCount = generationCount - successCount;
            const failed = result.find((item): item is PromiseRejectedResult => item.status === "rejected");
            const error = failed?.reason instanceof Error ? failed.reason.message : failCount ? "生成失败" : undefined;
            if (agentTaskId) updateAgentTask(agentTaskId, { status: successCount ? "succeeded" : "failed", successCount, failCount, error: successCount ? undefined : error });

            if (successCount === 0) {
                await updateSession(sessionId, "failed", [], error);
                message.error(error || "生成失败");
                return;
            }

            // Upload generated images to backend storage so URLs are stable.
            const logImages = await Promise.all(
                successImages.map(async (image) => {
                    const stored = await uploadImage(image.dataUrl);
                    return { ...image, dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType };
                }),
            );

            const media: ChatMedia[] = logImages.map((image) => ({
                id: image.id,
                url: image.dataUrl,
                mimeType: image.mimeType,
                width: image.width,
                height: image.height,
                bytes: image.bytes,
            }));

            await updateSession(sessionId, "success", media);
            message.success("图片已生成");
        } catch (e) {
            const error = e instanceof Error ? e.message : "生成失败";
            console.error("[image/generate] failed", e);
            await updateSession(sessionId, "failed", [], error);
            message.error(error);
        } finally {
            setRunning(false);
        }
    };

    // 响应 Agent 面板下发的生图命令：填入提示词，并按需自动触发生成。
    useEffect(() => {
        if (!imageCommand || imageCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = imageCommand.nonce;
        clearImageCommand();
        if (typeof imageCommand.prompt === "string") setPrompt(imageCommand.prompt);
        if (imageCommand.run && running) {
            if (imageCommand.taskId) updateAgentTask(imageCommand.taskId, { status: "failed", error: "生图工作台已有任务正在运行" });
            return;
        }
        if (imageCommand.run) {
            agentTaskIdRef.current = imageCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [imageCommand, clearImageCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        } else {
            message.warning("生图工作台只能使用文本或图片资产");
        }
        setAssetPickerOpen(false);
    };

    const resetSession = () => {
        setPrompt("");
        setReferences([]);
        setElapsedMs(0);
        setStartedAt(0);
        setSelectedSessionId(undefined);
    };

    const selectSession = (session: GenerationSession) => {
        setSelectedSessionId(session.id);
        setPrompt(session.prompt);
    };

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error("请输入生图提示词");
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("请先完成配置");
            openConfigDialog(true);
            return null;
        }
        return { text, config: { ...effectiveConfig, model, count: "1" }, references: [...references] };
    };

    const runGenerationSlot = async (index: number, snapshot: { text: string; config: AiConfig; references: ReferenceImage[] }) => {
        const itemStartedAt = performance.now();
        try {
            const result = snapshot.references.length ? await requestEdit(snapshot.config, snapshot.text, snapshot.references) : await requestGeneration(snapshot.config, snapshot.text);
            const image = result[0];
            if (!image) throw new Error("接口没有返回图片");
            const meta = await readImageMeta(image.dataUrl);
            const nextImage = { id: image.id, dataUrl: image.dataUrl, durationMs: performance.now() - itemStartedAt, width: meta.width, height: meta.height, bytes: getDataUrlByteSize(image.dataUrl) };
            return nextImage;
        } catch (error) {
            throw error;
        }
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

    return (
        <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <PageContainer>
                <div className="flex h-full min-h-0 flex-col gap-4 py-4">
                    <header className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <h1 className="text-xl font-semibold text-stone-950 dark:text-stone-100">生图工作台</h1>
                            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">描述画面主体、风格、构图、光线和用途</p>
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
                                <label className="block">
                                    <span className="mb-1.5 block text-sm font-semibold">模型</span>
                                    <ModelPicker config={effectiveConfig} value={model} onChange={(value) => updateConfig("imageModel", value)} capability="image" fullWidth onMissingConfig={() => openConfigDialog(false)} />
                                </label>

                                <label className="block">
                                    <span className="mb-1.5 block text-sm font-semibold">输入模态</span>
                                    <Select
                                        value={modality}
                                        onChange={(value) => setModality(value as "text" | "reference")}
                                        options={[
                                            { value: "text", label: "文生图" },
                                            { value: "reference", label: "参考生成" },
                                        ]}
                                        className="w-full"
                                    />
                                </label>

                                {modality === "reference" ? <div className="min-w-0">
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                        <span className="text-sm font-semibold">参考图</span>
                                        <div className="flex gap-2">
                                            <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                                剪切板
                                            </Button>
                                            <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                                上传
                                            </Button>
                                        </div>
                                    </div>
                                    <div
                                        className={`hover-scrollbar hover-scrollbar-hint relative flex min-h-20 w-full min-w-0 max-w-full gap-2 overflow-x-scroll overflow-y-hidden rounded-lg border border-dashed p-2 pb-3 overscroll-x-contain transition-colors ${isReferenceDragActive ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700"}`}
                                        onDragEnter={(event) => {
                                            event.preventDefault();
                                            dragDepthRef.current += 1;
                                            if (event.dataTransfer.types.includes("Files")) setIsReferenceDragActive(true);
                                        }}
                                        onDragOver={(event) => {
                                            event.preventDefault();
                                            event.dataTransfer.dropEffect = "copy";
                                        }}
                                        onDragLeave={(event) => {
                                            event.preventDefault();
                                            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                                            if (!dragDepthRef.current) setIsReferenceDragActive(false);
                                        }}
                                        onDrop={(event) => {
                                            event.preventDefault();
                                            dragDepthRef.current = 0;
                                            setIsReferenceDragActive(false);
                                            void addReferences(event.dataTransfer.files);
                                        }}
                                        onWheel={(event) => {
                                            if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
                                            event.preventDefault();
                                            event.currentTarget.scrollLeft += event.deltaY;
                                        }}
                                    >
                                        {references.map((item, index) => (
                                            <div key={item.id} className="group relative size-16 shrink-0 overflow-hidden rounded-md border border-stone-200 dark:border-stone-800">
                                                <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                                <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-medium text-white">{imageReferenceLabel(index)}</span>
                                                <button
                                                    type="button"
                                                    className="absolute right-1 top-1 hidden size-5 items-center justify-center rounded bg-black/60 text-white group-hover:flex"
                                                    onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))}
                                                    aria-label="移除参考图"
                                                >
                                                    <Trash2 className="size-3" />
                                                </button>
                                            </div>
                                        ))}
                                        {!references.length ? <div className="flex min-w-full items-center justify-center text-xs text-stone-500">暂无参考图，可将图片拖到这里，也可在提示词框 Ctrl+V 粘贴</div> : null}
                                    </div>
                                </div> : null}

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
                                    <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} onPaste={handlePromptPaste} rows={5} maxLength={20000} showCount placeholder="描述画面主体、风格、构图、光线和用途。参考生成模式下可直接 Ctrl+V 粘贴图片" />
                                </div>

                                <div className="hidden sm:block">
                                    <ImageSettingsPanel config={effectiveConfig} model={model} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" maxCount={10} />
                                </div>
                            </div>

                            <div className="mt-auto pt-4">
                                <div className="mb-2 flex items-center justify-between text-xs text-stone-500">
                                    <span>{modelOptionLabel(effectiveConfig, model)}</span>
                                    <span>{formatDuration(elapsedMs)}</span>
                                </div>
                                <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running} onClick={() => void generate()}>
                                    开始生成{creditCost != null ? `（${creditCost} 积分）` : ""}
                                </Button>
                                <Button className="mt-2" size="small" block icon={<Plus className="size-3.5" />} onClick={resetSession}>
                                    新建会话
                                </Button>
                            </div>
                        </aside>

                        <section className="thin-scrollbar overflow-hidden rounded-lg border border-stone-200 bg-card shadow-sm dark:border-stone-800">
                            <GenerationFeed sessions={sessions} loading={historyLoading} mediaType="image" onRetry={handleRetry} onDelete={deleteSession} onRemoveResult={removeResultUrl} onReuse={handleReuse} />
                        </section>
                    </main>
                </div>
            </PageContainer>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer title="参数" placement="bottom" size="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-3 pb-4">
                    <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
        </div>
    );
}

function GenerationSettings({ config, model, updateConfig, openConfigDialog }: { config: AiConfig; model: string; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">模型</span>
                <ModelPicker config={config} value={model} onChange={(value) => updateConfig("imageModel", value)} capability="image" fullWidth onMissingConfig={() => openConfigDialog(false)} />
            </label>
            <div className="col-span-2">
                <ImageSettingsPanel config={config} model={model} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-4" maxCount={10} />
            </div>
        </>
    );
}

// Minimal drag-active state helper; full drag logic is inline in the drop zone.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const setIsReferenceDragActive = (active: boolean) => {
    // Placeholder to satisfy the onDragLeave call; visual drag state removed for simplicity.
    void active;
};
