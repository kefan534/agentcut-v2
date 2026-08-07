import { useCallback, useEffect, useState } from "react";
import {
    listGenerationSessions,
    createGenerationSession,
    updateGenerationSession,
    deleteGenerationSession,
    type GenerationSession,
} from "@/services/api/backend";

export type ChatMedia = {
    id: string;
    url: string;
    mimeType?: string;
    width?: number;
    height?: number;
    bytes?: number;
};

export type ChatMessage = {
    id: string;
    role: "user" | "assistant";
    prompt?: string;
    model?: string;
    status: "pending" | "success" | "failed";
    media: ChatMedia[];
    error?: string;
    createdAt: string;
};

function sessionToMessages(session: GenerationSession, mediaType: "image" | "video"): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const isVideo = mediaType === "video";

    messages.push({
        id: `${session.id}-user`,
        role: "user",
        prompt: session.prompt,
        model: session.model,
        status: "success",
        media: [],
        createdAt: session.created_at,
    });

    messages.push({
        id: session.id,
        role: "assistant",
        model: session.model,
        status: session.status === "success" ? "success" : session.status === "failed" ? "failed" : "pending",
        media: (session.result_urls || []).map((url, index) => ({
            id: `${session.id}-${index}`,
            url,
            mimeType: isVideo || url.endsWith(".mp4") || url.endsWith(".webm") ? "video/mp4" : "image/png",
        })),
        error: session.error_message || undefined,
        createdAt: session.updated_at,
    });

    return messages;
}

export function useGenerationHistory(modalCategory: "image" | "video") {
    const [sessions, setSessions] = useState<GenerationSession[]>([]);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const sessions = await listGenerationSessions(modalCategory, 50, 0);
            setSessions(sessions);
            const synthesized: ChatMessage[] = [];
            for (const session of sessions) {
                synthesized.push(...sessionToMessages(session, modalCategory));
            }
            synthesized.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            setMessages(synthesized);
        } catch (e) {
            console.error("Failed to load generation history", e);
        } finally {
            setLoading(false);
        }
    }, [modalCategory]);

    useEffect(() => {
        void load();
    }, [load]);

    const createSession = useCallback(
        async (prompt: string, model: string, taskType: "text" | "reference" = "text", referenceUrls: string[] = []) => {
            const session = await createGenerationSession(modalCategory, prompt, model, taskType, referenceUrls);
            const sessionWithPhase = { ...session, phase: "queued" as const };
            setSessions((prev) => [...prev, sessionWithPhase]);
            const [userMsg, assistantMsg] = sessionToMessages(sessionWithPhase, modalCategory);
            setMessages((prev) => [...prev, userMsg, assistantMsg]);
            return session.id;
        },
        [modalCategory],
    );

    const updateSession = useCallback(async (sessionId: string, status: string, media?: ChatMedia[], error?: string, phase?: "queued" | "running") => {
        const resultUrls = media?.map((item) => item.url) || [];
        // phase 是前端本地状态，不持久化到后端
        const updated = await updateGenerationSession(sessionId, {
            status,
            result_urls: resultUrls,
            error_message: error || null,
        });
        setSessions((prev) =>
            prev.map((session) => (session.id === sessionId ? { ...session, ...updated, result_urls: resultUrls, phase: phase ?? session.phase } : session)),
        );
        setMessages((prev) =>
            prev.map((msg) =>
                msg.id === sessionId
                    ? {
                          ...msg,
                          status: updated.status === "success" ? "success" : updated.status === "failed" ? "failed" : "pending",
                          media: media || msg.media,
                          error: updated.error_message || undefined,
                      }
                    : msg,
            ),
        );
    }, []);

    const appendUser = useCallback((prompt: string, model: string) => {
        const id = `tmp-${Date.now()}-user`;
        setMessages((prev) => [
            ...prev,
            { id, role: "user", prompt, model, status: "success", media: [], createdAt: new Date().toISOString() },
        ]);
        return id;
    }, []);

    const appendAssistant = useCallback((model: string, status: ChatMessage["status"], media?: ChatMedia[], error?: string) => {
        const id = `tmp-${Date.now()}-assistant`;
        setMessages((prev) => [
            ...prev,
            { id, role: "assistant", model, status, media: media || [], error, createdAt: new Date().toISOString() },
        ]);
        return id;
    }, []);

    const updateAssistant = useCallback((id: string, updates: Partial<ChatMessage>) => {
        setMessages((prev) => prev.map((msg) => (msg.id === id ? { ...msg, ...updates } : msg)));
    }, []);

    const deleteSession = useCallback(async (sessionId: string) => {
        await deleteGenerationSession(sessionId);
        setSessions((prev) => prev.filter((session) => session.id !== sessionId));
        setMessages((prev) => prev.filter((msg) => !msg.id.startsWith(`${sessionId}-`) && msg.id !== sessionId));
    }, []);

    const removeResultUrl = useCallback(async (sessionId: string, url: string) => {
        const session = sessions.find((item) => item.id === sessionId);
        if (!session) return;
        const nextUrls = (session.result_urls || []).filter((item) => item !== url);
        const updated = await updateGenerationSession(sessionId, {
            status: session.status,
            result_urls: nextUrls,
            error_message: session.error_message,
        });
        setSessions((prev) => prev.map((item) => (item.id === sessionId ? { ...item, ...updated, result_urls: nextUrls } : item)));
        setMessages((prev) =>
            prev.map((msg) =>
                msg.id === sessionId
                    ? { ...msg, media: msg.media.filter((media) => media.url !== url) }
                    : msg,
            ),
        );
    }, [sessions]);

    return { sessions, messages, loading, load, createSession, updateSession, deleteSession, removeResultUrl, appendUser, appendAssistant, updateAssistant };
}
