import { useState } from "react";
import { App, Button, InputNumber, Select, Spin, Empty } from "antd";

import { getBackendErrorMessage, splitVideoPrompts } from "@/services/api/backend";

export default function DramaPromptStudioPage() {
    const { message } = App.useApp();
    const [prompt, setPrompt] = useState("");
    const [custom, setCustom] = useState("");
    const [segments, setSegments] = useState(3);
    const [segmentSeconds, setSegmentSeconds] = useState(15);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState("");

    const run = async () => {
        const text = prompt.trim();
        if (!text) {
            message.warning("请先输入一句话创意");
            return;
        }
        setLoading(true);
        setResult("");
        try {
            const res = await splitVideoPrompts({ prompt: text, segments, segment_seconds: segmentSeconds, custom });
            setResult(res.content);
        } catch (e) {
            message.error(getBackendErrorMessage(e, "生成失败"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto py-6">
            <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <h1 className="text-xl font-medium text-foreground">分段提示词</h1>
                    <p className="text-sm text-muted-foreground">输入一句话创意，自动展开成分段视频生成提示词（单段 ≤15 秒，适配主流视频模型）</p>
                </div>
            </div>

            <div className="mt-6 flex flex-col gap-4">
                <div className="rounded-lg border border-stone-200 bg-card p-5 dark:border-stone-800">
                    <label className="text-sm font-medium text-stone-700 dark:text-stone-300">一句话创意</label>
                    <textarea
                        className="mt-1 min-h-20 w-full rounded-md border border-stone-200 bg-background p-3 text-sm text-foreground outline-none focus:border-stone-400 dark:border-stone-800"
                        placeholder='例如：把一瓶 2 元的纯净水卖到 100 元'
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                    />

                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                            <label className="text-sm font-medium text-stone-700 dark:text-stone-300">段落数</label>
                            <div className="mt-1 flex items-center gap-2">
                                <InputNumber min={1} max={12} value={segments} onChange={(v) => setSegments(v ?? 3)} className="w-28" />
                                <span className="text-xs text-muted-foreground">段</span>
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-medium text-stone-700 dark:text-stone-300">单段时长</label>
                            <div className="mt-1 flex items-center gap-2">
                                <InputNumber min={5} max={30} value={segmentSeconds} onChange={(v) => setSegmentSeconds(v ?? 15)} className="w-28" />
                                <span className="text-xs text-muted-foreground">秒 / 段（默认 15，模型单次上限）</span>
                            </div>
                        </div>
                    </div>

                    <div className="mt-4">
                        <label className="text-sm font-medium text-stone-700 dark:text-stone-300">附加要求（可选）</label>
                        <textarea
                            className="mt-1 min-h-14 w-full rounded-md border border-stone-200 bg-background p-3 text-sm text-foreground outline-none focus:border-stone-400 dark:border-stone-800"
                            placeholder="例如：16:9 横屏、电影感、角色外观固定"
                            value={custom}
                            onChange={(e) => setCustom(e.target.value)}
                        />
                    </div>

                    <div className="mt-4 flex justify-end">
                        <Button type="primary" disabled={loading || !prompt.trim()} onClick={() => void run()}>
                            {loading ? <Spin size="small" /> : "生成分段提示词 →"}
                        </Button>
                    </div>
                </div>

                <div className="rounded-lg border border-stone-200 bg-card p-5 dark:border-stone-800">
                    <div className="mb-2 flex items-center justify-between">
                        <h2 className="text-sm font-medium text-foreground">输出</h2>
                        {result ? (
                            <Button
                                size="small"
                                onClick={() => {
                                    void navigator.clipboard.writeText(result);
                                    message.success("已复制");
                                }}
                            >
                                复制全部
                            </Button>
                        ) : null}
                    </div>
                    {result ? (
                        <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md bg-stone-50 p-3 text-sm leading-relaxed text-stone-800 dark:bg-stone-900 dark:text-stone-200">{result}</pre>
                    ) : (
                        <Empty description={loading ? "生成中…" : "等待输入"} />
                    )}
                </div>
            </div>
        </div>
    );
}
