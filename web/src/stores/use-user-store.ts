import { create } from "zustand";
import { persist } from "zustand/middleware";
import * as backendApi from "@/services/api/backend";

export type LocalUser = {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    email: string;
    role: "user" | "admin";
    level: string;
    credits: number;
};

type UserStore = {
    user: LocalUser | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    setUser: (user: LocalUser | null) => void;
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string, nickname?: string) => Promise<void>;
    logout: () => Promise<void>;
    refreshSession: () => Promise<void>;
    clearSession: () => void;
};

function mapBackendUser(data: backendApi.BackendUser): LocalUser {
    return {
        id: data.id,
        username: data.email,
        displayName: data.nickname || data.email,
        avatarUrl: data.avatar_url || "",
        email: data.email,
        role: data.role as "user" | "admin",
        level: data.level,
        credits: data.credits,
    };
}

export const useUserStore = create<UserStore>()(
    persist(
        (set) => ({
            user: null,
            isLoading: false,
            isAuthenticated: false,
            setUser: (user) => set({ user, isAuthenticated: !!user }),
            login: async (email, password) => {
                await backendApi.loginUser(email, password);
                const me = await backendApi.fetchMe();
                set({ user: mapBackendUser(me), isAuthenticated: true });
            },
            register: async (email, password, nickname) => {
                await backendApi.registerUser(email, password, nickname);
                const me = await backendApi.fetchMe();
                set({ user: mapBackendUser(me), isAuthenticated: true });
            },
            logout: async () => {
                try {
                    await backendApi.logoutUser();
                } catch {
                    // ignore
                }
                set({ user: null, isAuthenticated: false });
            },
            refreshSession: async () => {
                try {
                    await backendApi.refreshToken();
                    const me = await backendApi.fetchMe();
                    set({ user: mapBackendUser(me), isAuthenticated: true });
                } catch {
                    set({ user: null, isAuthenticated: false });
                }
            },
            clearSession: () => set({ user: null, isAuthenticated: false }),
        }),
        {
            name: "infinite-canvas:user_store",
            partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
        },
    ),
);
