import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { trpc } from "@/providers/trpc";
import { StepSeal } from "@/components/ink/Seal";
import { BrushTitle, InkReveal, PaperCard } from "@/components/ink/decor";
import { SOP_STEPS, type KnowledgeCardData } from "@contracts/types";

type KnowledgeCard = KnowledgeCardData;

const KIND_LABEL: Record<string, string> = {
  main: "主流程",
  sub: "题型子流程",
  logic: "逻辑关系",
  option: "选项特征",
};

function CardBody({ card }: { card: KnowledgeCard }) {
  return (
    <div className="space-y-4">
      {card.points.length > 0 && (
        <div>
          <div className="meta-label mb-2">KEY POINTS · 要点</div>
          <ul className="space-y-2">
            {card.points.map((p, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="text-[var(--vermilion)] font-bold shrink-0">◆</span>
                <div>
                  <div className="text-[16px] leading-relaxed">{p.zh}</div>
                  <div className="text-[13px] text-[var(--ink-3)] italic" style={{ fontFamily: "var(--font-en)" }}>
                    {p.en}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {card.cautions.length > 0 && (
        <div>
          <div className="meta-label mb-2">CAUTIONS · 注意事项</div>
          <ul className="space-y-2">
            {card.cautions.map((c, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="text-[#b98a2f] font-bold shrink-0">!</span>
                <div>
                  <div className="text-[15px] leading-relaxed text-[var(--ink-2)]">{c.zh}</div>
                  <div className="text-[13px] text-[var(--ink-3)] italic" style={{ fontFamily: "var(--font-en)" }}>
                    {c.en}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {card.vocab.length > 0 && (
        <div>
          <div className="meta-label mb-2">VOCABULARY · 术语英汉对照</div>
          <div className="flex flex-wrap gap-2">
            {card.vocab.map((v, i) => (
              <span
                key={i}
                className="px-2.5 py-1 border border-[var(--line)] rounded-[2px] text-[13px] bg-[var(--paper-deep)]/50"
              >
                <span style={{ fontFamily: "var(--font-en)" }} className="font-bold">
                  {v.en}
                </span>
                <span className="text-[var(--ink-3)] ml-1.5">{v.zh}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SopPage() {
  const { data: cards } = trpc.knowledge.list.useQuery();
  const [open, setOpen] = useState<string | null>(null);
  const { hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const id = hash.slice(1);
      setOpen(id);
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    }
  }, [hash]);

  const mainCards = SOP_STEPS.map((s) => ({
    step: s,
    card: cards?.find((c) => c.nodeId === s.id),
  }));
  const subCards = (cards ?? []).filter((c) => c.kind === "sub");
  const otherCards = (cards ?? []).filter((c) => c.kind === "logic" || c.kind === "option");

  return (
    <div className="max-w-[860px] mx-auto">
      <InkReveal className="text-center mb-12">
        <div className="meta-label mb-3">STANDARD OPERATING PROCEDURE</div>
        <h1 className="text-[36px] md:text-[44px] font-black">
          <BrushTitle vermilion>SOP 做题图谱</BrushTitle>
        </h1>
        <p className="text-[var(--ink-2)] mt-4 text-[16px]">
          六步主流程一以贯之，八种题型各有分支。点击节点展开知识卡。
        </p>
      </InkReveal>

      {/* 主流程卷轴 */}
      <div className="relative">
        {/* 墨线主脉 */}
        <svg className="absolute left-[27px] top-4 bottom-4" width="3" height="calc(100% - 32px)" aria-hidden="true">
          <line x1="1.5" y1="0" x2="1.5" y2="100%" stroke="var(--ink-2)" strokeWidth="1.5" />
        </svg>
        <div className="space-y-6">
          {mainCards.map(({ step, card }, i) => (
            <InkReveal key={step.id} delay={i * 90}>
              <div id={step.id} className="relative flex gap-5 scroll-mt-24">
                <div className="bg-[var(--paper)] py-1 relative z-10">
                  <StepSeal num={step.num} size={56} seed={`sop-${step.id}`} active={open === step.id} />
                </div>
                <PaperCard
                  frame={open === step.id}
                  className="flex-1 p-5"
                  onClick={() => setOpen(open === step.id ? null : step.id)}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div>
                      <span className="text-[20px] font-bold">{step.name}</span>
                      <span className="meta-label ml-3">{step.nameEn}</span>
                    </div>
                    <span className="text-[var(--ink-3)] text-[14px] shrink-0">{open === step.id ? "收起 ▲" : "展开 ▼"}</span>
                  </div>
                  {open === step.id && card && (
                    <div className="mt-5 pt-5 border-t border-[var(--line)]">
                      <CardBody card={card} />
                    </div>
                  )}
                </PaperCard>
              </div>
            </InkReveal>
          ))}
        </div>
      </div>

      {/* 题型子流程 */}
      <InkReveal delay={200} className="mt-16">
        <h2 className="text-[26px] font-bold mb-2 text-center">
          <BrushTitle>八大题型子流程</BrushTitle>
        </h2>
        <p className="text-center text-[14px] text-[var(--ink-3)] mb-8">第二步判题型后，进入对应分支</p>
        <div className="grid md:grid-cols-2 gap-4">
          {subCards.map((c) => (
            <PaperCard key={c.nodeId} id={c.nodeId} className="p-5 scroll-mt-24" onClick={() => setOpen(open === c.nodeId ? null : c.nodeId)}>
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="font-bold text-[17px]">{c.title}</span>
                  <span className="meta-label ml-2">{c.titleEn}</span>
                </div>
                <span className="text-[12px] text-[var(--ink-3)]">{KIND_LABEL[c.kind]}</span>
              </div>
              {open === c.nodeId && (
                <div className="mt-4 pt-4 border-t border-[var(--line)]">
                  <CardBody card={c} />
                </div>
              )}
            </PaperCard>
          ))}
        </div>
      </InkReveal>

      {/* 逻辑与选项 */}
      <InkReveal delay={300} className="mt-12">
        <div className="grid md:grid-cols-2 gap-4">
          {otherCards.map((c) => (
            <PaperCard key={c.nodeId} id={c.nodeId} frame className="p-5 scroll-mt-24" onClick={() => setOpen(open === c.nodeId ? null : c.nodeId)}>
              <div className="flex items-baseline justify-between">
                <span className="font-bold text-[17px]">{c.title}</span>
                <span className="text-[12px] text-[var(--ink-3)]">{KIND_LABEL[c.kind]}</span>
              </div>
              {open === c.nodeId ? (
                <div className="mt-4 pt-4 border-t border-[var(--line)]">
                  <CardBody card={c} />
                </div>
              ) : (
                <p className="text-[14px] text-[var(--ink-3)] mt-2">{c.points[0]?.zh}……</p>
              )}
            </PaperCard>
          ))}
        </div>
      </InkReveal>

      {/* 笔记条款库：驱动 AI 教练的知识引擎 */}
      <ClauseLibrary />
    </div>
  );
}

const DOMAIN_LABEL: Record<string, string> = {
  structure: "篇章结构",
  step: "做题六步",
  type: "八大题型",
  logic: "六大逻辑",
  option: "选项特征",
  sentence: "长难句",
};

function ClauseLibrary() {
  const { data: clauses } = trpc.method.clauses.useQuery(undefined, { staleTime: Infinity });
  const [domain, setDomain] = useState("structure");
  const [openId, setOpenId] = useState<string | null>(null);
  const list = (clauses ?? []).filter((c) => c.domain === domain);

  return (
    <InkReveal delay={350} className="mt-16">
      <h2 className="text-[26px] font-bold mb-2 text-center">
        <BrushTitle>笔记条款库 · 驱动 AI 教练的知识引擎</BrushTitle>
      </h2>
      <p className="text-center text-[14px] text-[var(--ink-3)] mb-6">
        你的《考研传统阅读》笔记已结构化为 {clauses?.length ?? "…"} 条方法条款，逐条注入审题官、定位官、解题官等 AI 角色
      </p>
      <div className="flex flex-wrap justify-center gap-2 mb-6">
        {Object.entries(DOMAIN_LABEL).map(([d, label]) => (
          <button
            key={d}
            onClick={() => { setDomain(d); setOpenId(null); }}
            className={`px-3.5 py-1.5 text-[14px] border rounded-[2px] ${domain === d ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)] text-[var(--ink-3)] hover:border-[var(--ink-2)]"}`}
          >
            {label}
            <span className="ml-1.5 text-[11px]">{(clauses ?? []).filter((c) => c.domain === d).length}</span>
          </button>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {list.map((c) => (
          <PaperCard key={c.clauseId} className="p-4" onClick={() => setOpenId(openId === c.clauseId ? null : c.clauseId)}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-bold text-[15px]">{c.title}</span>
              <span className="meta-label shrink-0">{c.clauseId}</span>
            </div>
            <p className={`text-[13.5px] text-[var(--ink-2)] leading-relaxed mt-1.5 ${openId === c.clauseId ? "" : "line-clamp-2"}`}>
              {c.content}
            </p>
          </PaperCard>
        ))}
      </div>
    </InkReveal>
  );
}
