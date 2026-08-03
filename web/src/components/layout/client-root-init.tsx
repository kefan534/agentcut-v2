import type { ReactNode } from "react";
import { useEffect } from "react";

import { useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { useUserStore } from "@/stores/use-user-store";
import { useAgentStore } from "@/stores/use-agent-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const refreshSession = useUserStore((state) => state.refreshSession);
    const clearSession = useUserStore((state) => state.clearSession);
    const fetchBackendChannels = useConfigStore((state) => state.fetchBackendChannels);
    const loadAgentToken = useAgentStore((state) => state.loadPersistedToken);

    useEffect(() => {
        void loadAgentToken();
    }, [loadAgentToken]);

    useEffect(() => {
        void refreshSession().then(() => {
            void fetchBackendChannels();
        });
    }, [refreshSession, fetchBackendChannels]);

    useEffect(() => {
        const handleAuthRequired = () => {
            clearSession();
            // Preserve current path so user can return after login
            const current = window.location.pathname + window.location.search;
            if (current !== "/login") {
                window.location.href = `/login?redirect=${encodeURIComponent(current)}`;
            }
        };
        window.addEventListener("ic:auth:required" as never, handleAuthRequired);
        return () => window.removeEventListener("ic:auth:required" as never, handleAuthRequired);
    }, [clearSession]);

    usePromptSourceScheduler();

    return <>{children}</>;
}
