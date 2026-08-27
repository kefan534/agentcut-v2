import { type ReactNode, useState } from "react";
import { ConfigProvider, Select, Switch } from "antd";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { calcImageSize, imageCapabilitiesFor } from "@/lib/image-model-capabilities";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

const qualityOptions = [
    { value: "auto", label: "自动" },
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
];
const DIMENSION_STEP = 16;

const aspectOptions = [
    { value: "1:1", label: "1:1", width: 1024, height: 1024, icon: "square" },
    { value: "3:2", label: "3:2", width: 1536, height: 1024, icon: "landscape" },
    { value: "2:3", label: "2:3", width: 1024, height: 1536, icon: "portrait" },
    { value: "4:3", label: "4:3", width: 1360, height: 1024, icon: "landscape" },
    { value: "3:4", label: "3:4", width: 1024, height: 1360, icon: "portrait" },
    { value: "16:9", label: "16:9", width: 1824, height: 1024, icon: "landscape" },
    { value: "9:16", label: "9:16", width: 1024, height: 1824, icon: "portrait" },
    { value: "auto", label: "auto", width: 0, height: 0, icon: "auto" },
];

// 分辨率档（与宽高比解耦）：控制出图像素规模，后台据此分级计费。
const resolutionOptions = [
    { value: "1K", label: "1K" },
    { value: "2K", label: "2K" },
    { value: "4K", label: "4K" },
    { value: "auto", label: "自动" },
];

export const imageQualityOptions = qualityOptions.map((item) => ({ value: item.value, label: item.label }));
export const imageAspectOptions = aspectOptions.map((item) => ({ value: item.value, label: item.label }));

type ImageSettingsPanelProps = {
    config: AiConfig;
    /** 当前图像模型（可选；未传时回退 config.imageModel || config.model） */
    model?: string;
    onConfigChange: (key: "quality" | "size" | "count" | "background" | "resolution", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
};

export function ImageSettingsPanel({ config, model: imageModelProp, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", maxCount = 15, quickCount = 10 }: ImageSettingsPanelProps) {
    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);
    const imageModel = imageModelProp || config.imageModel || config.model;
    const capabilities = imageCapabilitiesFor(config, imageModel);
    const quality = config.quality || "auto";
    const count = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = config.size || "auto";
    const activeResolution = config.resolution || "1K";
    const transparentBackground = config.background === "transparent";

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-lg font-semibold">图像设置</div> : null}
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>质量</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {qualityOptions.map((item) => (
                            <OptionPill key={item.value} selected={quality === item.value} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </div>
                <ImageFormatPicker config={config} model={imageModel} activeResolution={activeResolution} capabilities={capabilities} onConfigChange={onConfigChange} theme={theme} snapDimensionToStep={snapDimensionToStep} onSnapChange={setSnapDimensionToStep} />
                <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                        <SettingTitle color={theme.node.muted}>透明背景</SettingTitle>
                        <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                            开启后生成无背景的透明图像(仅部分模型可用)
                        </div>
                    </div>
                    <span onMouseDown={(event) => event.stopPropagation()}>
                        <Switch size="small" checked={transparentBackground} onChange={(checked) => onConfigChange("background", checked ? "transparent" : "")} />
                    </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                    <SettingTitle color={theme.node.muted}>生成张数</SettingTitle>
                    <div className="flex h-8 items-center overflow-hidden rounded-lg border" style={{ borderColor: theme.node.stroke }}>
                        <button
                            type="button"
                            aria-label="减少张数"
                            className="grid h-full w-8 cursor-pointer place-items-center text-base leading-none transition hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-30"
                            style={{ color: theme.node.text }}
                            disabled={count <= 1}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() => onConfigChange("count", String(Math.max(1, count - 1)))}
                        >
                            −
                        </button>
                        <input
                            type="number"
                            min={1}
                            max={maxCount}
                            className="h-full w-10 border-x bg-transparent text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                            value={count || ""}
                            onChange={(event) => onConfigChange("count", String(Math.max(1, Math.min(maxCount, Number(event.target.value) || 1))))}
                            onMouseDown={(event) => event.stopPropagation()}
                        />
                        <button
                            type="button"
                            aria-label="增加张数"
                            className="grid h-full w-8 cursor-pointer place-items-center text-base leading-none transition hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-30"
                            style={{ color: theme.node.text }}
                            disabled={count >= maxCount}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() => onConfigChange("count", String(Math.min(maxCount, count + 1)))}
                        >
                            +
                        </button>
                    </div>
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    return ({ auto: "自动", high: "高", medium: "中", low: "低" } as Record<string, string>)[value] || value;
}

export function imageSizeLabel(size: string) {
    return aspectOptions.find((item) => item.value === size)?.label || size;
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function DimensionInput({ prefix, value, disabled, theme, alignToStep, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; alignToStep: boolean; onChange: (value: number | null) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = alignDimension(Math.max(1, Math.floor(Number(input.value) || value || 1024)), alignToStep);
        input.value = String(next);
        onChange(next);
    };

    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                type="number"
                min={1}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value || ""}
                key={`${prefix}-${value}`}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function AspectIcon({ type, width, height, color }: { type: string; width: number; height: number; color: string }) {
    if (type === "auto") return null;
    const ratio = width / Math.max(1, height);
    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
    return (
        <span className="grid h-7 w-9 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function readSizeDimensions(size: string, fallback: { width: number; height: number }) {
    const match = size?.match(/^(\d+)x(\d+)$/);
    return {
        width: match ? Number(match[1]) : fallback.width,
        height: match ? Number(match[2]) : fallback.height,
    };
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}

/**
 * 「清晰度 / 宽高比 / 尺寸」三级联动选择器（图像版）——
 * 可选值来自 image-model-capabilities.ts（按模型官方文档固化）。
 * 尺寸由「档位 × 比例」自动计算并 16 倍数对齐；通用兼容通道可开启自定义 W×H。
 */
function ImageFormatPicker({ config, model, activeResolution, capabilities, onConfigChange, theme, snapDimensionToStep, onSnapChange }: { config: AiConfig; model: string; activeResolution: string; capabilities: ReturnType<typeof imageCapabilitiesFor>; onConfigChange: ImageSettingsPanelProps["onConfigChange"]; theme: CanvasTheme; snapDimensionToStep: boolean; onSnapChange: (value: boolean) => void }) {
    const [customSize, setCustomSize] = useState(false);
    const requestConfig = resolveModelRequestConfig(config, model || config.imageModel || config.model);
    void requestConfig;
    const optionModel = modelOptionName(model || config.imageModel || config.model);

    // 比例显示值：从 config.size 反推（ratio 值直接匹配；W×H 就近匹配；否则首项）
    let ratioValue = config.size || capabilities.ratios[0].value;
    const isRatioValue = capabilities.ratios.some((item) => item.value === ratioValue);
    const sizeIsPixels = /^\d+x\d+$/.test(ratioValue);
    if (!isRatioValue) {
        if (sizeIsPixels) {
            const [w, h] = ratioValue.split("x").map(Number);
            const near = capabilities.ratios
                .map((item) => ({ item, diff: Math.abs(w / h - item.w / item.h) }))
                .sort((a, b) => a.diff - b.diff)[0];
            ratioValue = near && near.diff <= 0.08 ? near.item.value : capabilities.ratios[0].value;
        } else {
            ratioValue = capabilities.ratios[0].value;
        }
    }

    const autoSize = calcImageSize(activeResolution, ratioValue, capabilities.ratios);
    const showCustom = customSize || (sizeIsPixels && !isRatioValue);

    return (
        <>
            <div className="space-y-2.5">
                <SettingTitle color={theme.node.muted}>清晰度</SettingTitle>
                <Select
                    size="small"
                    className="w-full"
                    value={activeResolution}
                    onChange={(value) => onConfigChange("resolution", String(value))}
                    options={capabilities.resolutions.map((item) => ({ value: item.value, label: item.label }))}
                />
            </div>
            <div className="space-y-2.5">
                <SettingTitle color={theme.node.muted}>宽高比</SettingTitle>
                <Select
                    size="small"
                    className="w-full"
                    value={ratioValue}
                    onChange={(value) => onConfigChange("size", String(value))}
                    options={capabilities.ratios.map((item) => ({ value: item.value, label: `${item.label}` }))}
                />
            </div>
            <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                    <SettingTitle color={theme.node.muted}>尺寸</SettingTitle>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                            自定义 W×H
                        </span>
                        <span title="开启后可手动输入宽高（自动 16 倍数对齐）" onMouseDown={(event) => event.stopPropagation()}>
                            <Switch size="small" checked={showCustom} onChange={(checked) => { setCustomSize(checked); if (!checked) onConfigChange("size", ratioValue); }} />
                        </span>
                    </div>
                </div>
                {showCustom ? (
                    <CustomSizeInputs size={sizeIsPixels ? config.size : autoSize} theme={theme} alignToStep={snapDimensionToStep} onSnapChange={onSnapChange} onChange={(value) => onConfigChange("size", value)} />
                ) : (
                    <input
                        readOnly
                        className="h-9 w-full rounded-xl border bg-stone-50 px-2 text-sm dark:bg-stone-900"
                        style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                        value={autoSize.replace("x", " × ") + "（按档位与比例自动对齐）"}
                        onMouseDown={(event) => event.stopPropagation()}
                    />
                )}
            </div>
        </>
    );
}

function CustomSizeInputs({ size, theme, alignToStep, onSnapChange, onChange }: { size: string; theme: CanvasTheme; alignToStep: boolean; onSnapChange: (value: boolean) => void; onChange: (value: string) => void }) {
    const match = size.match(/^(\d+)x(\d+)$/);
    const width = match ? Number(match[1]) : 1024;
    const height = match ? Number(match[2]) : 1024;
    const commit = (key: "w" | "h", raw: number) => {
        const next = Math.max(64, alignDimension(Math.floor(raw || 1024), alignToStep));
        onChange(key === "w" ? `${next}x${height}` : `${width}x${next}`);
    };
    return (
        <>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                <DimensionInput prefix="W" value={width} disabled={false} theme={theme} alignToStep={alignToStep} onChange={(value) => commit("w", value || 1024)} />
                <span className="text-lg opacity-45">↔</span>
                <DimensionInput prefix="H" value={height} disabled={false} theme={theme} alignToStep={alignToStep} onChange={(value) => commit("h", value || 1024)} />
            </div>
            <div className="flex items-center justify-end gap-2">
                <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                    16倍数对齐
                </span>
                <span onMouseDown={(event) => event.stopPropagation()}>
                    <Switch size="small" checked={alignToStep} onChange={onSnapChange} />
                </span>
            </div>
        </>
    );
}
