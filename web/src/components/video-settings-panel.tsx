import { type ReactNode } from "react";
import { Select, Slider, Switch } from "antd";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { boolConfig, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceDurationOptions, seedancePixelLabel, seedanceRatioOptions, seedanceResolutionOptions } from "@/lib/seedance-video";
import {
  isMetasoVideoConfig,
  isMetasoVideoModel,
  metasoDurationOptions,
  metasoRatioOptions,
  metasoResolutionOptions,
  normalizeMetasoDuration,
  normalizeMetasoRatio,
  normalizeMetasoResolution,
} from "@/lib/metaso-video";
import {
  agnesRatioOptions,
  agnesResolutionOptions,
  isAgnesFlashModel,
  isAgnesVideoConfig,
  isAgnesVideoModel,
  normalizeAgnesRatio,
  normalizeAgnesSeconds,
  normalizeAgnesSize,
} from "@/lib/agnes-video";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { OPENAI_RATIO_OPTIONS, formatSelectState } from "@/lib/video-capabilities";
import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

const FREE_SHORT_SIDE: Record<string, number> = { "480": 480, "720": 720, "1080": 1080 };

/**
 * 「清晰度 / 比例 / 尺寸」三级联动选择器 —— 各模型可选值来自官方文档（video-capabilities.ts 固化）。
 * - upstream: 上游内部决定像素，第三级置灰
 * - table:    官方「清晰度×比例」像素映射表，第三级只读展示唯一值
 * - free:     第三级为 W×H（可编辑），随前两级自动计算；OpenAI 兼容通道独享
 */
function VideoFormatPicker({ config, model, onConfigChange, theme }: { config: AiConfig; model: string; onConfigChange: VideoSettingsPanelProps["onConfigChange"]; theme: CanvasTheme }) {
    const requestConfig = resolveModelRequestConfig(config, model || config.videoModel || config.model);
    const { resolutions, ratios, sizeMode, sizeTable } = formatSelectState(requestConfig.model, requestConfig.apiFormat);

    // —— 第一级：清晰度（存量值不在该模型文档档位内时，按文档归一化显示）
    const customResAllowed = sizeMode === "free";
    const rawRes = config.vquality || "";
    const resInList = resolutions.some((item) => item.value === rawRes);
    const resIsCustom = customResAllowed && !resInList && /^\d+$/.test(rawRes);
    let resValue = resInList || resIsCustom ? rawRes : "";
    if (!resValue) {
        if (isMetasoVideoModel(requestConfig.model)) resValue = normalizeMetasoResolution(rawRes);
        else if (isAgnesVideoModel(requestConfig.model)) resValue = normalizeAgnesSize(rawRes, isAgnesFlashModel(requestConfig.model));
        else if (requestConfig.apiFormat === "ark") resValue = normalizeSeedanceResolution(rawRes);
        else resValue = resolutions[0].value;
    }

    // —— 第二级：比例（free 模式从现有尺寸反推）
    let ratioValue = config.size || "";
    if (sizeMode === "free") {
        if (/^\d+x\d+$/.test(ratioValue)) {
            const [w, h] = ratioValue.split("x").map(Number);
            const near = OPENAI_RATIO_OPTIONS.filter((item) => item.value !== "auto" && item.value !== "custom")
                .map((item) => {
                    const [rw, rh] = item.value === "21:9" ? [21, 9] : item.value === "16:9" ? [16, 9] : item.value === "9:16" ? [9, 16] : item.value === "4:3" ? [4, 3] : item.value === "3:4" ? [3, 4] : [1, 1];
                    return { value: item.value, diff: Math.abs(w / h - rw / rh) };
                })
                .sort((a, b) => a.diff - b.diff)[0];
            ratioValue = near && near.diff <= 0.08 ? near.value : "auto";
        } else if (!OPENAI_RATIO_OPTIONS.some((item) => item.value === ratioValue)) {
            ratioValue = "auto";
        }
    } else if (!ratios.some((item) => item.value === ratioValue)) {
        ratioValue = ratios[0].value;
    }

    // —— 第三级：尺寸展示/取值
    const tableRow = sizeTable ? (sizeTable[config.vquality] || {})[ratioValue] : undefined;
    const shortSide = FREE_SHORT_SIDE[config.vquality] || (resIsCustom ? Number(config.vquality) || 1080 : 1080);
    const freeSize = (() => {
        if (/^\d+x\d+$/.test(config.size || "")) return config.size;
        const map: Record<string, [number, number]> = { "16:9": [16, 9], "9:16": [9, 16], "1:1": [1, 1], "3:4": [3, 4] };
        const r = map[ratioValue];
        if (!r) return "1280x720";
        let w: number, h: number;
        if (r[0] >= r[1]) { h = shortSide; w = Math.round((shortSide * r[0]) / r[1]); }
        else { w = shortSide; h = Math.round((shortSide * r[1]) / r[0]); }
        return `${w}x${h}`;
    })();

    const labelStyle = { color: theme.node.muted } as const;

    return (
        <>
            <SettingGroup title="清晰度" color={theme.node.muted}>
                <Select
                    size="small"
                    className="w-full"
                    value={resValue}
                    disabled={resolutions.length === 1}
                    onChange={(value) => {
                        if (value === "custom") onConfigChange("vquality", "1080");
                        else onConfigChange("vquality", String(value));
                    }}
                    options={resolutions.map((item) => ({ value: item.value, label: item.label }))}
                />
                {resValue === "custom" ? (
                    <input
                        type="number"
                        min={144}
                        placeholder="输入短边像素，如 1440"
                        className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                        value={config.vquality}
                        onChange={(event) => onConfigChange("vquality", event.target.value)}
                        onMouseDown={(event) => event.stopPropagation()}
                    />
                ) : null}
            </SettingGroup>
            <SettingGroup title="比例" color={theme.node.muted}>
                <Select
                    size="small"
                    className="w-full"
                    value={ratioValue}
                    onChange={(value) => {
                        if (sizeMode === "free") {
                            if (value === "auto") onConfigChange("size", "auto");
                            else if (/^\d+:\d+$/.test(String(value))) {
                                const shortSideValue = FREE_SHORT_SIDE[config.vquality] || (resIsCustom ? Number(config.vquality) || 1080 : 1080);
                                const [rw, rh] = String(value).split(":").map(Number);
                                let w: number, h: number;
                                if (rw >= rh) { h = shortSideValue; w = Math.round((shortSideValue * rw) / rh); }
                                else { w = shortSideValue; h = Math.round((shortSideValue * rh) / rw); }
                                onConfigChange("size", `${w}x${h}`);
                            } else onConfigChange("size", String(value));
                        } else {
                            onConfigChange("size", String(value));
                        }
                    }}
                    options={(sizeMode === "free" ? OPENAI_RATIO_OPTIONS : ratios).map((item) => ({ value: item.value, label: item.label }))}
                />
            </SettingGroup>
            <SettingGroup title="尺寸" color={theme.node.muted}>
                {sizeMode === "upstream" ? (
                    <Select size="small" className="w-full" disabled value="upstream" options={[{ value: "upstream", label: "由上游模型内部决定" }]} />
                ) : sizeMode === "table" ? (
                    tableRow ? (
                        <input
                            readOnly
                            className="h-8 w-full rounded-lg border bg-stone-50 px-2 text-sm dark:bg-stone-900"
                            style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                            value={tableRow.replace("x", " × ")}
                            onMouseDown={(event) => event.stopPropagation()}
                        />
                    ) : (
                        <Select size="small" className="w-full" disabled value="adaptive" options={[{ value: "adaptive", label: "自适应：由上游根据输入决定" }]} />
                    )
                ) : ratioValue === "auto" ? (
                    <input
                        type="text"
                        placeholder="W×H，如 1280x720"
                        className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm outline-none"
                        style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                        value={config.size === "auto" || !/^\d+x\d+$/.test(config.size || "") ? "" : config.size}
                        onChange={(event) => {
                            const v = event.target.value.trim();
                            if (/^\d+x\d+$/.test(v)) onConfigChange("size", v);
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onBlur={(event) => {
                            const v = event.target.value.trim();
                            if (!v) onConfigChange("size", "auto");
                        }}
                    />
                ) : (
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            min={64}
                            className="h-8 min-w-0 flex-1 rounded-lg border bg-transparent px-2 text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                            value={freeSize.split("x")[0]}
                            onChange={(event) => onConfigChange("size", `${Number(event.target.value) || 1280}x${freeSize.split("x")[1]}`)}
                            onMouseDown={(event) => event.stopPropagation()}
                        />
                        <span style={{ color: theme.node.muted }}>↔</span>
                        <input
                            type="number"
                            min={64}
                            className="h-8 min-w-0 flex-1 rounded-lg border bg-transparent px-2 text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                            value={freeSize.split("x")[1]}
                            onChange={(event) => onConfigChange("size", `${freeSize.split("x")[0]}x${Number(event.target.value) || 720}`)}
                            onMouseDown={(event) => event.stopPropagation()}
                        />
                    </div>
                )}
            </SettingGroup>
        </>
    );
}

const resolutionOptions = [
    { value: "720", label: "720p" },
    { value: "480", label: "480p" },
];

const sizeOptions = [
    { value: "1280x720", label: "横屏", width: 1280, height: 720 },
    { value: "720x1280", label: "竖屏", width: 720, height: 1280 },
    { value: "1024x1024", label: "方形", width: 1024, height: 1024 },
    { value: "1792x1024", label: "宽屏", width: 1792, height: 1024 },
    { value: "1024x1792", label: "长图", width: 1024, height: 1792 },
    { value: "auto", label: "auto", width: 0, height: 0 },
];

const secondOptions = [6, 10, 12, 16, 20];

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = sizeOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSecondOptions = secondOptions.map((value) => String(value));

type VideoSettingsPanelProps = {
    config: AiConfig;
    /** 当前视频模型（可选；未传时回退 config.videoModel || config.model） */
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoSeed", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, model: videoModelProp, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps & { model?: string }) {
    // 分支判定必须以「视频模型」为准，而不是 config.model（可能是文本/图片主模型）
    const videoModel = videoModelProp || config.videoModel || config.model;
    const videoConfig: AiConfig = { ...config, model: videoModel };
    if (isSeedanceVideoConfig(videoConfig)) {
        return <SeedanceVideoSettingsPanel config={videoConfig} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }

    if (isMetasoVideoConfig(videoConfig)) {
        return <MetasoVideoSettingsPanel config={videoConfig} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }

    if (isAgnesVideoConfig(videoConfig)) {
        return <AgnesVideoSettingsPanel config={videoConfig} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }

    const seconds = config.videoSeconds || "6";
    const size = normalizeVideoSizeValue(config.size);
    const dimensions = readSizeDimensions(size);
    const resolution = normalizeVideoResolutionValue(config.vquality);
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
        onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <VideoFormatPicker config={config} model={config.model || config.videoModel} onConfigChange={onConfigChange} theme={theme} />
                <SettingGroup title="秒数" color={theme.node.muted}>
                    <DurationSlider value={Number(seconds) || 6} theme={theme} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function AgnesVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps) {
    const model = config.videoModel || config.model;
    const flash = isAgnesFlashModel(model);
    const size = normalizeAgnesSize(config.vquality, flash);
    const ratio = normalizeAgnesRatio(config.size);
    const seconds = normalizeAgnesSeconds(config.videoSeconds);
    const seed = config.videoSeed?.trim() || "";

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <VideoFormatPicker config={config} model={config.model || config.videoModel} onConfigChange={onConfigChange} theme={theme} />
                <SettingGroup title="时长" color={theme.node.muted}>
                    <DurationSlider value={Number(seconds)} min={4} max={12} theme={theme} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                </SettingGroup>
                <SettingGroup title="随机种子" color={theme.node.muted}>
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            min={0}
                            placeholder="留空则随机"
                            className="h-9 flex-1 rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                            value={seed}
                            onChange={(event) => onConfigChange("videoSeed", event.target.value)}
                            onMouseDown={(event) => event.stopPropagation()}
                        />
                    </div>
                    <div className="text-xs opacity-60">相同种子 + 相同参数可复现生成结果</div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function SeedanceVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps) {
    const resolution = normalizeSeedanceResolution(config.vquality);
    const ratio = normalizeSeedanceRatio(config.size);
    const duration = normalizeSeedanceDuration(config.videoSeconds);
    const generateAudio = boolConfig(config.videoGenerateAudio, true);
    const watermark = boolConfig(config.videoWatermark, false);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <VideoFormatPicker config={config} model={config.model || config.videoModel} onConfigChange={onConfigChange} theme={theme} />
                <SettingGroup title="时长" color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {seedanceDurationOptions.map((value) => (
                            <OptionPill key={value} selected={duration === value} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value === -1 ? "智能" : `${value}s`}
                            </OptionPill>
                        ))}
                    </div>
                    <NumberInput value={String(duration)} min={-1} max={15} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} />
                </SettingGroup>
                <SettingGroup title="输出" color={theme.node.muted}>
                    <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                        <SwitchRow label="生成声音" checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                        <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function MetasoVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps) {
    const resolution = normalizeMetasoResolution(config.vquality);
    const ratio = normalizeMetasoRatio(config.size);
    const duration = normalizeMetasoDuration(config.videoSeconds);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <VideoFormatPicker config={config} model={config.model || config.videoModel} onConfigChange={onConfigChange} theme={theme} />
                <SettingGroup title="时长" color={theme.node.muted}>
                    <DurationSlider value={duration} theme={theme} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    return `${normalizeVideoResolutionValue(value)}p`;
}

export function videoSizeLabel(value: string) {
    const ratio = normalizeSeedanceRatio(value);
    if (value === "adaptive" || value === "auto") return "自适应";
    if (ratio === value) return seedanceRatioOptions.find((item) => item.value === ratio)?.label || ratio;
    const size = normalizeVideoSizeValue(value);
    return sizeOptions.find((item) => item.value === size)?.label || size;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return "智能";
    return `${value || "6"}s`;
}

export function normalizeVideoSizeValue(value: string) {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

export function normalizeVideoResolutionValue(value: string) {
    if (value === "480p" || value === "low") return "480";
    if (value === "720p" || value === "auto" || value === "high" || value === "medium") return "720";
    return value.replace(/p$/i, "") || "720";
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function ResolutionInput({ value, theme, onChange }: { value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input type="number" min={1} className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />
            <span className="grid w-7 place-items-center pr-1" style={{ color: theme.node.muted }}>
                p
            </span>
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </label>
    );
}

function NumberInput({ value, min, max, theme, onChange }: { value: string; min: number; max: number; theme: CanvasTheme; onChange: (value: string) => void }) {
    return <input type="number" min={min} max={max} className="h-9 rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }} value={value} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} />;
}

function DurationSlider({ value, min = 4, max = 15, theme, onChange }: { value: number; min?: number; max?: number; theme: CanvasTheme; onChange: (value: number) => void }) {
    const clamped = Math.max(min, Math.min(max, Number(value) || min));
    return (
        <div className="flex items-center gap-3">
            <div className="flex-1" onMouseDown={(event) => event.stopPropagation()}>
                <Slider
                    min={min}
                    max={max}
                    step={1}
                    value={clamped}
                    onChange={onChange}
                    styles={{
                        track: { background: theme.node.text },
                        tracks: { background: theme.node.text },
                        handle: { borderColor: theme.node.text, background: theme.node.text },
                    }}
                />
            </div>
            <NumberInput value={String(clamped)} min={min} max={max} theme={theme} onChange={(next) => onChange(Math.max(min, Math.min(max, Number(next) || min)))} />
            <span className="text-sm" style={{ color: theme.node.muted }}>s</span>
        </div>
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function ratioPreview(ratio: string) {
    if (ratio === "9:16") return { width: 9, height: 16 };
    if (ratio === "1:1") return { width: 1, height: 1 };
    if (ratio === "4:3") return { width: 4, height: 3 };
    if (ratio === "3:4") return { width: 3, height: 4 };
    if (ratio === "21:9") return { width: 21, height: 9 };
    if (ratio === "adaptive") return { width: 0, height: 0 };
    return { width: 16, height: 9 };
}

function SwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3">
            <span className="text-sm" style={{ color: theme.node.text }}>
                {label}
            </span>
            <span onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="small" checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}

function readSizeDimensions(size: string) {
    if (size === "auto") return { width: 0, height: 0 };
    const match = size.match(/^(\d+)x(\d+)$/);
    return { width: Number(match?.[1]) || 1280, height: Number(match?.[2]) || 720 };
}
