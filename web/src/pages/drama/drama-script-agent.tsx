import { Sparkles, Send, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Drawer, Input, Empty } from "antd";

import { BACKEND_BASE_URL, getMemoryAccessToken } from "@/services/api/backend";

type Msg = { id: string; role: "user" | "assistant"; text: string };

let seq = 0;
function nextId() {
    seq += 1;
    return `sa-${Date.now()}-${seq}`;
}

export function DramaScriptAgentDrawer({
    projectId,
    projectName,
    open,
    onClose,
}: {
    projectId: string;
    projectName: string;
    open: boolean;
    onClose: () => void;
}) {
    const [messages, setMessages] = useState<Msg[]>([]);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const esRef = useRef<EventSource | null>(null);
    const threadIdRef = useRef(`drama-sa-${Date.now()}`);
    const listRef = useRef<HTMLDivElement | null>(null);

    // 建立 SSE 连接，接收 agent 事件
    useEffect(() => {
        if (!open) return;
        const clientId = `drama-sa-${Date.now()}`;
        const token = getMemoryAccessToken();
        let url = `${BACKEND_BASE_URL}/api/v1/agent/events?clientId=${clientId}`;
        if (token) url += `&token=${encodeURIComponent(token)}`;
        const es = new EventSource(url, { withCredentials: true });

        const onAgentEvent = (e: MessageEvent) => {
            const data = JSON.parse(e.data);
            if (data.type === "item.updated") {
                const text = data.item?.text || "";
                setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last && last.role === "assistant") {
                        return [...prev.slice(0, -1), { ...last, text }];
                    }
                    return [...prev, { id: nextId(), role: "assistant", text }];
                });
            } else if (data.type === "turn.completed") {
                setBusy(false);
            }
        };
        const onCodexState = (e: MessageEvent) => {
            const data = JSON.parse(e.data);
            if (data.busy === false) setBusy(false);
        };
        const onError = (e: MessageEvent) => {
            const data = JSON.parse(e.data);
            setMessages((prev) => [...prev, { id: nextId(), role: "assistant", text: `⚠️ ${data.message || "出错了"}` }]);
            setBusy(false);
        };

        es.addEventListener("agent_event", onAgentEvent);
        es.addEventListener("codex_state", onCodexState);
        es.addEventListener("agent_error", onError);
        esRef.current = es;
        return () => {
            es.removeEventListener("agent_event", onAgentEvent);
            es.removeEventListener("codex_state", onCodexState);
            es.removeEventListener("agent_error", onError);
            es.close();
            esRef.current = null;
        };
    }, [open]);

    // 滚动到底部
    useEffect(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }, [messages]);

    const send = async () => {
        const text = input.trim();
        if (!text || busy) return;
        setMessages((prev) => [...prev, { id: nextId(), role: "user", text }]);
        setInput("");
        setBusy(true);
        try {
            await fetch(`${BACKEND_BASE_URL}/api/v1/agent/turn`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                    prompt: text,
                    threadId: threadIdRef.current,
                    scope: "script_agent",
                    projectId,
                }),
            });
        } catch {
            setMessages((prev) => [...prev, { id: nextId(), role: "assistant", text: "⚠️ 发送失败，请重试" }]);
            setBusy(false);
        }
    };

    return (
        <Drawer
            title={
                <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-stone-500" />
                    <span>AI 编剧</span>
                    <span className="text-xs font-normal text-stone-400">项目：{projectName}</span>
                </div>
            }
            placement="right"
            width={480}
            open={open}
            onClose={onClose}
            destroyOnClose
        >
            <div className="flex h-full flex-col">
                <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-3">
                    {messages.length === 0 ? (
                        <div className="flex h-full items-center justify-center">
                            <Empty description="和编剧聊聊，帮你读小说、写剧本" />
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {messages.map((m) => (
                                <div
                                    key={m.id}
                                    className={
                                        m.role === "user"
                                            ? "ml-auto max-w-[85%] rounded-lg bg-stone-900 px-3 py-2 text-sm text-white"
                                            : "mr-auto max-w-[85%] whitespace-pre-wrap rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-800 dark:bg-stone-800 dark:text-stone-100"
                                    }
                                >
                                    {m.text}
                                </div>
                            ))}
                            {busy ? (
                                <div className="flex items-center gap-1 text-xs text-stone-400">
                                    <Loader2 className="size-3 animate-spin" /> 编剧正在创作…
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
                <div className="flex gap-2 border-t border-stone-200 pt-3 dark:border-stone-800">
                    <Input.TextArea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="例如：根据小说第 1、2 章写一集剧本"
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        onPressEnter={(e) => {
                            if (!e.shiftKey) {
                                e.preventDefault();
                                void send();
                            }
                        }}
                    />
                    <Button type="primary" icon={<Send className="size-4" />} loading={busy} onClick={() => void send()} />
                </div>
            </div>
        </Drawer>
    );
}
