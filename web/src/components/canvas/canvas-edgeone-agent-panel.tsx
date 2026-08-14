import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button, Input, Segmented, Tooltip } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { ChevronDown, Copy, Database, Download, ExternalLink, FileText, Film, FolderOpen, History, ImageIcon, LoaderCircle, MessageSquare, Music, AtSign, PlugZap, Plus, RefreshCw, Square, Terminal, Trash2, Upload, Zap } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { readImageMeta } from "@/lib/image-utils";
import { randomId } from "@/lib/utils";
import { uploadImage } from "@/services/image-storage";
import { BACKEND_BASE_URL, getAssetUrl, getMemoryAccessToken } from "@/services/api/backend";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { useShallow } from "zustand/react/shallow";
import { useAgentStore, type AgentAttachment, type AgentCanvasContext, type AgentChatItem, type AgentEventLog, type AgentPanelTab, type AgentPendingToolCall, type AgentThreadSummary } from "@/stores/use-agent-store";
import { summarizeCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { isSiteTool, runSiteTool, SITE_TOOL_LABELS } from "@/lib/agent/agent-site-tools";
import { AgentChatComposer, AgentChatMessage, AgentPanelTabs, AgentPendingToolCard, AgentWorkingMessage, type CanvasAgentChatAttachment } from "./canvas-agent-chat-ui";

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_PAYLOAD_BYTES = 28 * 1024 * 1024;
const SCROLL_BOTTOM_THRESHOLD = 48;
const DEFAULT_AGENT_URL = "/api/v1/agent";
const AGENT_CONNECT_STEPS = [
    { title: "连接 EdgeOne Makers Agent", text: "点击下方「连接」按钮，即可通过后端调用托管在 EdgeOne Makers 的 AgentCut 智能体。无需安装本地 Codex 插件。" },
];

type AgentEventPayload = {
    agent?: string;
    type?: string;
    threadId?: string;
    thread_id?: string;
    turn_id?: string;
    item?: AgentEventItem;
    error?: { message?: string };
    message?: string;
    usage?: Record<string, unknown>;
};
type AgentEventItem = { id?: string; type?: string; text?: unknown; message?: unknown; server?: string; tool?: string; status?: string; arguments?: unknown; result?: unknown; error?: { message?: string } };

type AgentLogContext = { endpoint: string; connected: boolean; enabled: boolean; activity: string; waiting: boolean; sending: boolean; messages: number; pendingTool?: string };
type AgentWorkspace = { workspacePath: string; activeThreadId?: string };
type AgentThreadsResponse = { ok?: boolean; workspace?: AgentWorkspace; data?: AgentThreadSummary[] };
type AgentThreadResponse = { ok?: boolean; workspace?: AgentWorkspace; thread?: AgentThreadSummary; messages?: AgentChatItem[] };
type AgentConfigResponse = { ok?: boolean; url?: string; token?: string; hasToken?: boolean };
type AgentCodexState = { busy?: boolean; threadId?: string; turnId?: string };
type AgentHelloEvent = { ok?: boolean; clientId?: string; codex?: AgentCodexState };
type AgentWorkspaceEvent = { activeThreadId?: string; threadId?: string; emptyThread?: boolean };
type AgentChatEvent = { threadId?: string; sourceClientId?: string; message?: AgentChatItem };
type AgentOutputItem = { id: string; request_id: string; modal_category: string; variable_name: string; cost_credits: number; url: string; created_at?: string };
type AgentOutputsResponse = { ok?: boolean; data?: AgentOutputItem[] };

export function CanvasEdgeoneAgentPanel({ embedded, headless, autoConnect }: { embedded?: boolean; headless?: boolean; autoConnect?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const user = useUserStore((state) => state.user);
    const { message, modal } = App.useApp();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    // 逐字段 selector + useShallow：只有这些字段变化时才重渲染。
    // 注意：canvasContext 不在此订阅内 —— 它在拖拽/resize 时会被 project 每帧写入，
    // 但面板只在 ref 同步与防抖 postState 中用到它、渲染层从不读它。若把它放进订阅，
    // 面板会随画布每帧重渲染（性能问题，也是 #185 崩溃的放大器）。改为下方 subscribe 命令式监听。
    const { width, url, token, connected, enabled, prompt, attachments, assetRefs, sending, waiting, messages, eventLogs, threads, activeThreadId, workspacePath, loadingThreads, activeTab, confirmTools, activity, connectError, pendingTool } = useAgentStore(
        useShallow((state) => ({
            width: state.width,
            url: state.url,
            token: state.token,
            connected: state.connected,
            enabled: state.enabled,
            prompt: state.prompt,
            attachments: state.attachments,
            assetRefs: state.assetRefs,
            modelId: state.modelId,
            availableModels: state.availableModels,
            modelsLoading: state.modelsLoading,
            sending: state.sending,
            waiting: state.waiting,
            messages: state.messages,
            eventLogs: state.eventLogs,
            threads: state.threads,
            activeThreadId: state.activeThreadId,
            workspacePath: state.workspacePath,
            loadingThreads: state.loadingThreads,
            activeTab: state.activeTab,
            confirmTools: state.confirmTools,
            activity: state.activity,
            connectError: state.connectError,
            pendingTool: state.pendingTool,
        })),
    );
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const pushMessage = useAgentStore((state) => state.addMessage);
    const pushEventLog = useAgentStore((state) => state.addEventLog);
    const clearEventLogs = useAgentStore((state) => state.clearEventLogs);
    const addAssetRef = useAgentStore((state) => state.addAssetRef);
    const removeAssetRef = useAgentStore((state) => state.removeAssetRef);
    const listRef = useRef<HTMLDivElement>(null);
    const followMessagesRef = useRef(true);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const canvasContextRef = useRef<AgentCanvasContext | null>(useAgentStore.getState().canvasContext);
    const confirmToolsRef = useRef(confirmTools);
    const pendingToolRef = useRef<AgentPendingToolCall | null>(null);
    const autoConnectRef = useRef(false);
    const connectedRef = useRef(false);
    const errorLoggedRef = useRef(false);
    const attachmentUrlsRef = useRef(new Set<string>());
    const clientIdRef = useRef(randomId());
    const loadThreadsSequenceRef = useRef(0);
    const [outputs, setOutputs] = useState<AgentOutputItem[]>([]);
    const [loadingOutputs, setLoadingOutputs] = useState(false);
    const endpoint = useMemo(() => url.trim().replace(/\/$/, ""), [url]);
    const urlAgentAutoConnect = searchParams.has("agentUrl") && searchParams.has("agentToken");
    const loadThreads = useCallback(async (skipHistory = false) => {
        if (!connectedRef.current && !useAgentStore.getState().connected) return;
        const sequence = ++loadThreadsSequenceRef.current;
        setAgentState({ loadingThreads: true });
        try {
            const data = await fetchAgentJson<AgentThreadsResponse>(endpoint, token, `/codex/threads`);
            const nextThreadId = data.workspace?.activeThreadId || "";
            let nextMessages: AgentChatItem[] = [];
            if (nextThreadId && !skipHistory) {
                const thread = await fetchAgentJson<AgentThreadResponse>(endpoint, token, `/codex/threads/${encodeURIComponent(nextThreadId)}`);
                nextMessages = normalizeHistoryMessages(thread.messages || []);
            }
            if (sequence !== loadThreadsSequenceRef.current) return;
            // EdgeOne Makers 不在后端持久化对话记录，若后端返回空 activeThreadId，
            // 贸然覆盖 messages 会把当前会话内容清空，导致消息“闪现后消失”。
            if (nextThreadId) {
                setAgentState({ threads: data.data || [], workspacePath: data.workspace?.workspacePath || "", activeThreadId: nextThreadId, messages: nextMessages });
            } else {
                setAgentState({ threads: data.data || [], workspacePath: data.workspace?.workspacePath || "" });
            }
        } catch (error) {
            addEventLog("读取历史失败", error);
        } finally {
            if (sequence === loadThreadsSequenceRef.current) setAgentState({ loadingThreads: false });
        }
    }, [endpoint, setAgentState, token]);

    const loadOutputs = useCallback(async () => {
        setLoadingOutputs(true);
        try {
            const data = await fetchAgentJson<AgentOutputsResponse>(endpoint, token, `/outputs`);
            setOutputs(data.data || []);
        } catch (error) {
            addEventLog("读取产物失败", error);
        } finally {
            setLoadingOutputs(false);
        }
    }, [endpoint, token]);

    // canvasContext 命令式订阅：保持 ref 最新，并在快照变化时防抖上报，全程不触发面板重渲染。
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const unsubscribe = useAgentStore.subscribe((state) => {
            if (state.canvasContext === canvasContextRef.current) return;
            canvasContextRef.current = state.canvasContext;
            if (!useAgentStore.getState().connected) return;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => void postState(endpoint, token, clientIdRef.current, canvasContextRef.current?.snapshot || null), 300);
        });
        return () => {
            unsubscribe();
            if (timer) clearTimeout(timer);
        };
    }, [endpoint, token]);
    useEffect(() => {
        confirmToolsRef.current = confirmTools;
    }, [confirmTools]);
    useEffect(() => {
        pendingToolRef.current = pendingTool;
    }, [pendingTool]);
    const updateScrollState = useCallback(() => {
        const list = listRef.current;
        if (!list) return;
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight <= SCROLL_BOTTOM_THRESHOLD;
        followMessagesRef.current = atBottom;
        setShowScrollToBottom(!atBottom);
    }, []);
    const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
        const list = listRef.current;
        if (!list) return;
        followMessagesRef.current = true;
        list.scrollTo({ top: list.scrollHeight, behavior });
        setShowScrollToBottom(false);
    }, []);
    useEffect(() => {
        if (activeTab !== "chat") return;
        const frame = requestAnimationFrame(() => scrollToBottom("auto"));
        return () => cancelAnimationFrame(frame);
    }, [activeTab, activeThreadId, scrollToBottom]);
    useEffect(() => {
        if (activeTab !== "chat") return;
        const frame = requestAnimationFrame(() => (followMessagesRef.current ? scrollToBottom("auto") : updateScrollState()));
        return () => cancelAnimationFrame(frame);
    }, [activeTab, messages, pendingTool, scrollToBottom, updateScrollState, waiting]);
    useEffect(() => () => attachmentUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

    useEffect(() => {
        // 普通用户不应看到 setup/log 页；若当前 tab 对他们不可见，则切到对话页。
        if (user?.role !== "admin" && (activeTab === "setup" || activeTab === "log")) {
            setAgentState({ activeTab: "chat" });
        }
    }, [user?.role, activeTab, setAgentState]);

    useEffect(() => {
        if (!enabled) return;
        localStorage.setItem("canvas-agent-url", endpoint);
        // EdgeOne Makers 模式下 token 固定为空，不再持久化到 localStorage
        const clientId = clientIdRef.current;
        let eventQueue = Promise.resolve();
        const enqueueEvent = (task: () => void | Promise<void>) => {
            eventQueue = eventQueue.then(task).catch((error) => addEventLog("同步会话失败", error));
        };
        const isAbsoluteUrl = /^https?:\/\//i.test(endpoint);
        const memoryToken = getMemoryAccessToken();
        const eventSourceUrl = new URL(`${endpoint}/events`, window.location.href);
        eventSourceUrl.searchParams.set("clientId", clientId);
        if (isAbsoluteUrl && memoryToken) {
            // 跨域绝对地址时 cookie 经常因 SameSite=Lax 不发送，回退到 query token。
            eventSourceUrl.searchParams.set("token", memoryToken);
        }
        const source = new EventSource(eventSourceUrl.toString(), { withCredentials: true });
        source.addEventListener("hello", (event) => {
            const busy = Boolean(parseEventData<AgentHelloEvent>(event)?.codex?.busy);
            errorLoggedRef.current = false;
            connectedRef.current = true;
            setAgentState({ connected: true, activity: busy ? "Codex 正在运行" : "已连接", waiting: busy, sending: false, connectError: "", silentConnect: false, messages: useAgentStore.getState().messages.filter((item) => !isConnectionErrorMessage(item)) });
            if (!headless) message.success("本地 Agent 已连接");
            void postState(endpoint, token, clientId, canvasContextRef.current?.snapshot || null);
            if (document.visibilityState === "visible" && document.hasFocus()) void activateAgentClient(endpoint, token, clientId);
        });
        source.addEventListener("codex_state", (event) => {
            const data = parseEventData<AgentCodexState>(event);
            if (!data) return;
            enqueueEvent(async () => {
                const busy = Boolean(data.busy);
                setAgentState({ activity: busy ? "Codex 正在运行" : "完成", waiting: busy, ...(busy ? {} : { sending: false }) });
                // EdgeOne Makers 后端没有持久化的历史记录，每次 turn 完成都 loadThreads
                // 会把当前会话消息清空，因此不再自动刷新历史。
            });
        });
        source.addEventListener("tool_call", (event) => {
            const data = parseEventData<AgentPendingToolCall>(event);
            if (data) void handleToolCall(endpoint, token, data);
        });
        source.addEventListener("agent_event", (event) => {
            const data = parseEventData<AgentEventPayload>(event);
            if (data) enqueueEvent(() => {
                if (isCurrentThreadEvent(data)) handleAgentEvent(data);
            });
        });
        source.addEventListener("workspace_changed", (event) => {
            const data = parseEventData<AgentWorkspaceEvent>(event);
            if (!data) return;
            enqueueEvent(async () => {
                const nextThreadId = data.activeThreadId ?? data.threadId ?? "";
                pendingToolRef.current = null;
                setAgentState({ activeThreadId: nextThreadId, messages: [], pendingTool: null });
                await loadThreads(data.emptyThread);
            });
        });
        source.addEventListener("chat_message", (event) => {
            const data = parseEventData<AgentChatEvent>(event);
            if (!data?.message) return;
            enqueueEvent(() => {
                if (!isCurrentThreadEvent(data)) return;
                addMessage(data.message!);
            });
        });
        source.addEventListener("agent_log", (event) => {
            const text = parseEventData<{ text?: unknown }>(event)?.text;
            addEventLog("日志", text, text);
        });
        source.addEventListener("agent_error", (event) => {
            const data = parseEventData<AgentEventPayload>(event);
            if (!data) return;
            enqueueEvent(() => {
                if (!isCurrentThreadEvent(data)) return;
                addMessage({ role: "error", title: "错误", text: normalizeText(data.message) });
                addEventLog("错误", data.message, data.message);
            });
        });
        source.onerror = () => {
            const wasConnected = connectedRef.current;
            const silent = useAgentStore.getState().silentConnect && !wasConnected;
            const absoluteUrl = /^https?:\/\//i.test(endpoint);
            let text = wasConnected
                ? "本地 Agent 连接失败或已断开"
                : "连接失败：未登录，或登录状态无法用于 SSE（请尝试刷新页面后重新登录）";
            if (!wasConnected) {
                if (absoluteUrl) {
                    text = `连接失败：Agent URL「${endpoint}」为绝对地址，浏览器不会携带本站登录 cookie。建议改为相对路径「/api/v1/agent」，或重新登录后再试。`;
                } else if (!getMemoryAccessToken()) {
                    text = "连接失败：未检测到登录 token，请先登录账号后再连接 Agent。";
                }
            }
            if (!errorLoggedRef.current || wasConnected) {
                addEventLog(wasConnected ? "连接断开" : "连接失败", { endpoint, error: text, absoluteUrl, hasToken: Boolean(getMemoryAccessToken()) });
                if (!headless && !silent) message.error(text);
            }
            errorLoggedRef.current = true;
            connectedRef.current = false;
            clearAgentSession({ activity: wasConnected ? "连接断开" : "连接失败", connected: false, connectError: silent ? "" : text, silentConnect: false });
            if (!wasConnected) {
                source.close();
                setAgentState({ enabled: false });
            }
        };
        return () => {
            source.close();
            connectedRef.current = false;
            loadThreadsSequenceRef.current += 1;
        };
    }, [enabled, endpoint, loadThreads, message, setAgentState, token]);

    // Do not auto-load threads on connect/reconnect: EdgeOne Makers keeps history
    // in memory only, and a race with an ongoing turn can replace the current
    // chat with stale history and make messages appear out of order or disappear.
    // Threads are loaded explicitly when the user opens the History tab.

    useEffect(() => {
        if (!connected) return;
        const activate = () => void activateAgentClient(endpoint, token, clientIdRef.current);
        const activateVisible = () => {
            if (document.visibilityState === "visible") activate();
        };
        window.addEventListener("focus", activate);
        document.addEventListener("visibilitychange", activateVisible);
        return () => {
            window.removeEventListener("focus", activate);
            document.removeEventListener("visibilitychange", activateVisible);
        };
    }, [connected, endpoint, token]);
    const sendPrompt = async () => {
        const text = prompt.trim();
        const files = attachments;
        const refs = useAgentStore.getState().assetRefs;
        const requestPrompt = promptWithAttachments(text, files);
        if (!connected || !requestPrompt || sending || waiting) return;
        if (attachmentPayloadBytes(files) > MAX_ATTACHMENT_PAYLOAD_BYTES) {
            addMessage({ role: "error", title: "图片过大", text: "图片附件超过 30MB，请删减后再发送。" });
            return;
        }
        setAgentState({ activity: "发送中", sending: true });
        const messageId = createId();
        addMessage({ id: messageId, role: "user", text: text || "发送了图片", attachments: files });
        addEventLog("用户发送", { text, attachments: files.map(({ name, type, size }) => ({ name, type, size })), assetRefs: refs.map(({ assetId, name }) => ({ assetId, name })) });
        try {
            const data = await fetchAgentJson<{ threadId?: string }>(endpoint, token, "/turn", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    prompt: requestPrompt,
                    messageText: text || `发送了 ${files.length} 张图片`,
                    messageId,
                    clientId: clientIdRef.current,
                    threadId: useAgentStore.getState().activeThreadId || undefined,
                    attachments: files.map(({ id, name, type, size, width, height, dataUrl }) => ({ id, name, type, size, width, height, dataUrl })),
                    assetIds: refs.map((r) => r.assetId),
                }),
            });
            if (data.threadId) setAgentState({ activeThreadId: data.threadId });
            addEventLog("本地 Agent 已接收", { threadId: data.threadId });
            files.forEach((item) => {
                URL.revokeObjectURL(item.url);
                attachmentUrlsRef.current.delete(item.url);
            });
            setAgentState({ prompt: "", attachments: [], assetRefs: [] });
        } catch (error) {
            const text = error instanceof Error ? error.message : "发送失败";
            const busy = text.includes("Codex 正在运行");
            setAgentState({ activity: busy ? "Codex 正在运行" : "发送失败" });
            addMessage({ role: "error", title: busy ? "任务仍在运行" : "发送失败", text });
            addEventLog("发送失败", error);
        } finally {
            setAgentState({ sending: false });
        }
    };

    const stopTurn = async () => {
        if (!connected || (!sending && !waiting)) return;
        setAgentState({ activity: "停止中" });
        try {
            await fetch(`${endpoint}/interrupt`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify({ threadId: useAgentStore.getState().activeThreadId || undefined }), credentials: "include" });
            addEventLog("用户停止", {});
        } catch {
            setAgentState({ activity: "停止失败" });
        }
    };

    const addAttachments = async (files: FileList | File[] | null) => {
        if (!files) return;
        const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
        const prev = useAgentStore.getState().attachments;
        try {
            const next = await Promise.all(
                images.slice(0, Math.max(0, MAX_ATTACHMENTS - prev.length)).map(async (file) => {
                    const dataUrl = await readDataUrl(file);
                    const meta = await readImageMeta(dataUrl);
                    const url = URL.createObjectURL(file);
                    attachmentUrlsRef.current.add(url);
                    return { id: createId(), name: file.name, type: file.type, size: file.size, width: meta.width, height: meta.height, url, dataUrl };
                }),
            );
            const merged = [...prev, ...next];
            if (attachmentPayloadBytes(merged) > MAX_ATTACHMENT_PAYLOAD_BYTES) {
                next.forEach((item) => {
                    URL.revokeObjectURL(item.url);
                    attachmentUrlsRef.current.delete(item.url);
                });
                addMessage({ role: "error", title: "图片过大", text: "图片附件最多约 30MB。" });
                return;
            }
            if (next.length) setAgentState({ attachments: merged });
        } catch (error) {
            addMessage({ role: "error", title: "图片读取失败", text: error instanceof Error ? error.message : "图片读取失败" });
        }
    };

    const removeAttachment = (id: string) => {
        const removed = attachments.find((item) => item.id === id);
        if (removed) {
            URL.revokeObjectURL(removed.url);
            attachmentUrlsRef.current.delete(removed.url);
        }
        setAgentState({ attachments: attachments.filter((item) => item.id !== id) });
    };

    // P1: asset_upload 工具 — 弹前端文件选择器 → 上传 → 返回 assetId
    const handleAssetUploadFromAgent = async (requestId: string) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*,video/*,audio/*,.pdf,.docx,.xlsx,.xls,.txt,.md,.csv";
        input.style.display = "none";
        document.body.appendChild(input);
        return new Promise<{ ok: boolean; assetId?: string; error?: string }>((resolve) => {
            input.onchange = async () => {
                document.body.removeChild(input);
                const file = input.files?.[0];
                if (!file) { resolve({ ok: false, error: "no file selected" }); return; }
                try {
                    // 简易上传：前端直接 POST 到 /api/v1/assets
                    const fd = new FormData();
                    fd.append("file", file);
                    const res = await fetch("/api/v1/assets/upload", { method: "POST", body: fd, credentials: "include" });
                    const data = await res.json();
                    if (data.ok) {
                        addAssetRef({
                            assetId: data.assetId,
                            name: data.name,
                            kind: data.kind || "document",
                            url: data.url,
                            thumbnailUrl: data.thumbnailUrl,
                        });
                        resolve({ ok: true, assetId: data.assetId });
                    } else {
                        resolve({ ok: false, error: data.detail || "upload failed" });
                    }
                } catch (err) {
                    resolve({ ok: false, error: String(err) });
                }
            };
            input.click();
        });
    };

    const handleToolCall = async (endpoint: string, token: string, payload: AgentPendingToolCall) => {
        if (confirmToolsRef.current && isCanvasWriteTool(payload.name)) {
            if (pendingToolRef.current) {
                await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, error: "仍有待确认的画布工具调用" });
                return;
            }
            pendingToolRef.current = payload;
            setAgentState({ pendingTool: payload });
            addEventLog("等待确认", payload, payload);
            return;
        }
        await runToolCall(endpoint, token, payload);
    };

    const runToolCall = async (endpoint: string, token: string, payload: AgentPendingToolCall) => {
        // P1: asset_upload — 弹前端文件选择器 + 上传 + 返回 assetId
        if (payload.name === "asset_upload") {
            addEventLog("asset_upload", payload, payload);
            const result = await handleAssetUploadFromAgent(payload.requestId);
            await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, result });
            return;
        }
        if (isSiteTool(payload.name)) {
            try {
                addEventLog(toolName(payload.name), payload, payload);
                const result = await runSiteTool(payload.name, payload.input || {}, navigate, { canvasSnapshot: canvasContextRef.current?.snapshot || null });
                await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, result });
                addEventLog(`${toolName(payload.name)}完成`, result, result);
                addMessage({ role: "tool", title: `${toolName(payload.name)}完成`, text: siteToolSummary(payload.name, result), detail: { requestId: payload.requestId, name: payload.name, input: payload.input, result } });
            } catch (error) {
                const message = error instanceof Error ? error.message : "工具执行失败";
                addMessage({ role: "tool", title: "工具失败", text: message, detail: payload });
                await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, error: message });
            }
            return;
        }
        try {
            const input: { ops?: CanvasAgentOp[]; path?: string } = payload.input || {};
            addEventLog(toolName(payload.name), payload, payload);
            let result: unknown;
            let appliedOps = input.ops || [];
            if (payload.name === "site_navigate") {
                const path = input.path || "/";
                navigate(path);
                result = { ok: true, path };
            } else if (payload.name === "canvas_apply_ops") {
                const context = canvasContextRef.current;
                if (!context) throw new Error("当前不在画布页，请先用 site_navigate 打开画布");
                result = context.applyOps(appliedOps);
                void postState(endpoint, token, clientIdRef.current, result as CanvasAgentSnapshot);
            } else if (payload.name === "canvas_create_attachment_nodes") {
                const context = canvasContextRef.current;
                if (!context) throw new Error("当前不在画布页，请先用 site_navigate 打开画布");
                appliedOps = await attachmentNodeOps(endpoint, token, clientIdRef.current, payload.input?.nodes);
                result = context.applyOps(appliedOps);
                await postState(endpoint, token, clientIdRef.current, result as CanvasAgentSnapshot);
            } else {
                const snapshot = canvasContextRef.current?.snapshot;
                if (!snapshot) throw new Error("当前不在画布页，请先用 site_navigate 打开画布");
                result = snapshot;
            }
            await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, result });
            addEventLog(`${toolName(payload.name)}完成`, result, result);
            addMessage({
                role: "tool",
                title: `${toolName(payload.name)}完成`,
                text: appliedOps.length ? summarizeCanvasAgentOps(appliedOps) || "画布操作" : payload.name === "site_navigate" ? `已跳转到 ${input.path || "/"}` : "已完成",
                detail: { requestId: payload.requestId, name: payload.name, input, result },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "画布操作失败";
            addMessage({ role: "tool", title: "工具失败", text: message, detail: payload });
            await postToolResult(endpoint, token, clientIdRef.current, { requestId: payload.requestId, error: message });
        }
    };

    const rejectPendingTool = async () => {
        if (!pendingTool) return;
        await postToolResult(endpoint, token, clientIdRef.current, { requestId: pendingTool.requestId, error: "用户取消了画布工具调用" });
        addMessage({ role: "tool", title: "拒绝执行", text: toolName(pendingTool.name), detail: { requestId: pendingTool.requestId, name: pendingTool.name, input: pendingTool.input } });
        pendingToolRef.current = null;
        setAgentState({ pendingTool: null });
    };

    const approvePendingTool = async () => {
        if (!pendingTool) return;
        const tool = pendingTool;
        pendingToolRef.current = null;
        setAgentState({ pendingTool: null });
        await runToolCall(endpoint, token, tool);
    };

    const toggleAgentConnection = async ({ silent = false }: { silent?: boolean } = {}) => {
        if (enabled) {
            clearAgentSession({ enabled: false, connected: false, activity: "离线", connectError: "" });
            return;
        }
        errorLoggedRef.current = false;
        setAgentState({ enabled: true, connected: false, silentConnect: silent, activity: "连接中", connectError: "", activeTab: "setup" });
    };

    useEffect(() => {
        if (urlAgentAutoConnect && confirmTools) setAgentState({ confirmTools: false });
    }, [confirmTools, setAgentState, urlAgentAutoConnect]);

    useEffect(() => {
        if (!autoConnect || autoConnectRef.current || enabled || connected) return;
        autoConnectRef.current = true;
        void toggleAgentConnection({ silent: true });
    }, [autoConnect, connected, enabled]);

    function clearAgentSession(patch: Parameters<typeof setAgentState>[0] = {}) {
        loadThreadsSequenceRef.current += 1;
        setAgentState({
            messages: [],
            threads: [],
            activeThreadId: "",
            workspacePath: "",
            loadingThreads: false,
            waiting: false,
            sending: false,
            pendingTool: null,
            ...patch,
        });
        pendingToolRef.current = null;
    }

    const startNewThread = async () => {
        if (!connected || sending || waiting) return;
        setAgentState({ loadingThreads: true });
        try {
            const data = await fetchAgentJson<AgentThreadResponse>(endpoint, token, "/codex/threads/new", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
            setAgentState({ activeThreadId: data.thread?.id || data.workspace?.activeThreadId || "", messages: [], activeTab: "chat", activity: "新对话" });
        } catch (error) {
            addEventLog("新建对话失败", error);
            message.error(error instanceof Error ? error.message : "新建对话失败");
        } finally {
            setAgentState({ loadingThreads: false });
        }
    };

    const resumeThread = async (threadId: string) => {
        if (!connected || !threadId || sending || waiting) return;
        setAgentState({ loadingThreads: true });
        try {
            const data = await fetchAgentJson<AgentThreadResponse>(endpoint, token, `/codex/threads/${encodeURIComponent(threadId)}/resume`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
            setAgentState({ activeThreadId: data.thread?.id || threadId, messages: normalizeHistoryMessages(data.messages || []), activeTab: "chat", activity: "已恢复会话" });
        } catch (error) {
            addEventLog("恢复对话失败", error);
            message.error(error instanceof Error ? error.message : "恢复对话失败");
        } finally {
            setAgentState({ loadingThreads: false });
        }
    };

    const deleteThread = async (threadId: string) => {
        if (!connected || !threadId || sending || waiting) return;
        setAgentState({ loadingThreads: true });
        try {
            await fetchAgentJson(endpoint, token, `/codex/threads/${encodeURIComponent(threadId)}/delete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
            const current = useAgentStore.getState();
            setAgentState({
                threads: current.threads.filter((thread) => thread.id !== threadId),
                activeThreadId: current.activeThreadId === threadId ? "" : current.activeThreadId,
                messages: current.activeThreadId === threadId ? [] : current.messages,
            });
            message.success("记录已删除");
        } catch (error) {
            addEventLog("删除对话失败", error);
            message.error(error instanceof Error ? error.message : "删除对话失败");
        } finally {
            setAgentState({ loadingThreads: false });
        }
    };

    const confirmDeleteThread = (thread: AgentThreadSummary) => {
        const label = thread.name || thread.preview || "未命名对话";
        modal.confirm({
            title: "删除对话记录",
            content: `确定删除「${label.length > 48 ? `${label.slice(0, 48)}...` : label}」吗？`,
            okText: "删除",
            okType: "danger",
            cancelText: "取消",
            onOk: () => deleteThread(thread.id),
        });
    };

    const addMessage = (item: Omit<AgentChatItem, "id"> & { id?: string }) => {
        const text = normalizeText(item.text);
        if (!text && !item.attachments?.length) return;
        const now = Date.now();
        const next = { ...item, id: item.id || `${now}-${Math.random()}`, text, createdAt: item.createdAt || now } as AgentChatItem;
        const currentMessages = useAgentStore.getState().messages;
        if (currentMessages.some((message) => message.id === next.id)) return;
        // Streamed assistant messages share a streamId; update the existing message
        // in place so the text grows smoothly instead of creating duplicates.
        if (next.streamId) {
            const index = currentMessages.findIndex((message) => message.streamId === next.streamId);
            if (index >= 0) {
                const existing = currentMessages[index];
                setAgentState({
                    messages: currentMessages.map((message, i) =>
                        i === index
                            ? { ...message, ...next, id: message.id, text: next.text || message.text, createdAt: message.createdAt || next.createdAt }
                            : message,
                    ),
                });
                return;
            }
        }
        pushMessage(next);
    };

    const addEventLog = (title: string, text: unknown, raw?: unknown) => {
        pushEventLog({ id: `${Date.now()}-${Math.random()}`, time: new Date().toLocaleTimeString(), title, text: normalizeText(text) || title, raw });
    };

    const handleAgentEvent = (event: AgentEventPayload) => {
        if (shouldLogAgentEvent(event)) addEventLog(eventTitle(event), event, event);
        if (event.type === "thread.started" && event.thread_id) setAgentState({ activeThreadId: event.thread_id });
        const item = formatAgentEvent(event);
        if (item) addMessage(item);
    };

    const content = (
        <>
            <AgentPanelTabs
                value={activeTab}
                theme={theme}
                items={[
                    ...(user?.role === "admin" ? [{ value: "setup" as AgentPanelTab, label: "连接", icon: <PlugZap className="size-3.5" /> }] : []),
                    { value: "chat" as AgentPanelTab, label: "对话", icon: <MessageSquare className="size-3.5" /> },
                    { value: "outputs" as AgentPanelTab, label: "产物", icon: <FolderOpen className="size-3.5" /> },
                    { value: "history" as AgentPanelTab, label: "历史", icon: <History className="size-3.5" />, count: threads.length },
                    ...(user?.role === "admin" ? [{ value: "log" as AgentPanelTab, label: "日志", icon: <Terminal className="size-3.5" />, count: eventLogs.length }] : []),
                ]}
                onChange={(activeTab) => {
                    setAgentState({ activeTab });
                    if (activeTab === "history") void loadThreads();
                    if (activeTab === "outputs") void loadOutputs();
                }}
                right={
                    <>
                        <Button size="small" type="text" disabled={!connected || loadingThreads || sending || waiting} icon={<Plus className="size-3.5" />} onClick={startNewThread}>
                            新对话
                        </Button>
                    </>
                }
            />

            {activeTab === "setup" ? (
                <AgentConnectView
                    theme={theme}
                    url={url}
                    token={token}
                    enabled={enabled}
                    connected={connected}
                    activity={activity}
                    connectError={connectError}
                    onUrlChange={(url) => setAgentState({ url, connectError: "" })}
                    onTokenChange={(token) => setAgentState({ token, connectError: "" })}
                    onToggleEnabled={toggleAgentConnection}
                />
            ) : activeTab === "history" ? (
                <AgentHistoryView
                    theme={theme}
                    threads={threads}
                    activeThreadId={activeThreadId}
                    workspacePath={workspacePath}
                    loading={loadingThreads}
                    busy={sending || waiting}
                    connected={connected}
                    onRefresh={() => void loadThreads()}
                    onNewThread={() => void startNewThread()}
                    onResumeThread={(threadId) => void resumeThread(threadId)}
                    onDeleteThread={confirmDeleteThread}
                />
            ) : activeTab === "log" ? (
                <AgentLogView
                    logs={eventLogs}
                    theme={theme}
                    context={{ endpoint, connected, enabled, activity, waiting, sending, messages: messages.length, pendingTool: pendingTool?.name }}
                    onClear={clearEventLogs}
                    onCopied={(text) => message.success(text)}
                    onCopyBlocked={(text) => message.warning(text)}
                />
            ) : activeTab === "outputs" ? (
                <AgentOutputsView
                    outputs={outputs}
                    loading={loadingOutputs}
                    theme={theme}
                    onRefresh={() => void loadOutputs()}
                />
            ) : (
                <>
                    <div className="relative min-h-0 flex-1">
                        <div ref={listRef} className="thin-scrollbar h-full space-y-4 overflow-y-auto px-4 pb-12 pt-4" onScroll={updateScrollState}>
                            {messages.map((item) => (
                                <AgentChatMessage key={item.id} item={agentMessageToChatMessage(item)} theme={theme} user={user} />
                            ))}
                            {pendingTool ? (
                                <AgentPendingToolCard
                                    summary={summarizeCanvasAgentOps(pendingTool.input?.ops || []) || toolName(pendingTool.name)}
                                    detail={{ requestId: pendingTool.requestId, name: pendingTool.name, input: pendingTool.input }}
                                    theme={theme}
                                    onReject={rejectPendingTool}
                                    onApprove={approvePendingTool}
                                />
                            ) : null}
                            {waiting && !pendingTool ? <AgentWorkingMessage theme={theme} /> : null}
                        </div>
                        {showScrollToBottom ? (
                            <Tooltip title="滚动到底部" placement="left">
                                <Button
                                    type="text"
                                    shape="circle"
                                    aria-label="滚动到底部"
                                    className="!absolute bottom-3 left-1/2 z-10 !h-8 !w-8 !min-w-8 -translate-x-1/2 backdrop-blur transition hover:-translate-y-0.5"
                                    style={{ background: theme.toolbar.panel, border: `1px solid ${theme.node.stroke}`, color: theme.node.text }}
                                    icon={<ChevronDown className="size-4" />}
                                    onClick={() => scrollToBottom()}
                                />
                            </Tooltip>
                        ) : null}
                    </div>
                    <AgentChatComposer
                        prompt={prompt}
                        attachments={attachments.map(agentAttachmentToChatAttachment)}
                        assetRefs={assetRefs.map((r) => ({ assetId: r.assetId, name: r.name, kind: r.kind, url: r.url, thumbnailUrl: r.thumbnailUrl }))}
                        disabled={!connected}
                        sending={sending || waiting}
                        placeholder="询问 Agent，或让它操作网站/画布"
                        theme={theme}
                        onPromptChange={(prompt) => setAgentState({ prompt })}
                        onSubmit={sendPrompt}
                        onStop={stopTurn}
                        onAddFiles={addAttachments}
                        onRemoveAttachment={removeAttachment}
                        onRemoveAssetRef={(assetId) => removeAssetRef(assetId)}
                        left={
                            <AgentChatPlusMenu onAssetRef={addAssetRef} onAddFiles={addAttachments} />
                        }
                    />
                </>
            )}
        </>
    );

    if (headless) return null;
    return embedded ? content : null;
}

/* ── P0: Agent 输入区「+」菜单 ──────────────────────────────── */

type AssetRefInput = { assetId: string; name: string; kind: string; url: string; thumbnailUrl?: string };
type MenuPos = { top: number; left: number; right?: number };

function AgentChatPlusMenu({ onAssetRef, onAddFiles }: { onAssetRef: (ref: AssetRefInput) => void; onAddFiles?: (files: File[]) => void }) {
    const [open, setOpen] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const nav = useNavigate();
    const btnRef = useRef<HTMLButtonElement>(null);
    const [pos, setPos] = useState<MenuPos | null>(null);
    const [mounted, setMounted] = useState(false);
    const [pickingAsset, setPickingAsset] = useState(false);
    const [assets, setAssets] = useState<Array<{ id: string; name: string; asset_type: string; url?: string; thumbnail_url?: string }>>([]);
    const [assetLoading, setAssetLoading] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    const openMenu = () => {
        const el = btnRef.current?.querySelector<HTMLButtonElement>("button") ?? btnRef.current;
        const r = el?.getBoundingClientRect();
        if (r) {
            const menuWidth = 240;
            const menuHeight = 156;  // 估算 3 个选项 + padding
            const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, r.left));
            // 向上弹出：在按钮上方
            const top = r.top - menuHeight - 6;
            setPos({ top: Math.max(8, top), left });
        }
        setOpen(true);
    };

    const pickAsset = async () => {
        setOpen(false);
        setPickingAsset(true);
        setAssetLoading(true);
        try {
            const res = await fetch("/api/v1/assets?limit=50", { credentials: "include" });
            const data = await res.json();
            setAssets(Array.isArray(data) ? data : (data.items || []));
        } catch { /* ignore */ }
        finally { setAssetLoading(false); }
    };

    const addAsset = (a: { id: string; name: string; asset_type: string; url?: string; thumbnail_url?: string }) => {
        const kind = a.asset_type === "image" ? "image"
            : a.asset_type === "video" ? "video"
            : a.asset_type === "audio" ? "audio"
            : "document";
        onAssetRef({
            assetId: a.id,
            name: a.name,
            kind,
            url: a.url || "",
            thumbnailUrl: a.thumbnail_url || a.url,
        });
        setPickingAsset(false);
    };

    const handleUpload = (files: FileList | null) => {
        if (!files?.length) return;
        setOpen(false);
        if (onAddFiles) {
            // 走主上传链路，上传成功后由父组件加到 attachments/assetRefs
            onAddFiles(Array.from(files));
        } else {
            // fallback：直接跳转资产页让用户上传
            nav("/assets");
        }
    };

    if (!mounted) return null;

    const menu = pos && open ? (
        <div
            className="fixed inset-0 z-[2000] bg-transparent"
            onClick={() => setOpen(false)}
        >
            <div
                className="absolute min-w-60 rounded-xl border p-1 shadow-2xl"
                style={{
                    top: pos.top,
                    left: pos.left,
                    backgroundColor: "rgba(40, 40, 45, 0.96)",
                    borderColor: "rgba(255, 255, 255, 0.10)",
                    color: "#e5e7eb",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-white/10" onClick={() => fileRef.current?.click()}>
                    <Upload className="size-5 text-purple-400" />
                    <div><div className="font-medium">上传</div><div className="text-xs text-gray-400">图片、音频、视频、文档</div></div>
                </button>
                <input ref={fileRef} hidden type="file" accept="image/*,video/*,audio/*,.pdf,.docx,.xlsx,.xls,.txt,.md,.csv" multiple onChange={(e) => handleUpload(e.target.files)} />
                <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-white/10" onClick={pickAsset}>
                    <Database className="size-5 text-purple-400" />
                    <div><div className="font-medium">从素材库引用</div><div className="text-xs text-gray-400">已有素材 @ 引用</div></div>
                </button>
                <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-white/10" onClick={() => { setOpen(false); nav("/skill-store"); }}>
                    <Zap className="size-5 text-purple-400" />
                    <div><div className="font-medium">技能</div><div className="text-xs text-gray-400">Skill 商店</div></div>
                </button>
            </div>
        </div>
    ) : null;

    const assetPicker = pickingAsset ? (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40" onClick={() => setPickingAsset(false)}>
            <div className="max-h-[70vh] w-[520px] max-w-[90vw] overflow-y-auto rounded-xl bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-3 flex items-center justify-between">
                    <div className="text-base font-semibold">选择素材引用</div>
                    <button onClick={() => setPickingAsset(false)} className="text-gray-400 hover:text-gray-700">✕</button>
                </div>
                {assetLoading ? (
                    <div className="py-8 text-center text-sm text-gray-400">加载中...</div>
                ) : assets.length === 0 ? (
                    <div className="py-8 text-center text-sm text-gray-400">
                        <div>暂无素材</div>
                        <Button size="small" className="mt-2" onClick={() => { setPickingAsset(false); nav("/assets"); }}>去上传</Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {assets.map((a) => (
                            <button key={a.id} onClick={() => addAsset(a)} className="flex flex-col items-start gap-1 rounded-lg border p-2 text-left text-xs hover:border-purple-400 hover:bg-purple-50">
                                {a.thumbnail_url || a.url ? (
                                    <img src={a.thumbnail_url || a.url} alt={a.name} className="size-12 rounded object-cover" />
                                ) : (
                                    <div className="grid size-12 place-items-center rounded bg-gray-100 text-gray-400">
                                        <FileText className="size-5" />
                                    </div>
                                )}
                                <div className="line-clamp-2 break-all">{a.name}</div>
                                <div className="text-[10px] text-gray-400">{a.asset_type}</div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    ) : null;

    return (
        <>
            <Tooltip title="添加素材 / 知识库 / 技能">
                <Button ref={btnRef} type="text" shape="circle" className="!h-9 !w-9 !min-w-9" icon={<Plus className="size-4" />} onClick={openMenu} />
            </Tooltip>
            {menu}
            {assetPicker}
        </>
    );
}

/* ── P0: 模型选择器（持久化到 users.agent_model） ─────────── */

/* ── Agent 输出 / 产物页面 ─────────────────────────────────── */

function AgentOutputsView({
    outputs,
    loading,
    theme,
    onRefresh,
}: {
    outputs: AgentOutputItem[];
    loading: boolean;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onRefresh: () => void;
}) {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const isImage = (url: string, category: string) => category === "image" || /\.(jpe?g|png|webp|gif|bmp)(\?|$)/i.test(url);
    const isVideo = (url: string, category: string) => category === "video" || /\.(mp4|mov|webm|mkv)(\?|$)/i.test(url);
    const isAudio = (url: string, category: string) => category === "audio" || /\.(mp3|wav|m4a|aac|ogg)(\?|$)/i.test(url);

    const resolveOutputUrl = (url: string): string => {
        if (!url) return "";
        if (/^https?:\/\//i.test(url)) return url;
        if (url.startsWith("/api/v1/upload/")) return `${BACKEND_BASE_URL}${url}`;
        return getAssetUrl(url);
    };

    const handleDownload = async (url: string, category: string) => {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = blobUrl;
            const ext = category === "video" ? "mp4" : category === "audio" ? "mp3" : "png";
            link.download = `agentcut-output-${Date.now()}.${ext}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(blobUrl);
        } catch {
            window.open(url, "_blank");
        }
    };

    return (
        <div className="thin-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
            <div className="mb-3 flex items-center justify-between">
                <div className="text-base font-semibold leading-6">生成产物</div>
                <Button size="small" icon={<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />} onClick={onRefresh} loading={loading}>
                    刷新
                </Button>
            </div>
            {outputs.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm" style={{ color: theme.node.muted }}>
                    <FolderOpen className="size-8 opacity-50" />
                    <span>暂无生成产物</span>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    {outputs.map((item) => {
                        const displayUrl = resolveOutputUrl(item.url);
                        return (
                            <div
                                key={item.id}
                                className="group relative overflow-hidden rounded-lg border"
                                style={{ borderColor: theme.node.stroke, background: theme.toolbar.panel }}
                            >
                                {isImage(item.url, item.modal_category) ? (
                                    <img
                                        src={displayUrl}
                                        alt={item.variable_name}
                                        className="aspect-video w-full cursor-zoom-in object-cover"
                                        onClick={() => setPreviewUrl(displayUrl)}
                                    />
                                ) : isVideo(item.url, item.modal_category) ? (
                                    <video
                                        src={displayUrl}
                                        className="aspect-video w-full cursor-pointer object-cover"
                                        controls
                                        preload="metadata"
                                        onClick={() => setPreviewUrl(displayUrl)}
                                    />
                                ) : isAudio(item.url, item.modal_category) ? (
                                    <div className="flex aspect-video w-full items-center justify-center">
                                        <Music className="size-10 opacity-50" />
                                    </div>
                                ) : (
                                    <div className="flex aspect-video w-full items-center justify-center">
                                        <Film className="size-10 opacity-50" />
                                    </div>
                                )}
                                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/60 px-2 py-1.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
                                    <span className="truncate">{item.variable_name}</span>
                                    <div className="flex items-center gap-1">
                                        <Button size="small" type="text" icon={<Download className="size-3.5 text-white" />} onClick={() => void handleDownload(displayUrl, item.modal_category)} />
                                        <Button size="small" type="text" icon={<ExternalLink className="size-3.5 text-white" />} onClick={() => window.open(displayUrl, "_blank")} />
                                        <Button size="small" type="text" icon={<AtSign className="size-3.5 text-white" />} onClick={() => useAgentStore.getState().addAssetRef({ assetId: item.id, name: item.variable_name, kind: item.modal_category, url: displayUrl })} />
                                    </div>
                                </div>
                                {isAudio(item.url, item.modal_category) && (
                                    <audio src={displayUrl} controls className="w-full px-2 pb-2 pt-1" />
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            {previewUrl && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
                    onClick={() => setPreviewUrl(null)}
                >
                    <div className="max-h-full max-w-full overflow-auto" onClick={(e) => e.stopPropagation()}>
                        {/\.(mp4|mov|webm|mkv)(\?|$)/i.test(previewUrl) ? (
                            <video src={previewUrl} controls className="max-h-[80vh] max-w-[90vw] rounded-lg" />
                        ) : (
                            <img src={previewUrl} alt="preview" className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain" />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function AgentLogView({
    logs,
    theme,
    context,
    onClear,
    onCopied,
    onCopyBlocked,
}: {
    logs: AgentEventLog[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    context: AgentLogContext;
    onClear: () => void;
    onCopied: (text: string) => void;
    onCopyBlocked: (text: string) => void;
}) {
    const [mode, setMode] = useState<"text" | "json">("text");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const content = mode === "text" ? formatLogText(logs, context) : formatLogJson(logs, context);
    const lastError = [...logs].reverse().find((item) => /错误|失败|error/i.test(`${item.title}\n${item.text}`));
    const copy = async (value = content, tip = "日志已复制") => {
        if (await copyToClipboard(value)) {
            onCopied(tip);
            return;
        }
        textareaRef.current?.focus();
        textareaRef.current?.select();
        onCopyBlocked("已选中日志，请手动复制");
    };
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="flex min-h-full flex-col gap-3">
                <div>
                    <div className="text-base font-semibold leading-6">运行日志</div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Segmented
                        size="small"
                        value={mode}
                        onChange={(value) => setMode(value as "text" | "json")}
                        options={[
                            { label: "排查日志", value: "text" },
                            { label: "原始 JSON", value: "json" },
                        ]}
                    />
                    <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: theme.node.muted }}>
                            {logs.length} 条
                        </span>
                        <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void copy()}>
                            复制
                        </Button>
                        <Button size="small" disabled={!lastError} onClick={() => lastError && void copy(formatLogText([lastError], context), "最近错误已复制")}>
                            最近错误
                        </Button>
                        <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} disabled={!logs.length} onClick={onClear}>
                            清空
                        </Button>
                    </div>
                </div>
                <textarea
                    ref={textareaRef}
                    readOnly
                    value={content}
                    className="thin-scrollbar min-h-[360px] flex-1 resize-none rounded-lg border bg-transparent p-3 font-mono text-xs leading-5 outline-none"
                    style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                    onFocus={(event) => event.currentTarget.select()}
                />
            </div>
        </div>
    );
}

function AgentConnectView({
    enabled,
    connected,
    activity,
    connectError,
    onToggleEnabled,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    url: string;
    token: string;
    enabled: boolean;
    connected: boolean;
    activity: string;
    connectError: string;
    onUrlChange: (value: string) => void;
    onTokenChange: (value: string) => void;
    onToggleEnabled: () => void;
}) {
    const statusText = connectError ? "连接失败" : connected ? activity : enabled ? "连接中" : "未连接";
    const statusColor = connectError ? "#dc2626" : connected ? "#16a34a" : enabled ? "#d97706" : "#6b7280";
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
                <div>
                    <div className="text-base font-semibold leading-6">连接 AgentCut 智能体</div>
                    <div className="mt-1 text-xs leading-5 text-gray-500">
                        由 EdgeOne Makers 托管，通过后端代理与网页画布交互。
                    </div>
                </div>
                <div className="space-y-2">
                    {AGENT_CONNECT_STEPS.map((step) => (
                        <div key={step.title} className="rounded-lg px-3 py-2.5">
                            <div className="text-sm font-medium leading-5">{step.title}</div>
                            <div className="mt-1 text-xs leading-5 text-gray-500">{step.text}</div>
                        </div>
                    ))}
                </div>
                <div className="rounded-lg border p-3" style={{ borderColor: "#e5e7eb" }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="shrink-0 text-sm font-medium leading-5">网页连接</span>
                                <span
                                    className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4"
                                    style={{ borderColor: statusColor, color: statusColor }}
                                >
                                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: statusColor }} />
                                    <span className="truncate">{statusText}</span>
                                </span>
                            </div>
                            <div className="mt-1 text-xs leading-5 text-gray-500">
                                点击下方按钮连接后端 Agent。
                            </div>
                        </div>
                        <Button className="!h-8 !px-3" type={enabled ? "default" : "primary"} icon={<PlugZap className="size-4" />} onClick={onToggleEnabled}>
                            {enabled ? "断开" : "连接"}
                        </Button>
                    </div>
                    {connectError ? (
                        <div className="mt-3 rounded-md border px-2.5 py-2 text-xs leading-5" style={{ borderColor: "rgba(220,38,38,.35)", color: "#dc2626" }}>
                            {connectError}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function AgentHistoryView({
    theme,
    threads,
    activeThreadId,
    workspacePath,
    loading,
    busy,
    connected,
    onRefresh,
    onNewThread,
    onResumeThread,
    onDeleteThread,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    threads: AgentThreadSummary[];
    activeThreadId: string;
    workspacePath: string;
    loading: boolean;
    busy: boolean;
    connected: boolean;
    onRefresh: () => void;
    onNewThread: () => void;
    onResumeThread: (threadId: string) => void;
    onDeleteThread: (thread: AgentThreadSummary) => void;
}) {
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
            <div className="space-y-3">
                <div className="flex min-w-0 items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                    <FolderOpen className="size-3.5 shrink-0" />
                    <span className="shrink-0">工作空间</span>
                    <span className="min-w-0 truncate" title={workspacePath}>
                        {workspacePath || "默认画布目录"}
                    </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm" style={{ color: theme.node.muted }}>
                        {threads.length ? `${threads.length} 条历史` : connected ? "暂无历史" : "未连接"}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button size="small" icon={<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />} disabled={!connected || loading} onClick={onRefresh}>
                            刷新
                        </Button>
                        <Button size="small" type="primary" icon={<Plus className="size-3.5" />} disabled={!connected || loading || busy} onClick={onNewThread}>
                            新对话
                        </Button>
                    </div>
                </div>
                <div className="space-y-2">
                    {threads.map((thread) => {
                        const active = thread.id === activeThreadId;
                        return (
                            <div key={thread.id} className="rounded-lg border px-2.5 py-1.5 transition" style={{ borderColor: active ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}>
                                <div className="flex items-center gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            {active ? (
                                                <span className="shrink-0 text-[10px] font-medium" style={{ color: theme.node.text }}>
                                                    当前
                                                </span>
                                            ) : null}
                                            <div className="truncate text-sm font-medium leading-5">{thread.name || thread.preview || "未命名对话"}</div>
                                        </div>
                                        <div className="truncate text-[11px] leading-4 opacity-65">{thread.preview || thread.id}</div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        <span className="text-[10px] opacity-55">{formatThreadTime(thread.updatedAt || thread.createdAt)}</span>
                                        <Button size="small" className="!h-6 !px-2" disabled={loading || busy} onClick={() => onResumeThread(thread.id)}>
                                            进入
                                        </Button>
                                        <Tooltip title="删除记录">
                                            <Button size="small" danger type="text" className="!h-6 !w-6 !min-w-6" disabled={loading || busy} icon={<Trash2 className="size-3.5" />} onClick={() => onDeleteThread(thread)} />
                                        </Tooltip>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {!threads.length ? (
                        <div className="px-3 py-8 text-center text-sm" style={{ color: theme.node.muted }}>
                            {connected ? "当前工作空间还没有对话记录" : "连接本地 Agent 后显示历史记录"}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

async function postState(endpoint: string, _token: string, clientId: string, snapshot: CanvasAgentSnapshot | null) {
    try {
        await fetch(`${endpoint}/canvas/state?clientId=${encodeURIComponent(clientId)}`, {
            method: "POST",
            headers: { "content-type": "application/json", ...authHeaders() },
            body: JSON.stringify(snapshot ? { ...snapshot, hasCanvas: true } : { hasCanvas: false }),
            credentials: "include",
        });
    } catch {}
}

async function activateAgentClient(endpoint: string, _token: string, clientId: string) {
    try {
        await fetch(`${endpoint}/canvas/activate?clientId=${encodeURIComponent(clientId)}`, { method: "POST", headers: authHeaders(), credentials: "include" });
    } catch {}
}

async function postToolResult(endpoint: string, _token: string, clientId: string, body: { requestId: string; result?: unknown; error?: string }) {
    await fetch(`${endpoint}/canvas/result?clientId=${encodeURIComponent(clientId)}`, { method: "POST", headers: { "content-type": "application/json", ...authHeaders() }, body: JSON.stringify(body), credentials: "include" });
}

function agentMessageToChatMessage(item: AgentChatItem) {
    return { ...item, attachments: item.attachments?.map(agentAttachmentToChatAttachment) };
}

function agentAttachmentToChatAttachment(item: AgentAttachment): CanvasAgentChatAttachment {
    return { id: item.id, name: item.name, url: item.dataUrl || item.url };
}

function formatAgentEvent(event: AgentEventPayload): Omit<AgentChatItem, "id"> | null {
    const item = event.item;
    if (event.type === "item.completed" && item?.type === "error") return { role: "error", title: "错误", text: normalizeText(item.message), detail: item };
    if ((event.type === "item.updated" || event.type === "item.completed") && item?.type === "agent_message") return { role: "assistant", title: "Codex", text: stringText(item.text), meta: usageText(event), streamId: item.id };
    if (event.type === "item.completed" && isMcpToolItem(item) && isReadTool(String(item?.tool || ""))) return { role: "tool", title: `${toolName(String(item?.tool || ""))}完成`, text: item?.error?.message || toolSummary(item), detail: toolDetail(item) };
    const text = eventText(event);
    if (text) return { role: "assistant", title: "Codex", text, meta: usageText(event) };
    return null;
}

function parseEventData<T>(event: Event) {
    try {
        return JSON.parse((event as MessageEvent).data) as T;
    } catch {
        return null;
    }
}

function isCurrentThreadEvent(event: { threadId?: string; thread_id?: string }) {
    const threadId = event.threadId || event.thread_id || "";
    return Boolean(threadId) && threadId === useAgentStore.getState().activeThreadId;
}

function formatLogText(logs: AgentEventLog[], context: AgentLogContext) {
    const head = [
        "AgentCut Agent 诊断日志",
        `Canvas Agent: ${context.endpoint}`,
        `连接: ${context.connected ? "在线" : context.enabled ? "连接中" : "未启用"}`,
        `状态: ${context.activity}`,
        `waiting: ${context.waiting}`,
        `sending: ${context.sending}`,
        `messages: ${context.messages}`,
        `pendingTool: ${context.pendingTool ? toolName(context.pendingTool) : "none"}`,
        `logs: ${logs.length}`,
    ].join("\n");
    const body = logs
        .map((item, index) => {
            const detail = item.raw == null ? item.text : JSON.stringify(item.raw, null, 2);
            return [`#${index + 1} ${item.time} ${item.title}`, detail].filter(Boolean).join("\n");
        })
        .join("\n\n---\n\n");
    return [head, body || "暂无事件日志"].join("\n\n");
}

function formatLogJson(logs: AgentEventLog[], context: AgentLogContext) {
    return JSON.stringify({ context, logs: logs.map(({ time, title, text, raw }) => ({ time, title, text, raw })) }, null, 2);
}

function eventText(event: AgentEventPayload) {
    return event.type === "item.completed" && event.item?.type === "agent_message" ? stringText(event.item.text) : "";
}

function usageText(event: AgentEventPayload) {
    const usage = event.usage;
    if (!usage || typeof usage !== "object") return undefined;
    const total = numberField(usage, "total_tokens");
    const input = numberField(usage, "input_tokens");
    const output = numberField(usage, "output_tokens");
    if (total) return `${total} tok`;
    if (input || output) return `${input || 0}/${output || 0} tok`;
    return undefined;
}

function eventTitle(event: AgentEventPayload) {
    const item = event.item;
    if (event.type === "thread.started") return "已创建 Codex 会话";
    if (event.type === "turn.started") return "开始处理";
    if (event.type === "turn.completed") return "本轮完成";
    if (event.type === "stream.summary") return "流式摘要";
    if (event.type === "turn.failed" || event.type === "error") return "本轮失败";
    if (event.type === "item.started" && isMcpToolItem(item)) return `调用工具：${toolName(String(item?.tool || ""))}`;
    if (event.type === "item.completed" && isMcpToolItem(item)) return `工具完成：${toolName(String(item?.tool || ""))}`;
    if (event.type === "item.completed" && item?.type === "agent_message") return "Codex 回复";
    return event.type || "Codex 事件";
}

function shouldLogAgentEvent(event: AgentEventPayload) {
    const itemType = event.item?.type || "";
    return !["item.updated"].includes(event.type || "") && !["reasoning"].includes(itemType) && !(event.type === "item.started" && itemType === "agent_message");
}

function isConnectionErrorMessage(item: AgentChatItem) {
    return item.role === "error" && /连接失败|无法连接本地 Agent|本地 Agent 连接失败/.test(item.text);
}

function toolName(name: string) {
    if (name === "canvas_apply_ops") return "画布操作";
    if (name === "canvas_get_state") return "读取画布";
    if (name === "canvas_get_selection") return "读取选区";
    if (name === "canvas_export_snapshot") return "导出快照";
    if (name === "canvas_create_node") return "创建节点";
    if (name === "canvas_create_attachment_nodes") return "添加附件图片";
    if (name === "canvas_create_text_node") return "创建文本";
    if (name === "canvas_create_text_nodes") return "批量创建文本";
    if (name === "canvas_create_config_node") return "创建生成配置";
    if (name === "canvas_create_image_prompt_flow") return "创建生图流程";
    if (name === "canvas_create_generation_flow") return "创建生成流程";
    if (name === "canvas_generate_text") return "生成文本";
    if (name === "canvas_generate_image") return "生成图片";
    if (name === "canvas_generate_video") return "生成视频";
    if (name === "canvas_generate_audio") return "生成音频";
    if (name === "canvas_update_node") return "更新节点";
    if (name === "canvas_update_node_text") return "更新文本";
    if (name === "canvas_move_nodes") return "移动节点";
    if (name === "canvas_resize_node") return "调整节点尺寸";
    if (name === "canvas_delete_nodes") return "删除节点";
    if (name === "canvas_connect_nodes") return "连接节点";
    if (name === "canvas_select_nodes") return "选择节点";
    if (name === "canvas_set_viewport") return "调整视口";
    if (name === "canvas_run_generation") return "触发生成";
    if (name === "site_navigate") return "网站跳转";
    if (isSiteTool(name)) return SITE_TOOL_LABELS[name];
    return name;
}

function siteToolSummary(name: string, result: unknown) {
    const data = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
    if (name === "canvas_list_projects") return `共 ${numberField(data, "total")} 个画布`;
    if (name === "prompts_search") return `找到 ${numberField(data, "total")} 条提示词`;
    if (name === "assets_list") return `共 ${numberField(data, "total")} 个资产`;
    if (name === "assets_add") return "已加入我的资产";
    if (name === "generation_get_status") {
        const summary = data.summary && typeof data.summary === "object" ? (data.summary as Record<string, unknown>) : {};
        return `共 ${numberField(data, "total")} 个任务，排队 ${numberField(summary, "queued")}，运行中 ${numberField(summary, "running")}，成功 ${numberField(summary, "succeeded")}，失败 ${numberField(summary, "failed")}`;
    }
    if (name === "workbench_image_generate" || name === "workbench_video_generate") return typeof data.note === "string" ? data.note : "已在工作台执行";
    if (name === "workbench_image_get_config" || name === "workbench_video_get_config") return "已读取工作台配置";
    return "已完成";
}

function isReadTool(name: string) {
    return name === "canvas_get_state" || name === "canvas_get_selection" || name === "canvas_export_snapshot";
}

function isMcpToolItem(item?: AgentEventItem) {
    return item?.type === "mcp_tool_call";
}

function toolDetail(item?: AgentEventItem) {
    return { server: item?.server, tool: item?.tool, status: item?.status, arguments: item?.arguments, result: parseToolResult(item?.result), error: item?.error };
}

function toolSummary(item?: AgentEventItem) {
    const result = parseToolResult(item?.result);
    const nodeField = objectField(result, "nodes");
    const connectionField = objectField(result, "connections");
    const nodes = Array.isArray(nodeField) ? nodeField : [];
    const connections = Array.isArray(connectionField) ? connectionField : [];
    if (Array.isArray(nodeField) || Array.isArray(connectionField)) return `读取到 ${nodes.length} 个节点，${connections.length} 条连线`;
    return "工具调用完成";
}

function parseToolResult(result: unknown) {
    const content = objectField(result, "content");
    const text = Array.isArray(content)
        ? content
              .map((item) => objectField(item, "text"))
              .filter((item): item is string => typeof item === "string")
              .join("\n")
        : "";
    try {
        return text ? JSON.parse(text) : result;
    } catch {
        return text || result;
    }
}

function normalizeText(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (value instanceof Error) return value.message;
    if (value == null) return "";
    return JSON.stringify(value, null, 2);
}

function stringText(value: unknown) {
    return typeof value === "string" ? value : "";
}

function objectField(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function numberField(value: unknown, key: string) {
    const field = objectField(value, key);
    return typeof field === "number" ? field : 0;
}

function mergeAgentText(prev: string, next: string) {
    if (!next || prev === next || prev.endsWith(next)) return prev;
    if (next.startsWith(prev)) return next;
    for (let size = Math.min(prev.length, next.length); size > 0; size--) {
        if (prev.endsWith(next.slice(0, size))) return `${prev}${next.slice(size)}`;
    }
    const half = Math.floor(prev.length / 2);
    if (prev.length > 12 && next.length > 12 && prev.slice(half) === next.slice(0, prev.length - half)) return prev;
    return `${prev}${next}`;
}

function promptWithAttachments(text: string, attachments: AgentAttachment[]) {
    return text || (attachments.length ? "请处理上传的图片附件。" : "");
}

function attachmentPayloadBytes(attachments: AgentAttachment[]) {
    return attachments.reduce((total, item) => total + item.dataUrl.length, 0);
}

function formatBytes(bytes: number) {
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;
}

function isCanvasWriteTool(name: string) {
    return name === "canvas_apply_ops" || name === "canvas_create_attachment_nodes";
}

async function attachmentNodeOps(_endpoint: string, _token: string, _clientId: string, value: unknown): Promise<CanvasAgentOp[]> {
    const nodes = Array.isArray(value) ? value : [];
    if (!nodes.length) throw new Error("没有可添加的图片附件");
    const attachments = useAgentStore.getState().attachments;
    return await Promise.all(
        nodes.map(async (value) => {
            const item = value as { id?: unknown; attachmentId?: unknown; title?: unknown; position?: unknown };
            const id = String(item.id || "");
            const attachmentId = String(item.attachmentId || "");
            if (!id || !attachmentId) throw new Error("图片附件节点参数无效");
            const attachment = attachments.find((a) => a.id === attachmentId);
            if (!attachment?.dataUrl) throw new Error(`找不到图片附件：${attachmentId}`);
            const blob = await dataUrlToBlob(attachment.dataUrl);
            const image = await uploadImage(blob);
            const size = fitNodeSize(image.width, image.height);
            const position = item.position && typeof item.position === "object" ? (item.position as { x?: unknown; y?: unknown }) : {};
            return {
                type: "add_node" as const,
                id,
                nodeType: "image" as const,
                title: String(item.title || "参考图"),
                position: { x: Number(position.x) || 0, y: Number(position.y) || 0 },
                width: size.width,
                height: size.height,
                metadata: imageMetadata(image),
            };
        }),
    );
}

function dataUrlToBlob(dataUrl: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
        try {
            const [header, base64] = dataUrl.split(",");
            const mime = header.match(/data:([^;]+)/)?.[1] || "image/png";
            const byteString = atob(base64);
            const array = new Uint8Array(byteString.length);
            for (let i = 0; i < byteString.length; i++) {
                array[i] = byteString.charCodeAt(i);
            }
            resolve(new Blob([array], { type: mime }));
        } catch (error) {
            reject(error instanceof Error ? error : new Error("图片附件解码失败"));
        }
    });
}

function authHeaders(): Record<string, string> {
    const token = getMemoryAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchAgentJson<T>(endpoint: string, _token: string, path: string, init?: RequestInit) {
    const url = `${endpoint}${path}`;
    const headers = { ...authHeaders(), ...(init?.headers || {}) };
    const res = await fetch(url, { credentials: "include", ...init, headers });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; msg?: string };
    if (!res.ok) throw new Error(data.error || data.msg || "Agent 请求失败");
    return data;
}

async function discoverAgentConfig(endpoint: string) {
    try {
        const res = await fetch(`${endpoint}/config`);
        if (!res.ok) return null;
        const data = (await res.json()) as AgentConfigResponse;
        return data.ok ? data : null;
    } catch {
        return null;
    }
}

function normalizeHistoryMessages(messages: AgentChatItem[]) {
    return messages
        .map((item, index) => ({
            ...item,
            id: item.id || `history-${index}`,
            text: normalizeText(item.text),
        }))
        .filter((item) => item.text);
}

function formatThreadTime(value?: number) {
    if (!value) return "";
    return new Date(value * 1000).toLocaleString();
}

function createId() {
    return randomId();
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function readDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
        reader.readAsDataURL(file);
    });
}
