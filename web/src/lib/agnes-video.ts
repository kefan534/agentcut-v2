import { type AiConfig, resolveModelRequestConfig } from "@/stores/use-config-store";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import type { ReferenceImage } from "@/types/image";

/** Agnes Video 2.5 / 2.5 Flash 模型 ID（与上游 API 的 model 字段一致，同时是后端网关 variable_name）。 */
export const AGNES_VIDEO_25 = "agnes-video-2.5";
export const AGNES_VIDEO_25_FLASH = "agnes-video-2.5-flash";

export const AGNES_REFERENCE_LIMITS = {
    images: 9,
    videos: 3,
    audios: 3,
    imageMaxBytes: 30 * 1024 * 1024,
    videoMaxBytes: 50 * 1024 * 1024,
    audioMaxBytes: 15 * 1024 * 1024,
} as const;

/** Flash 专属收窄：参考图 ≤5、不支持参考视频、分辨率固定 720P。 */
export const AGNES_FLASH_LIMITS = {
    images: 5,
    videos: 0,
    audios: 3,
} as const;

export const AGNES_VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime"] as const;

export const agnesResolutionOptions = [
    { value: "720P", label: "720P" },
    { value: "960P", label: "960P" },
    { value: "2K", label: "2K" },
] as const;

export const agnesRatioOptions = [
    { value: "16:9", label: "横屏" },
    { value: "9:16", label: "竖屏" },
    { value: "1:1", label: "方形" },
    { value: "4:3", label: "标准横屏" },
    { value: "3:4", label: "标准竖屏" },
    { value: "21:9", label: "宽银幕" },
] as const;

export type AgnesVideoMode = "text" | "keyframe" | "reference";

export function isAgnesVideoModel(model: string | undefined) {
    return /agnes[-_]?video/i.test(model || "");
}

export function isAgnesFlashModel(model: string | undefined) {
    return /agnes[-_]?video.*flash/i.test(model || "");
}

export function isAgnesVideoConfig(config: AiConfig | Pick<AiConfig, "model" | "videoModel" | "apiFormat">) {
    const requestConfig = "channels" in config ? resolveModelRequestConfig(config, config.model || config.videoModel) : config;
    return isAgnesVideoModel(requestConfig.model);
}

/** 分辨率档（size 参数）：仅接受 720P / 960P / 2K；Flash 固定 720P。 */
export function normalizeAgnesSize(value: string, flash = false) {
    if (flash) return "720P";
    const normalized = String(value || "720P").toUpperCase().replace(/\s+/g, "");
    if (agnesResolutionOptions.some((item) => item.value === normalized)) return normalized;
    if (normalized.startsWith("960")) return "960P";
    if (normalized.includes("2K")) return "2K";
    return "720P";
}

/** 画幅：白名单枚举，不支持 auto/像素写法。 */
export function normalizeAgnesRatio(value: string) {
    const candidate = String(value || "").trim();
    if (agnesRatioOptions.some((item) => item.value === candidate)) return candidate;
    const match = candidate.match(/^(\d+)[x×:](\d+)$/);
    if (match) {
        const width = Number(match[1]);
        const height = Number(match[2]);
        if (width > 0 && height > 0) {
            const ratio = width / height;
            const options = [
                ["16:9", 16 / 9],
                ["4:3", 4 / 3],
                ["1:1", 1],
                ["3:4", 3 / 4],
                ["9:16", 9 / 16],
                ["21:9", 21 / 9],
            ] as const;
            return options.reduce((best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best), options[0])[0];
        }
    }
    return "16:9";
}

/** 时长：字符串 "4"–"12"，默认 "5"（API 要求字符串类型）。 */
export function normalizeAgnesSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 5);
    return String(Math.max(4, Math.min(12, seconds)));
}

export function agnesReferenceLimits(model: string | undefined) {
    return isAgnesFlashModel(model)
        ? { ...AGNES_REFERENCE_LIMITS, images: AGNES_FLASH_LIMITS.images, videos: AGNES_FLASH_LIMITS.videos }
        : { ...AGNES_REFERENCE_LIMITS };
}

export function agnesReferenceLabel(kind: "image" | "video" | "audio", index: number) {
    if (kind === "image") return `图片${index + 1}`;
    if (kind === "video") return `视频${index + 1}`;
    return `音频${index + 1}`;
}

/**
 * 参考生成模式的提示词：把前端 @N 引用标记翻译成 Agnes 占位符。
 * 编号顺序与视频页 combinedRefs 一致：图片 → 视频 → 音频。
 * <Picture N> / <Video N> / <Audio N>（各自数组内从 1 开始编号）。
 */
export function buildAgnesPromptText(prompt: string, images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[]) {
    const placeholders = [
        ...images.map((_, index) => `<Picture ${index + 1}>`),
        ...videos.map((_, index) => `<Video ${index + 1}>`),
        ...audios.map((_, index) => `<Audio ${index + 1}>`),
    ];
    let text = prompt.trim();
    if (placeholders.length) {
        // @N 从 1 开始；只在 reference 模式下做替换
        text = text.replace(/@(\d{1,2})/g, (raw, digits: string) => {
            const index = Number(digits) - 1;
            return index >= 0 && index < placeholders.length ? placeholders[index] : raw;
        });
        const note = `参考素材：${placeholders.map((token, index) => `${token}=素材${index + 1}`).join("、")}。请结合参考素材理解提示词。`;
        return `${note}\n\n${text}`;
    }
    return text;
}

export function agnesVideoReferenceError(videos: ReferenceVideo[], model: string | undefined) {
    if (isAgnesFlashModel(model) && videos.length) return "Agnes 2.5 Flash 不支持参考视频，请移除参考视频或切换 Agnes Video 2.5";
    let totalDurationMs = 0;
    for (let index = 0; index < videos.length; index += 1) {
        const video = videos[index];
        const label = agnesReferenceLabel("video", index);
        if (!AGNES_VIDEO_MIME_TYPES.includes(video.type as typeof AGNES_VIDEO_MIME_TYPES[number])) return `${label} 仅支持 mp4/mov 格式`;
        if (video.bytes && video.bytes > AGNES_REFERENCE_LIMITS.videoMaxBytes) return `${label} 超过 50MB，请压缩后再上传`;
        if (video.durationMs) {
            if (video.durationMs < 2000 || video.durationMs > 15000) return `${label} 时长需要在 2-15 秒之间`;
            totalDurationMs += video.durationMs;
        }
    }
    if (totalDurationMs > 15000) return "参考视频总时长不能超过 15 秒";
    return "";
}

export function agnesAudioReferenceError(audios: ReferenceAudio[]) {
    let totalDurationMs = 0;
    for (let index = 0; index < audios.length; index += 1) {
        const audio = audios[index];
        const label = agnesReferenceLabel("audio", index);
        if (audio.durationMs) {
            if (audio.durationMs < 2000 || audio.durationMs > 15000) return `${label} 时长需要在 2-15 秒之间`;
            totalDurationMs += audio.durationMs;
        }
    }
    if (totalDurationMs > 15000) return "参考音频总时长不能超过 15 秒";
    return "";
}

export const agnesVideoReferenceHint = "参考视频需为 mp4/mov，时长 2-15 秒；参考音频需为 mp3/wav，时长 2-15 秒。";
