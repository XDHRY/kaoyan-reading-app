import { Link } from "react-router";
import {
  QTYPE_ZH,
  sopAnchor,
  type ClauseRow,
  type Crosscheck,
  type LocateItem,
  type QAItem,
  type SolveItem,
} from "@/lib/analysisTypes";
import { DiffAnalysisBlock } from "./DiffAnalysisBlock";

interface Props {
  qNo: number;
  qAnalysis: QAItem[];
  locateResult: LocateItem[];
  solvedItem: SolveItem;
  crosscheck: Crosscheck | null;
  clauseMap: Map<string, ClauseRow>;
  /** 官方答案（真题有；与 AI 不一致时判分以官方为准） */
  officialAnswer?: string;
  /** 用户作答 */
  myAnswer?: string;
  /** 真题 or 仿真题（差异分析定位用） */
  kind?: "exam" | "generated";
  refId?: number;
}

/** 阶段标签：墨色小印 */
function StageSeal({ no, zh, en }: { no: string; zh: string; en: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-2">
      <span className="inline-flex items-center justify-center w-5 h-5 text-[11px] font-bold text-[var(--paper)] bg-[var(--ink)] rounded-[2px] print-shadow">{no}</span>
      <span className="font-bold text-[14px] tracking-wide">{zh}</span>
      <span className="meta-label">{en}</span>
    </div>
  );
}

/** 原文引文块：朱丝栏 */
function QuoteBlock({ en, zh }: { en?: string; zh?: string }) {
  if (!en) return null;
  return (
    <div className="border-l-2 border-[var(--vermilion)] pl-3 py-0.5 my-1.5">
      <p className="text-[13.5px] italic leading-relaxed" style={{ fontFamily: "var(--font-en)" }}>{en}</p>
      {zh && <p className="text-[13px] text-[var(--ink-3)] mt-0.5 leading-relaxed">{zh}</p>}
    </div>
  );
}

/** 教练提示条 */
function CoachNote({ label, text, tone = "ink" }: { label: string; text?: string; tone?: "ink" | "bamboo" | "vermilion" }) {
  if (!text) return null;
  const color = tone === "bamboo" ? "text-[var(--bamboo)]" : tone === "vermilion" ? "text-[var(--vermilion)]" : "text-[var(--ink-2)]";
  return (
    <p className="text-[13px] leading-relaxed">
      <b className={`${color} mr-1`}>{label}</b>
      <span className="text-[var(--ink-2)]">{text}</span>
    </p>
  );
}

/** 单题完整解析（真题/生成题通用）：审题 3Q → 定位 → 解题 → 方法应用卡 → 交叉验证旗标 */
const isChoice = (v: unknown): v is "A" | "B" | "C" | "D" => v === "A" || v === "B" || v === "C" || v === "D";

export function QuestionAnalysisBlock({ qNo, qAnalysis, locateResult, solvedItem, crosscheck, clauseMap, officialAnswer, myAnswer, kind, refId }: Props) {
  const qa = qAnalysis.find((x) => x.qNo === qNo);
  const lc = locateResult.find((x) => x.qNo === qNo);
  const flag = crosscheck && !crosscheck.skipped ? crosscheck.items.find((x) => x.qNo === qNo) : undefined;
  const diverge = !!officialAnswer && officialAnswer !== solvedItem.answer;
  const showDiff = diverge && !!kind && refId != null;

  return (
    <div className="mt-4 pt-4 border-t border-[var(--line)] space-y-5 text-[14.5px]">
      {/* 阶段一：审题 3Q */}
      {qa && (
        <section>
          <StageSeal no="壹" zh="审题 3Q" en="READ THE STEM" />
          <div className="rounded-[2px] border border-[var(--line)] bg-[var(--paper-deep)]/40 p-3 space-y-1.5">
            <p>
              题型：<b className="text-[var(--vermilion)]">{qa.qTypeZh ?? QTYPE_ZH[qa.qType ?? ""] ?? qa.qType}</b>
              {qa.marker && <span className="text-[13px] text-[var(--ink-3)]">（标志词：<i style={{ fontFamily: "var(--font-en)" }}>{qa.marker}</i>）</span>}
            </p>
            <p>题干翻译：<span className="text-[var(--ink-2)]">{qa.stemZh}</span></p>
            {qa.locators && qa.locators.length > 0 && (
              <p>定位词：<b>{qa.locators.join(" / ")}</b></p>
            )}
            {qa.reasoning && <CoachNote label="判定思路" text={qa.reasoning} />}
            {qa.scopeGuide && <CoachNote label="解题范围" text={qa.scopeGuide} tone="bamboo" />}
            {qa.pitfall && <CoachNote label="避坑提醒" text={qa.pitfall} tone="vermilion" />}
          </div>
        </section>
      )}

      {/* 阶段二：定位 */}
      {lc && (
        <section>
          <StageSeal no="贰" zh="定位原文" en="LOCATE" />
          <div className="rounded-[2px] border border-[var(--line)] bg-[var(--paper-deep)]/40 p-3 space-y-1.5">
            <p>
              {lc.paraNos && lc.paraNos.length > 1 ? (
                <>跨段定位：第 <b>{lc.paraNos.join("、")}</b> 段{lc.scope?.includes("全篇") && <span className="text-[var(--vermilion)] font-bold">（全篇）</span>}</>
              ) : (
                <>第 <b>{lc.paraNos?.[0] ?? lc.paraNo}</b> 段</>
              )}
              {lc.scope && <span className="text-[var(--ink-2)]"> · {lc.scope}</span>}
            </p>
            <QuoteBlock en={lc.sentence} zh={lc.sentenceZh} />
            {lc.matchedTerms && lc.matchedTerms.length > 0 && (
              <div className="text-[13px] space-y-0.5 border-l-2 border-[var(--bamboo)] pl-2">
                <span className="meta-label">逐词对应铁证</span>
                {lc.matchedTerms.map((m, i) => (
                  <p key={i} className="text-[var(--ink-2)]">
                    题干 <b style={{ fontFamily: "var(--font-en)" }}>{m.stem}</b>
                    <span className="text-[var(--vermilion)] mx-1">⇄</span>
                    原文 <b style={{ fontFamily: "var(--font-en)" }}>{m.text}</b>
                  </p>
                ))}
              </div>
            )}
            {lc.rewriteForm && <CoachNote label="改写对照" text={lc.rewriteForm} tone="bamboo" />}
            {lc.howFound && <CoachNote label="定位思路" text={lc.howFound} />}
          </div>
        </section>
      )}

      {/* 阶段三：解题 */}
      <section>
        <StageSeal no="叁" zh="解题定夺" en="SOLVE" />
        <div className="rounded-[2px] border border-[var(--line)] bg-[var(--paper-deep)]/40 p-3 space-y-3">
          <p className="text-[15px]">
            {officialAnswer ? (
              <>
                官方答案 <b className="text-[var(--bamboo)] text-[20px] mx-1">{officialAnswer}</b>
                <span className={`text-[13px] ml-1 ${diverge ? "text-[var(--ink-3)] line-through" : "text-[var(--ink-3)]"}`}>
                  AI 参考 {solvedItem.answer}{!diverge && " · 与官方一致 ✓"}
                </span>
              </>
            ) : (
              <>
                答案 <b className="text-[var(--vermilion)] text-[20px] mx-1">{solvedItem.answer}</b>
                {solvedItem.answerFeature && <span className="text-[13px] text-[var(--bamboo)] font-bold">〔{solvedItem.answerFeature}〕</span>}
              </>
            )}
            {solvedItem.answerZh && <span className="text-[var(--ink-2)]"> {solvedItem.answerZh}</span>}
            {myAnswer && (
              <span className={`ml-2 text-[13px] font-bold ${myAnswer === (officialAnswer ?? solvedItem.answer) ? "text-[var(--bamboo)]" : "text-[var(--vermilion)]"}`}>
                你选 {myAnswer}{myAnswer === (officialAnswer ?? solvedItem.answer) ? " ✓" : " ✗"}
              </span>
            )}
          </p>
          {diverge && (
            <p className="rounded-[2px] border border-[var(--vermilion)]/40 bg-[var(--vermilion)]/5 px-3 py-2 text-[13px] leading-relaxed">
              ⚖ AI 参考 <b>{solvedItem.answer}</b> 与官方答案 <b className="text-[var(--bamboo)]">{officialAnswer}</b> 不一致——判分以官方答案为准。下方「差异分析」深挖命题逻辑。
            </p>
          )}

          {/* 名师逻辑链：复述 → 逻辑（v5.8，旧解析无此字段自动隐藏） */}
          {(solvedItem.locateParaphrase || solvedItem.logicChain) && (
            <div className="rounded-[2px] border-l-2 border-[var(--vermilion)] bg-[var(--paper)] pl-3 py-2 space-y-1">
              {solvedItem.locateParaphrase && (
                <p className="text-[13.5px] leading-relaxed"><b className="text-[var(--vermilion)]">① 这句在说啥：</b>{solvedItem.locateParaphrase}</p>
              )}
              {solvedItem.logicChain && (
                <p className="text-[13.5px] leading-relaxed"><b className="text-[var(--vermilion)]">② 逻辑链：</b>{solvedItem.logicChain}</p>
              )}
            </div>
          )}

          {/* 证据映射 */}
          {(solvedItem.evidence || solvedItem.evidenceMap) && (
            <div>
              <div className="meta-label mb-1">原文证据</div>
              <QuoteBlock en={solvedItem.evidence} zh={solvedItem.evidenceZh} />
              {solvedItem.evidenceMap && <CoachNote label="证据对应" text={solvedItem.evidenceMap} tone="bamboo" />}
            </div>
          )}

          {/* 逐项断案 */}
          {solvedItem.options && (
            <div>
              <div className="meta-label mb-1.5">逐项断案</div>
              <div className="space-y-2">
                {solvedItem.options.map((o) => (
                  <div key={o.label} className={`rounded-[2px] border-l-2 pl-2.5 py-1 ${o.verdict === "对" ? "border-[var(--bamboo)] bg-[var(--bamboo)]/5" : "border-[var(--line)]"}`}>
                    <p className="text-[13.5px] leading-relaxed">
                      <b className={o.verdict === "对" ? "text-[var(--bamboo)]" : "text-[var(--ink-3)]"}>[{o.label}]{o.verdict === "对" ? " ✓" : " ✗"}</b>
                      {o.flawType && <span className="text-[var(--vermilion)] font-bold">〔{o.flawType}〕</span>}{" "}
                      <span className="text-[var(--ink-2)]">{o.analysis}</span>
                    </p>
                    {o.trap && <p className="text-[12.5px] text-[var(--ink-3)] mt-0.5">⌦ 陷阱手法：{o.trap}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 完整思路 */}
          {solvedItem.reasoning && (
            <div>
              <div className="meta-label mb-1">完整思路</div>
              <p className="text-[14px] text-[var(--ink)] leading-[1.9] bg-[var(--paper)] rounded-[2px] border border-[var(--line)] p-3">
                {solvedItem.reasoning}
              </p>
            </div>
          )}

          {/* 本题复盘（v5 新增字段，旧解析无此字段自动隐藏） */}
          {solvedItem.reflection && (
            <p className="text-[13.5px] leading-relaxed text-[var(--ink-2)] border-t border-dashed border-[var(--line)] pt-2">
              <b className="text-[var(--bamboo)]">本题复盘：</b>{solvedItem.reflection}
            </p>
          )}

          {/* 解题口诀 */}
          {solvedItem.takeaway && (
            <p className="text-[13.5px] font-bold text-[var(--vermilion)] border-t border-dashed border-[var(--line)] pt-2">
              口诀带走：{solvedItem.takeaway}
            </p>
          )}
        </div>

        {/* 交叉验证：第二模型陪审团旗标 */}
        {flag && (
          <div
            className={`mt-3 rounded-[2px] border px-3 py-2 text-[13px] leading-relaxed ${
              flag.agree
                ? "border-[var(--bamboo)]/50 bg-[var(--bamboo)]/5 text-[var(--ink-2)]"
                : "border-[var(--vermilion)]/60 bg-[var(--vermilion)]/5"
            }`}
          >
            {flag.agree ? (
              <span>⚑ 交叉验证：第二模型独立解题同为 <b>{flag.crossAnswer}</b>{flag.why && <> — {flag.why}</>}，结论互证。</span>
            ) : (
              <span>
                ⚑ <b className="text-[var(--vermilion)]">交叉验证分歧</b>：第二模型独立解题选 <b className="text-[var(--vermilion)]">{flag.crossAnswer}</b>
                {flag.why && <> — {flag.why}</>}
                <span className="block mt-1 text-[var(--ink-3)]">请以定位证据原文为准，对照两路推理自行裁断。</span>
              </span>
            )}
          </div>
        )}
        {crosscheck?.skipped && (
          <p className="mt-3 text-[12px] text-[var(--ink-3)]">⚑ 交叉验证本次跳过（{crosscheck.reason}）</p>
        )}

        {/* 模块A：AI 与官方差异分析 */}
        {showDiff && isChoice(solvedItem.answer) && isChoice(officialAnswer) && (
          <DiffAnalysisBlock kind={kind!} refId={refId!} qNo={qNo} aiAnswer={solvedItem.answer} officialAnswer={officialAnswer} aiReasoning={solvedItem.reasoning} />
        )}

        {/* 方法应用卡 */}
        {solvedItem.methodRefs && solvedItem.methodRefs.length > 0 && (
          <div className="mt-3 pt-3 border-t border-dashed border-[var(--line)]">
            <div className="meta-label mb-2">方法应用 · 来自你的笔记</div>
            <div className="space-y-2">
              {solvedItem.methodRefs.map((m, mi) => {
                const clause = clauseMap.get(m.clauseId);
                return (
                  <details key={mi} className="group border-l-2 border-[var(--bamboo)] pl-3">
                    <summary className="cursor-pointer text-[13.5px] list-none">
                      <b className="text-[var(--bamboo)]">{m.title || clause?.title || m.clauseId}</b>
                      <span className="text-[var(--ink-2)]"> — {m.applied}</span>
                      <span className="text-[11px] text-[var(--ink-3)] ml-2 group-open:hidden">展开笔记原文 ▾</span>
                    </summary>
                    {clause && (
                      <div className="mt-1.5 text-[12.5px] text-[var(--ink-3)] leading-relaxed bg-[var(--paper-deep)]/50 rounded-[2px] p-2">
                        《考研传统阅读》笔记 · {clause.title}：{clause.content}
                        <Link to={sopAnchor(clause)} className="block mt-1 text-[var(--vermilion)] font-bold">→ 到 SOP 图谱复习此法</Link>
                      </div>
                    )}
                  </details>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
