import { useMemo, useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { BrushTitle, InkReveal, PaperCard, StatusDot } from "@/components/ink/decor";

export default function LibraryPage() {
  const { data: passages, isLoading } = trpc.passage.list.useQuery();
  const { data: stats } = trpc.agent.stats.useQuery();
  const [yearFilter, setYearFilter] = useState<number | 0>(0);

  const years = useMemo(() => [...new Set((passages ?? []).map((p) => p.year))].sort((a, b) => b - a), [passages]);
  const shown = (passages ?? []).filter((p) => yearFilter === 0 || p.year === yearFilter);
  // 警示说明按年份去重：同一年的 4 篇同源同说明，逐卡重复 68 次只是噪音；
  // 每个年份只在第一张卡上展示，其余三篇静默（年份筛选视图下同理）
  const firstOfYear = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of shown) if (!m.has(p.year)) m.set(p.year, p.id);
    return m;
  }, [shown]);
  const noteOfYear = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of shown) if (p.verifyNote && !m.has(p.year)) m.set(p.year, p.verifyNote);
    return m;
  }, [shown]);

  return (
    <div>
      <InkReveal className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="meta-label mb-2">REAL EXAMS · 2010—2026</div>
          <h1 className="text-[34px] font-black">
            <BrushTitle vermilion>真题库</BrushTitle>
          </h1>
          <p className="text-[var(--ink-2)] mt-2 text-[15px]">
            英语一 · 传统阅读 Text 1–4 · 共 {passages?.length ?? "…"} 篇 · 340 题
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setYearFilter(0)}
            className={`px-3 py-1 text-[14px] border rounded-[2px] ${yearFilter === 0 ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)] text-[var(--ink-2)]"}`}
          >
            全部
          </button>
          {years.map((y) => (
            <button
              key={y}
              onClick={() => setYearFilter(y)}
              className={`px-3 py-1 text-[14px] border rounded-[2px] ${yearFilter === y ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)] text-[var(--ink-2)]"}`}
            >
              {y}
            </button>
          ))}
        </div>
      </InkReveal>

      {isLoading && <p className="text-[var(--ink-3)]">载入真题中……</p>}

      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        {shown.map((p, i) => (
          <InkReveal key={p.id} delay={Math.min(i, 8) * 50}>
            <Link to={`/practice/${p.id}`}>
              <PaperCard className="p-5 h-full hover:print-shadow transition-shadow" frame>
                <div className="flex items-center justify-between mb-3">
                  <span className="meta-label">TEXT {p.textNo}</span>
                  <span className="flex items-center gap-1.5 text-[12px] text-[var(--ink-3)]">
                    <StatusDot ok={p.verifyStatus === "verified"} warn={p.verifyStatus !== "verified"} />
                    {p.verifyStatus === "verified" ? "双源校验" : "单源"}
                  </span>
                </div>
                <div className="text-[26px] font-black leading-none mb-1">{p.year}</div>
                <div className="text-[14px] text-[var(--ink-3)]">
                  {p.paraCount} 个自然段 · 5 题
                </div>
                {noteOfYear.get(p.year) && firstOfYear.get(p.year) === p.id && (
                  <div className="text-[12px] text-[#b98a2f] mt-2 leading-snug">
                    △ {noteOfYear.get(p.year)!.slice(0, 40)}
                    <span className="text-[var(--ink-3)]">（本年四篇同）</span>
                  </div>
                )}
                <div className="mt-4 text-[14px] text-[var(--vermilion)] font-bold">开始练习 →</div>
              </PaperCard>
            </Link>
          </InkReveal>
        ))}
      </div>

      {stats && (
        <p className="text-center text-[13px] text-[var(--ink-3)] mt-10">
          已完成 {stats.donePassages} / {stats.totalPassages} 篇
        </p>
      )}
    </div>
  );
}
