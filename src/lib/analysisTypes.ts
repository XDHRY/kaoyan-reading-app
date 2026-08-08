/** 解析流水线共享类型（真题 / AI 生成题通用） */

export interface ClauseRow {
  clauseId: string;
  domain: string;
  refKey: string;
  title: string;
  content: string;
}

export interface MethodRef {
  clauseId: string;
  title: string;
  applied: string;
}

export type QAItem = {
  qNo: number;
  qType?: string;
  qTypeZh?: string;
  marker?: string;
  stemZh?: string;
  locators?: string[];
  reasoning?: string;
  scopeGuide?: string;
  pitfall?: string;
};

export type LocateItem = {
  qNo: number;
  paraNo?: number | string;
  /** v5.8：跨段定位段号数组；主旨题为全篇段号 */
  paraNos?: number[];
  sentence?: string;
  sentenceZh?: string;
  /** v5.8：题干定位词与原文对应词的逐对铁证 */
  matchedTerms?: { stem: string; text: string }[];
  scope?: string;
  rewriteForm?: string;
  howFound?: string;
};

export type SolveItem = {
  qNo: number;
  answer: string;
  answerFeature?: string;
  answerZh?: string;
  /** v5.8：定位句中文复述（名师逻辑链第一步） */
  locateParaphrase?: string;
  /** v5.8：定位句→答案的逻辑链 */
  logicChain?: string;
  evidence?: string;
  evidenceZh?: string;
  evidenceMap?: string;
  reasoning?: string;
  takeaway?: string;
  /** v5：80 字内本题复盘（旧解析可能缺省） */
  reflection?: string;
  methodRefs?: MethodRef[];
  options?: { label: string; verdict: string; flawType?: string; analysis: string; trap?: string }[];
};

export type CrosscheckItem = {
  qNo: number;
  crossAnswer: string;
  why: string;
  agree: boolean | null;
};

export type Crosscheck =
  | { items: CrosscheckItem[]; model: string; disagree: number; skipped?: never; reason?: never }
  | { skipped: true; reason: string; items?: never; model?: never; disagree?: never };

export const QTYPE_ZH: Record<string, string> = {
  example: "例证题", attitude: "态度题", vocab: "语义题", cause: "因果题",
  viewpoint: "观点题", detail: "细节题", infer: "推断题", main: "主旨题", unknown: "待判定",
};

/** 条款 → SOP 页锚点 */
export function sopAnchor(c?: ClauseRow): string {
  if (!c) return "/sop";
  if (c.domain === "step" && /^S[1-6]$/.test(c.refKey)) return `/sop#${c.refKey}`;
  if (c.domain === "type") return `/sop#T-${c.refKey}`;
  if (c.domain === "logic") return "/sop#L-logic";
  if (c.domain === "option") return "/sop#O-options";
  return "/sop";
}

/** 任务产物 → 页面状态 */
export interface PipelineResult {
  structure: Record<string, unknown> | null;
  qAnalysis: QAItem[];
  locateResult: LocateItem[];
  solved: SolveItem[];
  review: Record<string, unknown> | null;
  crosscheck: Crosscheck | null;
  trace: { stage: string; ok: boolean; note: string }[];
  verdicts: Record<string, boolean>;
  modelsUsed: string[];
}

export function resultFromPayload(payload: Record<string, unknown>): PipelineResult {
  const models: string[] = [];
  if (payload.modelStructure) models.push(`结构:${payload.modelStructure}`);
  if (payload.modelQuestion) models.push(`审题:${payload.modelQuestion}`);
  if (payload.modelLocate) models.push(`定位:${payload.modelLocate}`);
  if (payload.modelSolve) models.push(`解题:${payload.modelSolve}`);
  const cc = payload.crosscheck as (Crosscheck & { model?: string }) | undefined;
  if (cc && !cc.skipped && cc.model) models.push(`交叉:${cc.model}`);
  return {
    structure: (payload.structure as Record<string, unknown>) ?? null,
    qAnalysis: (payload.qAnalysis as QAItem[]) ?? [],
    locateResult: (payload.locate as LocateItem[]) ?? [],
    solved: (payload.solved as SolveItem[]) ?? [],
    review: (payload.review as Record<string, unknown>) ?? null,
    crosscheck: (payload.crosscheck as Crosscheck) ?? null,
    trace: (payload.trace as { stage: string; ok: boolean; note: string }[]) ?? [],
    verdicts: (payload.verdicts as Record<string, boolean>) ?? {},
    modelsUsed: models,
  };
}
