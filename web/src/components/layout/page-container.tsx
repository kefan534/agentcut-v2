import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 统一的页面外壳：全站所有内容页都套这个容器，保证左右页边距一致。
 * - 内容最大宽度 1280px (max-w-7xl)
 * - 左右内边距 24px (px-6)
 * - 高度撑满父容器，超出滚动
 *
 * 任何新页面都应该用这个，而不是直接写 `h-full overflow-hidden` 自己撑容器。
 */
export function PageContainer({ children, className, scroll = false }: { children: ReactNode; className?: string; scroll?: boolean }) {
    return (
        <div
            className={cn(
                "mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col px-6",
                scroll && "overflow-y-auto",
                className,
            )}
        >
            {children}
        </div>
    );
}

/**
 * 工作台/视频台专用布局：上下结构 + 中央对齐的工作区
 *  - 上下结构（header + main），符合"留白包裹中央工作区"的视觉要求
 *  - 父容器由 PageContainer 提供统一页边距
 */
export function WorkbenchShell({ children, header, content }: { children?: ReactNode; header?: ReactNode; content?: ReactNode }) {
    return (
        <div className="flex h-full min-h-0 w-full flex-col gap-4 py-4">
            {header}
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">{content ?? children}</main>
        </div>
    );
}