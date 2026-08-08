import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useUser } from "@/hooks/useUser";
import { BrushTitle, InkReveal, InkDivider, PaperCard, StatusDot } from "@/components/ink/decor";
import { Seal } from "@/components/ink/Seal";

const TYPE_ZH = {
  letter: "小作文·书信", notice: "小作文·通知", memo: "小作文·备忘录",
  picture: "大作文·图画作文", chart: "大作文·图表作文",
} as const;
const STEP_ZH: Record<string, string> = { outline: "拟提纲", drafting: "逐段写", done: "已成文" };
const MATERIAL_KIND_ZH = { template: "模板", sentence: "句式", note: "笔记", model: "范文", vocab: "词汇" } as const;

function NewDraftCard() {
  const nav = useNavigate();
  const utils = trpc.useUtils();
  const startDraft = trpc.essay.startDraft.useMutation();
  const [essayType, setEssayType] = useState<keyof typeof TYPE_ZH>("letter");
  const [mode, setMode] = useState<"guided" | "auto">("guided");
  const [prompt, setPrompt] = useState("");
  const [useMaterials, setUseMaterials] = useState(false);
  const { data: materials } = trpc.essay.materialList.useQuery();

  const go = async () => {
    const r = await startDraft.mutateAsync({ essayType, prompt: prompt.trim(), useMaterials, mode });
    void utils.essay.draftList.invalidate();
    nav(`/essay/draft/${r.id}`);
  };

  return (
    <PaperCard frame className="p-6">
      <BrushTitle as="h2" vermilion className="text-[19px]">开一次写作</BrushTitle>
      <p className="meta-label mt-1.5">WRITING · 拟提纲 → 写正文 → 收稿批改</p>
      <div className="grid sm:grid-cols-2 gap-2.5 mt-4">
        {([
          { m: "guided" as const, zh: "接力引导", en: "GUIDED", desc: "AI 起草一段、你改一段，也可整段自己写——一步一印。" },
          { m: "auto" as const, zh: "一气呵成", en: "AUTO", desc: "AI 一次走完全文；你在每个阶段留参考意见，按意见进化。" },
        ]).map((o) => (
          <button key={o.m} onClick={() => setMode(o.m)} className={`text-left border rounded-[2px] px-3.5 py-3 transition-colors ${mode === o.m ? "border-[var(--vermilion)] bg-[var(--vermilion)]/5" : "border-[var(--line)] hover:border-[var(--ink-2)]"}`}>
            <p className={`text-[13.5px] font-bold ${mode === o.m ? "text-[var(--vermilion)]" : "text-[var(--ink)]"}`}>
              {o.zh} <span className="meta-label ml-1">{o.en}</span>
            </p>
            <p className="text-[12px] text-[var(--ink-3)] mt-1 leading-relaxed">{o.desc}</p>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap mt-4">
        {(Object.keys(TYPE_ZH) as (keyof typeof TYPE_ZH)[]).map((t) => (
          <button key={t} onClick={() => setEssayType(t)} className={`px-3 py-1.5 text-[13px] border rounded-[2px] transition-colors ${essayType === t ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--ink-2)]"}`}>
            {TYPE_ZH[t]}
          </button>
        ))}
      </div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        placeholder="粘贴作文题目 / Directions：Write a letter to …"
        className="mt-3 w-full border border-[var(--line)] rounded-[2px] px-3 py-2.5 text-[14px] leading-relaxed bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)]"
      />
      <div className="flex items-center gap-3 mt-3 flex-wrap">
        <label className="flex items-center gap-2 text-[13px] text-[var(--ink-2)] cursor-pointer select-none">
          <input type="checkbox" checked={useMaterials} onChange={(e) => setUseMaterials(e.target.checked)} className="accent-[var(--vermilion)]" />
          参考我的素材库（{(materials ?? []).length} 条）
        </label>
        <span className="flex-1" />
        <button
          onClick={() => void go()}
          disabled={startDraft.isPending || prompt.trim().length < 5}
          className="px-6 py-2.5 text-[14px] font-bold bg-[var(--vermilion)] text-[var(--paper)] rounded-[2px] print-shadow hover:opacity-90 disabled:opacity-40"
        >
          {startDraft.isPending ? "AI 拟提纲中…（约 30 秒）" : "开写 →"}
        </button>
      </div>
      {startDraft.isError && (
        <p className="mt-2 text-[13px] text-[var(--vermilion)] border-l-2 border-[var(--vermilion)] pl-2.5">
          {(startDraft.error as { message?: string }).message ?? "启动失败，请重试"}
        </p>
      )}
    </PaperCard>
  );
}

function DraftsCard() {
  const utils = trpc.useUtils();
  const { data: drafts } = trpc.essay.draftList.useQuery();
  const removeDraft = trpc.essay.removeDraft.useMutation({ onSuccess: () => void utils.essay.draftList.invalidate() });
  if (!drafts || drafts.length === 0) return null;
  return (
    <PaperCard className="p-6">
      <BrushTitle as="h2" className="text-[17px]">进行中的写作</BrushTitle>
      <div className="mt-4 divide-y divide-[var(--line)] ink-stagger">
        {drafts.map((d) => (
          <div key={d.id} className="flex items-center gap-3 py-2.5 group">
            <Link to={`/essay/draft/${d.id}`} className="flex items-center gap-3 flex-1 min-w-0">
              <StatusDot warn={d.step !== "done"} ok={d.step === "done"} />
              <span className="font-bold text-[13.5px] group-hover:text-[var(--vermilion)] transition-colors">{d.title}</span>
              <span className="text-[12px] text-[var(--ink-3)]">{TYPE_ZH[d.essayType as keyof typeof TYPE_ZH] ?? d.essayType}</span>
              <b className={`px-1.5 py-0.5 text-[11.5px] rounded-[2px] ${d.step === "done" ? "bg-[var(--bamboo)]/15 text-[var(--bamboo)]" : "bg-[var(--vermilion)]/10 text-[var(--vermilion)]"}`}>
                {STEP_ZH[d.step] ?? d.step}
              </b>
              <span className="flex-1" />
              <span className="text-[12px] text-[var(--ink-3)]">{new Date(d.updatedAt).toLocaleDateString("zh-CN")}</span>
              <span className="text-[12.5px] font-bold text-[var(--vermilion)]">→ 继续</span>
            </Link>
            <button
              onClick={() => { if (confirm("丢弃这份草稿？（已收稿的作文不受影响）")) removeDraft.mutate({ draftId: d.id }); }}
              className="shrink-0 text-[12px] font-bold text-[var(--vermilion)]/60 hover:text-[var(--vermilion)]"
            >
              丢弃
            </button>
          </div>
        ))}
      </div>
    </PaperCard>
  );
}

function EssaysCard() {
  const utils = trpc.useUtils();
  const { data: essays, isLoading } = trpc.essay.list.useQuery();
  const remove = trpc.essay.remove.useMutation({ onSuccess: () => void utils.essay.list.invalidate() });
  const [openId, setOpenId] = useState<number | null>(null);
  const { data: detail } = trpc.essay.detail.useQuery({ id: openId! }, { enabled: openId != null });
  const review = trpc.essay.review.useMutation({ onSuccess: () => { void utils.essay.list.invalidate(); void utils.essay.detail.invalidate(); } });

  return (
    <PaperCard className="p-6">
      <BrushTitle as="h2" className="text-[17px]">我的作文</BrushTitle>
      {isLoading && <p className="mt-3 text-[13.5px] text-[var(--ink-3)]">载入中…</p>}
      {!isLoading && (essays ?? []).length === 0 && (
        <p className="mt-3 text-[13.5px] text-[var(--ink-3)]">还没有成文。完成一次引导式写作后自动收进来，可请 AI 按四维度批改。</p>
      )}
      <div className="mt-4 divide-y divide-[var(--line)] ink-stagger">
        {(essays ?? []).map((e) => (
          <div key={e.id}>
            <button onClick={() => setOpenId(openId === e.id ? null : e.id)} className="w-full flex items-center gap-3 py-2.5 text-left group">
              <span className="font-bold text-[13.5px] group-hover:text-[var(--vermilion)] transition-colors">{e.title}</span>
              <span className="text-[12px] text-[var(--ink-3)]">{e.typeZh}</span>
              {e.score != null && <b className="px-1.5 py-0.5 bg-[var(--vermilion)]/10 text-[var(--vermilion)] text-[12px] rounded-[2px]">{e.score} 分</b>}
              {e.reviewed && e.score == null && <b className="px-1.5 py-0.5 bg-[var(--bamboo)]/15 text-[var(--bamboo)] text-[11.5px] rounded-[2px]">已批改</b>}
              <span className="flex-1" />
              <span className="text-[12px] text-[var(--ink-3)]">{new Date(e.updatedAt).toLocaleDateString("zh-CN")}</span>
              <span className={`text-[var(--ink-3)] text-[12px] transition-transform ${openId === e.id ? "rotate-90" : ""}`}>▸</span>
            </button>
            {openId === e.id && detail && (
              <div className="pb-5 pl-1 space-y-4">
                <div>
                  <div className="meta-label mb-1">题目</div>
                  <p className="text-[13px] text-[var(--ink-2)] whitespace-pre-wrap leading-relaxed">{detail.prompt}</p>
                </div>
                <div>
                  <div className="meta-label mb-1">正文</div>
                  <p className="text-[14px] leading-[1.95] whitespace-pre-wrap" style={{ fontFamily: "var(--font-en), var(--font-zh)" }}>{detail.content}</p>
                </div>
                {detail.review ? (
                  <ReviewView review={detail.review as Record<string, unknown>} />
                ) : (
                  <button
                    onClick={() => review.mutate({ essayId: e.id })}
                    disabled={review.isPending || !detail.content.trim()}
                    className="px-5 py-2 text-[13.5px] font-bold bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow hover:opacity-90 disabled:opacity-40"
                  >
                    {review.isPending ? "AI 批改中…（约 1 分钟）" : "请 AI 批改"}
                  </button>
                )}
                {review.isError && (
                  <p className="text-[13px] text-[var(--vermilion)] border-l-2 border-[var(--vermilion)] pl-2.5">
                    {(review.error as { message?: string }).message ?? "批改失败"}
                  </p>
                )}
                <button onClick={() => { if (confirm("删除这篇作文？")) { remove.mutate({ id: e.id }); setOpenId(null); } }} className="text-[12px] font-bold text-[var(--vermilion)]/70 hover:text-[var(--vermilion)]">
                  删除此篇
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </PaperCard>
  );
}

function ReviewView({ review }: { review: Record<string, unknown> }) {
  const DIM_ZH: Record<string, string> = { content: "内容", organization: "结构", language: "语言", norms: "规范" };
  // dimensions 兼容数组（[{name,zh,score,max,comment}]）与旧对象两种形态
  const dimsRaw = review.dimensions;
  const dims: { key: string; zh: string; score?: number; max?: number; comment?: string }[] = Array.isArray(dimsRaw)
    ? (dimsRaw as { name?: string; zh?: string; score?: number; max?: number; comment?: string }[]).map((d) => ({
        key: String(d.name ?? ""), zh: String(d.zh ?? DIM_ZH[String(d.name ?? "")] ?? d.name ?? ""), score: d.score, max: d.max, comment: d.comment,
      }))
    : Object.entries((dimsRaw ?? {}) as Record<string, { score?: number; max?: number; comment?: string }>).map(([k, v]) => ({
        key: k, zh: DIM_ZH[k] ?? k, score: v?.score, max: v?.max, comment: v?.comment,
      }));
  const annotations = Array.isArray(review.annotations)
    ? (review.annotations as { para?: number; issue?: string; suggestion?: string }[])
    : [];
  return (
    <div className="book-frame p-5 space-y-4">
      <div className="flex items-baseline gap-3">
        <BrushTitle as="h3" vermilion className="text-[15px]">AI 批改</BrushTitle>
        {typeof review.score === "number" && (
          <span className="text-[24px] font-bold text-[var(--vermilion)]" style={{ fontFamily: "var(--font-zh)" }}>
            {review.score}
            <span className="text-[13px] ml-1">分{typeof review.maxScore === "number" ? ` / ${review.maxScore}` : ""}</span>
          </span>
        )}
        {typeof review.modelUsed === "string" && <span className="meta-label ml-auto">{String(review.modelUsed)}</span>}
      </div>
      {!!review.overall && <p className="text-[13.5px] leading-[1.9] text-[var(--ink-2)]">{String(review.overall)}</p>}
      {!!review.summary && !review.overall && <p className="text-[13.5px] leading-[1.9] text-[var(--ink-2)]">{String(review.summary)}</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        {dims.map((d) => (
          <div key={d.key} className="border border-[var(--line)] rounded-[2px] px-3.5 py-2.5">
            <p className="text-[12.5px] font-bold">
              {d.zh}
              {typeof d.score === "number" && (
                <b className="text-[var(--vermilion)] ml-2">{d.score}{typeof d.max === "number" ? <span className="text-[var(--ink-3)] font-normal">/{d.max}</span> : null}</b>
              )}
            </p>
            {!!d.comment && <p className="text-[12.5px] text-[var(--ink-2)] mt-1 leading-relaxed">{d.comment}</p>}
          </div>
        ))}
      </div>
      {annotations.length > 0 && (
        <div>
          <div className="meta-label mb-1.5">逐段批注</div>
          {annotations.map((a, i) => (
            <div key={i} className="flex gap-2.5 border-l-2 border-[var(--bamboo)]/60 pl-3 mb-2 text-[12.5px] leading-relaxed">
              {typeof a.para === "number" && <b className="shrink-0 text-[var(--ink-3)]">P{a.para}</b>}
              <div>
                {!!a.issue && <p className="text-[var(--ink-2)]">{a.issue}</p>}
                {!!a.suggestion && <p className="text-[var(--bamboo)] mt-0.5">{a.suggestion}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      {Array.isArray(review.highlights) && review.highlights.length > 0 && (
        <div>
          <div className="meta-label mb-1.5">亮点句</div>
          {(review.highlights as string[]).map((h, i) => (
            <p key={i} className="text-[12.5px] text-[var(--bamboo)] leading-relaxed font-bold">✦ <span className="font-normal text-[var(--ink-2)]">{h}</span></p>
          ))}
        </div>
      )}
      {Array.isArray(review.corrections) && review.corrections.length > 0 && (
        <div>
          <div className="meta-label mb-1.5">修改建议</div>
          {(review.corrections as { original?: string; suggestion?: string; reason?: string }[]).map((c, i) => (
            <div key={i} className="border-l-2 border-[var(--vermilion)]/50 pl-3 mb-2 text-[12.5px] leading-relaxed">
              {!!c.original && <p className="line-through text-[var(--vermilion)]/80">{c.original}</p>}
              {!!c.suggestion && <p className="text-[var(--bamboo)] font-bold">{c.suggestion}</p>}
              {!!c.reason && <p className="text-[var(--ink-3)]">{c.reason}</p>}
            </div>
          ))}
        </div>
      )}
      {!!review.modelParagraph && (
        <div>
          <div className="meta-label mb-1.5">最弱段高分示范改写</div>
          <p className="text-[13px] leading-[1.95] text-[var(--ink-2)] whitespace-pre-wrap bg-[var(--paper-deep)]/40 rounded-[2px] p-3" style={{ fontFamily: "var(--font-en), var(--font-zh)" }}>{String(review.modelParagraph)}</p>
        </div>
      )}
      {!!review.modelEssay && (
        <details className="group">
          <summary className="cursor-pointer text-[12.5px] font-bold text-[var(--ink-2)] hover:text-[var(--vermilion)] select-none">同题范文 · 点击展开</summary>
          <p className="mt-2 text-[13px] leading-[1.95] text-[var(--ink-2)] whitespace-pre-wrap bg-[var(--paper-deep)]/40 rounded-[2px] p-3" style={{ fontFamily: "var(--font-en), var(--font-zh)" }}>{String(review.modelEssay)}</p>
        </details>
      )}
    </div>
  );
}

function MaterialsCard() {
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.essay.materialList.useQuery();
  const save = trpc.essay.materialSave.useMutation({ onSuccess: () => void utils.essay.materialList.invalidate() });
  const remove = trpc.essay.materialRemove.useMutation({ onSuccess: () => void utils.essay.materialList.invalidate() });
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<keyof typeof MATERIAL_KIND_ZH>("note");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const submit = async () => {
    if (!title.trim() || !content.trim()) return;
    await save.mutateAsync({ kind, title: title.trim(), content: content.trim() });
    setTitle(""); setContent(""); setOpen(false);
  };

  return (
    <PaperCard className="p-6">
      <div className="flex items-center justify-between">
        <BrushTitle as="h2" className="text-[17px]">素材库</BrushTitle>
        <button onClick={() => setOpen(!open)} className="px-3 py-1 text-[12.5px] font-bold border border-[var(--line)] rounded-[2px] text-[var(--ink-2)] hover:border-[var(--ink-2)]">
          {open ? "收起" : "＋ 添素材"}
        </button>
      </div>
      {open && (
        <div className="border border-[var(--line)] rounded-[2px] p-4 mt-4 space-y-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            {(Object.keys(MATERIAL_KIND_ZH) as (keyof typeof MATERIAL_KIND_ZH)[]).map((k) => (
              <button key={k} onClick={() => setKind(k)} className={`px-2.5 py-1 text-[12px] border rounded-[2px] ${kind === k ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)] text-[var(--ink-2)]"}`}>{MATERIAL_KIND_ZH[k]}</button>
            ))}
          </div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题，如：邀请信开头万能句" className="w-full border border-[var(--line)] rounded-[2px] px-3 py-2 text-[13.5px] bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)]" />
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="内容……" className="w-full border border-[var(--line)] rounded-[2px] px-3 py-2 text-[13.5px] bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)]" />
          <button onClick={() => void submit()} disabled={save.isPending || !title.trim() || !content.trim()} className="px-4 py-1.5 text-[13px] font-bold bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow disabled:opacity-40">落墨</button>
        </div>
      )}
      {isLoading && <p className="mt-3 text-[13.5px] text-[var(--ink-3)]">载入中…</p>}
      {!isLoading && (rows ?? []).length === 0 && (
        <p className="mt-3 text-[13.5px] text-[var(--ink-3)]">攒点模板、句式、范文片段——开写时勾选「参考素材库」，AI 优先用你自己的料。</p>
      )}
      <div className="mt-4 divide-y divide-[var(--line)]">
        {(rows ?? []).map((m) => (
          <div key={m.id} className="py-2.5">
            <div className="flex items-center gap-2">
              <b className="px-1.5 py-0.5 bg-[var(--bamboo)]/15 text-[var(--bamboo)] text-[11.5px] rounded-[2px]">{MATERIAL_KIND_ZH[m.kind as keyof typeof MATERIAL_KIND_ZH] ?? m.kind}</b>
              <span className="font-bold text-[13.5px]">{m.title}</span>
              <span className="flex-1" />
              <button onClick={() => { if (confirm("删除这条素材？")) remove.mutate({ id: m.id }); }} className="text-[12px] font-bold text-[var(--vermilion)]/70 hover:text-[var(--vermilion)]">删</button>
            </div>
            <p className="text-[12.5px] text-[var(--ink-2)] mt-1 whitespace-pre-wrap line-clamp-3 leading-relaxed">{m.content}</p>
          </div>
        ))}
      </div>
    </PaperCard>
  );
}

export default function EssayPage() {
  useUser();
  return (
    <div>
      <InkReveal>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <BrushTitle as="h1" vermilion className="text-[34px]">作文工坊</BrushTitle>
            <p className="text-[14px] text-[var(--ink-3)] mt-2.5">
              两种写法：接力引导（逐段人机接力）/ 一气呵成（AI 全走、你留意见进化）。收稿后 AI 四维度批改。
              <span className="meta-label ml-2">ESSAY WORKSHOP</span>
            </p>
          </div>
          <Seal size={72} seed="essay" text="下笔有神" center="文" />
        </div>
      </InkReveal>
      <InkDivider className="mt-4" />
      <div className="mt-6 space-y-6">
        <NewDraftCard />
        <DraftsCard />
        <EssaysCard />
        <MaterialsCard />
      </div>
    </div>
  );
}
