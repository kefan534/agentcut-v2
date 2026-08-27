/**
 * 视频模型能力配置 —— 视频创作台左栏联动的唯一事实来源。
 *
 * 每个模型声明：
 *  - modalities: 支持的输入模态（文生视频 / 首尾帧 / 参考生成）
 *  - keyframeSlots: 首尾帧模态下开放哪些槽位
 *  - reference: 参考模态下各类素材的上限（videos/audios 为 0 表示该类型不支持）
 *
 * 新增模型只需在 videoModelCapabilities 里加一个分支，左栏 UI 自动联动。
 */

export type VideoModality = "text" | "keyframe" | "reference";

export type VideoModelCapabilities = {
    modalities: Array<{ id: VideoModality; label: string }>;
    keyframeSlots: { first: boolean; last: boolean };
    reference: { images: number; videos: number; audios: number };
    /** 参考模态下音频是否需要搭配视觉素材（图/视频） */
    audioNeedsVisual: boolean;
};

export const MODALITY_LABELS: Record<VideoModality, string> = {
    text: "文生视频",
    keyframe: "首尾帧",
    reference: "参考生成",
};

import { isAgnesFlashModel, isAgnesVideoModel } from "@/lib/agnes-video";
import { isMetasoVideoModel } from "@/lib/metaso-video";

export function videoModelCapabilities(model: string | undefined, apiFormat?: string): VideoModelCapabilities {
    const name = model || "";
    if (isAgnesVideoModel(name)) {
        const flash = isAgnesFlashModel(name);
        return {
            modalities: [
                { id: "text", label: MODALITY_LABELS.text },
                { id: "keyframe", label: MODALITY_LABELS.keyframe },
                { id: "reference", label: MODALITY_LABELS.reference },
            ],
            keyframeSlots: { first: true, last: true },
            reference: { images: flash ? 5 : 9, videos: flash ? 0 : 3, audios: 3 },
            audioNeedsVisual: false,
        };
    }
    if (isMetasoVideoModel(name)) {
        return {
            modalities: [
                { id: "text", label: MODALITY_LABELS.text },
                { id: "keyframe", label: "首帧" },
                { id: "reference", label: "多模态参考" },
            ],
            keyframeSlots: { first: true, last: false },
            reference: { images: 9, videos: 3, audios: 3 },
            audioNeedsVisual: true,
        };
    }
    if (apiFormat === "ark" || /seedance|doubao/i.test(name)) {
        return {
            modalities: [
                { id: "text", label: MODALITY_LABELS.text },
                { id: "reference", label: MODALITY_LABELS.reference },
            ],
            keyframeSlots: { first: false, last: false },
            reference: { images: 9, videos: 3, audios: 3 },
            audioNeedsVisual: true,
        };
    }
    // 默认（OpenAI /videos 兼容接口）：仅支持文生与图片参考
    return {
        modalities: [
            { id: "text", label: MODALITY_LABELS.text },
            { id: "reference", label: "图片参考" },
        ],
        keyframeSlots: { first: false, last: false },
        reference: { images: 7, videos: 0, audios: 0 },
        audioNeedsVisual: false,
    };
}

export function supportsModality(capabilities: VideoModelCapabilities, modality: VideoModality) {
    return capabilities.modalities.some((item) => item.id === modality);
}

function isArk(apiFormat?: string) {
    return apiFormat === "ark";
}


// ---------------------------------------------------------------------------
// 「清晰度 / 比例 / 尺寸」三级联动数据 —— 全部来自各模型官方文档
//
// sizeMode:
//   "upstream" 上游内部决定像素，界面置灰展示
//   "table"    官方「清晰度×比例」像素映射表，第三级只读显示唯一值
//   "free"     开放 W×H 自定义（当前仅 OpenAI 兼容通道）
// ---------------------------------------------------------------------------

export type ResolutionOption = { value: string; label: string };
export type RatioOption = { value: string; label: string };

export const OPENAI_RATIO_OPTIONS: RatioOption[] = [
    { value: "auto", label: "自动（由尺寸反推）" },
    { value: "16:9", label: "横屏 16:9" },
    { value: "9:16", label: "竖屏 9:16" },
    { value: "1:1", label: "方形 1:1" },
    { value: "3:4", label: "标准竖屏 3:4" },
];

export function resolutionOptionsFor(model: string | undefined, apiFormat?: string): ResolutionOption[] {
    const name = model || "";
    if (isAgnesFlashModel(name)) return [{ value: "720P", label: "720P（固定）" }];
    if (isAgnesVideoModel(name)) {
        return [
            { value: "720P", label: "720P" },
            { value: "960P", label: "960P" },
            { value: "2K", label: "2K" },
        ];
    }
    if (isMetasoVideoModel(name)) {
        return [
            { value: "768P", label: "768P" },
            { value: "2K", label: "2K" },
        ];
    }
    if (isArk(apiFormat)) {
        return [
            { value: "480p", label: "480p" },
            { value: "720p", label: "720p" },
            { value: "1080p", label: "1080p" },
        ];
    }
    // OpenAI 兼容：自由档位 + 自定义
    return [
        { value: "480", label: "480p" },
        { value: "720", label: "720p" },
        { value: "1080", label: "1080p" },
        { value: "custom", label: "自定义…" },
    ];
}

const COMMON_RATIO_OPTIONS: RatioOption[] = [
    { value: "16:9", label: "横屏 16:9" },
    { value: "9:16", label: "竖屏 9:16" },
    { value: "4:3", label: "标准横屏 4:3" },
    { value: "1:1", label: "方形 1:1" },
    { value: "3:4", label: "标准竖屏 3:4" },
    { value: "21:9", label: "宽银幕 21:9" },
];

export function ratioOptionsFor(model: string | undefined, apiFormat?: string): RatioOption[] {
    const name = model || "";
    if (isAgnesVideoModel(name)) return COMMON_RATIO_OPTIONS; // 固定 6 种，无自适应
    if (isMetasoVideoModel(name)) {
        return [...COMMON_RATIO_OPTIONS, { value: "adaptive", label: "自适应" }];
    }
    if (isArk(apiFormat)) {
        return [...COMMON_RATIO_OPTIONS, { value: "adaptive", label: "自适应" }];
    }
    return OPENAI_RATIO_OPTIONS;
}

export type SizeMode = "upstream" | "table" | "free";

export function sizeModeFor(model: string | undefined, apiFormat?: string): SizeMode {
    if (isAgnesVideoModel(model)) return "table";
    if (isMetasoVideoModel(model)) return "upstream";
    if (isArk(apiFormat)) return "table";
    return "free";
}

/** Seedance 官方「清晰度×比例」像素映射表（火山引擎文档） */
const SEEDANCE_SIZE_TABLE: Record<string, Record<string, string>> = {
    "480p": { "16:9": "864x496", "4:3": "752x560", "1:1": "640x640", "3:4": "560x752", "9:16": "496x864", "21:9": "992x432" },
    "720p": { "16:9": "1280x720", "4:3": "1112x834", "1:1": "960x960", "3:4": "834x1112", "9:16": "720x1280", "21:9": "1470x630" },
    "1080p": { "16:9": "1920x1080", "4:3": "1664x1248", "1:1": "1440x1440", "3:4": "1248x1664", "9:16": "1080x1920", "21:9": "2206x946" },
};

/** Agnes 官方公布的 720P 像素表；960P/2K 文档未公布，按短边推算供展示 */
const AGNES_720_TABLE: Record<string, string> = {
    "21:9": "1680x720", "16:9": "1280x720", "4:3": "960x720", "1:1": "720x720", "3:4": "720x960", "9:16": "720x1280",
};
function agnesScaleTable(baseShort: number, scale: number): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [ratio, size] of Object.entries(AGNES_720_TABLE)) {
        const [w, h] = size.split("x").map(Number);
        out[ratio] = `${Math.round((w * scale) / 16) * 16}x${Math.round((h * scale) / 16) * 16}`;
    }
    void baseShort;
    return out;
}
const AGNES_SIZE_TABLE: Record<string, Record<string, string>> = {
    "720P": AGNES_720_TABLE,
    "960P": agnesScaleTable(960, 4 / 3),
    "2K": agnesScaleTable(1440, 2),
};

export function sizeTableFor(model: string | undefined, apiFormat?: string): Record<string, Record<string, string>> | null {
    if (isAgnesVideoModel(model)) return AGNES_SIZE_TABLE;
    if (isArk(apiFormat)) return SEEDANCE_SIZE_TABLE;
    return null;
}

export function formatSelectState(model: string | undefined, apiFormat?: string) {
    return {
        resolutions: resolutionOptionsFor(model, apiFormat),
        ratios: ratioOptionsFor(model, apiFormat),
        sizeMode: sizeModeFor(model, apiFormat),
        sizeTable: sizeTableFor(model, apiFormat),
    };
}
