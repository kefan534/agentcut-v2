import { create } from "zustand";

import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { encryptText, decryptText } from "@/lib/secure-storage";

export type AgentChatRole = "user" | "assistant" | "system" | "tool" | "error";
export type AgentAttachment = { id: string; name: string; type: string; size: number; width: number; height: number; url: string; dataUrl: string };
export type AgentChatItem = { id: string; role: AgentChatRole; title?: string; text: string; meta?: string; detail?: unknown; attachments?: AgentAttachment[]; streamId?: string };
export type AgentEventLog = { id: string; time: string; title: string; text: string; raw?: unknown };
export type AgentPendingToolCall = { requestId: string; name: string; input?: { ops?: CanvasAgentOp[]; path?: string } & Record<string, unknown> };
export type AgentCanvasContext = { snapshot: CanvasAgentSnapshot; applyOps: (ops?: CanvasAgentOp[]) => CanvasAgentSnapshot; undoOps: () => CanvasAgentSnapshot | null; canUndo: boolean };
export type AgentThreadSummary = { id: string; preview: string; name?: string | null; cwd?: string; status?: string; source?: unknown; createdAt?: number; updatedAt?: number };
export type AgentPanelTab = "chat" | "setup" | "history" | "log";

const CONNECT_TIMEOUT_MS = 6000;
let agentSource: EventSource | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;

const AGENT_URL_KEY = "canvas-agent-url";
const AGENT_TOKEN_KEY = "canvas-agent-token";
const DEFAULT_AGENT_URL = "/api/v1/agent";

function getStoredWidth(): number {
    if (typeof window === "undefined") return 440;
    const raw = window.localStorage.getItem("canvas-agent-panel-width");
    return raw ? Number(raw) || 440 : 440;
}

function migrateLegacyAgentUrl(raw: string | null): string {
    if (!raw) return DEFAULT_AGENT_URL;
    // 旧版本默认把绝对地址 http://localhost:8081/api/v1/agent 存到 localStorage，
    // 这会让浏览器绕过 Vite/nginx 代理直接跨端口请求后端，导致 SameSite=Lax cookie 不发送、
    // SSE 认证失败。自动迁移为相对路径，让请求走当前站点代理。
    if (/^https?:\/\/(localhost|127\.0\.0\.1):\d+\/api\/v1\/agent\/?$/i.test(raw)) {
        return DEFAULT_AGENT_URL;
    }
    return raw;
}

function getStoredUrl(): string {
    if (typeof window === "undefined") return DEFAULT_AGENT_URL;
    const raw = window.localStorage.getItem(AGENT_URL_KEY);
    return migrateLegacyAgentUrl(raw);
}

type AgentStore = {
    width: number;
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    canvasContext: AgentCanvasContext | null;
    url: string;
    token: string;
    tokenLoaded: boolean;
    connected: boolean;
    enabled: boolean;
    silentConnect: boolean;
    prompt: string;
    attachments: AgentAttachment[];
    sending: boolean;
    waiting: boolean;
    messages: AgentChatItem[];
    eventLogs: AgentEventLog[];
    threads: AgentThreadSummary[];
    activeThreadId: string;
    workspacePath: string;
    loadingThreads: boolean;
    activeTab: AgentPanelTab;
    confirmTools: boolean;
    activity: string;
    connectError: string;
    pendingTool: AgentPendingToolCall | null;
    setAgentState: (patch: Partial<Omit<AgentStore, "setAgentState" | "connectAgent" | "disconnectAgent" | "addMessage" | "addEventLog" | "clearEventLogs" | "openPanel" | "closePanel" | "togglePanel" | "setCanvasContext" | "loadPersistedToken">>) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
    setCanvasContext: (context: AgentCanvasContext | null) => void;
    connectAgent: (options?: { silent?: boolean }) => void;
    disconnectAgent: (patch?: Partial<Omit<AgentStore, "setAgentState" | "connectAgent" | "disconnectAgent" | "addMessage" | "addEventLog" | "clearEventLogs" | "openPanel" | "closePanel" | "togglePanel" | "setCanvasContext" | "loadPersistedToken">>) => void;
    addMessage: (item: AgentChatItem) => void;
    addEventLog: (item: AgentEventLog) => void;
    clearEventLogs: () => void;
    loadPersistedToken: () => Promise<void>;
};

export const CANVAS_AGENT_PANEL_MOTION_MS = 500;

export const useAgentStore = create<AgentStore>((set, get) => ({
    width: getStoredWidth(),
    panelOpen: false,
    panelMounted: true,
    panelClosing: false,
    canvasContext: null,
    url: getStoredUrl(),
    token: "",
    tokenLoaded: false,
    connected: false,
    enabled: false,
    silentConnect: false,
    prompt: "",
    attachments: [],
    sending: false,
    waiting: false,
    messages: [],
    eventLogs: [],
    threads: [],
    activeThreadId: "",
    workspacePath: "",
    loadingThreads: false,
    activeTab: "setup",
    confirmTools: true,
    activity: "就绪",
    connectError: "",
    pendingTool: null,
    setAgentState: (patch) => set(patch),
    openPanel: () => set({ panelOpen: true, panelMounted: true, panelClosing: false }),
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        set({ panelOpen: false, panelClosing: true });
        setTimeout(() => {
            if (get().panelClosing) set({ panelMounted: false, panelClosing: false });
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
    setCanvasContext: (canvasContext) => set({ canvasContext }),
    connectAgent: (options) => {
        const silent = options?.silent ?? false;
        const endpoint = migrateLegacyAgentUrl(get().url.trim().replace(/\/$/, ""));
        if (!endpoint) return set({ connectError: silent ? "" : "Agent 地址未配置" });
        window.localStorage.setItem(AGENT_URL_KEY, endpoint);
        // EdgeOne Makers 模式下不再使用本地 token；内存 token 由 backend.ts 在登录后写入
        set({ url: endpoint, token: "", enabled: true, silentConnect: silent, activity: "连接中", connectError: "" });
    },
    disconnectAgent: (patch = {}) => {
        agentSource?.close();
        agentSource = null;
        if (connectTimer) clearTimeout(connectTimer);
        connectTimer = null;
        set({ enabled: false, connected: false, silentConnect: false, activity: "离线", ...patch });
    },
    addMessage: (item) => set((state) => ({ messages: [...state.messages.slice(-120), item] })),
    addEventLog: (item) => set((state) => ({ eventLogs: [...state.eventLogs.slice(-160), item] })),
    clearEventLogs: () => set({ eventLogs: [] }),
    loadPersistedToken: async () => {
        if (typeof window === "undefined") return;
        // EdgeOne Makers 模式下 token 不再使用
        set({ token: "", tokenLoaded: true });
    },
}));
