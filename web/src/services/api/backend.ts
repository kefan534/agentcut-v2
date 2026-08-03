import axios, { type AxiosRequestConfig } from "axios";

export const BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8081";

export const backend = axios.create({
    baseURL: `${BACKEND_BASE_URL}/api/v1`,
    timeout: 360000,
    withCredentials: true,
});

// Plain axios instance for auth endpoints to avoid interceptor loops.
const authBackend = axios.create({
    baseURL: `${BACKEND_BASE_URL}/api/v1`,
    timeout: 30000,
    withCredentials: true,
});

let isRefreshing = false;
let refreshSubscribers: Array<(success: boolean) => void> = [];

function onRefreshed(success: boolean) {
    refreshSubscribers.forEach((cb) => cb(success));
    refreshSubscribers = [];
}

backend.interceptors.response.use(
    (response) => response,
    async (error) => {
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
    const { data } = await backend.post<BackendUser>("/auth/register", { email, password, nickname });
    return data;
}

export async function loginUser(email: string, password: string) {
    const { data } = await backend.post<{ access_token: string; refresh_token: string; token_type: string }>("/auth/login", { email, password });
    return data;
}

export async function logoutUser() {
    await backend.post("/auth/logout");
}

export async function fetchMe() {
    const { data } = await backend.get<BackendUser>("/auth/me");
    return data;
}

export async function refreshToken() {
    const { data } = await authBackend.post<{ access_token: string; refresh_token: string; token_type: string }>("/auth/refresh");
    return data;
}

export async function fetchAvailableModels() {
    const { data } = await backend.get<AvailableModel[]>("/gateway/models");
    return data;
}

export async function proxyGateway(variableName: string, endpoint: string, body: Record<string, unknown>, stream = false): Promise<unknown> {
    const { data } = await backend.post<unknown>(`/gateway/${variableName}/proxy`, { endpoint, body, stream });
    return data;
}

export async function proxyGatewayStream(variableName: string, endpoint: string, body: Record<string, unknown>) {
    const response = await fetch(`${BACKEND_BASE_URL}/api/v1/gateway/${variableName}/proxy`, {
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

export async function adminListLogs(params?: { user_id?: string; variable_name?: string; status?: string; limit?: number; offset?: number }) {
    const { data } = await backend.get<AdminCallLog[]>("/admin/logs", { params });
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
