import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { useUser } from "@/hooks/useUser";
import { BrushTitle, InkReveal, InkDivider, PaperCard, StatusDot } from "@/components/ink/decor";
import { Seal } from "@/components/ink/Seal";
import { playSound } from "@/hooks/useSound";

type OutlineItem = { para: number; purpose: string; points: string[]; keyExpressions: string[] };
type DraftState = {
  step: "outline" | "drafting" | "done";
  mode?: "guided" | "auto";
  outline: OutlineItem[];
  tips?: string;
  wordTarget?: string;
  paragraphs: string[];
  highlights: { para: number; highlights: string[]; note: string }[];
  currentPara: number;
  useMaterials: boolean;
};

const STEP_SEALS = [
  { no: "壹", zh: "拟提纲", en: "OUTLINE" },
  { no: "贰", zh: "逐段写", en: "DRAFT" },
  { no: "叁", zh: "收稿", en: "FINISH" },
];

function StepRail({ step }: { step: DraftState["step"] }) {
  const activeIdx = step === "outline" ? 0 : step === "drafting" ? 1 : 2;
  return (
    <div className="flex items-center gap-2.5 flex-wrap">
      {STEP_SEALS.map((s, i) => (
        <div key={s.no} className="flex items-center gap-2.5">
          {i > 0 && <span className="text-[var(--line)] text-[13px]">——</span>}
          <span className={`inline-flex items-center justify-center w-6 h-6 text-[12px] font-bold rounded-[2px] ${i <= activeIdx ? "bg-[var(--ink)] text-[var(--paper)]" : "border border-[var(--line)] text-[var(--ink-3)]"}`}>
            {s.no}
          </span>
          <span className={`text-[13.5px] ${i === activeIdx ? "font-bold text-[var(--vermilion)]" : i < activeIdx ? "font-bold text-[var(--ink-2)]" : "text-[var(--ink-3)]"}`}>
            {s.zh}
          </span>
          <span className="meta-label hidden sm:inline">{s.en}</span>
        </div>
      ))}
    </div>
  );
}

export default function EssayDraftPage() {
  useUser();
  const { draftId } = useParams();
  const id = Number(draftId);
  const utils = trpc.useUtils();
  const generateAll = trpc.essay.generateAll.useMutation({ onSuccess: () => void utils.essay.draftStatus.invalidate() });
  // 一气呵成写作中每 4 秒轮询：段落随写随现，中途回来看进度也在
  const { data, isLoading, isError } = trpc.essay.draftStatus.useQuery(
    { draftId: id },
    { enabled: Number.isFinite(id), refetchInterval: generateAll.isPending ? 4000 : false },
  );
  const state = (data?.state ?? null) as DraftState | null;

  const confirmOutline = trpc.essay.confirmOutline.useMutation({ onSuccess: () => void utils.essay.draftStatus.invalidate() });
  const reviseOutline = trpc.essay.reviseOutline.useMutation({ onSuccess: () => { void utils.essay.draftStatus.invalidate(); setOutlineNote(""); } });
  const generateParagraph = trpc.essay.generateParagraph.useMutation({
    onSuccess: (d) => { void utils.essay.draftStatus.invalidate(); if (d?.paragraph) setEdited(d.paragraph); },
  });
  const reviseParagraph = trpc.essay.reviseParagraph.useMutation({
    onSuccess: (d) => {
      void utils.essay.draftStatus.invalidate();
      setParaNote("");
      // 进化后的新段落必须立刻覆盖编辑框——query 失效重取不会改变 paragraphs.length，旧文本会赖在框里
      if (d?.paragraph) {
        if (d.paraNo === state?.currentPara) setEdited(d.paragraph);
        if (d.paraNo === editPara) setEditText(d.paragraph);
      }
    },
  });
  const confirmParagraph = trpc.essay.confirmParagraph.useMutation({ onSuccess: () => void utils.essay.draftStatus.invalidate() });
  const finishDraft = trpc.essay.finishDraft.useMutation({ onSuccess: () => { void utils.essay.draftStatus.invalidate(); void utils.essay.list.invalidate(); void utils.essay.draftList.invalidate(); } });

  const [edited, setEdited] = useState("");
  const [pendingSince, setPendingSince] = useState<number | null>(null);
  const [writingSelf, setWritingSelf] = useState(false);
  const [outlineNote, setOutlineNote] = useState("");
  const [paraNote, setParaNote] = useState("");
  const [editPara, setEditPara] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (state && state.step === "drafting") {
      setEdited(state.paragraphs[state.currentPara - 1] ?? "");
      setWritingSelf(false);
    }
  }, [state?.currentPara, state?.step, state?.paragraphs?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // LLM 调用挂起计时：超过 45 秒给用户一个诚实的说明（上游偶发审计会自动退避重试）
  const anyPending = generateParagraph.isPending || reviseParagraph.isPending || generateAll.isPending || confirmOutline.isPending || reviseOutline.isPending;
  useEffect(() => {
    if (anyPending && pendingSince == null) setPendingSince(Date.now());
    if (!anyPending && pendingSince != null) setPendingSince(null);
  }, [anyPending, pendingSince]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (pendingSince == null) return;
    const t = setInterval(() => tick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, [pendingSince]);

  if (isLoading) return <div className="py-20 text-center text-[14px] text-[var(--ink-3)]">载入写作会话…</div>;
  if (isError || !data || !state) {
    return (
      <div className="py-20 text-center space-y-3">
        <p className="text-[14px] text-[var(--ink-3)]">写作会话不存在或已被清理。</p>
        <Link to="/essay" className="text-[var(--vermilion)] font-bold hover:underline">← 回到作文工坊</Link>
      </div>
    );
  }

  const curOutline = state.outline[state.currentPara - 1];
  const curHighlight = state.highlights[state.currentPara - 1];
  // 收稿闸门以「定稿进度」为准而不是「草稿是否已生成」：AI 起草完末段后必须先经过人的编辑/定稿，
  // 否则起草末段会直接跳过人的参与跳到收稿页（一气呵成 generateAll 会把 currentPara 推过末段，不受影响）
  const allWritten = state.step === "drafting" && state.currentPara > state.outline.length;
  const autoRunning = generateAll.isPending;
  const slowPending = pendingSince != null && Date.now() - pendingSince > 45000;

  /** 一气呵成是独立路径：确认提纲后直接 AI 走完全文，不再需要第二次点击 */
  const onConfirmOutline = async () => {
    await confirmOutline.mutateAsync({ draftId: id });
    if (state.mode === "auto") generateAll.mutate({ draftId: id });
  };

  return (
    <div>
      <InkReveal>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <Link to="/essay" className="text-[12.5px] text-[var(--ink-3)] hover:text-[var(--ink)] mb-2 inline-block">← 作文工坊</Link>
            <BrushTitle as="h1" vermilion className="text-[30px]">{data.title}</BrushTitle>
            <div className="mt-3"><StepRail step={state.step} /></div>
          </div>
          <Seal size={68} seed={`draft-${id}`} text="循序渐进" center="写" />
        </div>
      </InkReveal>
      <InkDivider className="mt-4" />

      {/* 题目 */}
      <PaperCard className="p-5 mt-5">
        <div className="meta-label mb-1.5">题目 · DIRECTIONS</div>
        <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-[var(--ink-2)]">{data.prompt}</p>
        {!!state.wordTarget && <p className="text-[12px] text-[var(--ink-3)] mt-2">目标篇幅：{state.wordTarget}</p>}
      </PaperCard>

      {/* 壹 · 提纲 */}
      {state.step === "outline" && (
        <PaperCard frame className="p-6 mt-5 space-y-5">
          <BrushTitle as="h2" vermilion className="text-[17px]">写作提纲</BrushTitle>
          {!!state.tips && (
            <p className="text-[13px] leading-relaxed text-[var(--ink-2)] border-l-2 border-[var(--vermilion)] pl-3">{state.tips}</p>
          )}
          <div className="space-y-4">
            {state.outline.map((o) => (
              <div key={o.para} className="border border-[var(--line)] rounded-[2px] p-4">
                <p className="font-bold text-[14px]">
                  <span className="inline-flex items-center justify-center w-5 h-5 text-[11px] font-bold text-[var(--paper)] bg-[var(--ink)] rounded-[2px] mr-2">{o.para}</span>
                  {o.purpose}
                </p>
                <ul className="mt-2 space-y-1 ml-7">
                  {o.points.map((p, i) => <li key={i} className="text-[13px] text-[var(--ink-2)] leading-relaxed">· {p}</li>)}
                </ul>
                {o.keyExpressions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2.5 ml-7">
                    {o.keyExpressions.map((e, i) => (
                      <b key={i} className="px-1.5 py-0.5 bg-[var(--bamboo)]/15 text-[var(--bamboo)] text-[11.5px] rounded-[2px] font-normal" style={{ fontFamily: "var(--font-en), var(--font-zh)" }}>{e}</b>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* 人留参考意见 → 提纲进化 */}
          <div className="border border-dashed border-[var(--line)] rounded-[2px] p-4 space-y-2.5">
            <div className="meta-label">对提纲有想法？留一句参考意见，AI 按意见进化</div>
            <textarea
              value={outlineNote}
              onChange={(e) => setOutlineNote(e.target.value)}
              rows={2}
              placeholder="如：第二段想加一个原因分析；keyExpressions 多给些衔接词……"
              className="w-full border border-[var(--line)] rounded-[2px] px-3 py-2 text-[13px] bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)]"
            />
            <button
              onClick={() => reviseOutline.mutate({ draftId: id, note: outlineNote.trim() })}
              disabled={reviseOutline.isPending || outlineNote.trim().length < 2}
              className="px-4 py-2 text-[13px] font-bold border border-[var(--line)] rounded-[2px] text-[var(--ink-2)] hover:border-[var(--ink-2)] disabled:opacity-40"
            >
              {reviseOutline.isPending ? "提纲进化中…（约 20 秒）" : "⟳ 按意见进化提纲"}
            </button>
            {reviseOutline.isError && (
              <p className="text-[13px] text-[var(--vermilion)] border-l-2 border-[var(--vermilion)] pl-2.5">
                {(reviseOutline.error as { message?: string }).message ?? "进化失败，请重试"}
              </p>
            )}
          </div>
          <button
            onClick={() => void onConfirmOutline()}
            disabled={confirmOutline.isPending}
            className="px-6 py-2.5 text-[14px] font-bold bg-[var(--vermilion)] text-[var(--paper)] rounded-[2px] print-shadow hover:opacity-90 disabled:opacity-40"
          >
            {confirmOutline.isPending ? "确认提纲中…" : state.mode === "auto" ? "提纲无碍，AI 一气呵成 →" : "提纲无碍，写第一段 →"}
          </button>
        </PaperCard>
      )}

      {/* 贰 · 逐段写 */}
      {state.step === "drafting" && !allWritten && (
        <div className="mt-5 grid lg:grid-cols-[1fr_300px] gap-5 items-start">
          <PaperCard frame className="p-6 space-y-5">
            {curOutline && (
              <div className="border-l-2 border-[var(--vermilion)] pl-3.5">
                <p className="text-[13.5px] font-bold">本段任务 · {curOutline.purpose}</p>
                <p className="text-[12.5px] text-[var(--ink-3)] mt-1 leading-relaxed">{curOutline.points.join("；")}</p>
              </div>
            )}

            {state.mode === "auto" && (
              <div className="border border-[var(--vermilion)]/40 bg-[var(--vermilion)]/5 rounded-[2px] p-4 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-48">
                  <p className="text-[13.5px] font-bold text-[var(--vermilion)]">一气呵成模式</p>
                  <p className="text-[12px] text-[var(--ink-3)] mt-0.5 leading-relaxed">
                    {autoRunning ? "AI 正在逐段落墨，写完自动呈现全文；中途离开再回来进度不丢。" : "AI 一次写完剩余全部段落；写完可逐段留意见进化。下方仍可逐段接力。"}
                  </p>
                </div>
                {!autoRunning && (
                  <button
                    onClick={() => generateAll.mutate({ draftId: id })}
                    className="px-5 py-2.5 text-[13.5px] font-bold bg-[var(--vermilion)] text-[var(--paper)] rounded-[2px] print-shadow hover:opacity-90"
                  >
                    ⚑ AI 一气呵成写完全文
                  </button>
                )}
                {autoRunning && <span className="text-[13px] font-bold text-[var(--vermilion)]">AI 全文写作中…（约 1–2 分钟）</span>}
              </div>
            )}

            {!state.paragraphs[state.currentPara - 1] && !writingSelf ? (
              <div className="flex items-center gap-2.5 flex-wrap">
                <button
                  onClick={() => generateParagraph.mutate({ draftId: id, regenerate: false })}
                  disabled={generateParagraph.isPending || autoRunning}
                  className="px-6 py-2.5 text-[14px] font-bold bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow hover:opacity-90 disabled:opacity-40"
                >
                  {generateParagraph.isPending ? "AI 起草中…（约 30 秒）" : `⚑ 让 AI 起草第 ${state.currentPara} 段`}
                </button>
                <button
                  onClick={() => setWritingSelf(true)}
                  disabled={autoRunning}
                  className="px-4 py-2.5 text-[13px] font-bold border border-[var(--line)] rounded-[2px] text-[var(--ink-2)] hover:border-[var(--ink-2)] disabled:opacity-40"
                >
                  ✍ 我自己写本段
                </button>
              </div>
            ) : (
              <>
                {curHighlight && (curHighlight.highlights.length > 0 || curHighlight.note) && (
                  <div className="bg-[var(--bamboo)]/5 border-l-2 border-[var(--bamboo)] pl-3.5 py-2 space-y-1">
                    {curHighlight.highlights.map((h, i) => <p key={i} className="text-[12.5px] text-[var(--ink-2)] leading-relaxed"><b className="text-[var(--bamboo)]">✦</b> {h}</p>)}
                    {!!curHighlight.note && <p className="text-[12px] text-[var(--ink-3)]">{curHighlight.note}</p>}
                  </div>
                )}
                <div>
                  <div className="meta-label mb-1.5">{writingSelf && !state.paragraphs[state.currentPara - 1] ? "自己写本段 · 写完定稿" : "在 AI 草稿上改写成你的版本 · 直接编辑"}</div>
                  <textarea
                    value={edited}
                    onChange={(e) => setEdited(e.target.value)}
                    rows={Math.max(6, edited.split("\n").length + 2)}
                    className="w-full border border-[var(--line)] rounded-[2px] px-3.5 py-3 text-[14px] leading-[1.95] bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)]"
                    style={{ fontFamily: "var(--font-en), var(--font-zh)" }}
                  />
                  <p className="text-[11.5px] text-[var(--ink-3)] mt-1">当前约 {edited.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length} 词</p>
                </div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <button
                    onClick={() => confirmParagraph.mutate({ draftId: id, paraNo: state.currentPara, content: edited.trim() })}
                    disabled={confirmParagraph.isPending || edited.trim().length < 10}
                    className="px-5 py-2.5 text-[13.5px] font-bold bg-[var(--bamboo)] text-[var(--paper)] rounded-[2px] print-shadow hover:opacity-90 disabled:opacity-40"
                  >
                    {state.currentPara >= state.outline.length ? "✓ 定稿本段（末段）" : `✓ 定稿本段，写第 ${state.currentPara + 1} 段 →`}
                  </button>
                  <button
                    onClick={() => generateParagraph.mutate({ draftId: id, regenerate: true })}
                    disabled={generateParagraph.isPending}
                    className="px-4 py-2.5 text-[13px] font-bold border border-[var(--line)] rounded-[2px] text-[var(--ink-2)] hover:border-[var(--ink-2)] disabled:opacity-40"
                  >
                    {generateParagraph.isPending ? "重写中…" : "⟳ AI 换一版"}
                  </button>
                </div>
                {/* 人留参考意见 → 本段进化 */}
                <div className="border border-dashed border-[var(--line)] rounded-[2px] p-3.5 space-y-2">
                  <div className="meta-label">留句参考意见，AI 按意见进化本段</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      value={paraNote}
                      onChange={(e) => setParaNote(e.target.value)}
                      placeholder="如：更正式一点；多加一个衔接词；把例子换成科技类……"
                      className="flex-1 min-w-52 border border-[var(--line)] rounded-[2px] px-3 py-2 text-[13px] bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)]"
                    />
                    <button
                      onClick={() => reviseParagraph.mutate({ draftId: id, paraNo: state.currentPara, note: paraNote.trim() })}
                      disabled={reviseParagraph.isPending || paraNote.trim().length < 2}
                      className="px-4 py-2 text-[13px] font-bold border border-[var(--line)] rounded-[2px] text-[var(--ink-2)] hover:border-[var(--ink-2)] disabled:opacity-40"
                    >
                      {reviseParagraph.isPending ? "进化中…" : "⟳ 按意见进化本段"}
                    </button>
                  </div>
                </div>
              </>
            )}
            {slowPending && (
              <p className="text-[12px] text-[var(--ink-3)] border-l-2 border-[var(--line)] pl-2.5">
                模型偶发内容审计会自动退避重试，单次最长约 2–4 分钟；已写内容不会丢，离开再回来进度还在。
              </p>
            )}
            {(generateParagraph.isError || confirmParagraph.isError || generateAll.isError || reviseParagraph.isError) && (
              <p className="text-[13px] text-[var(--vermilion)] border-l-2 border-[var(--vermilion)] pl-2.5">
                {((generateParagraph.error ?? confirmParagraph.error ?? generateAll.error ?? reviseParagraph.error) as { message?: string } | null)?.message ?? "操作失败，请重试"}
              </p>
            )}
          </PaperCard>

          {/* 侧栏：全文进度 */}
          <PaperCard className="p-4 space-y-2">
            <div className="meta-label mb-1">全文进度</div>
            {state.outline.map((o) => {
              const written = !!state.paragraphs[o.para - 1];
              const active = o.para === state.currentPara;
              return (
                <div key={o.para} className={`flex items-center gap-2 rounded-[2px] border px-3 py-2 text-[12.5px] ${active ? "border-[var(--vermilion)]" : "border-[var(--line)]"}`}>
                  <StatusDot ok={written} warn={active} />
                  <b>P{o.para}</b>
                  <span className="text-[var(--ink-2)] truncate">{o.purpose}</span>
                  {active && <b className="text-[var(--vermilion)] ml-auto shrink-0">写作中</b>}
                </div>
              );
            })}
          </PaperCard>
        </div>
      )}

      {/* 叁 · 收稿 */}
      {state.step === "drafting" && allWritten && (
        <PaperCard frame className="p-6 mt-5 space-y-5">
          <BrushTitle as="h2" vermilion className="text-[17px]">全段就绪，收稿成文</BrushTitle>
          <div className="space-y-4">
            {state.paragraphs.map((p, i) => (
              <div key={i} className="border border-[var(--line)] rounded-[2px] p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="meta-label">第 {i + 1} 段</div>
                  <span className="flex-1" />
                  <button
                    onClick={() => { if (editPara === i + 1) { setEditPara(null); } else { setEditPara(i + 1); setEditText(p); setParaNote(""); } }}
                    className="text-[12px] font-bold text-[var(--ink-2)] hover:text-[var(--vermilion)]"
                  >
                    {editPara === i + 1 ? "收起" : "修改 / 留意见"}
                  </button>
                </div>
                {editPara === i + 1 ? (
                  <div className="space-y-2.5">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={Math.max(5, editText.split("\n").length + 2)}
                      className="w-full border border-[var(--line)] rounded-[2px] px-3.5 py-3 text-[13.5px] leading-[1.95] bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)]"
                      style={{ fontFamily: "var(--font-en), var(--font-zh)" }}
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => { confirmParagraph.mutate({ draftId: id, paraNo: i + 1, content: editText.trim() }); setEditPara(null); }}
                        disabled={confirmParagraph.isPending || editText.trim().length < 10}
                        className="px-4 py-2 text-[13px] font-bold bg-[var(--bamboo)] text-[var(--paper)] rounded-[2px] print-shadow disabled:opacity-40"
                      >
                        ✓ 保存此段
                      </button>
                      <input
                        value={paraNote}
                        onChange={(e) => setParaNote(e.target.value)}
                        placeholder="参考意见：更正式 / 换个例子 / 加衔接词……"
                        className="flex-1 min-w-48 border border-[var(--line)] rounded-[2px] px-3 py-2 text-[12.5px] bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)]"
                      />
                      <button
                        onClick={() => reviseParagraph.mutate({ draftId: id, paraNo: i + 1, note: paraNote.trim() })}
                        disabled={reviseParagraph.isPending || paraNote.trim().length < 2}
                        className="px-4 py-2 text-[13px] font-bold border border-[var(--line)] rounded-[2px] text-[var(--ink-2)] hover:border-[var(--ink-2)] disabled:opacity-40"
                      >
                        {reviseParagraph.isPending ? "进化中…" : "⟳ 按意见进化"}
                      </button>
                    </div>
                    {reviseParagraph.isError && (
                      <p className="text-[12.5px] text-[var(--vermilion)] border-l-2 border-[var(--vermilion)] pl-2.5">
                        {(reviseParagraph.error as { message?: string }).message ?? "进化失败，请重试"}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[13.5px] leading-[1.95] whitespace-pre-wrap" style={{ fontFamily: "var(--font-en), var(--font-zh)" }}>{p}</p>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 flex-wrap border-t border-dashed border-[var(--line)] pt-4">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={data.title} className="border border-[var(--line)] rounded-[2px] px-3 py-2 text-[13.5px] bg-[var(--paper)] w-64 focus:outline-none focus:border-[var(--ink-2)]" />
            <button
              onClick={() => { finishDraft.mutate({ draftId: id, title: title.trim() || undefined }); playSound("seal"); }}
              disabled={finishDraft.isPending}
              className="px-6 py-2.5 text-[14px] font-bold bg-[var(--vermilion)] text-[var(--paper)] rounded-[2px] print-shadow hover:opacity-90 disabled:opacity-40"
            >
              {finishDraft.isPending ? "收稿中…" : "收稿成文 →"}
            </button>
          </div>
        </PaperCard>
      )}

      {/* 已成文 */}
      {state.step === "done" && (
        <PaperCard frame className="p-10 mt-5 text-center space-y-4">
          <Seal size={84} seed={`done-${id}`} text="大功告成" center="成" />
          <p className="font-bold text-[17px]" style={{ fontFamily: "var(--font-zh)" }}>这篇作文已经收稿</p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            {data.essayId && <Link to="/essay" className="px-5 py-2.5 text-[13.5px] font-bold bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow">去作文列表请 AI 批改 →</Link>}
            <Link to="/essay" className="px-5 py-2.5 text-[13.5px] font-bold border border-[var(--line)] rounded-[2px] text-[var(--ink-2)]">再写一篇</Link>
          </div>
        </PaperCard>
      )}
    </div>
  );
}
