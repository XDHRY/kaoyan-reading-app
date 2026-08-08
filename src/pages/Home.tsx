import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useUser } from "@/hooks/useUser";
import { OnboardingTour } from "@/components/OnboardingTour";
import { Seal, StepSeal } from "@/components/ink/Seal";
import { BrushTitle, InkReveal, PaperCard, InkDivider } from "@/components/ink/decor";
import { SOP_STEPS } from "@contracts/types";

function StatCell({
  label,
  value,
  unit,
  vermilion = false,
}: {
  label: string;
  value: string | number;
  unit?: string;
  vermilion?: boolean;
}) {
  return (
    <div className="px-6 py-6 text-center hairline-r last:border-r-0">
      <div className="meta-label mb-2">{label}</div>
      <div
        className="text-[44px] leading-none font-bold"
        style={{ color: vermilion ? "var(--vermilion)" : "var(--ink)", fontFamily: "var(--font-zh)" }}
      >
        {value}
        {unit && <span className="text-[16px] text-[var(--ink-3)] ml-1">{unit}</span>}
      </div>
    </div>
  );
}

export default function Home() {
  const { user } = useUser();
  const { data: stats } = trpc.agent.stats.useQuery(undefined, { enabled: !!user });
  const { data: passages } = trpc.passage.list.useQuery();
  const { data: siteInfo } = trpc.auth.siteInfo.useQuery(undefined, { staleTime: 60_000 });

  const nextPassage = (passages ?? [])[0]; // 列表按年份倒序，取最新一篇
  const lastPassage = passages?.find((p) => p.id === stats?.lastPassageId);

  // 公告横幅只露摘要（标题 + 首行截断），全文请到 工单 · 公告榜 阅读
  const announcement = siteInfo?.announcement ?? "";
  const annTitle = announcement.match(/^【[^】]*】/)?.[0] ?? "";
  const annBody = announcement.slice(annTitle.length).replace(/\s+/g, " ").trim();
  const annDigest = annBody.length > 72 ? `${annBody.slice(0, 72)}……` : annBody;

  return (
    <div>
      <OnboardingTour />
      {announcement && (
        <Link to="/tickets?tab=notices" className="block mb-8 group" aria-label="查看公告全文">
          <PaperCard frame className="px-5 py-3.5 flex items-center gap-3 transition-colors group-hover:border-[var(--vermilion)]">
            <span className="shrink-0 text-[12px] px-2 py-0.5 bg-[var(--vermilion)] text-[var(--paper)] rounded-[2px] font-bold">公告</span>
            <p className="text-[14.5px] leading-relaxed truncate min-w-0 flex-1">
              {annTitle && <span className="font-bold">{annTitle} </span>}
              {annDigest}
            </p>
            <span className="shrink-0 text-[12px] text-[var(--ink-3)] transition-colors group-hover:text-[var(--vermilion)]">
              公告榜 →
            </span>
          </PaperCard>
        </Link>
      )}
      {/* 题字区：水墨山水衬底 + 竖排 + 印章落款 */}
      <div className="relative flex items-start justify-between mb-10 overflow-hidden rounded-[2px]">
        <img src="/art/ink-hero.jpg" alt="" aria-hidden className="ink-hero-art" loading="eager" />
        <InkReveal className="relative z-10 py-4 md:py-8 pl-1 md:pl-4">
          <div className="meta-label mb-3">KAOYAN ENGLISH I · 2010—2026</div>
          <h1 className="text-[40px] md:text-[52px] font-black leading-tight tracking-wide">
            <BrushTitle vermilion>纸上功夫</BrushTitle>
            <span className="block text-[22px] md:text-[28px] font-bold text-[var(--ink-2)] mt-3 tracking-wider">
              六步审题答题法，AI 全程陪跑
            </span>
          </h1>
        </InkReveal>
        <InkReveal delay={200} className="hidden md:block relative z-10 py-8 pr-2">
          <Seal size={110} seed="home-hero" text="考研阅读·纸上功夫" center="阅" animate />
        </InkReveal>
      </div>

      {/* 进度榜：发丝线分隔统计格 */}
      <InkReveal delay={100}>
        <PaperCard frame className="mb-8">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x-0">
            <StatCell label="已练篇章" value={stats?.donePassages ?? "—"} unit={`/ ${stats?.totalPassages ?? 68}`} />
            <StatCell label="答题正确率" value={stats ? `${stats.accuracy}%` : "—"} vermilion />
            <StatCell label="待攻克错题" value={stats?.wrongOpen ?? "—"} unit="道" />
            <StatCell label="连续学习" value={stats?.streak ?? "—"} unit="天" />
          </div>
        </PaperCard>
      </InkReveal>

      <div className="grid md:grid-cols-5 gap-8">
        {/* SOP 图谱缩略 */}
        <InkReveal delay={200} className="md:col-span-3">
          <PaperCard className="p-6 h-full">
            <div className="flex items-center justify-between mb-5">
              <BrushTitle as="h2" className="text-[22px]">
                做题六步图谱
              </BrushTitle>
              <Link to="/sop" className="text-[14px] text-[var(--vermilion)] hover:underline shrink-0">
                展开全图 →
              </Link>
            </div>
            <div className="space-y-0">
              {SOP_STEPS.map((s, i) => (
                <div key={s.id} className="flex items-center gap-4 group">
                  <div className="flex flex-col items-center">
                    <StepSeal num={s.num} seed={`home-${s.id}`} done={(stats?.donePassages ?? 0) > 0} />
                    {i < SOP_STEPS.length - 1 && (
                      <svg width="2" height="26" aria-hidden="true">
                        <line x1="1" y1="0" x2="1" y2="26" stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="3 3" />
                      </svg>
                    )}
                  </div>
                  <Link
                    to={`/sop#${s.id}`}
                    className="flex-1 py-2.5 flex items-baseline gap-3 border-b border-[var(--line)] group-last:border-b-0 hover:bg-[var(--paper-deep)]/60 px-2 transition-colors"
                  >
                    <span className="font-bold text-[17px]">{s.name}</span>
                    <span className="meta-label">{s.nameEn}</span>
                  </Link>
                </div>
              ))}
            </div>
          </PaperCard>
        </InkReveal>

        {/* 继续学习 + 快捷入口 */}
        <InkReveal delay={300} className="md:col-span-2">
          <div className="space-y-6 h-full flex flex-col">
            <PaperCard frame className="p-6">
              <div className="meta-label mb-3">CONTINUE · 继续学习</div>
              {lastPassage ? (
                <>
                  <p className="text-[15px] text-[var(--ink-2)] mb-1">上次练到</p>
                  <p className="text-[24px] font-bold mb-4">
                    {lastPassage.year} 年 · Text {lastPassage.textNo}
                  </p>
                  <Link
                    to={`/practice/${lastPassage.id}`}
                    className="inline-block px-5 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow text-[15px] hover:bg-[var(--vermilion)] transition-colors"
                  >
                    接着练 →
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-[15px] text-[var(--ink-2)] mb-4">
                    还没有做题记录。从最新一年真题开始，跟着 SOP 六步走一遍。
                  </p>
                  {nextPassage && (
                    <Link
                      to={`/practice/${nextPassage.id}`}
                      className="inline-block px-5 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow text-[15px] hover:bg-[var(--vermilion)] transition-colors"
                    >
                      从 {nextPassage.year} 年 Text {nextPassage.textNo} 开始 →
                    </Link>
                  )}
                </>
              )}
            </PaperCard>

            <PaperCard className="p-6 flex-1">
              <div className="meta-label mb-4">SHORTCUTS · 快捷入口</div>
              <div className="space-y-3">
                {[
                  { to: "/library", t: "真题库", d: "2010–2026 · 68 篇全文" },
                  { to: "/wrong", t: "错题本", d: "错题自动入册，重练攻克" },
                  { to: "/vocab", t: "生词本", d: "点词即查，卡片复习" },
                  { to: "/stats", t: "学习统计", d: "趋势·雷达·日历·进度" },
                  { to: "/generate", t: "AI 出题", d: "仿考研风格，即出即练" },
                  { to: "/guide", t: "方法指南", d: "零基础详细说明" },
                ].map((x) => (
                  <Link
                    key={x.to}
                    to={x.to}
                    className="flex items-baseline justify-between py-2 border-b border-[var(--line)] last:border-b-0 hover:px-2 transition-all group"
                  >
                    <span className="font-bold text-[16px] group-hover:text-[var(--vermilion)] transition-colors">
                      {x.t}
                    </span>
                    <span className="text-[13px] text-[var(--ink-3)]">{x.d}</span>
                  </Link>
                ))}
              </div>
            </PaperCard>
          </div>
        </InkReveal>
      </div>

      <InkDivider className="mt-14" />
      <p className="text-center text-[13px] text-[var(--ink-3)] mt-4">
        「操千曲而后晓声，观千剑而后识器」—— 先读 <Link to="/guide" className="text-[var(--vermilion)] hover:underline">方法指南</Link>，再进真题。
      </p>
    </div>
  );
}
