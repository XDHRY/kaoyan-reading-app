import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { StepSeal } from "@/components/ink/Seal";
import { PaperCard, StatusDot } from "@/components/ink/decor";
import { buildAnalysisMarkdown, downloadMarkdown } from "@/lib/exportMarkdown";
import { useUser } from "@/hooks/useUser";
import { SOP_STEPS } from "@contracts/types";
import { usePipelineJob } from "@/hooks/usePipelineJob";
import { safeStorage } from "@/lib/safeStorage";
import { playSound } from "@/hooks/useSound";
import { PipelinePanel } from "@/components/pipeline/PipelinePanel";
import { ArticleReader } from "@/components/analysis/ArticleReader";
import { StructureBlock } from "@/components/analysis/StructureBlock";
import { QuestionAnalysisBlock } from "@/components/analysis/QuestionAnalysisBlock";
import { RetroCard } from "@/components/analysis/RetroCard";
import { CollapsibleAnalysis } from "@/components/analysis/CollapsibleAnalysis";
import {
  QTYPE_ZH,
  resultFromPayload,
  type ClauseRow,
  type PipelineResult,
} from "@/lib/analysisTypes";

const STAGE_STEP: Record<string, number> = {
  structure: 0, question: 2, locate: 3, solve: 4, crosscheck: 4,
};

interface AnalysisRow {
  id: number;
  passageId: number;
  payload: Record<string, unknown>;
  modelUsed: string;
  createdAt: Date;
}

export default function PracticePage() {
  const { id } = useParams<{ id: string }>();
  const passageId = Number(id);
  const { data, isLoading } = trpc.passage.detail.useQuery({ id: passageId });
  const utils = trpc.useUtils();
  const { user } = useUser();

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [historyModel, setHistoryModel] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saveError, setSaveError] = useState("");
  const pendingSaveRef = useRef<(() => Promise<void>) | null>(null);
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(() => safeStorage.get("ky_panel_collapsed") === "1");
  const [draftHint, setDraftHint] = useState("");
  const startTimeRef = useRef<number>(Date.now());
  const savedJobRef = useRef<number | null>(null);
  const draftKey = `ky_draft_exam_${passageId}`;

  const { job, start, retry, pause, resume, cancel, reset, starting, retrying, pausing, resuming, cancelling, now } = usePipelineJob("exam", passageId);

  const saveResult = trpc.agent.saveResult.useMutation();
  const { data: clauseRows } = trpc.method.clauses.useQuery(undefined, { staleTime: Infinity });
  const clauseMap = useMemo(
    () => new Map(((clauseRows ?? []) as ClauseRow[]).map((c) => [c.clauseId, c])),
    [clauseRows],
  );

  // 任务完成 → 提取产物 + 落做题记录（分析产物已由服务端归档，skipAnalysis）
  // 恢复的 done 任务（切页/刷新后找回）直接展示产物；仅恢复任务未带作答时不重复落记录
  useEffect(() => {
    if (job?.status !== "done" || savedJobRef.current === job.id) return;
    savedJobRef.current = job.id;
    const r = resultFromPayload(job.payload);
    setResult(r);
    const jobAnswers = (job.answers ?? {}) as Record<string, string>;
    const hasFreshAnswers = Object.keys(answers).length > 0;
    if (!hasFreshAnswers && Object.keys(jobAnswers).length > 0) {
      setAnswers(jobAnswers);
      return; // 恢复视图：作答与判分已在当初落库
    }
    if (!hasFreshAnswers) return;
    const solvedItems = r.solved.map((x) => ({ qNo: x.qNo, answer: x.answer }));
    const doSave = async () => {
      await saveResult.mutateAsync({
        kind: "exam",
        passageId,
        payload: job.payload,
        modelUsed: r.modelsUsed.join(" | "),
        answers,
        verdicts: r.verdicts,
        solvedItems,
        durationSec: Math.round((Date.now() - startTimeRef.current) / 1000),
        skipAnalysis: true,
      });
    };
    pendingSaveRef.current = doSave;
    void doSave()
      .then(() => {
        pendingSaveRef.current = null;
        setSaveError("");
        safeStorage.remove(draftKey); // 交卷成功，草稿清除
        playSound("seal"); // 落章：交卷存档完成
        utils.agent.stats.invalidate();
        utils.wrong.list.invalidate();
        utils.agent.history.invalidate();
        utils.agent.analysisList.invalidate();
      })
      .catch((e: unknown) => {
        // 错误不静默：明示失败原因 + 一键重试，绝不悄悄丢记录
        setSaveError(e instanceof Error ? e.message : "保存失败");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, job?.id]);

  // 自动草稿：每 15 秒把当前选择落 localStorage；刷新/误关后可恢复
  useEffect(() => {
    const d = safeStorage.getJSON<{ answers: Record<string, string>; ts: number }>(draftKey);
    if (d?.answers && Object.keys(d.answers).length > 0) {
      setAnswers((cur) => (Object.keys(cur).length > 0 ? cur : d.answers));
      const mins = Math.max(1, Math.round((Date.now() - d.ts) / 60000));
      setDraftHint(`已恢复 ${mins} 分钟前的答题进度（${Object.keys(d.answers).length} 题）`);
      setTimeout(() => setDraftHint(""), 6000);
    }
  }, [draftKey]);
  const doneForDraft = result !== null;
  useEffect(() => {
    if (doneForDraft) return;
    const t = setInterval(() => {
      setAnswers((cur) => {
        if (Object.keys(cur).length > 0) safeStorage.setJSON(draftKey, { answers: cur, ts: Date.now() });
        return cur;
      });
    }, 15_000);
    return () => clearInterval(t);
  }, [draftKey, doneForDraft]);

  // 解析历史
  const { data: historyRows } = trpc.agent.analysisList.useQuery(
    { kind: "exam", passageId },
    { enabled: historyOpen },
  );

  const allAnswered = (data?.questions ?? []).every((q) => answers[String(q.id)]);
  const running = job?.status === "running";
  const done = result !== null;
  const answered = Object.keys(answers).length > 0;

  const currentSopStep = useMemo(() => {
    if (done) return 5;
    if (running && job) return STAGE_STEP[job.stage] ?? 1;
    return allAnswered ? 5 : 1;
  }, [done, running, job, allAnswered]);

  /** 载入历史解析 */
  function loadHistory(row: AnalysisRow) {
    const p = row.payload as Record<string, unknown>;
    setResult(resultFromPayload({
      structure: p.structure,
      qAnalysis: p.questionAnalysis,
      locate: p.locateResult,
      solved: p.solved,
      review: p.review,
      crosscheck: p.crosscheck,
    }));
    setHistoryModel(row.modelUsed);
    setHistoryOpen(false);
    reset();
  }

  function again() {
    setResult(null);
    setAnswers({});
    setSaveError("");
    safeStorage.remove(draftKey);
    setHistoryModel("");
    savedJobRef.current = null;
    startTimeRef.current = Date.now();
    reset();
  }

  /** 导出 Markdown */
  function exportMd(copyOnly: boolean) {
    if (!data || !result) return;
    const md = buildAnalysisMarkdown({
      title: `${data.passage.year} 年英语一 Text ${data.passage.textNo}`,
      paragraphs: data.passage.paragraphs,
      structure: result.structure,
      questionAnalysis: result.qAnalysis,
      locateResult: result.locateResult,
      solved: result.solved,
      review: result.review,
      modelUsed: result.modelsUsed.join(" | ") || historyModel,
    });
    if (copyOnly) {
      navigator.clipboard.writeText(md);
      setNote("已复制到剪贴板");
      setTimeout(() => setNote(""), 2500);
    } else {
      downloadMarkdown(`${data.passage.year}英语一Text${data.passage.textNo}-解析.md`, md);
    }
  }

  if (isLoading) return <p className="text-[var(--ink-3)]">载入真题中……</p>;
  if (!data) return <p>真题不存在。<Link to="/library" className="text-[var(--vermilion)]">返回真题库</Link></p>;

  const { passage, questions } = data;
  const verdicts = result?.verdicts ?? {};

  return (
    <div>
      {/* 页头 */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <Link to="/library" className="text-[13px] text-[var(--ink-3)] hover:text-[var(--ink)]">← 真题库</Link>
          <h1 className="text-[28px] font-black mt-1">
            {passage.year} 年 · 英语一 · Text {passage.textNo}
          </h1>
        </div>
        <div className="flex items-center gap-3 text-[13px] text-[var(--ink-3)]">
          <StatusDot ok={passage.verifyStatus === "verified"} warn={passage.verifyStatus !== "verified"} />
          {passage.verifyStatus === "verified" ? "双源校验一致" : "单源语料"}
          {user && (
            <Link
              to={`/interactive/exam/${passageId}`}
              className="px-3 py-1.5 bg-[var(--bamboo)] text-[var(--paper)] rounded-[2px] text-[13px] font-bold print-shadow hover:opacity-90"
            >
              跟我练 · 逐题走步
            </Link>
          )}
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className="px-3 py-1.5 border border-[var(--line)] rounded-[2px] text-[13px] hover:border-[var(--ink-2)] text-[var(--ink-2)]"
          >
            解析历史
          </button>
        </div>
      </div>

      {/* 解析历史抽屉 */}
      {historyOpen && (
        <PaperCard className="mb-6 p-5">
          <div className="meta-label mb-3">本篇解析档案 · ANALYSIS ARCHIVE</div>
          {((historyRows ?? []) as AnalysisRow[]).length === 0 && (
            <p className="text-[14px] text-[var(--ink-3)]">还没有存档——交卷解析一次即自动入档。</p>
          )}
          <div className="space-y-2">
            {((historyRows ?? []) as AnalysisRow[]).map((row) => (
              <div key={row.id} className="flex items-center gap-3 flex-wrap border border-[var(--line)] px-3 py-2 rounded-[2px]">
                <span className="text-[13px] font-mono">{new Date(row.createdAt).toLocaleString("zh-CN")}</span>
                <span className="text-[12px] text-[var(--ink-3)] flex-1 truncate">{row.modelUsed}</span>
                <button
                  onClick={() => loadHistory(row)}
                  className="text-[13px] text-[var(--vermilion)] underline underline-offset-4"
                >
                  载入查看
                </button>
              </div>
            ))}
          </div>
        </PaperCard>
      )}

      <div className="grid lg:grid-cols-[220px_1fr] gap-6">
        {/* SOP 步骤侧栏 */}
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <div className="meta-label mb-4">SOP · 六步引导</div>
            <div className="space-y-1">
              {SOP_STEPS.map((s, i) => {
                const isCurrent = i === currentSopStep;
                return (
                  <div key={s.id} className="flex items-center gap-3">
                    <div className="flex flex-col items-center">
                      <StepSeal num={s.num} size={40} seed={`pr-${s.id}`} active={isCurrent} done={i < currentSopStep || done} />
                      {i < SOP_STEPS.length - 1 && (
                        <svg width="2" height="18" aria-hidden="true">
                          <line x1="1" y1="0" x2="1" y2="18" stroke="var(--line)" strokeWidth="1.5" />
                        </svg>
                      )}
                    </div>
                    <div className={`text-[14px] ${isCurrent ? "font-bold text-[var(--vermilion)]" : "text-[var(--ink-2)]"}`}>
                      {s.name}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* 当前步骤知识卡提示 */}
            <PaperCard className="mt-5 p-4">
              <div className="meta-label mb-2">TIP</div>
              <p className="text-[13px] leading-relaxed text-[var(--ink-2)]">
                {done
                  ? "对照右侧解析，复盘自己每一步是否用对了方法。"
                  : allAnswered
                    ? "已答完 5 题。点击「交卷解析」，AI 教练将按六步带你复盘。"
                    : "先标段，再一次性读完 5 道题（判题型/翻题干/定定位词），然后按题文同序逐题作答。"}
              </p>
            </PaperCard>
            {result && result.modelsUsed.length > 0 && (
              <div className="mt-4 text-[11px] text-[var(--ink-3)] leading-relaxed">
                {result.modelsUsed.map((m) => (
                  <div key={m}>{m}</div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* 主区：文章 + 题目 */}
        <div className="grid xl:grid-cols-[3fr_2fr] gap-8 min-w-0">
          {/* 文章 */}
          <ArticleReader
            paragraphs={passage.paragraphs}
            kind="exam"
            refId={passageId}
            vocabPassageId={passageId}
            headerLabel="PASSAGE · 全文"
          >
            {done && result?.structure && (
              <StructureBlock kind="exam" refId={passageId} structure={result.structure} />
            )}
          </ArticleReader>

          {/* 题目区 */}
          <div className="space-y-5 min-w-0">
            {questions.map((q) => {
              const qid = String(q.id);
              const solvedItem = result?.solved.find((s) => s.qNo === q.qNo);
              const verdict = verdicts[qid];
              const locked = running || done || job?.status === "error";
              return (
                <PaperCard key={q.id} className="p-5" frame={done && verdict !== undefined}>
                  <div className="flex items-baseline justify-between gap-2 mb-3">
                    <div className="text-[16px] font-bold leading-relaxed" style={{ fontFamily: "var(--font-en)" }}>
                      {q.qNo}. {q.stem}
                    </div>
                    <span className="meta-label shrink-0">{QTYPE_ZH[q.qType] ?? ""}</span>
                  </div>
                  <div className="space-y-2">
                    {q.options.map((opt, oi) => {
                      const label = "ABCD"[oi];
                      const chosen = answers[qid] === label;
                      // 判分事实源：官方答案优先，AI 答案仅作降级参考
                      const officialAnswer = q.answer ?? solvedItem?.answer;
                      const isCorrect = done && officialAnswer === label;
                      const isWrongPick = done && chosen && officialAnswer !== undefined && officialAnswer !== label;
                      return (
                        <button
                          key={label}
                          disabled={locked}
                          onClick={() => setAnswers((a) => ({ ...a, [qid]: label }))}
                          className={`w-full text-left px-3 py-2 border rounded-[2px] text-[14.5px] leading-relaxed transition-colors ${
                            isCorrect
                              ? "border-[var(--bamboo)] bg-[var(--bamboo)]/10 font-bold"
                              : isWrongPick
                                ? "border-[var(--vermilion)] bg-[var(--vermilion)]/10"
                                : chosen
                                  ? "border-[var(--ink)] bg-[var(--paper-deep)]"
                                  : "border-[var(--line)] hover:border-[var(--ink-3)]"
                          }`}
                          style={{ fontFamily: "var(--font-en)" }}
                        >
                          <b className="mr-2">[{label}]</b>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                  {done && verdict !== undefined && (
                    <div className={`mt-3 text-[14px] font-bold ${verdict ? "text-[var(--bamboo)]" : "text-[var(--vermilion)]"}`}>
                      {verdict ? "✓ 答对了" : `✗ 答错了，正确答案 ${q.answer ?? solvedItem?.answer ?? "?"}`}
                      {!verdict && q.answer && solvedItem && solvedItem.answer !== q.answer && (
                        <span className="ml-2 text-[12px] font-normal text-[var(--ink-3)]">（AI 参考 ${solvedItem.answer}，以官方答案为准）</span>
                      )}
                    </div>
                  )}

                  {/* 解析（可折叠：默认行为取决于设置页的折叠偏好） */}
                  {done && solvedItem && result && (
                    <CollapsibleAnalysis label={`第 ${q.qNo} 题 · AI 教练解析`}>
                      <QuestionAnalysisBlock
                        qNo={q.qNo}
                        qAnalysis={result.qAnalysis}
                        locateResult={result.locateResult}
                        solvedItem={solvedItem}
                        crosscheck={result.crosscheck}
                        clauseMap={clauseMap}
                        officialAnswer={q.answer ?? undefined}
                        myAnswer={answers[qid]}
                        kind="exam"
                        refId={passageId}
                      />
                    </CollapsibleAnalysis>
                  )}
                </PaperCard>
              );
            })}

            {/* 交卷 / 流水线面板（可折叠：展开=完整面板，折叠=细条不遮挡解析） */}
            <PaperCard frame className={`text-center sticky safe-bottom-bar bottom-4 ${panelCollapsed ? "px-4 py-2" : "p-6"}`}>
              <button
                onClick={() => {
                  const next = !panelCollapsed;
                  setPanelCollapsed(next);
                  safeStorage.set("ky_panel_collapsed", next ? "1" : "0");
                }}
                aria-expanded={!panelCollapsed}
                className="absolute top-1.5 right-2.5 text-[12px] text-[var(--ink-3)] hover:text-[var(--ink)] px-2 py-0.5"
                title={panelCollapsed ? "展开面板" : "折叠面板（不再遮挡解析）"}
              >
                {panelCollapsed ? "▲ 展开" : "▼ 折叠"}
              </button>
              {draftHint && <p className="text-[13px] text-[var(--bamboo)] mb-2">{draftHint}</p>}
              {saveError && (
                <div className="mb-3 px-3 py-2 border border-[var(--vermilion)] bg-[var(--vermilion)]/10 text-[13px] text-[var(--vermilion)] rounded-[2px] flex items-center justify-center gap-3 flex-wrap">
                  <span>交卷记录保存失败：{saveError.slice(0, 80)}（答案解析没丢，点重试补存）</span>
                  <button
                    onClick={() => {
                      const fn = pendingSaveRef.current;
                      if (!fn) return;
                      setSaveError("");
                      void fn().then(() => {
                        pendingSaveRef.current = null;
                        utils.agent.stats.invalidate();
                        utils.wrong.list.invalidate();
                        utils.agent.history.invalidate();
                      }).catch((e: unknown) => setSaveError(e instanceof Error ? e.message : "保存失败"));
                    }}
                    className="px-3 py-1 bg-[var(--vermilion)] text-white rounded-[2px] text-[12px] font-bold"
                  >
                    重试保存
                  </button>
                </div>
              )}
              {note && <p className="text-[13px] text-[var(--bamboo)] mb-2">{note}</p>}
              {panelCollapsed ? (
                <div className="flex items-center justify-center gap-3 text-[13.5px]">
                  {done ? (
                    <span>
                      本次得分 <b className="text-[var(--vermilion)]">{Object.values(verdicts).filter(Boolean).length} / {questions.length}</b>
                      <span className="text-[var(--ink-3)] ml-2">面板已折叠，点右上角展开</span>
                    </span>
                  ) : running ? (
                    <span className="text-[var(--ink-2)]">解析进行中……（面板已折叠）</span>
                  ) : (
                    <span className="text-[var(--ink-3)]">答题面板已折叠</span>
                  )}
                </div>
              ) : (
              <>
              <PipelinePanel
                job={job}
                now={now}
                starting={starting}
                retrying={retrying}
                pausing={pausing}
                resuming={resuming}
                cancelling={cancelling}
                canSubmit={allAnswered && !!user}
                remaining={questions.length - Object.keys(answers).length}
                onStart={() => { startTimeRef.current = Date.now(); void start(answers); }}
                onRetry={() => void retry()}
                onPause={() => void pause()}
                onResume={() => void resume()}
                onCancel={() => { if (confirm("停止本次解析？已完成的阶段会保留，之后可断点重试。")) void cancel(); }}
                onClose={reset}
                doneSlot={
                  done ? (
                    <div>
                      <p className="font-bold text-[17px] mb-1">
                        {Object.keys(verdicts).length > 0 ? (
                          <>
                            本次得分：
                            <span className="text-[var(--vermilion)] text-[24px] mx-1">
                              {Object.values(verdicts).filter(Boolean).length} / {questions.length}
                            </span>
                          </>
                        ) : (
                          <span className="text-[15px] text-[var(--ink-2)]">历史解析回看{historyModel ? ` · ${historyModel.split(" | ")[0]}` : ""}</span>
                        )}
                      </p>
                      {result?.review && (
                        <p className="text-[13.5px] text-[var(--ink-2)] mb-2">
                          校验官总评：{String((result.review as { comment?: string }).comment ?? "通过")}
                        </p>
                      )}
                      {result && result.trace.length > 0 && (
                        <div className="text-[12px] text-[var(--ink-3)] mb-3 space-y-0.5">
                          {result.trace.map((t, i) => (
                            <div key={i}>{t.ok ? "✓" : "↺"} {t.note}</div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-center gap-3 flex-wrap">
                        <button
                          onClick={again}
                          className="px-5 py-2 border border-[var(--ink)] rounded-[2px] text-[15px] hover:bg-[var(--paper-deep)]"
                        >
                          再做一遍
                        </button>
                        <button
                          onClick={() => exportMd(false)}
                          className="px-4 py-2 border border-[var(--line)] rounded-[2px] text-[14px] hover:border-[var(--ink-2)]"
                        >
                          导出 .md
                        </button>
                        <button
                          onClick={() => exportMd(true)}
                          className="px-4 py-2 border border-[var(--line)] rounded-[2px] text-[14px] hover:border-[var(--ink-2)]"
                        >
                          复制全文
                        </button>
                        <Link to="/library" className="text-[var(--vermilion)] font-bold text-[15px]">回真题库 →</Link>
                      </div>
                    </div>
                  ) : undefined
                }
              />
              {!user && !running && !done && (
                <p className="text-[12.5px] text-[var(--vermilion)] mt-2">登录后才能交卷解析（解析任务归入你的账号）</p>
              )}
              {answered && !allAnswered && !running && !done && (
                <p className="text-[12px] text-[var(--ink-3)] mt-1">已答 {Object.keys(answers).length} / {questions.length} 题</p>
              )}
              </>
              )}
            </PaperCard>

            {/* 复盘定制卷：判分后基于错因+AI诊断+自评生成一整套新卷 */}
            {done && Object.keys(verdicts).length > 0 && user && (
              <RetroCard kind="exam" refId={passageId} verdicts={verdicts} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
