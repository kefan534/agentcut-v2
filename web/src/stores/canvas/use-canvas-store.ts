import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import * as backendApi from "@/services/api/backend";
import { useUserStore } from "@/stores/use-user-store";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
    syncProjects: () => Promise<void>;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects) return;
        queuedPersistState = nextState;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void localForageStorage.setItem(name, JSON.stringify(value));
        }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

function projectToBackendPayload(project: CanvasProject): backendApi.BackendProject {
    return {
        id: project.id,
        user_id: "",
        name: project.title,
        description: null,
        thumbnail_url: null,
        canvas_data: {
            nodes: project.nodes,
            connections: project.connections,
            chatSessions: project.chatSessions,
            activeChatId: project.activeChatId,
            backgroundMode: project.backgroundMode,
            showImageInfo: project.showImageInfo,
            viewport: project.viewport,
        },
        meta: {},
        is_deleted: "false",
        created_at: project.createdAt,
        updated_at: project.updatedAt,
    };
}

function backendProjectToProject(p: backendApi.BackendProject): CanvasProject {
    const canvas = (p.canvas_data || {}) as Record<string, unknown>;
    return {
        id: p.id,
        title: p.name,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        nodes: (canvas.nodes as CanvasNodeData[]) || [],
        connections: (canvas.connections as CanvasConnection[]) || [],
        chatSessions: (canvas.chatSessions as CanvasAssistantSession[]) || [],
        activeChatId: (canvas.activeChatId as string | null) || null,
        backgroundMode: (canvas.backgroundMode as CanvasBackgroundMode) || "lines",
        showImageInfo: Boolean(canvas.showImageInfo),
        viewport: (canvas.viewport as ViewportTransform) || initialViewport,
    };
}

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            createProject: (title = "未命名画布") => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                const user = useUserStore.getState().user;
                if (user) {
                    void backendApi.createProject(project.title, projectToBackendPayload(project).canvas_data).catch(() => undefined);
                }
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || "导入画布",
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                const user = useUserStore.getState().user;
                if (user) {
                    void backendApi.createProject(project.title, projectToBackendPayload(project).canvas_data).catch(() => undefined);
                }
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => {
                    const projects = state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project));
                    queueSync();
                    return { projects };
                }),
            deleteProjects: (ids) =>
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    const user = useUserStore.getState().user;
                    if (user) {
                        for (const id of ids) {
                            void backendApi.deleteProject(id).catch(() => undefined);
                        }
                    }
                    return { projects };
                }),
            replaceProjects: (projects) => {
                set({ projects });
                queueSync();
            },
            updateProject: (id, patch) =>
                set((state) => {
                    const projects = state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project));
                    queueSync();
                    return { projects };
                }),
            syncProjects: async () => {
                const user = useUserStore.getState().user;
                if (!user) return;
                try {
                    const remote = await backendApi.listProjects();
                    const remoteMap = new Map(remote.map((p) => [p.id, backendProjectToProject(p)]));
                    set((state) => {
                        const localMap = new Map(state.projects.map((p) => [p.id, p]));
                        const merged: CanvasProject[] = [];
                        for (const id of new Set([...localMap.keys(), ...remoteMap.keys()])) {
                            const remoteProject = remoteMap.get(id);
                            const localProject = localMap.get(id);
                            if (remoteProject && localProject) {
                                merged.push(localProject.updatedAt > remoteProject.updatedAt ? localProject : remoteProject);
                            } else if (remoteProject) {
                                merged.push(remoteProject);
                            } else if (localProject) {
                                merged.push(localProject);
                            }
                        }
                        merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
                        return { projects: merged };
                    });
                } catch {
                    // Silently keep local state if backend is unavailable
                }
            },
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
                const user = useUserStore.getState().user;
                if (user) {
                    void useCanvasStore.getState().syncProjects();
                }
            },
        },
    ),
);

function queueSync() {
    const user = useUserStore.getState().user;
    if (!user) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        syncTimer = null;
        const projects = useCanvasStore.getState().projects;
        for (const project of projects) {
            void backendApi.updateProject(project.id, projectToBackendPayload(project)).catch(() => undefined);
        }
    }, 2000);
}
