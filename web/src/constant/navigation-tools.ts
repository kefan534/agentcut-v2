import { FileText, ImagePlus, Images, Maximize2, Settings2, Video } from "lucide-react";

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
        slug: "assets",
        label: "我的资产",
        icon: Images,
        adminOnly: false,
    },
    {
        slug: "config",
        label: "设置",
        icon: Settings2,
        adminOnly: true,
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
