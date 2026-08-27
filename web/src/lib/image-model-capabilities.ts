/**
 * 图像模型能力配置 —— 生图工作台左栏联动的唯一事实来源（对齐视频台 video-capabilities.ts）。
 *
 * 三类图像模型（判定依据：apiFormat 与模型名前缀，与 services/api/image.ts 的提交分支一致）：
 *   - gemini 系（nano-banana 等）：档位(1K/2K/4K) × 比例(10 种) → 尺寸自动计算（16 倍数对齐）
 *   - gpt-image 系（gpt-image-2 等）：官方支持任意 W×H —— 16 倍数、长短边比 ≤3:1、总像素 65.5万~829万、单边 ≤3840px；
 *     档位 1k/2k/4k × 比例(13 种)
 *   - 通用 OpenAI 兼容：W×H 自由（16 倍数对齐）+ 常用比例
 */

import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export type ImageRatioOption = { value: string; w: number; h: number; label: string };

export type ImageModelCapabilities = {
    refMax: number;
    resolutions: Array<{ value: string; label: string }>;
    ratios: ImageRatioOption[];
    quality: boolean;
};

const RES_1K_2K_4K: Array<{ value: string; label: string }> = [
    { value: "1K", label: "1K" },
    { value: "2K", label: "2K" },
    { value: "4K", label: "4K" },
];

function ratio(value: string, w: number, h: number): ImageRatioOption {
    return { value, w, h, label: value };
}

const GEMINI_RATIOS: ImageRatioOption[] = [
    ratio("1:1", 1, 1), ratio("2:3", 2, 3), ratio("3:2", 3, 2),
    ratio("3:4", 3, 4), ratio("4:3", 4, 3), ratio("4:5", 4, 5), ratio("5:4", 5, 4),
    ratio("9:16", 9, 16), ratio("16:9", 16, 9), ratio("21:9", 21, 9),
];

const GPT_IMAGE_RATIOS: ImageRatioOption[] = [
    ratio("1:1", 1, 1), ratio("2:3", 2, 3), ratio("3:2", 3, 2),
    ratio("3:4", 3, 4), ratio("4:3", 4, 3), ratio("4:5", 4, 5), ratio("5:4", 5, 4),
    ratio("9:16", 9, 16), ratio("16:9", 16, 9),
    ratio("2:1", 2, 1), ratio("1:2", 1, 2), ratio("21:9", 21, 9), ratio("9:21", 9, 21),
];

const GENERIC_RATIOS: ImageRatioOption[] = [
    ratio("1:1", 1, 1), ratio("16:9", 16, 9), ratio("9:16", 9, 16),
    ratio("4:3", 4, 3), ratio("3:4", 3, 4),
];

/** gpt-image-2 官方约束（developers.openai.com） */
export const GPT_IMAGE_LIMITS = {
    maxEdge: 3840,
    minPixels: 655_360,
    maxPixels: 8_294_400,
    maxRatio: 3,
} as const;

/** 档位 → 短边像素（尺寸计算的基准） */
const SHORT_SIDE: Record<string, number> = { "1K": 1024, "2K": 2048, "4K": 3072 };

export function isGptImageModelName(name: string | undefined) {
    return (name || "").toLowerCase().startsWith("gpt-image-");
}

export function imageModelCapabilities(model: string | undefined, apiFormat?: string): ImageModelCapabilities {
    const name = modelOptionName(model || "");
    if (isGptImageModelName(name)) {
        return { refMax: 4, resolutions: RES_1K_2K_4K, ratios: GPT_IMAGE_RATIOS, quality: true };
    }
    if (apiFormat === "gemini") {
        return { refMax: 3, resolutions: RES_1K_2K_4K, ratios: GEMINI_RATIOS, quality: true };
    }
    return { refMax: 4, resolutions: RES_1K_2K_4K, ratios: GENERIC_RATIOS, quality: false };
}

export function imageCapabilitiesFor(config: AiConfig, model: string | undefined): ImageModelCapabilities {
    const requestConfig = resolveModelRequestConfig(config, model || config.imageModel || config.model);
    return imageModelCapabilities(requestConfig.model, requestConfig.apiFormat);
}

/** 按档位短边 × 比例计算尺寸（16 倍数对齐） */
export function calcImageSize(resolution: string, ratioValue: string, ratios: ImageRatioOption[]): string {
    const pair = ratios.find((item) => item.value === ratioValue) || ratios[0];
    const shortSide = SHORT_SIDE[resolution] || 1024;
    let w: number, h: number;
    if (pair.w >= pair.h) {
        h = shortSide;
        w = Math.round((shortSide * pair.w) / pair.h / 16) * 16;
    } else {
        w = shortSide;
        h = Math.round((shortSide * pair.h) / pair.w / 16) * 16;
    }
    return `${w}x${h}`;
}

/** gpt-image-2 官方约束校验（16 倍数、长短比 ≤3:1、总像素范围、单边上限） */
export function validateGptImageSize(size: string): string {
    const match = size.match(/^(\d+)x(\d+)$/);
    if (!match) return "尺寸格式应为 WxH";
    const w = Number(match[1]);
    const h = Number(match[2]);
    if (w % 16 !== 0 || h % 16 !== 0) return "宽高需为 16 的倍数";
    if (Math.max(w, h) > GPT_IMAGE_LIMITS.maxEdge) return `单边不能超过 ${GPT_IMAGE_LIMITS.maxEdge}px`;
    if (w / h > GPT_IMAGE_LIMITS.maxRatio || h / w > GPT_IMAGE_LIMITS.maxRatio) return "长短边比例不能超过 3:1";
    const pixels = w * h;
    if (pixels < GPT_IMAGE_LIMITS.minPixels) return "总像素过低（最少 65.5 万）";
    if (pixels > GPT_IMAGE_LIMITS.maxPixels) return "总像素超上限（最多 829 万，约 4K）";
    return "";
}
