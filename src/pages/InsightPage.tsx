import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useUser } from "@/hooks/useUser";
import { BrushTitle, InkReveal, InkDivider, PaperCard, StatusDot } from "@/components/ink/decor";
import { Seal } from "@/components/ink/Seal";
import { ERROR_TYPES, REVIEW_INTERVALS_DAYS } from "@contracts/constants";
import { playSound } from "@/hooks/useSound";

type Tab = "advice" | "insights" | "overview" | "review";

const QTYPE_ZH: Record<string, string> = {
  example: "例证题", attitude: "态度题", vocab: "语义题", cause: "因果题",
  viewpoint: "观点题", detail: "细节题", infer: "推断题", main: "主旨题", unknown: "未分类",
};

const GOLD = "#b98a2f";

/** 错因小印：墨色描边 + 朱砂字 */
function ErrorTypeBadge({ type }: { type: string }) {
  const meta = (ERROR_TYPES as Record<string, { zh: string }>)[type];
  if (!meta) return null;
  return (
    <span className="px-1.5 py-0.5 text-[11.5px] font-bold text-[var(--vermilion)] border border-[var(--vermilion)]/50 rounded-[2px]">
      {meta.zh}
    </span>
  );
}

function TabBtn({ active, onClick, children, badge }: { active: boolean; onClick: () => void; children: React.ReactNode; badge?: number }) {
  return (
    <button
      onClick={onClick}
      className={`relative px-4 py-1.5 text-[14px] border rounded-[2px] transition-colors ${
        active ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--ink-2)]"
      }`}
    >
      {children}
      {!!badge && (
        <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 rounded-[2px] bg-[var(--vermilion)] text-[var(--paper)] text-[10.5px] font-bold flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  );
}

// ———— 壹 · 备考建议 ————
function AdviceTab() {
  const utils = trpc.useUtils();
  const { data: rec, isLoading } = trpc.insight.getRecommendation.useQuery();
  const recommend = trpc.insight.recommend.useMutation({
    onSuccess: () => void utils.insight.getRecommendation.invalidate(),
  });
  const { data: practice } = trpc.insight.practiceProblems.useQuery({ limit: 8 });

  return (
    <div className="space-y-6">
      <PaperCard frame className="p-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <BrushTitle as="h2" vermilion className="text-[19px]">AI 备考参谋</BrushTitle>
            <p className="meta-label mt-1.5">COUNSEL · 基于真实错题统计</p>
          </div>
          <button
            onClick={() => recommend.mutate({ force: !!rec })}
            disabled={recommend.isPending}
            className="px-5 py-2 text-[13.5px] font-bold bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow hover:opacity-90 disabled:opacity-40"
          >
            {recommend.isPending ? "推演中…" : rec ? "重新推演" : "生成备考建议"}
          </button>
        </div>
        {recommend.isError && (
          <p className="mt-3 text-[13px] text-[var(--vermilion)] border-l-2 border-[var(--vermilion)] pl-2.5">
            {(recommend.error as { message?: string }).message ?? "生成失败，请稍后重试"}
          </p>
        )}
        {isLoading && <p className="mt-4 text-[13.5px] text-[var(--ink-3)]">载入中…</p>}
        {!rec && !isLoading && !recommend.isPending && (
          <p className="mt-4 text-[13.5px] text-[var(--ink-3)] leading-relaxed">
            还没有备考建议。刷几篇真题、攒下错题后点「生成备考建议」——参谋只基于你的真实错题统计出谋，绝不凭空开方。
          </p>
        )}
        {rec && (
          <div className="mt-5 space-y-4">
            {rec.headline && <p className="text-[17px] font-bold" style={{ fontFamily: "var(--font-zh)" }}>{rec.headline}</p>}
            {rec.focusTypes && rec.focusTypes.length > 0 && (
              <p className="text-[13px]">
                <span className="text-[var(--ink-3)] mr-2">主攻题型</span>
                {rec.focusTypes.map((t) => (
                  <b key={t} className="mr-2 px-2 py-0.5 bg-[var(--vermilion)]/10 text-[var(--vermilion)] rounded-[2px]">{QTYPE_ZH[t] ?? t}</b>
                ))}
              </p>
            )}
            <div className="border-l-2 border-[var(--vermilion)] pl-3.5 text-[14px] leading-[1.95] text-[var(--ink-2)] whitespace-pre-wrap">{rec.advice}</div>
            <p className="text-[11.5px] text-[var(--ink-3)]">模型 {rec.modelUsed} · 更新于 {new Date(rec.updatedAt).toLocaleString("zh-CN")}</p>
          </div>
        )}
      </PaperCard>

      <PaperCard className="p-6">
        <BrushTitle as="h2" className="text-[17px]">针对性练题</BrushTitle>
        <p className="meta-label mt-1.5 mb-4">DRILL · 薄弱题型 × 近年真题</p>
        {!practice || practice.items.length === 0 ? (
          <p className="text-[13.5px] text-[var(--ink-3)]">暂无可荐之题——系统会按你的薄弱题型，从真题库挑你还没做过的题。</p>
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {practice.items.map((p) => (
              <div key={p.questionId} className="flex items-center gap-3 py-2.5">
                <span className="text-[12px] text-[var(--ink-3)] whitespace-nowrap w-[92px]">{p.year} · T{p.textNo} · Q{p.qNo}</span>
                <b className="px-2 py-0.5 bg-[var(--bamboo)]/15 text-[var(--bamboo)] text-[11.5px] rounded-[2px] whitespace-nowrap">{QTYPE_ZH[p.qType] ?? p.qType}</b>
                <span className="flex-1 text-[13.5px] text-[var(--ink-2)] truncate">{p.stem}</span>
                <Link to={`/practice/${p.passageId}`} className="text-[12.5px] font-bold text-[var(--vermilion)] whitespace-nowrap hover:underline">→ 去练</Link>
              </div>
            ))}
          </div>
        )}
      </PaperCard>
    </div>
  );
}

// ———— 贰 · 感悟笔记 ————
function InsightsTab() {
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.insight.insightList.useQuery();
  const save = trpc.insight.insightSave.useMutation({ onSuccess: () => void utils.insight.insightList.invalidate() });
  const remove = trpc.insight.insightRemove.useMutation({ onSuccess: () => void utils.insight.insightList.invalidate() });
  const [content, setContent] = useState("");
  const [errorType, setErrorType] = useState("");
  const [status, setStatus] = useState<"attention" | "understood">("attention");
  const [editingId, setEditingId] = useState<number | null>(null);

  const submit = async () => {
    if (!content.trim()) return;
    await save.mutateAsync({ id: editingId ?? undefined, content: content.trim(), errorType, status });
    setContent(""); setErrorType(""); setStatus("attention"); setEditingId(null);
  };

  return (
    <div className="space-y-6">
      <PaperCard frame className="p-6">
        <BrushTitle as="h2" vermilion className="text-[17px]">{editingId ? "修改这条感悟" : "写一条感悟"}</BrushTitle>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          placeholder="例：态度题再读一遍首段转折句，别凭感觉选……"
          className="mt-3 w-full border border-[var(--line)] rounded-[2px] px-3 py-2.5 text-[14px] leading-relaxed bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)]"
        />
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <select value={errorType} onChange={(e) => setErrorType(e.target.value)} className="border border-[var(--line)] rounded-[2px] px-2.5 py-1.5 text-[13px] bg-[var(--paper)]">
            <option value="">不归类</option>
            {Object.entries(ERROR_TYPES).map(([k, v]) => <option key={k} value={k}>{v.zh}</option>)}
          </select>
          <button onClick={() => setStatus("attention")} className={`px-3 py-1.5 text-[13px] border rounded-[2px] ${status === "attention" ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)] text-[var(--ink-2)]"}`}>待消化</button>
          <button onClick={() => setStatus("understood")} className={`px-3 py-1.5 text-[13px] border rounded-[2px] ${status === "understood" ? "border-[var(--bamboo)] text-[var(--bamboo)] font-bold" : "border-[var(--line)] text-[var(--ink-2)]"}`}>已吃透</button>
          <span className="flex-1" />
          {editingId && <button onClick={() => { setEditingId(null); setContent(""); }} className="px-3 py-1.5 text-[13px] border border-[var(--line)] rounded-[2px] text-[var(--ink-2)]">取消</button>}
          <button onClick={() => void submit()} disabled={save.isPending || !content.trim()} className="px-5 py-1.5 text-[13.5px] font-bold bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow disabled:opacity-40">
            {save.isPending ? "落墨中…" : "落墨"}
          </button>
        </div>
      </PaperCard>

      {isLoading && <p className="text-[13.5px] text-[var(--ink-3)]">载入中…</p>}
      {!isLoading && (rows ?? []).length === 0 && (
        <PaperCard className="p-10 text-center">
          <p className="text-[14px] text-[var(--ink-3)]">尚无感悟。错题本里点「写感悟」可挂上具体错题，也可在此直记通用心得。</p>
        </PaperCard>
      )}
      <div className="space-y-4">
        {(rows ?? []).map((r) => (
          <PaperCard key={r.id} className="p-5">
            <div className="flex items-center gap-2 flex-wrap">
              {r.errorType && <ErrorTypeBadge type={r.errorType} />}
              <StatusDot ok={r.status === "understood"} warn={r.status === "attention"} />
              <span className={`text-[12px] font-bold ${r.status === "understood" ? "text-[var(--bamboo)]" : ""}`} style={r.status === "attention" ? { color: GOLD } : undefined}>
                {r.status === "understood" ? "已吃透" : "待消化"}
              </span>
              {r.wrongId && <Link to="/wrong" className="text-[11.5px] text-[var(--ink-3)] hover:text-[var(--vermilion)]">↗ 关联错题 #{r.wrongId}</Link>}
              <span className="flex-1" />
              <span className="text-[11.5px] text-[var(--ink-3)]">{new Date(r.updatedAt).toLocaleDateString("zh-CN")}</span>
              <button onClick={() => { setEditingId(r.id); setContent(r.content); setErrorType(r.errorType); setStatus(r.status as "attention" | "understood"); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="text-[12px] font-bold text-[var(--ink-2)] hover:text-[var(--ink)]">改</button>
              <button onClick={() => { if (confirm("删除这条感悟？")) remove.mutate({ id: r.id }); }} className="text-[12px] font-bold text-[var(--vermilion)]/70 hover:text-[var(--vermilion)]">删</button>
            </div>
            <p className="mt-2.5 text-[14px] leading-[1.9] text-[var(--ink-2)] whitespace-pre-wrap">{r.content}</p>
          </PaperCard>
        ))}
      </div>
    </div>
  );
}

// ———— 叁 · 错因概览 ————
function OverviewTab() {
  const { data: stats, isLoading } = trpc.insight.errorTypeStats.useQuery();
  const { data: summary } = trpc.insight.insightSummary.useQuery();
  if (isLoading) return <p className="text-[13.5px] text-[var(--ink-3)]">载入中…</p>;
  if (!stats || stats.total === 0) {
    return (
      <PaperCard className="p-10 text-center">
        <p className="text-[14px] text-[var(--ink-3)]">还没有错题数据。先去<Link to="/library" className="text-[var(--vermilion)] font-bold hover:underline">真题库</Link>刷一篇。</p>
      </PaperCard>
    );
  }
  const maxCount = Math.max(1, ...stats.byErrorType.map((b) => b.count));
  return (
    <div className="space-y-6">
      <PaperCard frame className="p-6">
        <BrushTitle as="h2" vermilion className="text-[17px]">错因六分法</BrushTitle>
        <p className="text-[12.5px] text-[var(--ink-3)] mt-2 mb-5">
          共 {stats.total} 道错题{stats.undiagnosed > 0 && `，${stats.undiagnosed} 道尚未诊断（错题本里可逐题深度分析）`}
        </p>
        <div className="space-y-3.5">
          {stats.byErrorType.map((b) => {
            const meta = (ERROR_TYPES as Record<string, { sopStep: string; desc: string }>)[b.errorType];
            return (
              <div key={b.errorType}>
                <div className="flex items-center gap-3 text-[13.5px]">
                  <span className="w-[76px] font-bold shrink-0">{b.zh}</span>
                  <div className="flex-1 h-[18px] border border-[var(--line)] rounded-[2px] overflow-hidden bg-[var(--paper-deep)]/40">
                    <div className="h-full bg-[var(--vermilion)]/70 transition-all" style={{ width: `${(b.count / maxCount) * 100}%` }} />
                  </div>
                  <span className="w-7 text-right font-bold text-[var(--ink-2)]">{b.count}</span>
                </div>
                {b.count > 0 && meta && (
                  <p className="text-[11.5px] text-[var(--ink-3)] mt-1 ml-[88px]">对应 SOP {meta.sopStep} · {meta.desc}</p>
                )}
              </div>
            );
          })}
        </div>
      </PaperCard>

      {stats.recent14Days?.some((d) => d.count > 0) && (
        <PaperCard className="p-6">
          <BrushTitle as="h2" className="text-[17px]">近 14 天错题热度</BrushTitle>
          <p className="text-[12.5px] text-[var(--ink-3)] mt-2 mb-4">每日入册的错题数——热度下降，就是进步在发生。</p>
          <div className="flex items-end gap-[5px] h-[64px]">
            {stats.recent14Days.map((d) => {
              const maxD = Math.max(1, ...stats.recent14Days.map((x) => x.count));
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${d.date} · ${d.count} 题`}>
                  {d.count > 0 && <span className="text-[10px] font-bold text-[var(--vermilion)]">{d.count}</span>}
                  <div
                    className={`w-full rounded-[2px] ${d.count > 0 ? "bg-[var(--vermilion)]/60" : "bg-[var(--line)]/50"}`}
                    style={{ height: `${Math.max(6, (d.count / maxD) * 44)}px` }}
                  />
                  <span className="text-[9.5px] text-[var(--ink-3)] whitespace-nowrap">{d.date}</span>
                </div>
              );
            })}
          </div>
        </PaperCard>
      )}

      <PaperCard className="p-6">
        <BrushTitle as="h2" className="text-[17px]">题型掌握度</BrushTitle>
        <div className="grid sm:grid-cols-2 gap-x-6 mt-4 divide-y sm:divide-y-0 divide-[var(--line)]">
          {stats.byQType.map((q) => {
            const pct = Math.round((q.mastered / q.total) * 100);
            return (
              <div key={q.qType} className="flex items-center gap-3 py-2.5 sm:border-b sm:border-[var(--line)]">
                <span className="font-bold text-[13.5px] w-16">{QTYPE_ZH[q.qType] ?? q.qType}</span>
                <span className="text-[12.5px] text-[var(--ink-3)]">错 {q.total} · 掌握 {q.mastered}</span>
                <span className="flex-1" />
                <span className={`text-[14px] font-bold ${pct >= 60 ? "text-[var(--bamboo)]" : "text-[var(--vermilion)]"}`} style={pct >= 30 && pct < 60 ? { color: GOLD } : undefined}>
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </PaperCard>

      {summary && summary.total > 0 && (
        <PaperCard className="p-6">
          <BrushTitle as="h2" className="text-[17px]">感悟沉淀</BrushTitle>
          <p className="text-[13.5px] text-[var(--ink-2)] mt-3">
            共 {summary.total} 条 · <b style={{ color: GOLD }}>{summary.attention} 待消化</b> · <b className="text-[var(--bamboo)]">{summary.understood} 已吃透</b>
          </p>
        </PaperCard>
      )}
    </div>
  );
}

// ———— 肆 · 艾宾浩斯复习 ————
function ReviewTab() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.insight.reviewQueue.useQuery();
  const reviewDone = trpc.insight.reviewDone.useMutation({ onSuccess: () => void utils.insight.reviewQueue.invalidate() });
  const [idx, setIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  if (isLoading) return <p className="text-[13.5px] text-[var(--ink-3)]">载入中…</p>;
  const due = data?.due ?? [];
  const cur = due[Math.min(idx, due.length - 1)];

  return (
    <div className="space-y-6">
      <PaperCard className="px-6 py-4 flex items-center gap-4 flex-wrap">
        <span className="font-bold text-[26px] text-[var(--vermilion)]" style={{ fontFamily: "var(--font-zh)" }}>{data?.dueCount ?? 0}</span>
        <span className="text-[13.5px] text-[var(--ink-2)]">道到期待复习</span>
        <span className="w-px h-5 bg-[var(--line)]" />
        <span className="text-[12.5px] text-[var(--ink-3)]">排期中 {data?.scheduledCount ?? 0} 道 · 节奏 {REVIEW_INTERVALS_DAYS.join("→")} 天</span>
        <span className="flex-1" />
        <span className="text-[12px] text-[var(--ink-3)]">错题本点「加入复习」即可排期</span>
      </PaperCard>

      {due.length === 0 ? (
        <PaperCard className="p-10 text-center">
          <p className="text-[14px] text-[var(--ink-3)]">今日无到期复习。节奏不乱，即是胜利。</p>
        </PaperCard>
      ) : cur && (
        <PaperCard frame className="p-6">
          <div className="flex items-center gap-2.5 text-[12.5px] text-[var(--ink-3)] flex-wrap">
            <b className="text-[var(--ink)]">{idx + 1} <span className="font-normal">/ {due.length}</span></b>
            <span>{cur.source === "exam" ? "真题" : "仿真"} · Q{cur.qNo}</span>
            <b className="px-1.5 py-0.5 bg-[var(--bamboo)]/15 text-[var(--bamboo)] text-[11.5px] rounded-[2px]">{QTYPE_ZH[cur.qType] ?? cur.qType}</b>
            {cur.errorType && <ErrorTypeBadge type={cur.errorType} />}
            <span className="flex-1" />
            <span>第 {cur.reviewStage + 1} 轮 · 已复习 {cur.reviewCount} 次</span>
          </div>
          <p className="mt-4 text-[15.5px] font-bold leading-relaxed" style={{ fontFamily: "var(--font-en), var(--font-zh)" }}>{cur.stem}</p>
          <div className="mt-4 space-y-2">
            {cur.options.map((opt, i) => {
              const letter = "ABCD"[i];
              const isCorrect = showAnswer && letter === cur.correctAnswer;
              const isMine = showAnswer && letter === cur.myAnswer && cur.myAnswer !== cur.correctAnswer;
              return (
                <div key={i} className={`px-3.5 py-2.5 rounded-[2px] border text-[13.5px] leading-relaxed ${
                  isCorrect ? "border-[var(--bamboo)] bg-[var(--bamboo)]/10 font-bold" : isMine ? "border-[var(--vermilion)]/50 bg-[var(--vermilion)]/5 line-through text-[var(--ink-3)]" : "border-[var(--line)]"
                }`}>
                  <b className="mr-2">{letter}.</b>{opt}
                </div>
              );
            })}
          </div>
          {!showAnswer ? (
            <button onClick={() => { setShowAnswer(true); playSound("page"); }} className="mt-5 px-6 py-2.5 text-[14px] font-bold bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow hover:opacity-90">
              想好了，揭榜
            </button>
          ) : (
            <div className="mt-5 border-t border-dashed border-[var(--line)] pt-4 flex items-center gap-3 flex-wrap">
              <span className="text-[13.5px]">
                正解 <b className="text-[var(--bamboo)] text-[16px]">{cur.correctAnswer}</b> · 你当时选 <b className="text-[var(--vermilion)]">{cur.myAnswer}</b>。这次记住了？
              </span>
              <button
                onClick={() => { reviewDone.mutate({ wrongId: cur.id, remembered: true }); playSound("seal"); setShowAnswer(false); setIdx((i) => Math.min(i, due.length - 2)); }}
                disabled={reviewDone.isPending}
                className="px-4 py-2 text-[13px] font-bold bg-[var(--bamboo)] text-[var(--paper)] rounded-[2px] print-shadow hover:opacity-90 disabled:opacity-40"
              >
                记住了 → {REVIEW_INTERVALS_DAYS[Math.min(cur.reviewStage + 1, REVIEW_INTERVALS_DAYS.length - 1)]} 天后再见
              </button>
              <button
                onClick={() => { reviewDone.mutate({ wrongId: cur.id, remembered: false }); setShowAnswer(false); setIdx((i) => Math.min(i, due.length - 2)); }}
                disabled={reviewDone.isPending}
                className="px-4 py-2 text-[13px] font-bold border border-[var(--vermilion)]/60 text-[var(--vermilion)] rounded-[2px] hover:bg-[var(--vermilion)]/5 disabled:opacity-40"
              >
                又忘了 → 明日重来
              </button>
            </div>
          )}
        </PaperCard>
      )}
    </div>
  );
}

export default function InsightPage() {
  const { user } = useUser();
  const [tab, setTab] = useState<Tab>("advice");
  const { data: queue } = trpc.insight.reviewQueue.useQuery(undefined, { enabled: !!user });

  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: "advice", label: "备考建议" },
    { key: "insights", label: "感悟笔记" },
    { key: "overview", label: "错因概览" },
    { key: "review", label: "复习打卡", badge: queue?.dueCount },
  ];

  return (
    <div>
      <InkReveal>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <BrushTitle as="h1" vermilion className="text-[34px]">顿悟室</BrushTitle>
            <p className="text-[14px] text-[var(--ink-3)] mt-2.5">
              错因六分法诊断 · AI 备考参谋 · 感悟沉淀 · 艾宾浩斯抗遗忘。
              <span className="meta-label ml-2">INSIGHT ROOM</span>
            </p>
          </div>
          <Seal size={72} seed="insight" text="恍然大悟" center="悟" />
        </div>
      </InkReveal>

      <div className="flex items-center gap-2 mt-6 flex-wrap">
        {TABS.map((t) => <TabBtn key={t.key} active={tab === t.key} onClick={() => setTab(t.key)} badge={t.badge}>{t.label}</TabBtn>)}
      </div>
      <InkDivider className="mt-3" />

      <div className="mt-6">
        {tab === "advice" && <AdviceTab />}
        {tab === "insights" && <InsightsTab />}
        {tab === "overview" && <OverviewTab />}
        {tab === "review" && <ReviewTab />}
      </div>
    </div>
  );
}
