import { useMemo, useState } from "react";
import { Pagination } from "antd";
import { SKILL_CATEGORIES, type Skill, type SkillCategory } from "./skills-data";
import { SkillCard } from "./skill-card";

type SkillLike = Skill & { priceCredits?: number; submitterName?: string; introduction?: string; useCases?: string[]; howToUse?: string[]; output?: string[]; promptFragment?: string; avgRating?: number | null; reviewCount?: number };

function StarIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 3.5l2.7 5.5 6.1.9-4.4 4.3 1 6L12 17.6 6.6 20.2l1-6L3.2 9.9l6.1-.9L12 3.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
    );
}

type Props = {
    skills: SkillLike[];
    loading?: boolean;
    activeCategory: SkillCategory;
    onCategoryChange: (c: SkillCategory) => void;
    onUse?: (skill: SkillLike) => void;
    onOpen?: (skill: SkillLike) => void;
    isFavorite?: (id: string) => boolean;
    onToggleFavorite?: (skill: SkillLike) => void;
    pageSize?: number;
};

export function SkillGallery({ skills, loading, activeCategory, onCategoryChange, onUse, onOpen, isFavorite, onToggleFavorite, pageSize = 12 }: Props) {
    const [page, setPage] = useState(1);

    const visible: SkillLike[] = useMemo(() => {
        if (activeCategory === "推荐") return skills;
        return skills.filter((s) => s.category === activeCategory);
    }, [skills, activeCategory]);

    useMemo(() => setPage(1), [activeCategory]);

    const paged = visible.slice((page - 1) * pageSize, page * pageSize);

    return (
        <div className="text-white/90">
            <div className="mb-4 flex flex-wrap items-center gap-2">
                {SKILL_CATEGORIES.map((c) => {
                    const active = c === activeCategory;
                    return (
                        <button
                            key={c}
                            type="button"
                            onClick={() => onCategoryChange(c)}
                            style={
                                active
                                    ? { backgroundColor: "#ffffff", color: "#000000", border: "1px solid transparent" }
                                    : { backgroundColor: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.10)" }
                            }
                            className="rounded-md px-3 py-1 text-xs font-medium transition hover:opacity-90"
                        >
                            {c}
                        </button>
                    );
                })}
                <span className="ml-auto inline-flex items-center gap-1 text-xs text-white/40">
                    <StarIcon /> 共 {visible.length} 个 Skill
                </span>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="animate-pulse rounded-xl bg-white/5 h-40" />
                    ))}
                </div>
            ) : paged.length === 0 ? (
                <p className="py-16 text-center text-sm text-white/40">没有匹配的 Skill，试试别的关键词。</p>
            ) : (
                <>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {paged.map((s) => (
                            <SkillCard
                                key={s.id}
                                skill={s}
                                onOpen={onOpen}
                                onUse={onUse}
                                onToggleFavorite={onToggleFavorite}
                                isFavorite={isFavorite?.(s.id)}
                            />
                        ))}
                    </div>
                    {visible.length > pageSize ? (
                        <div className="mt-6 flex justify-center [&_.ant-pagination-item]:!bg-white/5 [&_.ant-pagination-item]:!border-white/10 [&_.ant-pagination-item_a]:!text-white/80">
                            <Pagination current={page} pageSize={pageSize} total={visible.length} onChange={setPage} showSizeChanger={false} />
                        </div>
                    ) : null}
                </>
            )}
        </div>
    );
}