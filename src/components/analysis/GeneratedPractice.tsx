import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { PaperCard } from "@/components/ink/decor";
import { safeStorage } from "@/lib/safeStorage";
import { playSound } from "@/hooks/useSound";
import { useUser } from "@/hooks/useUser";
import { usePipelineJob } from "@/hooks/usePipelineJob";
import { PipelinePanel } from "@/components/pipeline/PipelinePanel";
import { ArticleReader } from "./ArticleReader";
import { StructureBlock } from "./StructureBlock";
import { QuestionAnalysisBlock } from "./QuestionAnalysisBlock";
import { RetroCard } from "./RetroCard";
import { CollapsibleAnalysis } from "./CollapsibleAnalysis";
import {
  QTYPE_ZH,
  resultFromPayload,
  type ClauseRow,
  type PipelineResult,
} from "@/lib/analysisTypes";

export type GeneratedPayload = {
  title?: string;
  paragraphs?: string[];
  questions?: {
    qNo: number;
    stem: string;
    qType?: string;
    options: string[];
    answer: string;
    design?: string;
  }[];
  glossary?: { en: string; zh: string }[];
};

interface Props {
  setId: number;
  payload: GeneratedPayload;
}

/**
 * AI 生成题练习视图：与真题完全同等待遇——
 * 点词查词 / 长难句拆解 / 结构图 / 五段式 AI 流水线解析 / 错题入册。
 */
export function GeneratedPractice({ setId, payload }: Props) {
  const utils = trpc.useUtils();
  const { user } = useUser();
  const draftKey = `ky_draft_gen_${setId}`;
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const d = safeStorage.getJSON<{ answers: Record<string, string>; at: number }>(draftKey);
    return d?.answers ?? {};
  });
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [saveError, setSaveError] = useState("");
  const [draftHint, setDraftHint] = useState(() => {
    const d = safeStorage.getJSON<{ answers: Record<string, string>; at: number }>(draftKey);
    return d && Object.keys(d.answers).length > 0 ? `已恢复 ${Math.max(1, Math.round((Date.now() - d.at) / 60000))} 分钟前的答题进度` : "";
  });
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(() => safeStorage.get("ky_panel_collapsed") === "1");
  const startTimeRef = useRef<number>(Date.now());
  const savedJobRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<(() => Promise<unknown>) | null>(null);

  // 自动草稿：15 秒一拍，答过的题实时落本地（防刷新丢答案）
  useEffect(() => {
    const t = setInterval(() => {
      if (Object.keys(answers).length > 0) {
        safeStorage.setJSON(draftKey, { answers, at: Date.now() });
      }
    }, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers]);

  const { job, start, retry, pause, resume, cancel, reset, starting, retrying, pausing, resuming, cancelling, now } = usePipelineJob("generated", setId);
  const saveResult = trpc.agent.saveResult.useMutation();
  const { data: clauseRows } = trpc.method.clauses.useQuery(undefined, { staleTime: Infinity });
  const clauseMap = useMemo(
    () => new Map(((clauseRows ?? []) as ClauseRow[]).map((c) => [c.clauseId, c])),
    [clauseRows],
  );

  const questions = useMemo(() => payload.questions ?? [], [payload]);
  const keyOf = (qNo: number) => `g${qNo}`;
  const allAnswered = questions.every((q) => answers[keyOf(q.qNo)]);
  const running = job?.status === "running";
  const done = result !== null;
  const verdicts = result?.verdicts ?? {};

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
    const doSave = () =>
      saveResult.mutateAsync({
        kind: "generated",
        passageId: setId,
        payload: job.payload,
        modelUsed: r.modelsUsed.join(" | "),
        answers,
        verdicts: r.verdicts,
        solvedItems: r.solved.map((x) => ({ qNo: x.qNo, answer: x.answer })),
        durationSec: Math.round((Date.now() - startTimeRef.current) / 1000),
        skipAnalysis: true,
      });
    pendingSaveRef.current = doSave;
    void doSave()
      .then(() => {
        pendingSaveRef.current = null;
        setSaveError("");
        safeStorage.remove(draftKey);
        playSound("seal"); // 落章：仿真卷存档完成
        utils.agent.stats.invalidate();
        utils.wrong.list.invalidate();
        utils.agent.history.invalidate();
      })
      .catch((e: unknown) => setSaveError(e instanceof Error ? e.message : "保存失败"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, job?.id]);

  function again() {
    setResult(null);
    setAnswers({});
    setSaveError("");
    setDraftHint("");
    safeStorage.remove(draftKey);
    savedJobRef.current = null;
    startTimeRef.current = Date.now();
    reset();
  }

  return (
    <div className="grid xl:grid-cols-[3fr_2fr] gap-8 min-w-0">
      {/* 文章：与真题同一阅读器 */}
      <ArticleReader
        paragraphs={payload.paragraphs ?? []}
        kind="generated"
        refId={setId}
        headerLabel={payload.title ?? "生成阅读"}
      >
        {done && result?.structure && (
          <StructureBlock kind="generated" refId={setId} structure={result.structure} />
        )}
        {(payload.glossary ?? []).length > 0 && (
          <div className="mt-8 border-t border-[var(--line)] pt-4">
            <div className="meta-label mb-2">GLOSSARY · 词汇英汉对照</div>
            <div className="flex flex-wrap gap-2">
              {(payload.glossary ?? []).map((g, i) => (
                <span key={i} className="px-2.5 py-1 border border-[var(--line)] rounded-[2px] text-[13px]">
                  <b style={{ fontFamily: "var(--font-en)" }}>{g.en}</b>
                  <span className="text-[var(--ink-3)] ml-1.5">{g.zh}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </ArticleReader>

      {/* 题目区 */}
      <div className="space-y-5 min-w-0">
        {questions.map((q) => {
          const qid = keyOf(q.qNo);
          const solvedItem = result?.solved.find((s) => s.qNo === q.qNo);
          const verdict = verdicts[qid];
          const locked = running || done || job?.status === "error";
          const officialAnswer = q.answer ?? solvedItem?.answer;
          return (
            <PaperCard key={q.qNo} className="p-5" frame={done && verdict !== undefined}>
              <div className="flex items-baseline justify-between gap-2 mb-3">
                <div className="text-[16px] font-bold leading-relaxed" style={{ fontFamily: "var(--font-en)" }}>
                  {q.qNo}. {q.stem}
                </div>
                <span className="meta-label shrink-0">{QTYPE_ZH[q.qType ?? ""] ?? ""}</span>
              </div>
              <div className="space-y-2">
                {q.options.map((opt, oi) => {
                  const label = "ABCD"[oi];
                  const chosen = answers[qid] === label;
                  const isCorrect = done && officialAnswer === label;
                  const isWrongPick = done && chosen && officialAnswer !== label;
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
                  {verdict ? "✓ 答对了" : `✗ 答错了，正确答案 ${officialAnswer ?? "?"}`}
                  {!verdict && q.answer && solvedItem && solvedItem.answer !== q.answer && (
                    <span className="ml-2 text-[12px] font-normal text-[var(--ink-3)]">（AI 参考 {solvedItem.answer}，以命题设计答案为准）</span>
                  )}
                </div>
              )}
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
                    kind="generated"
                    refId={setId}
                  />
                </CollapsibleAnalysis>
              )}
              {done && !solvedItem && q.design && (
                <div className="mt-3 text-[13.5px] text-[var(--ink-2)] bg-[var(--paper-deep)]/50 p-3 rounded-[2px]">
                  命题说明 · 答案 <b className="text-[var(--vermilion)]">{q.answer}</b>：{q.design}
                </div>
              )}
            </PaperCard>
          );
        })}

        {/* 交卷 / 流水线面板（可折叠，与真题页一致） */}
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
                    safeStorage.remove(draftKey);
                    utils.agent.stats.invalidate();
                    utils.wrong.list.invalidate();
                    utils.agent.history.invalidate();
                  }).catch((e: unknown) => setSaveError(e instanceof Error ? e.message : "保存失败"));
                }}
                className="px-3 py-1 bg-[var(--vermilion)] text-[var(--paper)] rounded-[2px] text-[12px] font-bold"
              >
                重试保存
              </button>
            </div>
          )}
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
                        本次得分：
                        <span className="text-[var(--vermilion)] text-[24px] mx-1">
                          {Object.values(verdicts).filter(Boolean).length} / {questions.length}
                        </span>
                      </p>
                      {result?.review && (
                        <p className="text-[13.5px] text-[var(--ink-2)] mb-2">
                          校验官总评：{String((result.review as { comment?: string }).comment ?? "通过")}
                        </p>
                      )}
                      <p className="text-[13px] text-[var(--ink-3)] mb-3">错题已自动收入错题本，与真题错题同等待遇</p>
                      <button onClick={again} className="px-5 py-2 border border-[var(--ink)] rounded-[2px] text-[15px] hover:bg-[var(--paper-deep)]">
                        再练一遍
                      </button>
                    </div>
                  ) : undefined
                }
              />
              {!user && !running && !done && (
                <p className="text-[12.5px] text-[var(--vermilion)] mt-2">登录后才能交卷解析（解析任务归入你的账号）</p>
              )}
            </>
          )}
        </PaperCard>

        {/* 复盘定制卷：仿真卷判分后同样可以趁热定制 */}
        {done && Object.keys(verdicts).length > 0 && user && (
          <RetroCard kind="generated" refId={setId} verdicts={verdicts} />
        )}
      </div>
    </div>
  );
}
