import { z } from "zod";
import { eq, and, asc, desc, isNull } from "drizzle-orm";
import { createRouter, publicQuery, privateQuery } from "./middleware";
import { TRPCError } from "@trpc/server";
import { getDb } from "./queries/connection";
import { knowledgeCards, passages, questions, prompts } from "@db/schema";

export const knowledgeRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb();
    return db.select().from(knowledgeCards).orderBy(asc(knowledgeCards.sortOrder));
  }),
  byNode: publicQuery.input(z.object({ nodeId: z.string() })).query(async ({ input }) => {
    const db = getDb();
    return db.query.knowledgeCards.findFirst({ where: eq(knowledgeCards.nodeId, input.nodeId) });
  }),
});

export const passageRouter = createRouter({
  /** 真题库列表（不含全文，轻量） */
  list: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db.select().from(passages).orderBy(desc(passages.year), asc(passages.textNo));
    return rows.map((p) => ({
      id: p.id,
      year: p.year,
      textNo: p.textNo,
      paraCount: p.paragraphs.length,
      sourceTag: p.sourceTag,
      verifyStatus: p.verifyStatus,
      verifyNote: p.verifyNote,
    }));
  }),
  /** 单篇全文 + 题目 */
  detail: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const db = getDb();
    const passage = await db.query.passages.findFirst({ where: eq(passages.id, input.id) });
    if (!passage) throw new Error("真题不存在");
    const qs = await db
      .select()
      .from(questions)
      .where(eq(questions.passageId, input.id))
      .orderBy(asc(questions.qNo));
    return { passage, questions: qs };
  }),
  byYearText: publicQuery
    .input(z.object({ year: z.number(), textNo: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const passage = await db.query.passages.findFirst({
        where: and(eq(passages.year, input.year), eq(passages.textNo, input.textNo)),
      });
      if (!passage) return null;
      const qs = await db
        .select()
        .from(questions)
        .where(eq(questions.passageId, passage.id))
        .orderBy(asc(questions.qNo));
      return { passage, questions: qs };
    }),
});

export const promptRouter = createRouter({
  list: privateQuery.query(async () => {
    const db = getDb();
    return db.select().from(prompts).orderBy(asc(prompts.agentRole), desc(prompts.version));
  }),
  save: privateQuery
    .input(
      z.object({
        agentRole: z.string(),
        name: z.string().min(1),
        content: z.string().min(1),
        personal: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      // 全站预设仅管理员可改；个人版本任何登录用户可存
      if (!input.personal && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "全站提示词仅管理员可修改" });
      }
      const userId = input.personal ? ctx.user.id : null;
      const scope = userId
        ? and(eq(prompts.agentRole, input.agentRole), eq(prompts.userId, userId), eq(prompts.isActive, true))
        : and(eq(prompts.agentRole, input.agentRole), isNull(prompts.userId), eq(prompts.isActive, true));
      const existing = await db.query.prompts.findFirst({ where: scope });
      if (existing) {
        await db.update(prompts).set({ isActive: false, updatedAt: new Date() }).where(eq(prompts.id, existing.id));
      }
      const version = (existing?.version ?? 0) + 1;
      const [{ id }] = await db
        .insert(prompts)
        .values({ agentRole: input.agentRole, name: input.name, content: input.content, userId, version, isActive: true })
        .$returningId();
      return db.query.prompts.findFirst({ where: eq(prompts.id, id) });
    }),
});

/** 内部：取某 Agent 的当前生效提示词（个人覆盖优先于全站预设） */
export async function getActivePrompt(agentRole: string, userId?: number): Promise<string | null> {
  const db = getDb();
  if (userId) {
    const mine = await db.query.prompts.findFirst({
      where: and(eq(prompts.agentRole, agentRole), eq(prompts.userId, userId), eq(prompts.isActive, true)),
    });
    if (mine) return mine.content;
  }
  const p = await db.query.prompts.findFirst({
    where: and(eq(prompts.agentRole, agentRole), isNull(prompts.userId), eq(prompts.isActive, true)),
  });
  return p?.content ?? null;
}
