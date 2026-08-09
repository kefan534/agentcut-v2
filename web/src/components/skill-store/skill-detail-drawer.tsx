import { useEffect, useMemo } from "react";
import { Button, Tag } from "antd";
import { Zap, Star, X, Share2, User } from "lucide-react";
import type { Skill } from "./skills-data";

type SkillLike = Skill & {
    priceCredits?: number;
    introduction?: string;
    useCases?: string[];
    howToUse?: string[];
    output?: string[];
    promptFragment?: string;
    submitterName?: string;
    avgRating?: number | null;
    reviewCount?: number;
};

function VideoBackdrop({ skill }: { skill: SkillLike }) {
    const [from, to] = skill.palette;
    const id = `v-${skill.id}`;
    return (
        <svg viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={skill.title} className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
            <defs>
                <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={from} />
                    <stop offset="100%" stopColor={to} />
                </linearGradient>
                <radialGradient id={`${id}-glow`} cx="0.7" cy="0.3" r="0.7">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.32)" />
                    <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                </radialGradient>
                <linearGradient id={`${id}-vignette`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(0,0,0,0)" />
                    <stop offset="100%" stopColor="rgba(0,0,0,0.55)" />
                </linearGradient>
            </defs>
            <rect width="1280" height="720" fill={`url(#${id})`} />
            <rect width="1280" height="720" fill={`url(#${id}-glow)`} />
            <rect width="1280" height="720" fill={`url(#${id}-vignette)`} />
            <text x="50%" y="48%" textAnchor="middle" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="84" fontWeight="700" fill="rgba(255,255,255,0.92)" letterSpacing="4">{skill.motif}</text>
            <text x="50%" y="62%" textAnchor="middle" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="24" fill="rgba(255,255,255,0.6)">{skill.title}</text>
        </svg>
    );
}

function VideoPlayer({ skill }: { skill: SkillLike }) {
    return (
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
            <VideoBackdrop skill={skill} />
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/40 backdrop-blur transition hover:bg-black/55">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="white" aria-hidden>
                        <path d="M8 5v14l11-7L8 5z" />
                    </svg>
                </span>
            </div>
        </div>
    );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="grid grid-cols-[88px_1fr] items-start gap-4 py-3 border-b border-white/10 last:border-0">
            <div className="text-sm text-white/45">{label}</div>
            <div className="text-sm text-white">{children}</div>
        </div>
    );
}

type Props = {
    skill: SkillLike | null;
    related?: SkillLike[];
    onClose: () => void;
    onUse?: (skill: SkillLike) => void;
    onOpen?: (skill: SkillLike) => void;
};

export function SkillDetailDrawer({ skill, related = [], onClose, onUse, onOpen }: Props) {
    useEffect(() => {
        if (!skill) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        document.addEventListener("keydown", onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
    }, [skill, onClose]);

    const relatedList = useMemo(() => related.filter((r) => r.id !== skill?.id).slice(0, 4), [related, skill]);

    if (!skill) return null;
    const price = skill.priceCredits || 0;

    return (
        <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm"
            onClick={onClose}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="relative w-full max-w-4xl overflow-hidden rounded-2xl bg-[#1a1a1a] text-white shadow-2xl ring-1 ring-white/10 max-h-[90vh] flex flex-col"
            >
                {/* Header */}
                <div className="flex items-start gap-4 border-b border-white/10 px-6 py-5">
                    <div className="min-w-0 flex-1">
                        <h2 className="text-xl font-semibold tracking-tight">{skill.title}</h2>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/60">
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-white/30 to-white/10 text-[10px] text-white">
                                {(skill.submitterName || skill.author).slice(0, 1)}
                            </span>
                            <span className="text-white/80">{skill.submitterName || skill.author}</span>
                            <span className="text-white/30">·</span>
                            <span>{skill.category}</span>
                            <span className="text-white/30">·</span>
                            <span className="inline-flex items-center gap-1"><User className="size-3" /> {skill.usage}</span>
                            {skill.avgRating ? (
                                <>
                                    <span className="text-white/30">·</span>
                                    <span className="inline-flex items-center gap-1"><Star className="size-3" /> {skill.avgRating} ({skill.reviewCount})</span>
                                </>
                            ) : null}
                            <span className="text-white/30">·</span>
                            {price > 0 ? (
                                <span className="rounded border border-purple-400/30 bg-purple-500/10 px-2 py-0.5 text-purple-300">{price} 积分</span>
                            ) : (
                                <span className="rounded border border-green-400/30 bg-green-500/10 px-2 py-0.5 text-green-300">免费</span>
                            )}
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                        <button type="button" aria-label="分享" className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/5 text-white/80 transition hover:bg-white/10 hover:text-white">
                            <Share2 className="size-4" />
                        </button>
                        <Button type="primary" icon={<Zap className="size-4" />} onClick={() => onUse?.(skill)}>
                            {price > 0 ? "解锁并添加" : "添加 Skill"}
                        </Button>
                        <button type="button" aria-label="关闭" onClick={onClose} className="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/5 hover:text-white">
                            <X className="size-5" />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="overflow-y-auto px-6 py-6">
                    <VideoPlayer skill={skill} />

                    <h3 className="mt-6 text-base font-semibold">简介</h3>
                    <div className="mt-2">
                        <DetailRow label="介绍">{skill.introduction || skill.description || "—"}</DetailRow>
                        <DetailRow label="分类">{skill.category}</DetailRow>
                        {skill.useCases?.length ? <DetailRow label="使用场景">{skill.useCases.join("、")}</DetailRow> : null}
                        {skill.howToUse?.length ? <DetailRow label="如何使用">{skill.howToUse.join("、")}</DetailRow> : null}
                        {skill.output?.length ? <DetailRow label="输出内容">{skill.output.join("、")}</DetailRow> : null}
                        {skill.promptFragment ? (
                            <DetailRow label="Prompt">
                                <pre className="rounded bg-white/5 p-3 text-xs whitespace-pre-wrap max-h-40 overflow-y-auto border border-white/10">{skill.promptFragment}</pre>
                            </DetailRow>
                        ) : null}
                    </div>

                    {relatedList.length > 0 ? (
                        <div className="mt-8">
                            <h3 className="text-base font-semibold">相关推荐</h3>
                            <div className="mt-3 -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
                                {relatedList.map((r) => (
                                    <button
                                        key={r.id}
                                        onClick={() => onOpen?.(r)}
                                        className="group w-[280px] shrink-0 snap-start overflow-hidden rounded-xl border border-white/5 bg-[#15151a] p-3 text-left transition hover:border-white/15 hover:bg-[#1f1f1f]"
                                    >
                                        <div className="flex gap-3">
<div className="relative h-[72px] w-[128px] shrink-0 overflow-hidden rounded-lg bg-black/40">
                                        <VideoBackdrop skill={r} />
                                    </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-semibold text-white">{r.title}</div>
                                                <div className="mt-1 line-clamp-2 text-xs text-white/55">{r.description}</div>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}