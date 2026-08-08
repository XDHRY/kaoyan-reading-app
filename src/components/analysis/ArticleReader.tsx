import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { trpc } from "@/providers/trpc";
import { PaperCard } from "@/components/ink/decor";
import { ClickableText } from "@/components/ClickableText";
import { useUser } from "@/hooks/useUser";
import { splitSentences } from "@/lib/sentences";

interface VocabPop {
  word: string;
  x: number;
  y: number;
  loading: boolean;
  zh?: string;
  contextZh?: string;
  error?: string;
}

export interface SentPopData {
  segments?: { text: string; role: string; zh: string }[];
  skeleton?: string;
  skeletonZh?: string;
  fullZh?: string;
  grammar?: { point: string; explain: string }[];
  steps?: string[];
  /** 意群串联：按英文原序顺读，每步只加一个意群并说明与上文关系 */
  flow?: string[];
}

interface SentPop {
  paraNo: number;
  sentIdx: number;
  sentence: string;
  loading: boolean;
  data?: SentPopData;
  error?: string;
}

interface Props {
  paragraphs: string[];
  kind: "exam" | "generated";
  refId: number;
  /** 真题传 passageId 以便词条回溯出处；生成题省略 */
  vocabPassageId?: number;
  headerLabel?: string;
  /** 追加在文章之后的块（如结构分析） */
  children?: ReactNode;
}

/** 文章阅读器：标段 + 点词查词 + 长难句三步拆解（真题/生成题通用） */
export function ArticleReader({ paragraphs, kind, refId, vocabPassageId, headerLabel, children }: Props) {
  const { user } = useUser();
  const [sentMode, setSentMode] = useState(false);
  const [pop, setPop] = useState<VocabPop | null>(null);
  const [sentPop, setSentPop] = useState<SentPop | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);

  const lookup = trpc.vocab.lookup.useMutation();
  const parseSentence = trpc.method.parseSentence.useMutation();

  const { data: vocabRows, refetch: refetchVocab } = trpc.vocab.list.useQuery(undefined, { enabled: !!user });
  const inBook = useMemo(
    () => new Set(((vocabRows ?? []) as { word: string }[]).map((v) => v.word)),
    [vocabRows],
  );

  const popElRef = useRef<HTMLDivElement>(null);
  const wordSeqRef = useRef(0);
  const sentSeqRef = useRef(0);

  const onSentenceClick = async (paraNo: number, sentIdx: number, sentence: string) => {
    const seq = ++sentSeqRef.current;
    setSentPop({ paraNo, sentIdx, sentence, loading: true });
    try {
      const r = await parseSentence.mutateAsync({ kind, refId, paraNo, sentIdx, sentence });
      if (seq !== sentSeqRef.current) return; // 竞态守卫：只认最后一次点击
      setSentPop({ paraNo, sentIdx, sentence, loading: false, data: r.analysis as SentPopData });
    } catch (e) {
      if (seq !== sentSeqRef.current) return;
      setSentPop({ paraNo, sentIdx, sentence, loading: false, error: e instanceof Error ? e.message : "拆解失败" });
    }
  };

  async function onWordClick(word: string, e: React.MouseEvent) {
    if (!user || !articleRef.current) return;
    const seq = ++wordSeqRef.current;
    const rect = articleRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top + 14;
    setPop({ word, x, y, loading: true });
    try {
      const r = await lookup.mutateAsync({ word, passageId: vocabPassageId });
      if (seq !== wordSeqRef.current) return; // 竞态守卫
      const ctx = (r.item?.context ?? "") as string;
      const ctxZh = ctx.includes("\n译：") ? ctx.split("\n译：")[1] : "";
      setPop({ word, x, y, loading: false, zh: r.item?.zh ?? "", contextZh: ctxZh });
      refetchVocab();
    } catch (err) {
      if (seq !== wordSeqRef.current) return;
      setPop({ word, x, y, loading: false, error: err instanceof Error ? err.message : "查词失败" });
    }
  }

  // 气泡钳制：挂载后实测尺寸，左右不越界、触底则上翻
  useEffect(() => {
    const el = popElRef.current;
    const host = articleRef.current;
    if (!pop || !el || !host) return;
    const hostRect = host.getBoundingClientRect();
    const bw = el.offsetWidth;
    const bh = el.offsetHeight;
    let x = Math.max(4, Math.min(pop.x, hostRect.width - bw - 4));
    let y = pop.y;
    if (y + bh > hostRect.height - 4) {
      y = Math.max(4, pop.y - bh - 28); // 上翻到点击位置上方
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [pop]);

  return (
    <div className="relative h-fit" ref={articleRef}>
      <PaperCard className="p-6 md:p-8 h-fit">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
          <div className="meta-label">
            {headerLabel ?? "PASSAGE · 全文"}（已标段{sentMode ? " · 点句子原地拆解 · 再点收起" : " · 点单词查词"}）
          </div>
          <button
            onClick={() => { setSentMode(!sentMode); setPop(null); }}
            className={`text-[12.5px] px-2.5 py-1 border rounded-[2px] ${sentMode ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)] text-[var(--ink-3)] hover:border-[var(--ink-2)]"}`}
          >
            {sentMode ? "✓ 长难句模式" : "长难句模式"}
          </button>
        </div>
        <div className="reading-en" onClick={() => pop && setPop(null)}>
          {paragraphs.map((p, i) => (
            <p key={i}>
              <span className="para-no">[{i + 1}]</span>
              {sentMode ? (
                <>
                  {splitSentences(p).map((s, si) => (
                    <span key={si}>
                      <span
                        className={`cursor-pointer rounded-[2px] transition-colors ${
                          sentPop && sentPop.paraNo === i + 1 && sentPop.sentIdx === si
                            ? "bg-[var(--vermilion)]/15 text-[var(--vermilion)]"
                            : "hover:bg-[var(--vermilion)]/10 hover:text-[var(--vermilion)]"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          // 再点同一句 = 收起；点别的句 = 就地切换
                          if (sentPop && sentPop.paraNo === i + 1 && sentPop.sentIdx === si) setSentPop(null);
                          else void onSentenceClick(i + 1, si, s);
                        }}
                      >
                        {s}{" "}
                      </span>
                      {/* 长难句拆解面板：原位内联展开，跟随被点句子，不弹层、不跳转 */}
                      {sentPop && sentPop.paraNo === i + 1 && sentPop.sentIdx === si && (
                        <span
                          className="block my-3 rounded-[2px] border-2 border-[var(--ink)] bg-[var(--paper)] shadow-[4px_4px_0_rgba(16,16,16,0.85)] p-4 md:p-5 cursor-default"
                          style={{ fontFamily: "var(--font-zh, inherit)" }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="flex items-start justify-between gap-4 mb-3">
                            <span className="min-w-0">
                              <span className="meta-label mb-1 block">长难句三步拆解 · 第{sentPop.paraNo}段第{sentPop.sentIdx + 1}句</span>
                              <span className="block text-[14px] italic leading-relaxed" style={{ fontFamily: "var(--font-en)" }}>{sentPop.sentence}</span>
                            </span>
                            <button onClick={() => setSentPop(null)} className="text-[20px] leading-none px-1 shrink-0" title="收起">×</button>
                          </span>
                          {sentPop.loading && <span className="block text-[13.5px] text-[var(--ink-3)]">教练拆句中……（标点断开 → 复合句断开 → 主干/修饰断开）</span>}
                          {sentPop.error && (
                            <span className="block text-[13.5px] text-[var(--vermilion)]">
                              {sentPop.error}
                              <button
                                className="ml-3 px-2.5 py-0.5 border border-[var(--vermilion)] rounded-[2px] text-[12.5px] font-bold"
                                onClick={() => void onSentenceClick(sentPop.paraNo, sentPop.sentIdx, sentPop.sentence)}
                              >
                                重试
                              </button>
                            </span>
                          )}
                          {sentPop.data && (
                            <span className="block space-y-4 text-[14px]">
                              {sentPop.data.steps && (
                                <span className="block">
                                  <span className="meta-label mb-1.5 block">三步拆解过程</span>
                                  <ol className="space-y-1 list-decimal list-inside text-[var(--ink-2)]">
                                    {sentPop.data.steps.map((st, j) => <li key={j}>{st}</li>)}
                                  </ol>
                                </span>
                              )}
                              {sentPop.data.flow && sentPop.data.flow.length > 0 && (
                                <span className="block rounded-[2px] border-l-[3px] border-[var(--vermilion)] bg-[var(--vermilion)]/5 p-3">
                                  <span className="meta-label mb-1.5 block !text-[var(--vermilion)]">意群串联 · 考场顺读法</span>
                                  <ol className="space-y-1 list-decimal list-inside text-[var(--ink-2)]">
                                    {sentPop.data.flow.map((f, j) => <li key={j}>{f}</li>)}
                                  </ol>
                                </span>
                              )}
                              {sentPop.data.segments && (
                                <span className="block">
                                  <span className="meta-label mb-1.5 block">片段切分</span>
                                  <span className="block space-y-1.5">
                                    {sentPop.data.segments.map((seg, j) => (
                                      <span key={j} className="flex gap-2 items-baseline border-l-2 border-[var(--line)] pl-2">
                                        <span className={`shrink-0 text-[11px] px-1.5 py-0.5 rounded-[2px] ${seg.role === "主干" ? "bg-[var(--vermilion)] text-[var(--paper)]" : "bg-[var(--paper-deep)] text-[var(--ink-3)]"}`}>{seg.role}</span>
                                        <span>
                                          <span style={{ fontFamily: "var(--font-en)" }}>{seg.text}</span>
                                          <span className="text-[var(--ink-3)] text-[13px] block">{seg.zh}</span>
                                        </span>
                                      </span>
                                    ))}
                                  </span>
                                </span>
                              )}
                              {sentPop.data.skeleton && (
                                <span className="block bg-[var(--paper-deep)]/60 rounded-[2px] p-3">
                                  <span className="meta-label mb-1 block">句子主干</span>
                                  <span className="block" style={{ fontFamily: "var(--font-en)" }}><b>{sentPop.data.skeleton}</b></span>
                                  <span className="block text-[var(--vermilion)] font-bold mt-1">{sentPop.data.skeletonZh}</span>
                                </span>
                              )}
                              {sentPop.data.fullZh && <span className="block"><b>全句通译：</b>{sentPop.data.fullZh}</span>}
                              {sentPop.data.grammar && sentPop.data.grammar.length > 0 && (
                                <span className="block">
                                  <span className="meta-label mb-1.5 block">语法点</span>
                                  {sentPop.data.grammar.map((g, j) => (
                                    <span key={j} className="block text-[13.5px] text-[var(--ink-2)]"><b>{g.point}</b>：{g.explain}</span>
                                  ))}
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  ))}
                </>
              ) : (
                <ClickableText text={p} inBook={inBook} onWord={onWordClick} />
              )}
            </p>
          ))}
        </div>
        {children}
        {/* 查词气泡（位置由钳制 effect 实测修正） */}
        {pop && (
          <div className="vocab-pop" ref={popElRef} style={{ left: pop.x, top: pop.y }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-baseline justify-between">
              <span className="pop-word">{pop.word}</span>
              <button className="text-[16px] px-1" onClick={() => setPop(null)}>×</button>
            </div>
            {pop.loading && <p className="text-[13px] text-[var(--ink-3)] mt-2">查阅中…</p>}
            {pop.error && <p className="text-[13px] text-[var(--vermilion)] mt-2">{pop.error}</p>}
            {!pop.loading && !pop.error && (
              <>
                <p className="text-[15px] mt-2 text-[var(--vermilion)] font-bold">{pop.zh}</p>
                {pop.contextZh && <p className="text-[12.5px] text-[var(--ink-3)] mt-2 leading-relaxed">{pop.contextZh}</p>}
                <p className="text-[12px] text-[var(--bamboo)] mt-2">✓ 已自动收入生词本</p>
              </>
            )}
          </div>
        )}
      </PaperCard>
    </div>
  );
}
