import { z } from "zod";
import { and, eq, desc, isNotNull, lte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, privateQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  wrongItems,
  wrongItemAnalyses,
  wrongInsights,
  wrongRecommendations,
  questions,
  passages,
  methodClauses,
} from "@db/schema";
import { chatJson, promptOf, FALLBACK_PROMPTS, loadContent, passageTextOf } from "./lib/agentCore";
import { buildMethodContext } from "./lib/methodKnowledge";
import { ERROR_TYPES, REVIEW_INTERVALS_DAYS } from "@contracts/constants";

type ErrorTypeKey = keyof typeof ERROR_TYPES;
const VALID_ERROR_TYPES = new Set(Object.keys(ERROR_TYPES));

async function assertWrongOwner(wrongId: number, userId: number) {
  const db = getDb();
  const item = await db.query.wrongItems.findFirst({ where: eq(wrongItems.id, wrongId) });
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "错题不存在" });
  if (item.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该错题" });
  return item;
}

/** 服务端校验 methodRefs，剔除幻觉条款 */
async function sanitizeRefs(refs: unknown): Promise<{ clauseId: string; title: string; applied: string }[]> {
  if (!Array.isArray(refs)) return [];
  const db = getDb();
  const valid = new Set((await db.select({ id: methodClauses.clauseId }).from(methodClauses)).map((r) => r.id));
  return (refs as { clauseId?: string; title?: string; applied?: string }[])
    .filter((r) => r.clauseId && valid.has(r.clauseId))
    .map((r) => ({ clauseId: r.clauseId!, title: r.title ?? "", applied: r.applied ?? "" }))
    .slice(0, 3);
}

/** 单题 AI 诊断（内部：analyze / analyzeBatch 共用） */
async function analyzeOne(wrongId: number, userId: number) {
  const db = getDb();
  const item = await assertWrongOwner(wrongId, userId);
  const content = await loadContent(item.source, item.refId);
  const q = content.questions.find((x) => x.qNo === item.qNo);
  const qText = q
    ? `第${q.qNo}题：${q.stem}\n${q.options.map((o, i) => `${"ABCD"[i]}. ${o}`).join("\n")}`
    : `题干：${item.stem}\n${(item.options as string[]).map((o, i) => `${"ABCD"[i]}. ${o}`).join("\n")}`;
  const { data, model } = await chatJson<Record<string, unknown>>(
    "agent_analyst",
    (await promptOf("agent_analyst", FALLBACK_PROMPTS.agent_analyst, userId)) +
      (await buildMethodContext("agent_solver", item.qType ? [item.qType] : [])),
    `篇章：\n${passageTextOf(content.paragraphs).slice(0, 12000)}\n\n${qText}\n\n学生的错选：${item.myAnswer}\n正确答案：${item.correctAnswer}\n题型：${item.qType}`,
    { maxTokens: 8192, userId },
  );
  const errorType = VALID_ERROR_TYPES.has(String(data.errorType)) ? String(data.errorType) : "comprehend";
  const methodRefs = await sanitizeRefs(data.methodRefs);
  const values = {
    wrongId,
    errorType,
    rootCause: String(data.rootCause ?? ""),
    distractorPull: String(data.distractorPull ?? ""),
    knowledgeGap: String(data.knowledgeGap ?? ""),
    methodRefs,
    suggestion: String(data.suggestion ?? ""),
    modelUsed: model,
  };
  const existing = await db.query.wrongItemAnalyses.findFirst({ where: eq(wrongItemAnalyses.wrongId, wrongId) });
  if (existing) {
    await db.update(wrongItemAnalyses).set(values).where(eq(wrongItemAnalyses.id, existing.id));
  } else {
    await db.insert(wrongItemAnalyses).values(values);
  }
  await db
    .update(wrongItems)
    .set({ errorType, hasAnalysis: true })
    .where(eq(wrongItems.id, wrongId));
  return db.query.wrongItemAnalyses.findFirst({ where: eq(wrongItemAnalyses.wrongId, wrongId) });
}

export const insightRouter = createRouter({
  /** 单题诊断书（有则返回，无则 null） */
  getAnalysis: privateQuery.input(z.object({ wrongId: z.number() })).query(async ({ ctx, input }) => {
    await assertWrongOwner(input.wrongId, ctx.user.id);
    const db = getDb();
    return (await db.query.wrongItemAnalyses.findFirst({ where: eq(wrongItemAnalyses.wrongId, input.wrongId) })) ?? null;
  }),

  /** 生成/重生成单题诊断书 */
  analyze: privateQuery.input(z.object({ wrongId: z.number() })).mutation(async ({ ctx, input }) => {
    const row = await analyzeOne(input.wrongId, ctx.user.id);
    return { analysis: row };
  }),

  /** 批量诊断（≤50 串行，单题失败不拖垮整批） */
  analyzeBatch: privateQuery
    .input(z.object({ wrongIds: z.array(z.number()).min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const results: { wrongId: number; ok: boolean; error?: string }[] = [];
      for (const id of input.wrongIds) {
        try {
          await analyzeOne(id, ctx.user.id);
          results.push({ wrongId: id, ok: true });
        } catch (e) {
          results.push({ wrongId: id, ok: false, error: e instanceof Error ? e.message.slice(0, 120) : String(e) });
        }
      }
      return { results, okCount: results.filter((r) => r.ok).length };
    }),

  /** 手动编辑诊断书（用户的批注优先于 AI） */
  saveAnalysis: privateQuery
    .input(
      z.object({
        wrongId: z.number(),
        errorType: z.string().max(24).optional(),
        rootCause: z.string().max(4000).optional(),
        suggestion: z.string().max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await assertWrongOwner(input.wrongId, ctx.user.id);
      const existing = await db.query.wrongItemAnalyses.findFirst({ where: eq(wrongItemAnalyses.wrongId, input.wrongId) });
      const patch = {
        ...(input.errorType !== undefined && VALID_ERROR_TYPES.has(input.errorType) ? { errorType: input.errorType } : {}),
        ...(input.rootCause !== undefined ? { rootCause: input.rootCause } : {}),
        ...(input.suggestion !== undefined ? { suggestion: input.suggestion } : {}),
      };
      if (existing) {
        await db.update(wrongItemAnalyses).set(patch).where(eq(wrongItemAnalyses.id, existing.id));
      } else {
        await db.insert(wrongItemAnalyses).values({ wrongId: input.wrongId, ...patch });
      }
      if (patch.errorType) {
        await db.update(wrongItems).set({ errorType: patch.errorType, hasAnalysis: true }).where(eq(wrongItems.id, input.wrongId));
      } else {
        await db.update(wrongItems).set({ hasAnalysis: true }).where(eq(wrongItems.id, input.wrongId));
      }
      return { ok: true };
    }),

  /** 错因六分法统计（确定性计算，不用 AI） */
  errorTypeStats: privateQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db
      .select({ errorType: wrongItems.errorType, qType: wrongItems.qType, mastered: wrongItems.mastered, createdAt: wrongItems.createdAt })
      .from(wrongItems)
      .where(eq(wrongItems.userId, ctx.user.id));
    // 近 14 天每日新增（确定性统计，前端迷你趋势带用）
    const days: { date: string; count: number }[] = [];
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(dayStart.getTime() - i * 86400000);
      const key = `${d.getMonth() + 1}/${d.getDate()}`;
      const next = d.getTime() + 86400000;
      days.push({ date: key, count: rows.filter((r) => r.createdAt && new Date(r.createdAt).getTime() >= d.getTime() && new Date(r.createdAt).getTime() < next).length });
    }
    const byError = new Map<string, number>();
    const byQType = new Map<string, { total: number; mastered: number }>();
    let undiagnosed = 0;
    for (const r of rows) {
      if (r.errorType) byError.set(r.errorType, (byError.get(r.errorType) ?? 0) + 1);
      else undiagnosed++;
      const a = byQType.get(r.qType) ?? { total: 0, mastered: 0 };
      a.total++;
      if (r.mastered) a.mastered++;
      byQType.set(r.qType, a);
    }
    return {
      total: rows.length,
      undiagnosed,
      recent14Days: days,
      byErrorType: Object.entries(ERROR_TYPES).map(([k, v]) => ({
        errorType: k as ErrorTypeKey,
        zh: v.zh,
        count: byError.get(k) ?? 0,
      })),
      byQType: Array.from(byQType.entries()).map(([qType, a]) => ({ qType, ...a })),
    };
  }),

  /** AI 备考建议（每用户缓存 1 条；force=true 重新生成） */
  recommend: privateQuery.input(z.object({ force: z.boolean().default(false) })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const uid = ctx.user.id;
    if (!input.force) {
      const cached = await db.query.wrongRecommendations.findFirst({ where: eq(wrongRecommendations.userId, uid) });
      if (cached) return { rec: cached, cached: true };
    }
    // 先确定性算统计，再让 AI 基于数据出建议（防数据幻觉）
    const rows = await db.select().from(wrongItems).where(eq(wrongItems.userId, uid));
    if (rows.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "还没有错题，先去刷几篇真题再来" });
    const byError = new Map<string, number>();
    const byQ = new Map<string, { total: number; mastered: number }>();
    for (const r of rows) {
      if (r.errorType) byError.set(r.errorType, (byError.get(r.errorType) ?? 0) + 1);
      const a = byQ.get(r.qType) ?? { total: 0, mastered: 0 };
      a.total++;
      if (r.mastered) a.mastered++;
      byQ.set(r.qType, a);
    }
    const statText = [
      `错题总数：${rows.length}，未掌握：${rows.filter((r) => !r.mastered).length}`,
      `错因分布：${Array.from(byError.entries()).map(([k, v]) => `${ERROR_TYPES[k as ErrorTypeKey]?.zh ?? k} ${v} 次`).join("、") || "（尚未诊断）"}`,
      `题型分布：${Array.from(byQ.entries()).map(([k, a]) => `${k} 共 ${a.total} 错·已掌握 ${a.mastered}`).join("、")}`,
    ].join("\n");
    const { data, model } = await chatJson<Record<string, unknown>>(
      "agent_advisor",
      await promptOf("agent_advisor", FALLBACK_PROMPTS.agent_advisor, uid),
      `学生的错题统计：\n${statText}`,
      { maxTokens: 4096, userId: uid },
    );
    const focusTypes = (Array.isArray(data.focusTypes) ? data.focusTypes : []).map(String).slice(0, 3);
    const values = {
      headline: String(data.headline ?? ""),
      advice: String(data.advice ?? ""),
      focusTypes,
      modelUsed: model,
    };
    const existing = await db.query.wrongRecommendations.findFirst({ where: eq(wrongRecommendations.userId, uid) });
    if (existing) {
      await db.update(wrongRecommendations).set(values).where(eq(wrongRecommendations.id, existing.id));
    } else {
      await db.insert(wrongRecommendations).values({ userId: uid, ...values });
    }
    return { rec: await db.query.wrongRecommendations.findFirst({ where: eq(wrongRecommendations.userId, uid) }), cached: false };
  }),

  getRecommendation: privateQuery.query(async ({ ctx }) => {
    const db = getDb();
    return (await db.query.wrongRecommendations.findFirst({ where: eq(wrongRecommendations.userId, ctx.user.id) })) ?? null;
  }),

  /** 针对性习题推荐（纯 SQL：同薄弱题型 + 未做过/未掌握，按薄弱权重×年份权重排序） */
  practiceProblems: privateQuery.input(z.object({ limit: z.number().min(1).max(20).default(8) })).query(async ({ ctx, input }) => {
    const db = getDb();
    const uid = ctx.user.id;
    const wrongs = await db.select().from(wrongItems).where(eq(wrongItems.userId, uid));
    const weak = new Map<string, number>();
    for (const w of wrongs) {
      const weight = (w.mastered ? 0.2 : 1) * (1 + w.attempts * 0.3);
      weak.set(w.qType, (weak.get(w.qType) ?? 0) + weight);
    }
    if (weak.size === 0) return { items: [] };
    const allQ = await db.select().from(questions);
    const ps = await db.select().from(passages);
    const pMap = new Map(ps.map((p) => [p.id, p]));
    const doneQ = new Set(wrongs.filter((w) => w.questionId).map((w) => Number(w.questionId)));
    const items = allQ
      .filter((q) => weak.has(q.qType) && !doneQ.has(q.id))
      .map((q) => {
        const p = pMap.get(q.passageId);
        const score = (weak.get(q.qType) ?? 0) * (1 + ((p?.year ?? 2010) - 2009) * 0.05);
        return { questionId: q.id, passageId: q.passageId, qNo: q.qNo, qType: q.qType, stem: q.stem, year: p?.year ?? 0, textNo: p?.textNo ?? 0, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, input.limit);
    return { items: items.map(({ score: _s, ...rest }) => rest) };
  }),

  // —— 感悟笔记 ——
  insightList: privateQuery
    .input(z.object({ wrongId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(wrongInsights)
        .where(
          input?.wrongId
            ? and(eq(wrongInsights.userId, ctx.user.id), eq(wrongInsights.wrongId, input.wrongId))
            : eq(wrongInsights.userId, ctx.user.id),
        )
        .orderBy(desc(wrongInsights.updatedAt));
      return rows;
    }),

  insightSave: privateQuery
    .input(
      z.object({
        id: z.number().optional(),
        wrongId: z.number().optional(),
        errorType: z.string().max(24).default(""),
        content: z.string().min(1).max(10000),
        status: z.enum(["attention", "understood"]).default("attention"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      if (input.wrongId) await assertWrongOwner(input.wrongId, ctx.user.id);
      if (input.id) {
        const row = await db.query.wrongInsights.findFirst({ where: eq(wrongInsights.id, input.id) });
        if (!row || row.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "感悟不存在" });
        await db
          .update(wrongInsights)
          .set({ content: input.content, status: input.status, errorType: input.errorType })
          .where(eq(wrongInsights.id, input.id));
        if (input.wrongId) {
          await db.update(wrongItems).set({ insightStatus: input.status }).where(eq(wrongItems.id, input.wrongId));
        }
        return { id: input.id };
      }
      const [{ id }] = await db
        .insert(wrongInsights)
        .values({ userId: ctx.user.id, wrongId: input.wrongId ?? null, errorType: input.errorType, content: input.content, status: input.status })
        .$returningId();
      if (input.wrongId) {
        await db.update(wrongItems).set({ insightStatus: input.status }).where(eq(wrongItems.id, input.wrongId));
      }
      return { id };
    }),

  insightRemove: privateQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const row = await db.query.wrongInsights.findFirst({ where: eq(wrongInsights.id, input.id) });
    if (!row || row.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "感悟不存在" });
    await db.delete(wrongInsights).where(eq(wrongInsights.id, input.id));
    return { ok: true };
  }),

  /** 按错误类型聚合的感悟摘要 */
  insightSummary: privateQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db.select().from(wrongInsights).where(eq(wrongInsights.userId, ctx.user.id));
    const byType = new Map<string, number>();
    for (const r of rows) {
      const k = r.errorType || "general";
      byType.set(k, (byType.get(k) ?? 0) + 1);
    }
    return {
      total: rows.length,
      attention: rows.filter((r) => r.status === "attention").length,
      understood: rows.filter((r) => r.status === "understood").length,
      byType: Array.from(byType.entries()).map(([errorType, count]) => ({ errorType, count })),
    };
  }),

  // —— 艾宾浩斯复习 ——
  /** 待复习队列：nextReviewAt 到期 + 未掌握，顺带统计今日待复习数 */
  reviewQueue: privateQuery.query(async ({ ctx }) => {
    const db = getDb();
    const now = new Date();
    const rows = await db
      .select()
      .from(wrongItems)
      .where(and(eq(wrongItems.userId, ctx.user.id), eq(wrongItems.mastered, false), isNotNull(wrongItems.nextReviewAt), lte(wrongItems.nextReviewAt, now)))
      .orderBy(wrongItems.nextReviewAt);
    const scheduled = await db
      .select({ count: sql<number>`count(*)` })
      .from(wrongItems)
      .where(and(eq(wrongItems.userId, ctx.user.id), eq(wrongItems.mastered, false), isNotNull(wrongItems.nextReviewAt)));
    return { due: rows, dueCount: rows.length, scheduledCount: Number(scheduled[0]?.count ?? 0) };
  }),

  /** 复习打卡：remembered → 进入下一阶段排期；forgot → 回到阶段 0 */
  reviewDone: privateQuery
    .input(z.object({ wrongId: z.number(), remembered: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const item = await assertWrongOwner(input.wrongId, ctx.user.id);
      const now = new Date();
      let stage = item.reviewStage;
      if (input.remembered) {
        stage = Math.min(stage + 1, REVIEW_INTERVALS_DAYS.length - 1);
      } else {
        stage = 0;
      }
      const days = REVIEW_INTERVALS_DAYS[stage];
      const next = new Date(now.getTime() + days * 86400_000);
      await db
        .update(wrongItems)
        .set({
          reviewStage: stage,
          reviewCount: item.reviewCount + 1,
          lastReviewedAt: now,
          nextReviewAt: next,
          mastered: input.remembered && stage >= REVIEW_INTERVALS_DAYS.length - 1 ? true : item.mastered,
        })
        .where(eq(wrongItems.id, item.id));
      return { stage, nextReviewAt: next, days };
    }),

  /** 把一道错题加入复习计划（从阶段 0 开始排期） */
  reviewStart: privateQuery.input(z.object({ wrongId: z.number() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const item = await assertWrongOwner(input.wrongId, ctx.user.id);
    if (item.nextReviewAt) return { ok: true, already: true };
    const next = new Date(Date.now() + REVIEW_INTERVALS_DAYS[0] * 86400_000);
    await db.update(wrongItems).set({ nextReviewAt: next, reviewStage: 0 }).where(eq(wrongItems.id, item.id));
    return { ok: true };
  }),
});
