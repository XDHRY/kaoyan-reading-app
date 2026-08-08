import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, privateQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { analyses, interactiveRecords } from "@db/schema";
import { loadContent } from "./lib/agentCore";
import { ERROR_TYPES } from "@contracts/constants";

/**
 * 参与式解题（跟我练）：学生走进六步解题的每一步，AI 参照逐步揭示。
 *
 * 设计决策：
 * - **零额外 LLM 成本**：参照物全部来自已落库的流水线分析产物（analyses.payload），
 *   没有分析的内容先引导去跑一次常规交卷解析（边界提示，不硬挡）；
 * - **不剧透**：每步只返回该步所需的最小参照（审题步不给定位句，定位步不给答案）；
 * - 四步闭环：审题(判题型)→定位(选段落)→解题(选答案)→复盘(写一句+对照反思)；
 * - 会话状态全在前端（localStorage），后端只管"取参照"和"存成果"——
 *   断网/刷新/换题都不丢服务端状态，也不产生半成品数据。
 */

type QAnalysis = { qNo: number; qType?: string; focus?: string; translation?: string; testPoint?: string };
type LocateItem = { qNo: number; paraNo?: number; evidence?: string; evidenceZh?: string; locateLogic?: string };
type SolveItem = { qNo: number; answer?: string; reflection?: string; takeaway?: string };

function payloadOf(analysis: { payload: unknown } | undefined): Record<string, unknown> {
  return (analysis?.payload ?? {}) as Record<string, unknown>;
}

/** 归档产物键名双拼写兼容：旧 saveResult 路径写 qAnalysis/locate，
 *  流水线归档写 questionAnalysis/locateResult——两种历史数据都要能读。 */
function qAnalysisOf(p: Record<string, unknown>): QAnalysis[] {
  return ((p.qAnalysis ?? p.questionAnalysis) as QAnalysis[] | undefined) ?? [];
}
function locateOf(p: Record<string, unknown>): LocateItem[] {
  return ((p.locate ?? p.locateResult) as LocateItem[] | undefined) ?? [];
}

export const interactiveRouter = createRouter({
  /** 某内容是否已具备参与式解题的分析产物（前端决定入口可用性） */
  availability: privateQuery
    .input(z.object({ kind: z.enum(["exam", "generated"]).default("exam"), refId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const row = await db.query.analyses.findFirst({
        where: and(eq(analyses.source, input.kind), eq(analyses.passageId, input.refId)),
        orderBy: desc(analyses.id),
      });
      const p = payloadOf(row);
      return {
        ready: !!row,
        qCount: qAnalysisOf(p).length,
        title: input.kind === "exam" ? undefined : undefined,
      };
    }),

  /** 步 1·审题参照：题型 + 考眼（不含定位与答案） */
  stepQuestion: privateQuery
    .input(z.object({ kind: z.enum(["exam", "generated"]).default("exam"), refId: z.number(), qNo: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const content = await loadContent(input.kind, input.refId);
      const q = content.questions.find((x) => x.qNo === input.qNo);
      if (!q) throw new TRPCError({ code: "NOT_FOUND", message: "题目不存在" });
      const row = await db.query.analyses.findFirst({
        where: and(eq(analyses.source, input.kind), eq(analyses.passageId, input.refId)),
        orderBy: desc(analyses.id),
      });
      const qa = qAnalysisOf(payloadOf(row)).find((x) => x.qNo === input.qNo);
      return {
        stem: q.stem,
        options: q.options,
        ref: qa
          ? { qType: qa.qType ?? "unknown", focus: qa.focus ?? qa.testPoint ?? "", translation: qa.translation ?? "" }
          : null,
      };
    }),

  /** 步 2·定位参照：证据句所在段落 + 定位思路（不含答案判定） */
  stepLocate: privateQuery
    .input(z.object({ kind: z.enum(["exam", "generated"]).default("exam"), refId: z.number(), qNo: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const content = await loadContent(input.kind, input.refId);
      const row = await db.query.analyses.findFirst({
        where: and(eq(analyses.source, input.kind), eq(analyses.passageId, input.refId)),
        orderBy: desc(analyses.id),
      });
      const loc = locateOf(payloadOf(row)).find((x) => x.qNo === input.qNo);
      return {
        paraCount: content.paragraphs.length,
        ref: loc ? { paraNo: loc.paraNo ?? null, evidence: loc.evidence ?? "", evidenceZh: loc.evidenceZh ?? "", locateLogic: loc.locateLogic ?? "" } : null,
      };
    }),

  /** 步 3·解题参照：官方答案 + 逐题反思与口诀（判分以官方为准） */
  stepSolve: privateQuery
    .input(z.object({ kind: z.enum(["exam", "generated"]).default("exam"), refId: z.number(), qNo: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const content = await loadContent(input.kind, input.refId);
      const q = content.questions.find((x) => x.qNo === input.qNo);
      if (!q) throw new TRPCError({ code: "NOT_FOUND", message: "题目不存在" });
      const row = await db.query.analyses.findFirst({
        where: and(eq(analyses.source, input.kind), eq(analyses.passageId, input.refId)),
        orderBy: desc(analyses.id),
      });
      const solved = ((payloadOf(row).solved as SolveItem[]) ?? []).find((x) => x.qNo === input.qNo);
      return {
        official: q.answer ?? null,
        ai: solved?.answer ?? null,
        reflection: solved?.reflection ?? "",
        takeaway: solved?.takeaway ?? "",
      };
    }),

  /** 步 4·复盘落库：一次参与式练习的完整成果（每步对错 + 自评） */
  finish: privateQuery
    .input(
      z.object({
        kind: z.enum(["exam", "generated"]).default("exam"),
        refId: z.number(),
        qNo: z.number(),
        myQType: z.string().max(32).default(""),
        myParaNo: z.number().nullable().default(null),
        myAnswer: z.enum(["A", "B", "C", "D"]),
        myReflection: z.string().max(500).default(""),
        score: z.object({ question: z.boolean(), locate: z.boolean(), solve: z.boolean() }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const content = await loadContent(input.kind, input.refId);
      const q = content.questions.find((x) => x.qNo === input.qNo);
      if (!q) throw new TRPCError({ code: "NOT_FOUND", message: "题目不存在" });
      const correct = q.answer === input.myAnswer;
      const [{ id }] = await db
        .insert(interactiveRecords)
        .values({
          userId: ctx.user.id,
          kind: input.kind,
          refId: input.refId,
          qNo: input.qNo,
          myQType: input.myQType,
          myParaNo: input.myParaNo,
          myAnswer: input.myAnswer,
          myReflection: input.myReflection,
          correct,
          stepScore: input.score,
        })
        .$returningId();
      return { id, correct };
    }),

  /** 我的参与式练习历史 */
  history: privateQuery
    .input(z.object({ kind: z.enum(["exam", "generated"]).default("exam"), refId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(interactiveRecords)
        .where(and(eq(interactiveRecords.userId, ctx.user.id), eq(interactiveRecords.kind, input.kind), eq(interactiveRecords.refId, input.refId)))
        .orderBy(desc(interactiveRecords.id));
      return rows;
    }),
});

// 供前端展示六分法中文名（避免前端重复维护）
export const ERROR_TYPE_ZH = Object.fromEntries(Object.entries(ERROR_TYPES).map(([k, v]) => [k, v.zh]));
