import { useEffect, useRef, type ReactNode } from "react";

type GenerationConfirmBubbleProps = {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
    kind: string;
    cost: number | null;
    balance: number;
    /** 生成按钮（气泡锚定其上方） */
    children: ReactNode;
};

const fmt = new Intl.NumberFormat("zh-CN");

/**
 * 生成确认气泡 —— 锚定生成按钮上方的深灰半透明毛玻璃小卡片，
 * 替代居中的 Modal.confirm 大白框（视频台/生图台共用）。
 */
export function GenerationConfirmBubble({ open, onClose, onConfirm, kind, cost, balance, children }: GenerationConfirmBubbleProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) onClose();
        };
        const escHandler = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("mousedown", handler);
        document.addEventListener("keydown", escHandler);
        return () => {
            document.removeEventListener("mousedown", handler);
            document.removeEventListener("keydown", escHandler);
        };
    }, [open, onClose]);

    const remaining = Math.max(0, balance - (cost ?? 0));

    return (
        <div className="relative" ref={containerRef}>
            {children}
            {open ? (
                <div
                    className="absolute bottom-full left-1/2 z-30 mb-2 w-[264px] -translate-x-1/2 rounded-2xl border border-stone-600/40 p-4 shadow-2xl"
                    style={{ background: "rgba(28,25,23,0.88)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
                    role="dialog"
                    aria-label="确认生成"
                >
                    <div
                        className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-l border-t border-stone-600/40"
                        style={{ background: "rgba(28,25,23,0.88)" }}
                    />
                    <div className="mb-1.5 flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-medium text-stone-50">确认生成</span>
                        <span className="text-[11px] text-stone-500">{kind}</span>
                    </div>
                    <div className="mb-3 text-xs leading-relaxed text-stone-300">
                        预计消耗 <span className="text-base font-medium text-amber-400">{fmt.format(cost ?? 0)}</span> <span className="text-stone-400">credits</span>
                        <br />
                        <span className="text-stone-400">
                            当前余额 {fmt.format(balance)}，生成后剩余 {fmt.format(remaining)}
                        </span>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            className="h-7 cursor-pointer rounded-lg border border-stone-500/40 bg-transparent px-3.5 text-xs text-stone-300 transition hover:border-stone-400 hover:text-stone-100"
                            onClick={onClose}
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            className="h-7 cursor-pointer rounded-lg border-none bg-stone-50 px-3.5 text-xs font-medium text-stone-950 transition hover:bg-white"
                            onClick={() => {
                                onClose();
                                onConfirm();
                            }}
                        >
                            开始生成
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
