import type { Skill } from "./skills-data";

type SkillLike = Skill & { priceCredits?: number; submitterName?: string };

function ThumbnailPlaceholder({ skill }: { skill: SkillLike }) {
    const [from, to] = skill.palette;
    const id = `g-${skill.id}`;
    return (
        <svg viewBox="0 0 400 225" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={skill.title} className="h-full w-full" preserveAspectRatio="xMidYMid slice">
            <defs>
                <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={from} />
                    <stop offset="100%" stopColor={to} />
                </linearGradient>
                <radialGradient id={`${id}-glow`} cx="0.7" cy="0.3" r="0.6">
                    <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
                    <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                </radialGradient>
            </defs>
            <rect width="400" height="225" fill={`url(#${id})`} />
            <rect width="400" height="225" fill={`url(#${id}-glow)`} />
            <text x="50%" y="52%" textAnchor="middle" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="34" fontWeight="700" fill="rgba(255,255,255,0.92)" letterSpacing="2">
                {skill.motif}
            </text>
            <text x="50%" y="74%" textAnchor="middle" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="13" fill="rgba(255,255,255,0.55)">
                {skill.title}
            </text>
        </svg>
    );
}

function PersonIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
            <path d="M4 20c1.5-3.5 5-5 8-5s6.5 1.5 8 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
    );
}

type Props = {
    skill: SkillLike;
    onOpen?: (skill: SkillLike) => void;
    onUse?: (skill: SkillLike) => void;
    isFavorite?: boolean;
    onToggleFavorite?: (skill: SkillLike) => void;
};

export function SkillCard({ skill, onOpen, onUse, onToggleFavorite, isFavorite = false }: Props) {
    const price = skill.priceCredits || 0;
    const handleOpen = () => onOpen?.(skill);
    const handleUse = (e: React.MouseEvent) => { e.stopPropagation(); onUse?.(skill); };
    const handleFav = (e: React.MouseEvent) => { e.stopPropagation(); onToggleFavorite?.(skill); };

    return (
        <article
            role={onOpen ? "button" : undefined}
            tabIndex={onOpen ? 0 : undefined}
            onClick={onOpen ? handleOpen : undefined}
            onKeyDown={onOpen ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpen(); } } : undefined}
            className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-white/5 bg-[#15151a] p-3 transition hover:border-white/15 hover:bg-[#1f1f1f]"
        >
            {/* Top: thumbnail (固定尺寸 128x72px) + text */}
            <div className="flex gap-3">
                <div className="relative h-[72px] w-[128px] shrink-0 overflow-hidden rounded-lg bg-black/40">
                    <ThumbnailPlaceholder skill={skill} />
                    <span className="absolute left-1.5 top-1.5 rounded bg-white/95 px-1.5 py-0.5 text-[10px] font-medium leading-none text-black">
                        {skill.badge}
                    </span>
                </div>

                <div className="flex min-w-0 flex-1 flex-col py-0.5">
                    <h3 className="truncate pr-16 text-sm font-semibold text-white">{skill.title}</h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-snug text-white/55">{skill.description}</p>
                    <div className="mt-auto flex items-center gap-2 text-xs text-white/60">
                        <span aria-hidden className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-white/20 to-white/5 text-[10px] text-white/80">
                            {(skill.submitterName || skill.author).slice(0, 1)}
                        </span>
                        <span className="truncate text-white/80">{skill.submitterName || skill.author}</span>
                        <span aria-hidden className="text-white/30">·</span>
                        <span aria-hidden className="inline-flex items-center gap-1"><PersonIcon /> {skill.usage}</span>
                    </div>
                </div>
            </div>

            {/* Bottom action row — 参照 skill-page 原版：使用按钮黑底白字，解锁按钮暗色边框 */}
            <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                    type="button"
                    onClick={handleUse}
                    className="flex items-center gap-1.5 rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white shadow ring-1 ring-white/10 transition hover:bg-zinc-900"
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M13 2L3 14h7l-1 8 11-14h-7l1-6z" />
                    </svg>
                    使用
                </button>
                {price > 0 ? (
                    <button
                        type="button"
                        onClick={handleUse}
                        className="ml-auto rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/85 transition hover:bg-white/10 hover:text-white"
                    >
                        解锁
                    </button>
                ) : (
                    <span className="ml-auto rounded-md border border-green-400/30 bg-green-500/15 px-2.5 py-1.5 text-xs font-medium text-green-300">
                        免费
                    </span>
                )}
            </div>

            {/* Hover action overlay — 移植自 skill-page：右上角 ☆ 收藏 */}
            {onToggleFavorite && (
                <div
                    className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        type="button"
                        aria-label={isFavorite ? "已收藏" : "收藏"}
                        onClick={handleFav}
                        className={
                            "flex h-7 w-7 items-center justify-center rounded-full border transition " +
                            (isFavorite
                                ? "border-yellow-300/30 bg-yellow-500/15 text-yellow-300"
                                : "border-white/15 bg-black/30 text-white/85 backdrop-blur hover:bg-black/50 hover:text-white")
                        }
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill={isFavorite ? "currentColor" : "none"} aria-hidden>
                            <path d="M12 3.5l2.7 5.5 6.1.9-4.4 4.3 1 6L12 17.6 6.6 20.2l1-6L3.2 9.9l6.1-.9L12 3.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                        </svg>
                    </button>
                </div>
            )}
        </article>
    );
}