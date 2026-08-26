import { useState } from "react";
import { App, Button, Select, Spin, Upload, Empty } from "antd";
import { UploadOutlined } from "@ant-design/icons";

import { analyzeMedia, getBackendErrorMessage } from "@/services/api/backend";

const MEDIA_KIND_OPTIONS = [
    { value: "image", label: "图片" },
    { value: "video", label: "视频" },
    { value: "audio", label: "音乐 / 音频" },
];

const MEDIA_PROMPTS: Record<string, string> = {
    image:
        "请专业分析这张图片：主体、构图、景别、机位、光线、色彩、空间关系、可见文字、人物/场景/道具/特效资产、连续性风险，并给出可复刻的 AI 图像/视频提示词。",
    video:
        "请逐段分析这个视频：时间码、镜头、动作、构图、运镜、节奏、人物/场景/道具/特效资产、光线、剪辑、音画关系、连续性，并给出可复刻的视频提示词。",
    audio:
        "请完整拆解这段音乐/音频：BPM 与拍号估计、Intro/Verse/Chorus/Bridge/Outro 时间段、人声/歌词、主要乐器、鼓点、低频、旋律、动态、强拍、转折、高潮、情绪曲线，并给出 AI MV 资产与逐段画面规划。",
};

const KIND_ACCEPT: Record<string, string> = {
    image: "image/*",
    video: "video/*",
    audio: "audio/*",
};

export default function DramaMediaLabPage() {
    const { message } = App.useApp();
    const [kind, setKind] = useState<"image" | "video" | "audio">("image");
    const [prompt, setPrompt] = useState(MEDIA_PROMPTS.image);
    const [file, setFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState("");

    const switchKind = (value: string) => {
        const k = value as "image" | "video" | "audio";
        setKind(k);
        setPrompt(MEDIA_PROMPTS[k]);
        setFile(null);
        setResult("");
    };

    const run = async () => {
        if (!file) {
            message.warning("请先选择媒体文件");
            return;
        }
        setLoading(true);
        setResult("");
        try {
            const res = await analyzeMedia(file, kind, prompt);
            setResult(res.analysis);
        } catch (e) {
            message.error(getBackendErrorMessage(e, "分析失败"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto py-6">
            <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                    <h1 className="text-xl font-medium text-foreground">多模态实验室</h1>
                    <p className="text-sm text-muted-foreground">上传图片 / 视频 / 音乐，AI 拆解后给出可复刻的提示词（对标乐凡 Omni 分析）</p>
                </div>
            </div>

            <div className="mt-6 flex flex-col gap-4">
                <div className="rounded-lg border border-stone-200 bg-card p-5 dark:border-stone-800">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div>
                            <label className="text-sm font-medium text-stone-700 dark:text-stone-300">媒体类型</label>
                            <Select className="mt-1 w-full" value={kind} options={MEDIA_KIND_OPTIONS} onChange={switchKind} />
                        </div>
                        <div className="md:col-span-2">
                            <label className="text-sm font-medium text-stone-700 dark:text-stone-300">媒体文件</label>
                            <Upload
                                className="mt-1 w-full"
                                accept={KIND_ACCEPT[kind]}
                                maxCount={1}
                                beforeUpload={(f) => {
                                    if (f.size > 20 * 1024 * 1024) {
                                        message.error("文件不能超过 20MB");
                                        return Upload.LIST_IGNORE;
                                    }
                                    setFile(f);
                                    return false;
                                }}
                                onRemove={() => setFile(null)}
                            >
                                <Button icon={<UploadOutlined />}>选择{kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}文件</Button>
                            </Upload>
                        </div>
                    </div>

                    <div className="mt-4">
                        <label className="text-sm font-medium text-stone-700 dark:text-stone-300">分析要求</label>
                        <textarea
                            className="mt-1 min-h-24 w-full rounded-md border border-stone-200 bg-background p-3 text-sm text-foreground outline-none focus:border-stone-400 dark:border-stone-800"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                        />
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">图片直接分析；视频自动抽取首帧分析；音频需配置音频模型（AUDIO_MODEL）</span>
                        <Button type="primary" disabled={loading || !file} onClick={() => void run()}>
                            {loading ? <Spin size="small" /> : "分析媒体 →"}
                        </Button>
                    </div>
                </div>

                <div className="rounded-lg border border-stone-200 bg-card p-5 dark:border-stone-800">
                    <div className="mb-2 flex items-center justify-between">
                        <h2 className="text-sm font-medium text-foreground">分析结果</h2>
                        {result ? (
                            <Button
                                size="small"
                                onClick={() => {
                                    void navigator.clipboard.writeText(result);
                                    message.success("已复制");
                                }}
                            >
                                复制
                            </Button>
                        ) : null}
                    </div>
                    {result ? (
                        <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md bg-stone-50 p-3 text-sm leading-relaxed text-stone-800 dark:bg-stone-900 dark:text-stone-200">{result}</pre>
                    ) : (
                        <Empty description={loading ? "分析中…" : "等待分析"} />
                    )}
                </div>
            </div>
        </div>
    );
}
