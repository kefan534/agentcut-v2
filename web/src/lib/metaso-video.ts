import { type AiConfig, resolveModelRequestConfig } from "@/stores/use-config-store";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import type { ReferenceImage } from "@/types/image";

export const METASO_REFERENCE_LIMITS = {
  images: 9,
  videos: 3,
  audios: 3,
  imageMaxBytes: 30 * 1024 * 1024,
  videoMaxBytes: 50 * 1024 * 1024,
  audioMaxBytes: 15 * 1024 * 1024,
} as const;

export const METASO_VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime"] as const;

export const metasoResolutionOptions = [
  { value: "2K", label: "2K" },
  { value: "768P", label: "768P" },
] as const;

export const metasoRatioOptions = [
  { value: "16:9", label: "横屏" },
  { value: "9:16", label: "竖屏" },
  { value: "1:1", label: "方形" },
  { value: "4:3", label: "标准横屏" },
  { value: "3:4", label: "标准竖屏" },
  { value: "21:9", label: "宽银幕" },
  { value: "adaptive", label: "自适应" },
] as const;

export const metasoDurationOptions = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

export function isMetasoVideoModel(model: string | undefined) {
  return /metaso|minimax.*h3|h3.*metaso/i.test(model || "");
}

export function isMetasoVideoConfig(config: AiConfig | Pick<AiConfig, "model" | "videoModel" | "apiFormat">) {
  const requestConfig = "channels" in config ? resolveModelRequestConfig(config, config.model || config.videoModel) : config;
  return isMetasoVideoModel(requestConfig.model);
}

export function normalizeMetasoResolution(value: string) {
  const normalized = String(value || "2K").toUpperCase();
  return metasoResolutionOptions.some((item) => item.value === normalized) ? normalized : "2K";
}

export function normalizeMetasoRatio(value: string) {
  if (!value || value === "auto" || value === "adaptive") return "adaptive";
  if (metasoRatioOptions.some((item) => item.value === value)) return value;
  const match = value.match(/^(\d+)x(\d+)$/);
  if (!match) return "16:9";
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height) return "16:9";
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

export function normalizeMetasoDuration(value: string) {
  const seconds = Math.floor(Number(value) || 5);
  return Math.max(4, Math.min(15, seconds));
}

export function metasoReferenceLabel(kind: "image" | "video" | "audio", index: number) {
  if (kind === "image") return `图片${index + 1}`;
  if (kind === "video") return `视频${index + 1}`;
  return `音频${index + 1}`;
}

export function buildMetasoPromptText(prompt: string, images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[]) {
  const labels = [
    ...images.map((_, index) => metasoReferenceLabel("image", index)),
    ...videos.map((_, index) => metasoReferenceLabel("video", index)),
    ...audios.map((_, index) => metasoReferenceLabel("audio", index)),
  ];
  const text = prompt.trim();
  if (!labels.length) return text;
  return `参考资产编号：${labels.join("、")}。请按这些编号理解提示词中的图片、视频和音频引用。\n\n${text}`;
}

export function metasoVideoReferenceError(videos: ReferenceVideo[]) {
  let totalDurationMs = 0;
  for (let index = 0; index < videos.length; index += 1) {
    const video = videos[index];
    const label = metasoReferenceLabel("video", index);
    if (!METASO_VIDEO_MIME_TYPES.includes(video.type as typeof METASO_VIDEO_MIME_TYPES[number])) return `${label} 仅支持 mp4/mov 格式`;
    if (video.bytes && video.bytes > METASO_REFERENCE_LIMITS.videoMaxBytes) return `${label} 超过 50MB，请压缩后再上传`;
    if (video.durationMs) {
      if (video.durationMs < 2000 || video.durationMs > 15000) return `${label} 时长需要在 2-15 秒之间`;
      totalDurationMs += video.durationMs;
    }
    if (video.width && video.height) {
      if (video.width < 256 || video.width > 5760 || video.height < 256 || video.height > 5760) return `${label} 宽高需要在 256-5760px 之间`;
      const ratio = video.width / video.height;
      if (ratio < 0.4 || ratio > 2.5) return `${label} 宽高比需要在 0.4-2.5 之间`;
    }
  }
  if (totalDurationMs > 15000) return "MiniMax H3 参考视频总时长不能超过 15 秒";
  return "";
}

export function metasoAudioReferenceError(audios: ReferenceAudio[]) {
  let totalDurationMs = 0;
  for (let index = 0; index < audios.length; index += 1) {
    const audio = audios[index];
    const label = metasoReferenceLabel("audio", index);
    if (audio.durationMs) {
      if (audio.durationMs < 2000 || audio.durationMs > 15000) return `${label} 时长需要在 2-15 秒之间`;
      totalDurationMs += audio.durationMs;
    }
  }
  if (totalDurationMs > 15000) return "MiniMax H3 参考音频总时长不能超过 15 秒";
  return "";
}

export const metasoVideoReferenceHint = "MiniMax H3 参考视频需为 mp4/mov，H.264/H.265，时长 2-15 秒；参考音频需为 mp3/wav，时长 2-15 秒。";
