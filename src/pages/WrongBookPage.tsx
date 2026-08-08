import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useUser } from "@/hooks/useUser";
import { BrushTitle, InkReveal, PaperCard } from "@/components/ink/decor";
import { Seal } from "@/components/ink/Seal";
import { playSound } from "@/hooks/useSound";

const TYPE_ZH: Record<string, string> = {
  example: "例证题", attitude: "态度题", vocab: "语义题", cause: "因果题",
  viewpoint: "观点题", detail: "细节题", infer: "推断题", main: "主旨题", unknown: "未分类",
};

interface WrongRow {
  id: number;
  source: "exam" | "generated";
  refId: number;
  qNo: number;
  qType: string;
  stem: string;
  options: string[];
  correctAnswer: string;
  myAnswer: string;
  mastered: boolean;
  attempts: number;
  year: number | null;
  textNo: number | null;
  errorType: string;
  hasAnalysis: boolean;
  insightStatus: string;
  nextReviewAt: string | Date | null;
  createdAt: string | Date | null;
}

const ERROR_ZH: Record<string, string> = {
  locate: "定位偏差", comprehend: "理解偏差", overinfer: "过度推断",
  detail: "细节疏漏", mistype: "题型误判", vocab: "词汇障碍",
};

/** 单题诊断书（错因分析师产出） */
function DiagnosisPanel({ wrongId }: { wrongId: number }) {
  const { data: a, isLoading } = trpc.insight.getAnalysis.useQuery({ wrongId });
  if (isLoading) return <p className="mt-3 text-[13px] text-[var(--ink-3)]">载入诊断书…</p>;
  if (!a) return null;
  return (
    <div className="mt-3 border-t border-dashed border-[var(--line)] pt-3 space-y-2.5">
      <div className="meta-label">诊断书 · DIAGNOSIS</div>
      {a.rootCause && (
        <p className="text-[13.5px] leading-relaxed">
          <b className="text-[var(--vermilion)]">错因【{ERROR_ZH[a.errorType] ?? a.errorType}】</b>
          <span className="text-[var(--ink-2)]"> {a.rootCause}</span>
        </p>
      )}
      {a.distractorPull && (
        <p className="text-[13px] leading-relaxed"><b className="text-[var(--ink)]">干扰项拉力：</b><span className="text-[var(--ink-2)]">{a.distractorPull}</span></p>
      )}
      {a.knowledgeGap && (
        <p className="text-[13px] leading-relaxed"><b className="text-[var(--ink)]">能力缺口：</b><span className="text-[var(--ink-2)]">{a.knowledgeGap}</span></p>
      )}
      {a.suggestion && (
        <p className="text-[13px] leading-relaxed border-l-2 border-[var(--bamboo)] pl-2.5">
          <b className="text-[var(--bamboo)]">纠正建议：</b><span className="text-[var(--ink-2)]">{a.suggestion}</span>
        </p>
      )}
      {(a.methodRefs ?? []).length > 0 && (
        <p className="text-[12.5px] text-[var(--ink-3)]">
          方法依据：{(a.methodRefs ?? []).map((m) => m.title || m.clauseId).join("、")}
        </p>
      )}
      <p className="text-[11px] text-[var(--ink-3)]">模型 {a.modelUsed} · {new Date(a.createdAt).toLocaleDateString("zh-CN")}</p>
    </div>
  );
}

export default function WrongBookPage() {
  const { user } = useUser();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<"open" | "mastered">("open");
  const [typeFilter, setTypeFilter] = useState("");
  const [errorFilter, setErrorFilter] = useState("");
  const [todayOnly, setTodayOnly] = useState(false);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [result, setResult] = useState<Record<number, { ok: boolean; correctAnswer: string }>>({});
  const [analysisOpen, setAnalysisOpen] = useState<Record<number, boolean>>({});
  const [insightFor, setInsightFor] = useState<number | null>(null);
  const [insightText, setInsightText] = useState("");
  const retry = trpc.wrong.retry.useMutation();
  const unmaster = trpc.wrong.unmaster.useMutation();
  const remove = trpc.wrong.remove.useMutation();
  const analyze = trpc.insight.analyze.useMutation({
    onSuccess: (_d, v) => {
      setAnalysisOpen((m) => ({ ...m, [v.wrongId]: true }));
      void utils.insight.getAnalysis.invalidate({ wrongId: v.wrongId });
      void refetch();
    },
  });
  const reviewStart = trpc.insight.reviewStart.useMutation({ onSuccess: () => void refetch() });
  const insightSave = trpc.insight.insightSave.useMutation({
    onSuccess: () => { setInsightFor(null); setInsightText(""); void utils.insight.insightList.invalidate(); void refetch(); },
  });

  const { data, refetch } = trpc.wrong.list.useQuery(
    { mastered: tab === "mastered" },
    { enabled: !!user },
  );
  // 全量（不分掌握状态）仅用于顶部掌握度统计
  const { data: allForStat } = trpc.wrong.list.useQuery({}, { enabled: !!user });

  const all = (data ?? []) as WrongRow[];
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayCount = all.filter((r) => r.createdAt && new Date(r.createdAt) >= todayStart).length;
  const rows = all.filter((r) =>
    (!typeFilter || r.qType === typeFilter) &&
    (!errorFilter || r.errorType === errorFilter) &&
    (!todayOnly || (r.createdAt && new Date(r.createdAt) >= todayStart)),
  );
  const types = Array.from(new Set(all.map((r) => r.qType)));
  const errorTypes = Array.from(new Set(all.map((r) => r.errorType).filter(Boolean)));
  const statAll = (allForStat ?? []) as WrongRow[];
  const masteredCount = statAll.filter((r) => r.mastered).length;
  const masteryPct = statAll.length ? Math.round((masteredCount / statAll.length) * 100) : 0;

  const doRetry = async (id: number) => {
    const ans = picked[id];
    if (!ans) return;
    const r = await retry.mutateAsync({ id, answer: ans as "A" | "B" | "C" | "D" });
    setResult((m) => ({ ...m, [id]: r }));
    if (r.ok) await refetch();
  };

  return (
    <div>
      <InkReveal>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <BrushTitle as="h1" className="text-[34px]">错题本</BrushTitle>
            <p className="text-[14px] text-[var(--ink-3)] mt-2">
              练习中做错的题自动入册。重练做对即盖「已掌握」印——错题不过夜。
            </p>
            {statAll.length > 0 && (
              <div className="mt-3 flex items-center gap-2">
                <div className="w-[140px] h-[6px] border border-[var(--line)] rounded-[2px] overflow-hidden">
                  <div className="h-full bg-[var(--bamboo)] transition-all" style={{ width: `${masteryPct}%` }} />
                </div>
                <span className="text-[12.5px] text-[var(--ink-3)]">
                  已掌握 {masteredCount}/{statAll.length}（{masteryPct}%）
                </span>
              </div>
            )}
          </div>
          <Seal size={72} seed="wrongbook" text="知错能改" center="改" />
        </div>
      </InkReveal>

      {/* 筛选 */}
      <div className="flex items-center gap-2 mt-6 flex-wrap">
        <button
          onClick={() => setTab("open")}
          className={`px-4 py-1.5 text-[14px] border rounded-[2px] ${tab === "open" ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)]"}`}
        >待攻克</button>
        <button
          onClick={() => setTab("mastered")}
          className={`px-4 py-1.5 text-[14px] border rounded-[2px] ${tab === "mastered" ? "border-[var(--bamboo)] text-[var(--bamboo)] font-bold" : "border-[var(--line)]"}`}
        >已掌握</button>
        <span className="w-px h-5 bg-[var(--line)] mx-1" />
        {todayCount > 0 && (
          <button
            onClick={() => setTodayOnly((v) => !v)}
            className={`px-3 py-1 text-[13px] border rounded-[2px] ${todayOnly ? "border-[var(--ink)] font-bold bg-[var(--paper-deep)]" : "border-[var(--line)]"}`}
          >只看今日新增（{todayCount}）</button>
        )}
        <button
          onClick={() => setTypeFilter("")}
          className={`px-3 py-1 text-[13px] border rounded-[2px] ${!typeFilter ? "border-[var(--ink)] font-bold" : "border-[var(--line)]"}`}
        >全部题型</button>
        {types.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`px-3 py-1 text-[13px] border rounded-[2px] ${typeFilter === t ? "border-[var(--ink)] font-bold" : "border-[var(--line)]"}`}
          >{TYPE_ZH[t] ?? t}</button>
        ))}
        {errorTypes.length > 0 && (
          <>
            <span className="w-px h-5 bg-[var(--line)] mx-1" />
            <button
              onClick={() => setErrorFilter("")}
              className={`px-3 py-1 text-[13px] border rounded-[2px] ${!errorFilter ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)]"}`}
            >全部错因</button>
            {errorTypes.map((t) => (
              <button
                key={t}
                onClick={() => setErrorFilter(t)}
                className={`px-3 py-1 text-[13px] border rounded-[2px] ${errorFilter === t ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)]"}`}
              >{ERROR_ZH[t] ?? t}</button>
            ))}
          </>
        )}
      </div>

      {/* 列表 */}
      <div className="mt-6 space-y-4 ink-stagger">
        {rows.map((w) => {
          const r = result[w.id];
          const done = w.mastered || r?.ok;
          return (
            <PaperCard key={w.id} className={done ? "opacity-80" : ""}>
              <div className="flex items-center gap-2 flex-wrap text-[13px]">
                <span className="meta-label border border-[var(--line)] px-1.5 py-0.5">
                  {w.source === "exam" ? `${w.year}年 · Text ${w.textNo}` : "AI 模拟题"}
                </span>
                <span className="meta-label border border-[var(--line)] px-1.5 py-0.5">第 {w.qNo} 题</span>
                <span className="meta-label text-[var(--bamboo)]">{TYPE_ZH[w.qType] ?? w.qType}</span>
                {w.errorType && (
                  <span className="text-[11.5px] font-bold text-[var(--vermilion)] border border-[var(--vermilion)]/50 px-1.5 py-0.5 rounded-[2px]">
                    {ERROR_ZH[w.errorType] ?? w.errorType}
                  </span>
                )}
                {w.insightStatus === "understood" && <span className="meta-label text-[var(--bamboo)]">✎ 感悟已吃透</span>}
                {w.insightStatus === "attention" && <span className="meta-label" style={{ color: "#b98a2f" }}>✎ 感悟待消化</span>}
                {w.nextReviewAt && <span className="meta-label text-[var(--ink-3)]">⏰ 复习排期中</span>}
                {w.attempts > 0 && <span className="meta-label text-[var(--ink-3)]">已重练 {w.attempts} 次</span>}
                {done && <span className="meta-label text-[var(--paper)] bg-[var(--bamboo)] px-1.5 py-0.5">已掌握</span>}
              </div>
              <p className="reading-en mt-3 !text-[17px]">{w.stem}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                {w.options.map((o, i) => {
                  const label = "ABCD"[i];
                  const isPicked = picked[w.id] === label;
                  const showRight = r && label === r.correctAnswer;
                  const showWrong = r && isPicked && !r.ok;
                  return (
                    <button
                      key={label}
                      disabled={!!r || w.mastered}
                      onClick={() => setPicked((m) => ({ ...m, [w.id]: label }))}
                      className={`text-left px-3 py-2 border rounded-[2px] text-[14px] transition-colors ${
                        showRight ? "border-[var(--bamboo)] bg-[var(--bamboo)]/10 font-bold"
                        : showWrong ? "border-[var(--vermilion)] bg-[var(--vermilion)]/10"
                        : isPicked ? "border-[var(--ink)] bg-[var(--paper-deep)]"
                        : "border-[var(--line)] hover:border-[var(--ink-2)]"
                      }`}
                    >
                      <span className="font-bold mr-1.5">{label}.</span>{o}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                {!w.mastered && !r && (
                  <button
                    onClick={() => doRetry(w.id)}
                    disabled={!picked[w.id] || retry.isPending}
                    className="px-4 py-1.5 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] text-[14px] disabled:opacity-40"
                  >提交重练</button>
                )}
                {r && (
                  <span className={`text-[14px] font-bold ${r.ok ? "text-[var(--bamboo)]" : "text-[var(--vermilion)]"}`}>
                    {r.ok ? "✓ 做对了，已盖「已掌握」印" : `✗ 还是不对，正确答案是 ${r.correctAnswer}，再想想`}
                  </span>
                )}
                <span className="text-[13px] text-[var(--ink-3)]">
                  上次错选 {w.myAnswer} · 正确答案 {r || w.mastered ? w.correctAnswer : "？（先自己作答）"}
                </span>
                <span className="flex-1" />
                <button
                  onClick={() => {
                    if (w.hasAnalysis) {
                      setAnalysisOpen((m) => ({ ...m, [w.id]: !m[w.id] }));
                    } else {
                      analyze.mutate({ wrongId: w.id });
                    }
                  }}
                  disabled={analyze.isPending && analyze.variables?.wrongId === w.id}
                  className="text-[13px] font-bold underline underline-offset-4 text-[var(--vermilion)] disabled:opacity-40"
                >
                  {analyze.isPending && analyze.variables?.wrongId === w.id
                    ? "诊断中…"
                    : w.hasAnalysis
                      ? analysisOpen[w.id] ? "收起诊断" : "看诊断书"
                      : "⚑ 深度诊断"}
                </button>
                <button
                  onClick={() => { setInsightFor(insightFor === w.id ? null : w.id); setInsightText(""); }}
                  className="text-[13px] underline underline-offset-4 text-[var(--ink-2)]"
                >写感悟</button>
                {!w.nextReviewAt && !w.mastered && (
                  <button
                    onClick={() => { reviewStart.mutate({ wrongId: w.id }); playSound("page"); }}
                    disabled={reviewStart.isPending}
                    className="text-[13px] underline underline-offset-4 text-[var(--ink-2)] disabled:opacity-40"
                  >加入复习</button>
                )}
                {w.source === "exam" && (
                  <Link to={`/practice/${w.refId}`} className="text-[13px] underline underline-offset-4 text-[var(--ink-3)]">
                    回到原篇
                  </Link>
                )}
                {w.mastered && (
                  <button onClick={async () => { await unmaster.mutateAsync({ id: w.id }); await refetch(); }}
                    className="text-[13px] underline underline-offset-4 text-[var(--ink-3)]">撤销掌握</button>
                )}
                <button
                  onClick={async () => { if (confirm("移出错题本？")) { await remove.mutateAsync({ id: w.id }); await refetch(); } }}
                  className="text-[13px] underline underline-offset-4 text-[var(--vermilion)]">移出</button>
              </div>
              {analysisOpen[w.id] && w.hasAnalysis && <DiagnosisPanel wrongId={w.id} />}
              {insightFor === w.id && (
                <div className="mt-3 border-t border-dashed border-[var(--line)] pt-3">
                  <textarea
                    value={insightText}
                    onChange={(e) => setInsightText(e.target.value)}
                    rows={2}
                    placeholder="这道题的教训，用你自己的话记下来……"
                    className="w-full border border-[var(--line)] rounded-[2px] px-3 py-2 text-[13.5px] bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)]"
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => insightSave.mutate({ wrongId: w.id, errorType: w.errorType || "", content: insightText.trim(), status: "attention" })}
                      disabled={insightSave.isPending || !insightText.trim()}
                      className="px-4 py-1.5 text-[13px] font-bold bg-[var(--ink)] text-[var(--paper)] rounded-[2px] disabled:opacity-40"
                    >存为「待消化」</button>
                    <button
                      onClick={() => insightSave.mutate({ wrongId: w.id, errorType: w.errorType || "", content: insightText.trim(), status: "understood" })}
                      disabled={insightSave.isPending || !insightText.trim()}
                      className="px-4 py-1.5 text-[13px] font-bold border border-[var(--bamboo)] text-[var(--bamboo)] rounded-[2px] disabled:opacity-40"
                    >已吃透</button>
                    <button onClick={() => setInsightFor(null)} className="text-[13px] text-[var(--ink-3)]">取消</button>
                  </div>
                </div>
              )}
            </PaperCard>
          );
        })}
        {rows.length === 0 && (
          <div className="text-center py-16 text-[var(--ink-3)]">
            <Seal size={80} seed="wrong-empty" text="无错一身轻" center="善" />
            <p className="mt-4">{tab === "open" ? "没有待攻克的错题——去做一篇真题试试身手" : "还没有掌握的错题"}</p>
            {tab === "open" && (
              <Link to="/library" className="inline-block mt-4 px-5 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow">
                去真题库
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
