import axios, { type AxiosRequestConfig } from "axios";

// VITE_BACKEND_URL is an absolute origin (e.g. http://localhost:8081 in dev).
// Leave it empty in production deploys so requests go to the same origin and
// the nginx reverse proxy forwards /api/v1/* to the FastAPI backend.
export const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL || "";

export const backend = axios.create({
    baseURL: `${BACKEND_BASE_URL}/api/v1`,
    timeout: 900000,
    withCredentials: true,
});

// Plain axios instance for auth endpoints to avoid interceptor loops.
const authBackend = axios.create({
    baseURL: `${BACKEND_BASE_URL}/api/v1`,
    timeout: 30000,
    withCredentials: true,
});

// In-memory access token used for EventSource (SSE) connections where custom
// headers are not supported. We deliberately do NOT persist this to localStorage
// to reduce XSS risk; it is refreshed on page load via cookie-based /auth/me or
// /auth/refresh on the first authenticated request.
let memoryAccessToken: string | null = null;

export function setMemoryAccessToken(token: string | null) {
    memoryAccessToken = token;
}

export function getMemoryAccessToken(): string | null {
    return memoryAccessToken;
}

let isRefreshing = false;
let refreshSubscribers: Array<(success: boolean) => void> = [];

function onRefreshed(success: boolean) {
    refreshSubscribers.forEach((cb) => cb(success));
    refreshSubscribers = [];
}

backend.interceptors.request.use(
    (config) => {
        // eslint-disable-next-line no-console
        console.log(`[api] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
    },
    (error) => Promise.reject(error),
);

backend.interceptors.response.use(
    (response) => response,
    async (error) => {
        // Network errors (no response) - provide better diagnostics
        if (!error.response) {
            const url = error.config?.url || "?";
            const method = error.config?.method?.toUpperCase() || "?";
            console.error(
                `[api] NETWORK ERROR ${method} ${url}\n` +
                `  message: ${error.message}\n` +
                `  code: ${error.code}\n` +
                `  Did CORS preflight succeed? Check Network tab.`,
            );
            throw new Error(
                `网络错误 ${method} ${url}：${error.message || "Failed to fetch"}。` +
                `可能原因：1)CORS 2)后端未启动 3)本地代理 4)浏览器扩展拦截。请查看浏览器 DevTools → Network`,
            );
        }

        const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

        // Do not retry the refresh request itself or unauthenticated auth endpoints.
        const url = originalRequest.url || "";
        if (url === "/auth/refresh" || url === "/auth/login" || url === "/auth/register" || url === "/auth/logout") {
            return Promise.reject(error);
        }

        if (axios.isAxiosError(error) && error.response?.status === 401 && !originalRequest._retry) {
            if (isRefreshing) {
                return new Promise((resolve, reject) => {
                    refreshSubscribers.push((success) => {
                        if (success) {
                            resolve(backend(originalRequest));
                        } else {
                            reject(error);
                        }
                    });
                });
            }

            originalRequest._retry = true;
            isRefreshing = true;

            try {
                await refreshToken();
                isRefreshing = false;
                onRefreshed(true);
                return backend(originalRequest);
            } catch (refreshError) {
                isRefreshing = false;
                onRefreshed(false);
                window.dispatchEvent(new CustomEvent("ic:auth:required"));
                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    },
);

export type BackendUser = {
    id: string;
    email: string;
    nickname: string | null;
    avatar_url: string | null;
    role: "user" | "admin";
    level: string;
    credits: number;
    status: string;
    created_at: string;
};

export type AvailableModel = {
    variable_name: string;
    modal_category: "text" | "image" | "audio" | "video";
    default_source_id: number;
    vendor: string;
    model_version: string;
    source_name: string;
    description?: string;
};

export async function registerUser(email: string, password: string, nickname?: string) {
    const { data } = await backend.post<BackendUser & { access_token?: string; refresh_token?: string; token_type?: string }>("/auth/register", { email, password, nickname });
    if (data.access_token) setMemoryAccessToken(data.access_token);
    return data;
}

export async function loginUser(email: string, password: string) {
    const { data } = await backend.post<{ access_token: string; refresh_token: string; token_type: string }>("/auth/login", { email, password });
    setMemoryAccessToken(data.access_token);
    return data;
}

export async function logoutUser() {
    setMemoryAccessToken(null);
    await backend.post("/auth/logout");
}

export async function fetchMe() {
    const { data } = await backend.get<BackendUser>("/auth/me");
    return data;
}

export async function changePassword(oldPassword: string, newPassword: string) {
    const { data } = await backend.post<{ detail: string }>("/auth/change-password", {
        old_password: oldPassword,
        new_password: newPassword,
    });
    return data;
}

export async function refreshToken() {
    const { data } = await authBackend.post<{ access_token: string; refresh_token: string; token_type: string }>("/auth/refresh");
    setMemoryAccessToken(data.access_token);
    return data;
}

export async function fetchAvailableModels() {
    const { data } = await backend.get<AvailableModel[]>("/gateway/models");
    return data;
}

export async function proxyGateway(variableName: string, endpoint: string, body: Record<string, unknown>, stream = false): Promise<unknown> {
    const { data } = await backend.post<unknown>(`/gateway/${encodeURIComponent(variableName)}/proxy`, { endpoint, body, stream });
    return data;
}

export async function proxyGatewayStream(variableName: string, endpoint: string, body: Record<string, unknown>) {
    const response = await fetch(`${BACKEND_BASE_URL}/api/v1/gateway/${encodeURIComponent(variableName)}/proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ endpoint, body, stream: true }),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Gateway stream request failed");
    }
    return response.body;
}

export async function uploadFile(file: File, onProgress?: (percent: number) => void) {
    const formData = new FormData();
    formData.append("file", file);
    const { data } = await backend.post<{ storage_key: string; filename: string | null; content_type: string | null; url: string }>("/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: onProgress
            ? (event) => {
                  if (event.total) onProgress(Math.round((event.loaded * 100) / event.total));
              }
            : undefined,
    });
    return data;
}

export async function fetchBackendFile(storageKey: string) {
    const path = storageKey.startsWith("/") ? storageKey : `/${storageKey}`;
    const response = await fetch(`${BACKEND_BASE_URL}/api/v1/upload${path}`, {
        credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to fetch file");
    return response.blob();
}

export type GenerationLog = {
    id: string;
    request_id: string;
    user_id: string;
    variable_name: string;
    source_id: number | null;
    modal_category: string;
    status: "success" | "failed" | "pending";
    status_code: number | null;
    latency_ms: number;
    error_message: string | null;
    cost_credits: number;
    request_body: Record<string, unknown> | null;
    response_summary: Record<string, unknown> | null;
    created_at: string;
};

export async function getGenerationLogs(modalCategory: string, limit = 50, offset = 0) {
    const { data } = await backend.get<GenerationLog[]>("/gateway/logs", {
        params: { modal_category: modalCategory, limit, offset },
    });
    return data;
}

export type GenerationSession = {
    id: string;
    user_id: string;
    modal_category: string;
    task_type: "text" | "reference";
    prompt: string;
    model: string;
    status: "pending" | "success" | "failed";
    phase?: "queued" | "running";
    reference_urls: string[];
    result_urls: string[];
    error_message: string | null;
    created_at: string;
    updated_at: string;
};

export async function listGenerationSessions(modalCategory: string, limit = 50, offset = 0) {
    const { data } = await backend.get<GenerationSession[]>("/gateway/sessions", {
        params: { modal_category: modalCategory, limit, offset },
    });
    return data;
}

export async function createGenerationSession(
    modalCategory: string,
    prompt: string,
    model: string,
    taskType: "text" | "reference" = "text",
    referenceUrls: string[] = [],
) {
    const { data } = await backend.post<GenerationSession>("/gateway/sessions", {
        modal_category: modalCategory,
        task_type: taskType,
        prompt,
        model,
        reference_urls: referenceUrls,
    });
    return data;
}

export async function updateGenerationSession(
    sessionId: string,
    payload: { status: string; reference_urls?: string[]; result_urls?: string[]; error_message?: string | null },
) {
    const { data } = await backend.patch<GenerationSession>(`/gateway/sessions/${sessionId}`, payload);
    return data;
}

export async function deleteGenerationSession(sessionId: string) {
    await backend.delete(`/gateway/sessions/${sessionId}`);
}

// Projects
export type BackendProject = {
    id: string;
    user_id: string;
    name: string;
    description: string | null;
    thumbnail_url: string | null;
    canvas_data: Record<string, unknown>;
    meta: Record<string, unknown>;
    is_deleted: string;
    created_at: string;
    updated_at: string;
};

export async function listProjects() {
    const { data } = await backend.get<BackendProject[]>("/projects");
    return data;
}

export async function createProject(name: string, canvasData: Record<string, unknown>, description?: string, thumbnailUrl?: string) {
    const { data } = await backend.post<BackendProject>("/projects", { name, description, thumbnail_url: thumbnailUrl, canvas_data: canvasData, meta: {} });
    return data;
}

export async function getProject(id: string) {
    const { data } = await backend.get<BackendProject>(`/projects/${id}`);
    return data;
}

export async function updateProject(id: string, payload: Partial<BackendProject>) {
    const { data } = await backend.put<BackendProject>(`/projects/${id}`, payload);
    return data;
}

export async function deleteProject(id: string) {
    await backend.delete(`/projects/${id}`);
}

// Drama (short-drama / Toonflow) projects
export type DramaProject = {
    id: string;
    user_id: string;
    name: string;
    intro: string | null;
    project_type: string | null;
    type: string | null;
    art_style: string | null;
    director_manual: string | null;
    video_ratio: string | null;
    image_model: string | null;
    video_model: string | null;
    image_quality: string | null;
    mode: string | null;
    is_deleted: string;
    created_at: string;
    updated_at: string;
};

export async function listDramaProjects() {
    const { data } = await backend.get<DramaProject[]>("/drama/projects");
    return data;
}

export async function createDramaProject(payload: Partial<Omit<DramaProject, "id" | "user_id" | "is_deleted" | "created_at" | "updated_at">>) {
    const { data } = await backend.post<DramaProject>("/drama/projects", payload);
    return data;
}

export async function getDramaProject(id: string) {
    const { data } = await backend.get<DramaProject>(`/drama/projects/${id}`);
    return data;
}

export async function updateDramaProject(id: string, payload: Partial<Omit<DramaProject, "id" | "user_id" | "is_deleted" | "created_at" | "updated_at">>) {
    const { data } = await backend.put<DramaProject>(`/drama/projects/${id}`, payload);
    return data;
}

export async function deleteDramaProject(id: string) {
    await backend.delete(`/drama/projects/${id}`);
}

// Drama novels (小说原文章节)
export type DramaNovel = {
    id: string;
    user_id: string;
    project_id: string;
    chapter_index: number;
    reel: string | null;
    chapter: string | null;
    chapter_data: string | null;
    event_state: number;
    event: string | null;
    error_reason: string | null;
    is_deleted: string;
    created_at: string;
    updated_at: string;
};

export async function listDramaNovels(projectId: string, page = 1, limit = 50) {
    const { data } = await backend.get<DramaNovel[]>("/drama/novels", {
        params: { project_id: projectId, page, limit },
    });
    return data;
}

export async function createDramaNovels(projectId: string, items: { reel?: string; chapter?: string; chapter_data?: string }[]) {
    const { data } = await backend.post<DramaNovel[]>("/drama/novels", { project_id: projectId, items });
    return data;
}

export async function updateDramaNovel(id: string, payload: { reel?: string; chapter?: string; chapter_data?: string }) {
    const { data } = await backend.put<DramaNovel>(`/drama/novels/${id}`, payload);
    return data;
}

export async function deleteDramaNovel(id: string) {
    await backend.delete(`/drama/novels/${id}`);
}

export async function extractDramaNovelEvents(projectId: string, novelIds: string[] = []) {
    const { data } = await backend.post<{ ok: boolean; detail: string }>("/drama/novels/extract-events", {
        project_id: projectId,
        novel_ids: novelIds,
    });
    return data;
}

// Drama scripts (剧本)
export type DramaScript = {
    id: string;
    user_id: string;
    project_id: string;
    name: string;
    content: string | null;
    extract_state: number;
    error_reason: string | null;
    is_deleted: string;
    created_at: string;
    updated_at: string;
};

export async function listDramaScripts(projectId: string) {
    const { data } = await backend.get<DramaScript[]>("/drama/scripts", {
        params: { project_id: projectId },
    });
    return data;
}

export async function createDramaScript(projectId: string, name: string, content?: string) {
    const { data } = await backend.post<DramaScript>("/drama/scripts", { project_id: projectId, name, content });
    return data;
}

export async function getDramaScript(id: string) {
    const { data } = await backend.get<DramaScript>(`/drama/scripts/${id}`);
    return data;
}

export async function updateDramaScript(id: string, payload: { name?: string; content?: string }) {
    const { data } = await backend.put<DramaScript>(`/drama/scripts/${id}`, payload);
    return data;
}

export async function deleteDramaScript(id: string) {
    await backend.delete(`/drama/scripts/${id}`);
}

// Drama assets (资产)
export type DramaAsset = {
    id: string;
    user_id: string;
    project_id: string;
    name: string;
    describe: string | null;
    type: string | null;
    prompt: string | null;
    remark: string | null;
    image_url: string | null;
    image_model: string | null;
    image_state: string | null;
    error_reason: string | null;
    is_deleted: string;
    created_at: string;
    updated_at: string;
};

export async function listDramaAssets(projectId: string, assetType?: string) {
    const { data } = await backend.get<DramaAsset[]>("/drama/assets", {
        params: { project_id: projectId, asset_type: assetType },
    });
    return data;
}

export async function createDramaAsset(payload: { project_id: string; name: string; type?: string; describe?: string; prompt?: string; remark?: string }) {
    const { data } = await backend.post<DramaAsset>("/drama/assets", payload);
    return data;
}

export async function updateDramaAsset(id: string, payload: { name?: string; type?: string; describe?: string; prompt?: string; remark?: string }) {
    const { data } = await backend.put<DramaAsset>(`/drama/assets/${id}`, payload);
    return data;
}

export async function deleteDramaAsset(id: string) {
    await backend.delete(`/drama/assets/${id}`);
}

export async function generateDramaAsset(id: string, model: string, size = "1024x1024") {
    const { data } = await backend.post<DramaAsset>(`/drama/assets/${id}/generate`, { model, size });
    return data;
}

// Drama storyboard (分镜)
export type DramaStoryboard = {
    id: string;
    user_id: string;
    project_id: string;
    script_id: string | null;
    index: number;
    prompt: string | null;
    video_desc: string | null;
    duration: number | null;
    image_url: string | null;
    image_state: string | null;
    error_reason: string | null;
    is_deleted: string;
    created_at: string;
    updated_at: string;
};

export async function listDramaStoryboards(projectId: string, scriptId?: string) {
    const { data } = await backend.get<DramaStoryboard[]>("/drama/storyboards", {
        params: { project_id: projectId, script_id: scriptId },
    });
    return data;
}

export async function createDramaStoryboard(payload: { project_id: string; script_id?: string; index?: number; prompt?: string; video_desc?: string; duration?: number }) {
    const { data } = await backend.post<DramaStoryboard>("/drama/storyboards", payload);
    return data;
}

export async function updateDramaStoryboard(id: string, payload: Partial<DramaStoryboard>) {
    const { data } = await backend.put<DramaStoryboard>(`/drama/storyboards/${id}`, payload);
    return data;
}

export async function deleteDramaStoryboard(id: string) {
    await backend.delete(`/drama/storyboards/${id}`);
}

export async function generateStoryboardImage(id: string, model: string, size = "1024x1024") {
    const { data } = await backend.post<DramaStoryboard>(`/drama/storyboards/${id}/generate-image`, { model, size });
    return data;
}

export async function generateStoryboardsFromScript(projectId: string, scriptId: string) {
    const { data } = await backend.post<{ ok: boolean; count: number }>("/drama/storyboards/generate-from-script", {
        project_id: projectId,
        script_id: scriptId,
    });
    return data;
}

// Drama video (视频)
export type DramaVideo = {
    id: string;
    user_id: string;
    project_id: string;
    script_id: string | null;
    storyboard_id: string | null;
    prompt: string | null;
    video_url: string | null;
    duration: number | null;
    model: string | null;
    state: string;
    error_reason: string | null;
    is_deleted: string;
    created_at: string;
    updated_at: string;
};

export async function listDramaVideos(projectId: string) {
    const { data } = await backend.get<DramaVideo[]>("/drama/videos", { params: { project_id: projectId } });
    return data;
}

export async function createDramaVideo(payload: { project_id: string; script_id?: string; storyboard_id?: string; prompt?: string; duration?: number; model: string }) {
    const { data } = await backend.post<DramaVideo>("/drama/videos", payload);
    return data;
}

export async function deleteDramaVideo(id: string) {
    await backend.delete(`/drama/videos/${id}`);
}

// Drama task board (任务看板聚合)
export type DramaTaskSummary = {
    project_id: string;
    scripts: { total: number; with_content: number };
    assets: { total: number; done: number; failed: number };
    storyboards: { total: number; done: number };
    videos: { total: number; success: number; failed: number };
};

export async function getDramaTasksSummary(projectId: string) {
    const { data } = await backend.get<DramaTaskSummary>("/drama/tasks/summary", { params: { project_id: projectId } });
    return data;
}

// Drama art style (画风)
export type DramaArtStyle = {
    id: string;
    user_id: string;
    name: string;
    prompt: string | null;
    image_url: string | null;
    is_deleted: string;
    created_at: string;
    updated_at: string;
};

export async function listDramaArtStyles() {
    const { data } = await backend.get<DramaArtStyle[]>("/drama/art-styles");
    return data;
}

export async function createDramaArtStyle(payload: { name: string; prompt?: string; image_url?: string }) {
    const { data } = await backend.post<DramaArtStyle>("/drama/art-styles", payload);
    return data;
}

export async function updateDramaArtStyle(id: string, payload: { name?: string; prompt?: string; image_url?: string }) {
    const { data } = await backend.put<DramaArtStyle>(`/drama/art-styles/${id}`, payload);
    return data;
}

export async function deleteDramaArtStyle(id: string) {
    await backend.delete(`/drama/art-styles/${id}`);
}

// Drama models (模型与部署)
export type DramaModels = {
    ok: boolean;
    models: Record<"text" | "image" | "video" | "audio", { variable_name: string; vendor: string; model_version: string }[]>;
};

export async function getDramaModels() {
    const { data } = await backend.get<DramaModels>("/drama/models");
    return data;
}

// Assets
export type BackendAsset = {
    id: string;
    user_id: string;
    asset_type: "image" | "video" | "audio" | "text";
    name: string;
    storage_key: string;
    mime_type: string | null;
    size_bytes: number | null;
    width: number | null;
    height: number | null;
    duration_seconds: number | null;
    prompt: string | null;
    meta: Record<string, unknown>;
    project_id: string | null;
    url?: string;
    created_at: string;
    updated_at: string;
};

export async function listAssets(assetType?: string, projectId?: string) {
    const { data } = await backend.get<BackendAsset[]>("/assets", { params: { asset_type: assetType, project_id: projectId } });
    return data;
}

export async function createAsset(payload: Omit<BackendAsset, "id" | "user_id" | "created_at" | "updated_at" | "url">) {
    const { data } = await backend.post<BackendAsset>("/assets", payload);
    return data;
}

export async function deleteAsset(id: string) {
    await backend.delete(`/assets/${id}`);
}

export function getAssetUrl(storageKey: string) {
    if (!storageKey) return "";
    // 已是完整 URL（含 COS presigned URL）直接返回
    if (/^https?:\/\//.test(storageKey)) return storageKey;
    // storageKey 可能是本地路径（uploads/uuid/...）或 COS key（generated/uid/...）
    // 统一走后端 /api/v1/upload/{storage_key} 解析，后端会返回本地文件或 COS 签名链接
    const prefix = storageKey.startsWith("/") ? "" : "/";
    return `${BACKEND_BASE_URL}/api/v1/upload${prefix}${storageKey}`;
}

// Admin
export type AdminApiSource = {
    id: number;
    modal_category: "text" | "image" | "audio" | "video";
    vendor: string;
    model_version: string;
    source_name: string;
    priority: number;
    base_url: string;
    endpoint_path: string;
    api_key_plain?: string;
    timeout_ms: number;
    retry_count: number;
    is_active: boolean;
    cost_level: string;
    quality_level: string;
    allowed_user_levels: string[];
    extra_headers: Record<string, string> | null;
    extra_body: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
};

export type AdminVariableMapping = {
    id: number;
    variable_name: string;
    modal_category: "text" | "image" | "audio" | "video";
    default_source_id: number;
    fallback_source_ids: number[];
    condition_rules: Record<string, unknown>;
    description: string | null;
    created_at: string;
    updated_at: string;
};

export type AdminCallLog = {
    id: string;
    user_id: string;
    variable_name: string;
    modal_category: string;
    source_id: number | null;
    status: string;
    status_code: number | null;
    latency_ms: number;
    error_message: string | null;
    cost_credits: number;
    created_at: string;
};

export async function adminListModels() {
    const { data } = await backend.get<AdminApiSource[]>("/admin/models");
    return data;
}

export async function adminCreateModel(payload: Omit<AdminApiSource, "id" | "created_at" | "updated_at">) {
    const { data } = await backend.post<AdminApiSource>("/admin/models", payload);
    return data;
}

export async function adminUpdateModel(id: number, payload: Partial<Omit<AdminApiSource, "id" | "created_at" | "updated_at">>) {
    const { data } = await backend.put<AdminApiSource>(`/admin/models/${id}`, payload);
    return data;
}

export async function adminDeleteModel(id: number) {
    await backend.delete(`/admin/models/${id}`);
}

export async function adminListVariables() {
    const { data } = await backend.get<AdminVariableMapping[]>("/admin/variables");
    return data;
}

export async function adminCreateVariable(payload: Omit<AdminVariableMapping, "id" | "created_at" | "updated_at">) {
    const { data } = await backend.post<AdminVariableMapping>("/admin/variables", payload);
    return data;
}

export async function adminUpdateVariable(id: number, payload: Partial<Omit<AdminVariableMapping, "id" | "created_at" | "updated_at">>) {
    const { data } = await backend.put<AdminVariableMapping>(`/admin/variables/${id}`, payload);
    return data;
}

export async function adminDeleteVariable(id: number) {
    await backend.delete(`/admin/variables/${id}`);
}

// Agent config (通用 Agent + 短剧工坊智能体)
export type AgentConfigScope = {
    system_prompt: string | null;
    model_variable: string | null;
    enabled_tools: string[] | null;
    max_steps: number | null;
    tool_timeout_sec: number | null;
};

export async function adminGetAgentConfig() {
    const { data } = await backend.get<{ ok: boolean; scopes: Record<string, AgentConfigScope> }>("/admin/agent-config");
    return data;
}

export async function adminUpdateAgentConfig(scope: string, payload: Partial<AgentConfigScope>) {
    const { data } = await backend.put<{ ok: boolean; config: AgentConfigScope }>(`/admin/agent-config/${scope}`, payload);
    return data;
}

export async function adminListUsers(q?: string) {
    const { data } = await backend.get<BackendUser[]>("/admin/users", { params: { q } });
    return data;
}

export async function adminAddCredits(userId: string, delta: number, reason = "admin_recharge") {
    const { data } = await backend.post<{ user_id: string; new_balance: number }>(`/admin/users/${userId}/credits`, null, { params: { delta, reason } });
    return data;
}

export async function adminBanUser(userId: string) {
    await backend.post(`/admin/users/${userId}/ban`);
}

export async function adminUnbanUser(userId: string) {
    await backend.post(`/admin/users/${userId}/unban`);
}

export async function adminUpdateUser(userId: string, payload: { role?: string; level?: string; nickname?: string }) {
    const { data } = await backend.put<BackendUser>(`/admin/users/${userId}`, payload);
    return data;
}

export type AdminUserDetail = {
    user: { id: string; email: string; nickname: string | null; role: string; level: string; credits: number; status: string; created_at: string | null };
    ledger: { id: string; delta: number; balance_after: number; reason: string; created_at: string | null }[];
    recent_calls: { id: string; variable_name: string; modal_category: string; status: string; status_code: number | null; latency_ms: number; cost_credits: number; created_at: string | null }[];
    assets: { id: string; name: string; asset_type: string; created_at: string | null }[];
};

export async function adminGetUserDetail(userId: string) {
    const { data } = await backend.get<AdminUserDetail>(`/admin/users/${userId}`);
    return data;
}

export type AdminDashboard = {
    users: { total: number; active: number; new_today: number };
    calls: { total: number; today: number; success: number };
    credits: { total_cost: number; cost_today: number };
    by_variable: { variable_name: string; count: number }[];
    trend: { date: string; count: number }[];
};

export async function adminGetDashboard() {
    const { data } = await backend.get<AdminDashboard>("/admin/dashboard");
    return data;
}

export async function adminTestModel(sourceId: number) {
    const { data } = await backend.post<{ ok: boolean; status_code?: number; detail?: string; error?: string }>(`/admin/models/${sourceId}/test`);
    return data;
}

export async function adminGetModelStats() {
    const { data } = await backend.get<{ stats: Record<number, { total: number; success: number; success_rate: number; avg_latency_ms: number }> }>("/admin/models/stats");
    return data;
}

export async function adminListLogs(params?: { user_id?: string; variable_name?: string; status?: string; limit?: number; offset?: number }) {
    const { data } = await backend.get<{ total: number; items: AdminCallLog[] }>("/admin/logs", { params });
    return data;
}

/**
 * Extract a user-friendly error message from an axios error.
 */
export function getBackendErrorMessage(error: unknown, fallback = "操作失败"): string {
    if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 402) return "积分不足，请联系管理员充值";
        const detail = error.response?.data?.detail;
        if (typeof detail === "string") return detail;
        if (Array.isArray(detail)) return detail.map((d) => (typeof d === "string" ? d : d.msg)).join("; ");
        return error.message || fallback;
    }
    if (error instanceof Error) return error.message;
    return fallback;
}
