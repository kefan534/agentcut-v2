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
