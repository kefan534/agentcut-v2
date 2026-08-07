import * as backendApi from "./backend";
import { type AiConfig, modelOptionName } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import {
  buildMetasoPromptText,
  isMetasoVideoModel,
  metasoAudioReferenceError,
  metasoVideoReferenceError,
  METASO_VIDEO_MIME_TYPES,
  normalizeMetasoDuration,
  normalizeMetasoRatio,
  normalizeMetasoResolution,
} from "@/lib/metaso-video";

export type RequestOptions = { signal?: AbortSignal };

const IMAGE_OUTPUT_FORMAT = "png";

const QUALITY_BASE: Record<string, number> = {
    low: 1024,
    medium: 2048,
    high: 2880,
    standard: 1024,
    hd: 2048,
};

const QUALITY_ALIASES: Record<string, string> = {
    "1k": "low",
    "2k": "medium",
    "4k": "high",
};

const DEFAULT_IMAGE_SHORT_SIDE = 1024;
const IMAGE_SIZE_STEP = 16;
const IMAGE_MIN_PIXELS = 655360;
const IMAGE_MAX_PIXELS = 8294400;
const IMAGE_MAX_EDGE = 3840;
const IMAGE_MAX_RATIO = 3;

function normalizeQuality(quality: string) {
    const value = quality.trim().toLowerCase();
    const normalized = QUALITY_ALIASES[value] || value;
    return QUALITY_BASE[normalized] ? normalized : undefined;
}

function normalizeBackground(background: string | undefined) {
    return background?.trim().toLowerCase() === "transparent" ? "transparent" : undefined;
}

function parseRatioValue(value: string) {
    const parts = value.split(":");
    if (parts.length !== 2) throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new Error("图像比例必须是正数，例如 9:16");
    return { width: w, height: h };
}

function parseImageRatio(value: string) {
    const ratio = parseRatioValue(value);
    if (Math.max(ratio.width, ratio.height) / Math.min(ratio.width, ratio.height) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    return ratio;
}

function parseImageDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/i);
    if (!match) return null;
    return { width: Number(match[1]), height: Number(match[2]) };
}

function validateImageSize(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("图像尺寸必须是正整数，例如 1024x1024");
    if (width % IMAGE_SIZE_STEP !== 0 || height % IMAGE_SIZE_STEP !== 0) throw new Error("图像尺寸的宽高必须是 16 的倍数，请调整尺寸");
    if (Math.max(width, height) > IMAGE_MAX_EDGE) throw new Error("图像尺寸最长边不能超过 3840px，请调整尺寸");
    if (Math.max(width, height) / Math.min(width, height) > IMAGE_MAX_RATIO) throw new Error("图像宽高比不能超过 3:1，请调整尺寸");
    const pixels = width * height;
    if (pixels < IMAGE_MIN_PIXELS || pixels > IMAGE_MAX_PIXELS) throw new Error("图像总像素需在 655360 到 8294400 之间，请调整尺寸");
}

function resolveSize(quality: string | undefined, ratio: string): string {
    const parsedRatio = parseImageRatio(ratio);
    const basePixels = quality ? QUALITY_BASE[quality] : undefined;
    const isLandscape = parsedRatio.width >= parsedRatio.height;
    const longRatio = isLandscape ? parsedRatio.width / parsedRatio.height : parsedRatio.height / parsedRatio.width;
    let longSide: number;
    let shortSide: number;

    if (basePixels) {
        const targetPixels = basePixels * basePixels;
        const longSideRaw = Math.sqrt(targetPixels * longRatio);
        longSide = Math.floor(longSideRaw / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
        shortSide = Math.round(longSide / longRatio / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    } else {
        shortSide = DEFAULT_IMAGE_SHORT_SIDE;
        longSide = Math.round((shortSide * longRatio) / IMAGE_SIZE_STEP) * IMAGE_SIZE_STEP;
    }

    const width = isLandscape ? longSide : shortSide;
    const height = isLandscape ? shortSide : longSide;
    validateImageSize(width, height);
    return `${width}x${height}`;
}

function resolveRequestSize(quality: string | undefined, size: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return undefined;
    const dimensions = parseImageDimensions(value);
    if (dimensions) {
        validateImageSize(dimensions.width, dimensions.height);
        return `${dimensions.width}x${dimensions.height}`;
    }
    if (value.includes(":")) return resolveSize(quality, value);
    throw new Error("图像尺寸格式不支持，请使用 auto、9:16 或 1024x1024");
}

function withSystemPrompt(config: AiConfig, prompt: string) {
    const systemPrompt = config.systemPrompt.trim();
    return systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
}

export function isRemoteModel(config: AiConfig, value?: string) {
    if (config.channelMode === "remote") return true;
    if (!value) return false;
    const decoded = value.includes("::") ? { channelId: value.slice(0, value.indexOf("::")), model: value.slice(value.indexOf("::") + 2) } : null;
    return decoded?.channelId === "backend";
}

export function remoteVariableName(value: string) {
    return modelOptionName(value);
}

/** true when the URL is a genuinely public http(s) URL (not localhost / private LAN). */
function isPublicHttpUrl(value: string): boolean {
    if (!/^https?:\/\//i.test(value)) return false;
    try {
        const host = new URL(value).hostname.toLowerCase();
        if (host === "localhost" || host === "::1" || host.endsWith(".local") || host.endsWith(".localhost")) return false;
        if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
        return true;
    } catch {
        return false;
    }
}

/** Collect reference images that already have a public http(s) URL (usable by async task APIs like flux-art). */
function publicReferenceUrls(references: ReferenceImage[], limit = 7): string[] {
    const urls: string[] = [];
    for (const image of references) {
        if (urls.length >= limit) break;
        if (image.url && isPublicHttpUrl(image.url)) urls.push(image.url);
    }
    return urls;
}

/** true if every reference carries a public http(s) URL. */
function allReferencesPublic(references: ReferenceImage[]): boolean {
    return references.length > 0 && publicReferenceUrls(references).length === references.length;
}

// ---------- Image ----------

export async function remoteImageGeneration(config: AiConfig, prompt: string, options?: RequestOptions) {
    const selectedModel = config.model || config.imageModel;
    const model = modelOptionName(selectedModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    const background = normalizeBackground(config.background);

    const response = await backendApi.proxyGateway(model, "/images/generations", {
        model,
        prompt: withSystemPrompt(config, prompt),
        n,
        ...(quality ? { quality } : {}),
        ...(requestSize ? { size: requestSize } : {}),
        ...(background ? { background } : {}),
        response_format: "b64_json",
        output_format: IMAGE_OUTPUT_FORMAT,
    });
    return response;
}

export async function remoteImageEdit(config: AiConfig, prompt: string, references: ReferenceImage[], mask?: ReferenceImage, options?: RequestOptions) {
    const selectedModel = config.model || config.imageModel;
    const model = modelOptionName(selectedModel);
    const n = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1)));
    const quality = normalizeQuality(config.quality);
    const requestSize = resolveRequestSize(quality, config.size);
    const background = normalizeBackground(config.background);
    const isGptImage = model.toLowerCase().startsWith("gpt-image-");

    if (references.length === 0) {
        // No references: use generations endpoint
        const response = await backendApi.proxyGateway(model, "/images/generations", {
            model,
            prompt: withSystemPrompt(config, prompt),
            n,
            ...(quality ? { quality } : {}),
            ...(requestSize ? { size: requestSize } : {}),
            ...(background ? { background } : {}),
            ...(!isGptImage ? { response_format: "b64_json" } : {}),
            output_format: IMAGE_OUTPUT_FORMAT,
        });
        return response;
    }

    // With references: prefer public http(s) URLs when every reference has one
    // (async task APIs like flux-art reject data URLs).
    const usePublic = allReferencesPublic(references);
    const refs = usePublic ? publicReferenceUrls(references) : await Promise.all(references.map((image) => imageToDataUrl(image)));

    const response = await backendApi.proxyGateway(model, "/images/generations", {
        model,
        prompt: withSystemPrompt(config, prompt),
        n,
        ...(quality ? { quality } : {}),
        ...(requestSize ? { size: requestSize } : {}),
        ...(background ? { background } : {}),
        ...(!isGptImage ? { response_format: "b64_json" } : {}),
        output_format: IMAGE_OUTPUT_FORMAT,
        image: refs,
    });
    return response;
}

export async function remoteImageQuestion(config: AiConfig, messages: Array<{ role: "system" | "user" | "assistant"; content: string | unknown }>, onDelta: (text: string) => void, options?: RequestOptions) {
    const selectedModel = config.model || config.textModel;
    const model = modelOptionName(selectedModel);

    const systemPrompt = config.systemPrompt.trim();
    const textMessages = messages
        .filter((m): m is { role: "system" | "user" | "assistant"; content: string } => typeof m.content === "string")
        .map((m) => ({ role: m.role, content: m.content }));
    const requestMessages = systemPrompt ? [{ role: "system" as const, content: systemPrompt }, ...textMessages.filter((m) => m.role !== "system")] : textMessages;

    // Try streaming first
    try {
        const streamBody = await backendApi.proxyGatewayStream(model, "/v1/chat/completions", {
            model,
            messages: requestMessages,
            stream: true,
        });
        if (!streamBody) throw new Error("Stream not supported");

        const reader = streamBody.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        let buffer = "";
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const data = trimmed.slice(5).trim();
                if (data === "[DONE]") continue;
                try {
                    const event = JSON.parse(data);
                    const delta = event.choices?.[0]?.delta?.content;
                    if (typeof delta === "string") {
                        fullText += delta;
                        onDelta(fullText);
                    }
                } catch {
                    // ignore malformed SSE lines
                }
            }
        }
        return fullText || "没有返回内容";
    } catch {
        // Fallback to non-streaming
        const response = await backendApi.proxyGateway(model, "/v1/chat/completions", {
            model,
            messages: requestMessages,
        });
        const payload = response as { choices?: Array<{ message?: { content?: string } }> };
        const text = payload.choices?.[0]?.message?.content || "没有返回内容";
        if (text === "没有返回内容") onDelta(text);
        return text;
    }
}

// ---------- Video ----------

function gcd(a: number, b: number): number {
    return b === 0 ? a : gcd(b, a % b);
}

function toVideoRatio(size: string | undefined | null): string | undefined {
    const value = (size || "").trim();
    if (!value || value === "auto") return undefined;
    // Already a ratio like "16:9"
    if (/^\d+:\d+$/.test(value)) return value;
    // Pixel dimensions like "1280x720"
    const match = value.match(/^(\d+)[xX](\d+)$/);
    if (match) {
        const w = parseInt(match[1]);
        const h = parseInt(match[2]);
        const g = gcd(w, h);
        return `${w / g}:${h / g}`;
    }
    return undefined;
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

export async function remoteVideoGeneration(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[] = [],
    videoReferences: ReferenceVideo[] = [],
    audioReferences: ReferenceAudio[] = [],
    options?: RequestOptions,
): Promise<Record<string, unknown>> {
    const selectedModel = config.model || config.videoModel;
    const model = modelOptionName(selectedModel);

    if (isMetasoVideoModel(model)) {
        return remoteMetasoVideoGeneration(config, model, prompt, references, videoReferences, audioReferences, options);
    }

    // Prefer public http(s) URLs when every reference has one (flux-art requires public URLs).
    const usePublic = allReferencesPublic(references);
    const refs = usePublic ? publicReferenceUrls(references) : await Promise.all(references.slice(0, 7).map((image) => imageToDataUrl(image)));
    const hasReference = refs.length > 0;
    const ratio = toVideoRatio(config.size);

    const body: Record<string, unknown> = {
        model,
        prompt,
        duration: parseInt(normalizeVideoSeconds(config.videoSeconds)),
        resolution: normalizeVideoResolution(config.vquality),
        video_mode: hasReference ? "image_to_video" : "text_to_video",
    };
    if (ratio) body.ratio = ratio;
    if (hasReference) body.image = refs[0];

    const response = await backendApi.proxyGateway(model, "/videos/generations", body);
    return response as Record<string, unknown>;
}

async function remoteMetasoVideoGeneration(
    config: AiConfig,
    model: string,
    prompt: string,
    references: ReferenceImage[],
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
): Promise<Record<string, unknown>> {
    const imageError = metasoVideoReferenceError(videoReferences);
    if (imageError) throw new Error(imageError);
    const audioError = metasoAudioReferenceError(audioReferences);
    if (audioError) throw new Error(audioError);

    const imageUrls = await Promise.all(references.slice(0, 9).map((image) => resolveMetasoImageUrl(image)));
    const videoUrls = await Promise.all(videoReferences.slice(0, 3).map((video) => resolveMetasoVideoUrl(video)));
    const audioUrls = await Promise.all(audioReferences.slice(0, 3).map((audio) => resolveMetasoAudioUrl(audio)));

    const body: Record<string, unknown> = {
        model,
        prompt: buildMetasoPromptText(prompt, references, videoReferences, audioReferences),
        duration: normalizeMetasoDuration(config.videoSeconds),
        resolution: normalizeMetasoResolution(config.vquality),
        ratio: normalizeMetasoRatio(config.size),
    };

    if (imageUrls.length === 1 && !videoUrls.length && !audioUrls.length) {
        body.video_mode = "image_to_video";
        body.image = imageUrls[0];
    } else if (imageUrls.length > 1 || videoUrls.length || audioUrls.length) {
        body.video_mode = "reference_to_video";
        if (imageUrls.length) body.image_urls = imageUrls;
        if (videoUrls.length) body.video = videoUrls;
        if (audioUrls.length) body.audio = audioUrls;
    } else {
        body.video_mode = "text_to_video";
    }

    const response = await backendApi.proxyGateway(model, "/videos/generations", body);
    return response as Record<string, unknown>;
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

async function resolveMetasoImageUrl(image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl)) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error("参考图读取失败，请换一张图片或重新上传");
    return dataUrl;
}

async function resolveMetasoVideoUrl(video: ReferenceVideo) {
    if (isPublicMediaUrl(video.url)) return video.url;
    let blob: Blob | null = null;
    if (video.storageKey) blob = await getMediaBlob(video.storageKey);
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    if (!blob) throw new Error("参考视频必须是公网 URL、资产 ID，或本地已保存的视频");
    const uploaded = await uploadMediaFile(blob, "video-reference", { preferBackend: true });
    return uploaded.url;
}

async function resolveMetasoAudioUrl(audio: ReferenceAudio) {
    if (isPublicMediaUrl(audio.url)) return audio.url;
    let blob: Blob | null = null;
    if (audio.storageKey) blob = await getMediaBlob(audio.storageKey);
    if (!blob && audio.url?.startsWith("blob:")) blob = await (await fetch(audio.url)).blob();
    if (!blob) throw new Error("参考音频必须是公网 URL、资产 ID，或本地已保存的音频");
    const uploaded = await uploadMediaFile(blob, "audio-reference", { preferBackend: true });
    return uploaded.url;
}

export async function remoteVideoTaskStatus(config: AiConfig, taskId: string, options?: RequestOptions): Promise<Record<string, unknown>> {
    const selectedModel = config.model || config.videoModel;
    const model = modelOptionName(selectedModel);
    const response = await backendApi.proxyGateway(model, `/videos/${taskId}`, {});
    return response as Record<string, unknown>;
}

export async function remoteVideoTaskContent(config: AiConfig, taskId: string, options?: RequestOptions) {
    const selectedModel = config.model || config.videoModel;
    const model = modelOptionName(selectedModel);
    const url = `${backendApi.BACKEND_BASE_URL}/api/v1/gateway/${encodeURIComponent(model)}/proxy`;
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ endpoint: `/videos/${taskId}/content`, body: {}, stream: false }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error("Failed to fetch video content");
    return response.blob();
}

// ---------- Audio ----------

import { audioMimeType, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";

export async function remoteAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<Blob> {
    const selectedModel = config.model || config.audioModel;
    const model = modelOptionName(selectedModel);
    const format = normalizeAudioFormatValue(config.audioFormat);
    const instructions = config.audioInstructions.trim();

    const url = `${backendApi.BACKEND_BASE_URL}/api/v1/gateway/${encodeURIComponent(model)}/proxy`;
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
            endpoint: "/audio/speech",
            body: {
                model,
                input: prompt,
                voice: normalizeAudioVoiceValue(config.audioVoice),
                response_format: format,
                speed: Number(normalizeAudioSpeedValue(config.audioSpeed)),
                ...(instructions ? { instructions } : {}),
            },
            stream: false,
        }),
        signal: options?.signal,
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "音频生成失败");
    }
    const blob = await response.blob();
    return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
}
