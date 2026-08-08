import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { BrushTitle, InkReveal, InkDivider, PaperCard, StatusDot } from "@/components/ink/decor";
import { Seal, StepSeal } from "@/components/ink/Seal";
import { useUser } from "@/hooks/useUser";
import { safeStorage } from "@/lib/safeStorage";
import { playSound } from "@/hooks/useSound";
import { useToast } from "@/hooks/useToast";
import { Q_TYPES } from "@contracts/constants";

/**
 * 参与式解题（跟我练）：学生走进解题的每一步。
 * 四步：壹·审题（判题型）→ 贰·定位（选段落）→ 叁·解题（选答案）→ 肆·复盘（写一句，AI 对照）。
 * 每步先学生作答、提交后才揭示 AI 参照——不剧透下一步。
 * 会话进度存 localStorage（刷新/切页不丢）；仅最终成果落库（0 额外 LLM 成本，参照全来自已落库解析）。
 */

type Step = 0 | 1 | 2 | 3; // 0审题 1定位 2解题 3复盘
const STEP_META = [
  { num: "壹", zh: "审题", en: "QUESTION", hint: "读题干，判断这是什么题型、考眼在哪" },
  { num: "贰", zh: "定位", en: "LOCATE", hint: "回原文找答案区，选出证据句所在段落" },
  { num: "叁", zh: "解题", en: "SOLVE", hint: "逐项过筛，锁定你的答案" },
  { num: "肆", zh: "复盘", en: "REFLECT", hint: "写一句你的思路，对照 AI 的反思" },
] as const;

interface Session {
  step: Step;
  myQType: string;
  myParaNo: number | null;
  myAnswer: string;
  myReflection: string;
  score: { question: boolean; locate: boolean; solve: boolean } | null;
  done: boolean;
}

const EMPTY: Session = { step: 0, myQType: "", myParaNo: null, myAnswer: "", myReflection: "", score: null, done: false };

const QTYPE_OPTIONS = Q_TYPES.map((t) => ({ id: t.id as string, zh: t.name as string }));

export default function InteractivePage() {
  const { kind = "exam", id } = useParams();
  const k = (kind === "generated" ? "generated" : "exam") as "exam" | "generated";
  const refId = Number(id);
  const { user } = useUser();
  const { toast } = useToast();

  const [qNo, setQNo] = useState(1);
  const sessKey = `ky_interactive_${k}_${refId}_${qNo}`;
  const [sess, setSess] = useState<Session>(() => {
    try { return { ...EMPTY, ...JSON.parse(safeStorage.get(sessKey) ?? "{}") }; } catch { return EMPTY; }
  });
  useEffect(() => {
    try { return; } catch { /* noop */ }
  }, []);
  useEffect(() => {
    const saved = (() => { try { return JSON.parse(safeStorage.get(sessKey) ?? "{}"); } catch { return {}; } })();
    setSess({ ...EMPTY, ...saved });
  }, [sessKey]);
  useEffect(() => { safeStorage.set(sessKey, JSON.stringify(sess)); }, [sessKey, sess]);

  const { data: detail } = trpc.passage.detail.useQuery({ id: refId }, { enabled: k === "exam" });
  const { data: genDetail } = trpc.agent.generatedDetail.useQuery({ id: refId }, { enabled: k === "generated" });
  const paragraphs: string[] = useMemo(() => {
    if (k === "exam") return detail?.passage.paragraphs ?? [];
    const p = (genDetail?.payload as { paragraphs?: string[] } | undefined)?.paragraphs;
    return p ?? [];
  }, [k, detail, genDetail]);
  const qTotal = k === "exam" ? (detail?.questions.length ?? 5) : (((genDetail?.payload as { questions?: unknown[] })?.questions?.length) ?? 5);

  const stepQ = trpc.interactive.stepQuestion.useQuery({ kind: k, refId, qNo }, { enabled: !!user });
  const stepL = trpc.interactive.stepLocate.useQuery({ kind: k, refId, qNo }, { enabled: !!user && sess.step >= 1 });
  const stepS = trpc.interactive.stepSolve.useQuery({ kind: k, refId, qNo }, { enabled: !!user && sess.step >= 3 && sess.score !== null });

  const finishMut = trpc.interactive.finish.useMutation();

  if (!user) {
    return (
      <PaperCard className="max-w-[720px] mx-auto p-10 text-center">
        <Seal size={80} seed="inter-gate" center="练" />
        <p className="mt-4 text-[15px]">签到后才能进入「跟我练」</p>
      </PaperCard>
    );
  }

  const submitStep = async () => {
    if (sess.step === 0) {
      if (!sess.myQType) return toast("先选一个题型", "warn");
      const ok = (stepQ.data?.ref?.qType ?? "") === sess.myQType;
      setSess((s) => ({ ...s, step: 1, score: { question: ok, locate: false, solve: false } }));
      playSound(ok ? "seal" : "page");
    } else if (sess.step === 1) {
      if (sess.myParaNo == null) return toast("先选一个段落", "warn");
      const ok = (stepL.data?.ref?.paraNo ?? -1) === sess.myParaNo;
      setSess((s) => ({ ...s, step: 2, score: { ...(s.score ?? { question: false, locate: false, solve: false }), locate: ok } }));
      playSound(ok ? "seal" : "page");
    } else if (sess.step === 2) {
      if (!sess.myAnswer) return toast("先选一个答案", "warn");
      // 解题对错在步 4 一起算（stepSolve 已可取）
      const s3 = await stepS.refetch();
      const official = s3.data?.official ?? "";
      const ok = official === sess.myAnswer;
      const score = { ...(sess.score ?? { question: false, locate: false }), solve: ok };
      setSess((s) => ({ ...s, step: 3, score }));
      playSound(ok ? "seal" : "page");
    } else {
      // 复盘落库
      try {
        await finishMut.mutateAsync({
          kind: k, refId, qNo,
          myQType: sess.myQType, myParaNo: sess.myParaNo,
          myAnswer: sess.myAnswer as "A" | "B" | "C" | "D",
          myReflection: sess.myReflection.trim(),
          score: sess.score ?? { question: false, locate: false, solve: false },
        });
        setSess((s) => ({ ...s, done: true }));
        playSound("seal");
        toast("本题练习成果已入档", "ok");
      } catch (e) {
        toast(e instanceof Error ? e.message : "落库失败", "warn");
      }
    }
  };

  const nextQ = () => {
    if (qNo < qTotal) { setQNo(qNo + 1); setSess(EMPTY); }
  };

  const meta = STEP_META[sess.step];
  const scoreCount = sess.score ? Object.values(sess.score).filter(Boolean).length : 0;

  return (
    <div className="max-w-[1200px] mx-auto">
      <InkReveal className="mb-6">
        <div className="meta-label mb-2">GUIDED PRACTICE · 跟我练</div>
        <h1 className="text-[30px] font-black"><BrushTitle vermilion>每一步，你先来</BrushTitle></h1>
        <p className="text-[var(--ink-2)] mt-1.5 text-[14.5px]">
          AI 不替你走。审题、定位、解题、复盘，每一步你先作答，再看 AI 怎么走——参照全部来自这篇的深度解析，零等待。
        </p>
      </InkReveal>

      {/* 步骤轨 + 选题 */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
        <div className="flex items-center gap-4">
          {STEP_META.map((s, i) => (
            <div key={s.num} className="flex items-center gap-1.5">
              <StepSeal num={s.num} size={34} seed={`inter-${s.num}`} active={sess.step === i && !sess.done} done={sess.step > i || sess.done} />
              <span className={`text-[13px] ${sess.step === i && !sess.done ? "font-bold text-[var(--vermilion)]" : "text-[var(--ink-2)]"}`}>{s.zh}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {Array.from({ length: qTotal }, (_, i) => i + 1).map((n) => (
            <button key={n} onClick={() => { setQNo(n); setSess(EMPTY); }}
              className={`w-8 h-8 text-[13px] border rounded-[2px] ${n === qNo ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)] text-[var(--ink-3)]"}`}>
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="grid xl:grid-cols-[3fr_2fr] gap-8 min-w-0">
        {/* 左：原文（定位步高亮选择） */}
        <PaperCard frame className="p-6">
          <div className="meta-label mb-3">PASSAGE · 全文</div>
          <div className="reading-en">
            {paragraphs.map((p, i) => (
              <p key={i} className={sess.step === 1 && sess.myParaNo === i + 1 ? "bg-[var(--vermilion)]/10 px-2 -mx-2 rounded-[2px]" : ""}>
                <span className="para-no">{i + 1}</span>{p}
              </p>
            ))}
            {paragraphs.length === 0 && <p className="text-[14px] text-[var(--ink-3)]">载入中……</p>}
          </div>
        </PaperCard>

        {/* 右：当前步骤操作台 */}
        <div className="space-y-5">
          <PaperCard frame className="p-6">
            <div className="meta-label mb-1">{meta.en}</div>
            <h2 className="text-[19px] font-bold mb-1">{meta.num} · {meta.zh}</h2>
            <p className="text-[13px] text-[var(--ink-3)] mb-4">{meta.hint}</p>
            <InkDivider />

            {/* 壹·审题 */}
            {sess.step === 0 && (
              <div className="mt-4">
                <p className="text-[14.5px] leading-relaxed mb-3">{stepQ.data?.stem ?? "载入题干…"}</p>
                <div className="grid grid-cols-2 gap-2">
                  {QTYPE_OPTIONS.map((t) => (
                    <button key={t.id} onClick={() => setSess((s) => ({ ...s, myQType: t.id }))}
                      className={`px-3 py-2 text-[13.5px] border rounded-[2px] text-left ${sess.myQType === t.id ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)]"}`}>
                      {t.zh}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 贰·定位 */}
            {sess.step === 1 && (
              <div className="mt-4">
                <div className="flex flex-wrap gap-2">
                  {paragraphs.map((_, i) => (
                    <button key={i} onClick={() => setSess((s) => ({ ...s, myParaNo: i + 1 }))}
                      className={`w-11 h-11 border rounded-[2px] text-[15px] ${sess.myParaNo === i + 1 ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)]"}`}>
                      {i + 1}
                    </button>
                  ))}
                </div>
                <p className="text-[12.5px] text-[var(--ink-3)] mt-3">点选你认为证据句所在的段落（左栏会高亮）</p>
                {/* 上一步对照 */}
                <div className="mt-4 border-t border-dashed border-[var(--line)] pt-3 text-[13px]">
                  审题：你判 <b>{QTYPE_OPTIONS.find((t) => t.id === sess.myQType)?.zh ?? sess.myQType}</b>，
                  AI 判 <b className={sess.score?.question ? "text-[var(--bamboo)]" : "text-[var(--vermilion)]"}>
                    {QTYPE_OPTIONS.find((t) => t.id === stepQ.data?.ref?.qType)?.zh ?? stepQ.data?.ref?.qType ?? "—"}
                  </b> {sess.score?.question ? "✓ 一致" : "（不一致也没关系，往下看）"}
                </div>
              </div>
            )}

            {/* 叁·解题 */}
            {sess.step === 2 && (
              <div className="mt-4">
                <div className="space-y-2">
                  {(stepQ.data?.options ?? []).map((o, i) => {
                    const label = "ABCD"[i];
                    return (
                      <button key={label} onClick={() => setSess((s) => ({ ...s, myAnswer: label }))}
                        className={`w-full text-left px-3 py-2 border rounded-[2px] text-[13.5px] leading-relaxed ${sess.myAnswer === label ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)]"}`}>
                        <span className="font-mono mr-2">{label}.</span>{o}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 border-t border-dashed border-[var(--line)] pt-3 text-[13px] space-y-1.5">
                  <p>定位：你选第 <b>{sess.myParaNo}</b> 段，AI 证据在第 <b className={sess.score?.locate ? "text-[var(--bamboo)]" : "text-[var(--vermilion)]"}>{stepL.data?.ref?.paraNo ?? "—"}</b> 段 {sess.score?.locate ? "✓" : ""}</p>
                  {stepL.data?.ref?.evidence && <p className="text-[var(--ink-2)]">证据：{stepL.data.ref.evidence}</p>}
                </div>
              </div>
            )}

            {/* 肆·复盘 */}
            {sess.step === 3 && (
              <div className="mt-4">
                {!sess.done ? (
                  <>
                    <div className="text-[14px] mb-3">
                      你选 <b className={sess.score?.solve ? "text-[var(--bamboo)]" : "text-[var(--vermilion)]"}>{sess.myAnswer}</b> ·
                      官方答案 <b className="text-[var(--bamboo)]">{stepS.data?.official ?? "…"}</b>
                      {sess.score?.solve ? " ✓ 答对了" : "（答错了，更要写复盘）"}
                    </div>
                    <textarea value={sess.myReflection} onChange={(e) => setSess((s) => ({ ...s, myReflection: e.target.value }))}
                      rows={3} maxLength={500} className="ink-textarea"
                      placeholder="写一句你这一步是怎么想的：对在哪，或卡在哪……" />
                    <p className="text-[12px] text-[var(--ink-3)] mt-1">写完再落章，AI 的反思才会揭晓——先自己说透。</p>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-[15px]">
                      <StatusDot ok={scoreCount === 3} warn={scoreCount < 3} />
                      四步得分 <b className="text-[var(--vermilion)] text-[20px]">{scoreCount} / 3</b>
                      <span className="text-[var(--ink-3)] text-[13px]">（审题/定位/解题）</span>
                    </div>
                    {stepS.data?.reflection && (
                      <div className="border-t border-dashed border-[var(--line)] pt-3">
                        <div className="meta-label mb-1.5">AI REFLECTION</div>
                        <p className="text-[13.5px] leading-relaxed">{stepS.data.reflection}</p>
                      </div>
                    )}
                    {stepS.data?.takeaway && (
                      <div className="border border-[var(--line)] rounded-[2px] px-3 py-2 bg-[var(--paper-deep)]">
                        <span className="text-[12.5px]">口诀带走：{stepS.data.takeaway}</span>
                      </div>
                    )}
                    {qNo < qTotal ? (
                      <button onClick={nextQ} className="w-full px-5 py-2.5 bg-[var(--vermilion)] text-[var(--paper)] rounded-[2px] text-[14px] font-bold print-shadow">
                        下一题（第 {qNo + 1} 题）→
                      </button>
                    ) : (
                      <div className="text-center pt-2">
                        <Seal size={72} seed="inter-done" center="成" animate />
                        <p className="text-[14px] mt-2">这篇跟我练全部走完。</p>
                        <Link to={k === "exam" ? "/library" : "/generate"} className="text-[var(--vermilion)] font-bold text-[14px] underline underline-offset-4">回去开新一套 →</Link>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!sess.done && (
              <button onClick={() => void submitStep()} disabled={finishMut.isPending || (sess.step === 3 && !sess.myReflection.trim())}
                className="mt-5 w-full px-5 py-2.5 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] text-[14px] font-bold print-shadow hover:opacity-90 disabled:opacity-40">
                {sess.step === 3 ? (finishMut.isPending ? "落档中…" : "落章，揭晓 AI 反思") : "提交，看 AI 参照"}
              </button>
            )}
          </PaperCard>
        </div>
      </div>
    </div>
  );
}
