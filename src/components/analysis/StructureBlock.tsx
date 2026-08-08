import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { StructureDiagram } from "./StructureDiagram";

interface Props {
  kind: "exam" | "generated";
  refId: number;
  structure: Record<string, unknown>;
}

type AssocType = "scene" | "vocab";
interface AssocLink { from: string; to: string; relation: string; zh?: string }

/** SOP 联想图（可选附加）：点才生，不点不生；结果按篇章缓存，二次打开秒回 */
function AssocImage({ kind, refId, type, title, purpose }: { kind: "exam" | "generated"; refId: number; type: AssocType; title: string; purpose: string }) {
  const [st, setSt] = useState<{ loading: boolean; image?: string | null; reason?: string; captionZh?: string; links?: AssocLink[] }>({ loading: false });
  const assocImage = trpc.method.assocImage.useMutation();

  const draw = async () => {
    setSt({ loading: true });
    try {
      const r = await assocImage.mutateAsync({ kind, refId, type });
      setSt({ loading: false, image: r.image, reason: r.reason, captionZh: r.captionZh, links: (r.links ?? []) as AssocLink[] });
    } catch (e) {
      setSt({ loading: false, image: null, reason: e instanceof Error ? e.message : "生成失败" });
    }
  };

  return (
    <div className="border border-[var(--line)] rounded-[2px] p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[14.5px] font-bold">{title}</div>
          <p className="text-[12.5px] text-[var(--ink-3)] mt-0.5 leading-relaxed">{purpose}</p>
        </div>
        {!st.image && !st.loading && (
          <button onClick={draw} className="shrink-0 px-4 py-2 border border-[var(--ink)] rounded-[2px] text-[13.5px] hover:bg-[var(--paper-deep)]">
            生成{type === "scene" ? "景象" : "连锁"}图
          </button>
        )}
      </div>
      {st.loading && (
        <p className="text-[13px] text-[var(--ink-3)] mt-3">
          教学设计师提炼元素与关系 → 画师成图中……（首次约 30–60 秒，之后按篇章缓存秒回；不影响其他学习操作）
        </p>
      )}
      {st.image && (
        <div className="mt-3">
          <img src={st.image} alt={title} className="w-full max-w-[560px] border border-[var(--line)] rounded-[2px]" />
          {st.captionZh && <p className="text-[13px] text-[var(--ink-2)] mt-2 leading-relaxed"><b>图读法：</b>{st.captionZh}</p>}
          {type === "vocab" && (st.links ?? []).length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="meta-label">连锁关系（文字版，与图互证）</div>
              {(st.links ?? []).map((l, i) => (
                <p key={i} className="text-[12.5px] text-[var(--ink-2)]">
                  <b style={{ fontFamily: "var(--font-en)" }}>{l.from}</b>
                  <span className="text-[var(--vermilion)] mx-1.5">—{l.relation}→</span>
                  <b style={{ fontFamily: "var(--font-en)" }}>{l.to}</b>
                  {l.zh && <span className="text-[var(--ink-3)] ml-2">{l.zh}</span>}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      {st.reason && !st.image && !st.loading && (
        <p className="text-[12.5px] text-[var(--ink-3)] mt-2">
          暂时没画成：{st.reason}
          <button onClick={draw} className="ml-2 px-2 py-0.5 border border-[var(--line)] rounded-[2px] text-[12px]">重试</button>
        </p>
      )}
    </div>
  );
}

/**
 * 全文行文结构分析块（真题/生成题通用）：
 * 文字结构 + 免费 SVG 结构速览图 + 可选 SOP 联想图（景象联想 / 词汇连锁，精确关系提示词）。
 */
export function StructureBlock({ kind, refId, structure }: Props) {
  const [open, setOpen] = useState(false);

  const paras = (structure.paragraphs as
    | { no: number; role: string; topic: string; keySentence?: string; keySentenceZh?: string; logic?: string }[]
    | undefined) ?? [];
  const readingTips = structure.readingTips ? String(structure.readingTips) : undefined;

  return (
    <div className="mt-8 pt-6 border-t border-[var(--line)]">
      <button onClick={() => setOpen(!open)} className="text-[15px] font-bold text-[var(--vermilion)]">
        {open ? "收起" : "查看"}全文行文结构分析 {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="mt-4 space-y-4 text-[15px]">
          <div className="rounded-[2px] border border-[var(--line)] bg-[var(--paper-deep)]/40 p-4 space-y-2">
            <p><b>篇章模式：</b>{String(structure.pattern ?? "")}</p>
            <p><b>全文主旨：</b>{String(structure.gist ?? "")}</p>
            <div>
              <div className="meta-label mb-1">论证推进路线</div>
              <p className="text-[14.5px] leading-[1.9] text-[var(--ink)]">{String(structure.logicFlow ?? "")}</p>
            </div>
            {readingTips && (
              <p className="text-[13.5px] font-bold text-[var(--bamboo)] border-t border-dashed border-[var(--line)] pt-2">
                考场读法：{readingTips}
              </p>
            )}
          </div>
          <div className="space-y-3">
            {paras.map((p) => (
              <div key={p.no} className="border-l-2 border-[var(--vermilion)] pl-3 space-y-1">
                <p><b>第{p.no}段</b> · {p.role}</p>
                <p className="text-[14px] text-[var(--ink-2)]">{p.topic}</p>
                {p.logic && <p className="text-[13px] text-[var(--bamboo)]">↳ 段间衔接：{p.logic}</p>}
                {p.keySentence && (
                  <div className="border-l border-[var(--line)] pl-2 mt-1">
                    <p className="text-[13px] italic leading-relaxed" style={{ fontFamily: "var(--font-en)" }}>{p.keySentence}</p>
                    {p.keySentenceZh && <p className="text-[12.5px] text-[var(--ink-3)] mt-0.5">{p.keySentenceZh}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 结构图：SVG 速览（免费即时） + 可选 SOP 联想图（AI 绘图，点才生，按篇章缓存） */}
          <div className="mt-5 pt-4 border-t border-[var(--line)] space-y-4">
            <StructureDiagram
              pattern={structure.pattern ? String(structure.pattern) : undefined}
              paragraphs={paras}
            />
            <div>
              <div className="meta-label mb-2">联想图 · 可选附加（SOP 助记，不影响解析）</div>
              <div className="space-y-3">
                <AssocImage
                  kind={kind}
                  refId={refId}
                  type="scene"
                  title="全文景象联想图"
                  purpose="把全文局面浓缩成一个具象场景——读完文章闭上眼能想起这幅画面，主旨与立场就忘不了。"
                />
                <AssocImage
                  kind={kind}
                  refId={refId}
                  type="vocab"
                  title="核心词汇连锁图"
                  purpose="把串联主旨的关键词画成带因果/对比/例证标签的关系网——词汇不再孤立，而是按原文论证链连锁记忆。"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
