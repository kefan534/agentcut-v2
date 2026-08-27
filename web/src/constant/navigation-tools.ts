import { BookMarked, Clapperboard, ClipboardCheck, FileText, ImagePlus, ListChecks, Maximize2, Video, Zap } from "lucide-react";

export const navigationTools = [
    {
        slug: "canvas",
        label: "我的画布",
        icon: Maximize2,
        adminOnly: false,
    },
    {
        slug: "image",
        label: "生图工作台",
        icon: ImagePlus,
        adminOnly: false,
    },
    {
        slug: "video",
        label: "视频创作台",
        icon: Video,
        adminOnly: false,
    },
    {
        slug: "prompts",
        label: "提示词库",
        icon: FileText,
        adminOnly: false,
    },
    {
        slug: "skill-store",
        label: "Skill 商店",
        icon: Zap,
        adminOnly: false,
    },
    {
        slug: "drama",
        label: "制片工坊",
        icon: Clapperboard,
        adminOnly: false,
    },
    {
        slug: "tasks",
        label: "任务中心",
        icon: ListChecks,
        adminOnly: false,
    },
    {
        slug: "qa",
        label: "质量中心",
        icon: ClipboardCheck,
        adminOnly: false,
    },
    {
        slug: "lock-card",
        label: "全局锁定卡",
        icon: BookMarked,
        adminOnly: false,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
