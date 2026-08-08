import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { createRouter, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  users,
  sessions,
  prompts,
  bindings,
  vocabItems,
  wrongItems,
  practiceRecords,
  analyses,
  channels,
  generatedSets,
  methodClauses,
  siteSettings,
  pipelineJobs,
  type User,
} from "@db/schema";
import { hashSecret, newSalt, normalizeRecoveryAnswer } from "./lib/auth";

function safeUser(u: User) {
  return {
    id: u.id,
    name: u.name,
    avatarChar: u.avatarChar,
    role: u.role,
    hasRecovery: !!u.recoveryQuestion,
    createdAt: u.createdAt,
  };
}

export const adminRouter = createRouter({
  /** 全站总览 */
  overview: adminQuery.query(async () => {
    const db = getDb();
    const count = async (t: never) => {
      const [r] = (await db.select({ c: sql<number>`count(*)` }).from(t)) as unknown as { c: number }[];
      return Number(r.c);
    };
    const [u, rec, wrong, vocab, ch, gen, ana, clauses] = await Promise.all([
      count(users as never),
      count(practiceRecords as never),
      count(wrongItems as never),
      count(vocabItems as never),
      count(channels as never),
      count(generatedSets as never),
      count(analyses as never),
      count(methodClauses as never),
    ]);
    const jobs = await db.select().from(pipelineJobs).orderBy(desc(pipelineJobs.createdAt));
    const recentJobs = jobs.slice(0, 10).map((j) => ({
      id: j.id, userId: j.userId, kind: j.kind, refId: j.refId, status: j.status, stage: j.stage,
      errorMsg: j.errorMsg, createdAt: j.createdAt,
    }));
    const failedJobs = jobs.filter((j) => j.status === "error").length;
    // 条款热度：解析产物中 methodRefs 的使用频率
    const hot = new Map<string, number>();
    for (const a of await db.select().from(analyses)) {
      const solved = (a.payload as { solved?: { methodRefs?: { clauseId?: string }[] }[] }).solved ?? [];
      for (const item of solved) {
        for (const r of item.methodRefs ?? []) {
          if (r.clauseId) hot.set(r.clauseId, (hot.get(r.clauseId) ?? 0) + 1);
        }
      }
    }
    const clauseHot = [...hot.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([clauseId, count]) => ({ clauseId, count }));
    return {
      totals: { users: u, practiceRecords: rec, wrongItems: wrong, vocabItems: vocab, channels: ch, generatedSets: gen, analyses: ana, methodClauses: clauses },
      jobs: { total: jobs.length, failed: failedJobs, recent: recentJobs },
      clauseHot,
    };
  }),

  /** 用户列表（含每人数据统计） */
  listUsers: adminQuery.query(async () => {
    const db = getDb();
    const all = await db.select().from(users).orderBy(users.id);
    const [recs, wrongs, vocabs] = await Promise.all([
      db.select().from(practiceRecords),
      db.select().from(wrongItems),
      db.select().from(vocabItems),
    ]);
    return all.map((u) => ({
      ...safeUser(u),
      stats: {
        records: recs.filter((r) => r.userId === u.id).length,
        wrong: wrongs.filter((w) => w.userId === u.id).length,
        vocab: vocabs.filter((v) => v.userId === u.id).length,
        lastActive: recs.filter((r) => r.userId === u.id).map((r) => r.createdAt).sort().pop() ?? null,
      },
    }));
  }),

  /** 改任意用户：昵称 / 头像字 / 角色 */
  updateUser: adminQuery
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(32).optional(),
        avatarChar: z.string().max(4).optional(),
        role: z.enum(["user", "admin"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      if (input.id === ctx.user.id && input.role === "user") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能移除自己的管理员身份" });
      }
      if (input.name) {
        const dup = await db.query.users.findFirst({
          where: and(eq(users.name, input.name.trim()), ne(users.id, input.id)),
        });
        if (dup) throw new TRPCError({ code: "CONFLICT", message: "该昵称已被占用" });
      }
      const patch: Partial<User> = {};
      if (input.name) patch.name = input.name.trim();
      if (input.avatarChar) patch.avatarChar = input.avatarChar;
      if (input.role) patch.role = input.role;
      await db.update(users).set(patch).where(eq(users.id, input.id));
      const u = await db.query.users.findFirst({ where: eq(users.id, input.id) });
      return { user: safeUser(u!) };
    }),

  /** 直接重设任意用户密码（无需原密码） */
  resetUserPassword: adminQuery
    .input(z.object({ id: z.number(), newPassword: z.string().min(6).max(64) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const salt = newSalt();
      await db
        .update(users)
        .set({ passwordHash: hashSecret(input.newPassword, salt), salt })
        .where(eq(users.id, input.id));
      await db.delete(sessions).where(eq(sessions.userId, input.id));
      return { ok: true };
    }),

  /** 重设任意用户密保 */
  resetUserRecovery: adminQuery
    .input(z.object({ id: z.number(), question: z.string().min(2).max(128), answer: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const u = await db.query.users.findFirst({ where: eq(users.id, input.id) });
      if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
      await db
        .update(users)
        .set({
          recoveryQuestion: input.question.trim(),
          recoveryHash: hashSecret(normalizeRecoveryAnswer(input.answer), u.salt),
        })
        .where(eq(users.id, input.id));
      return { ok: true };
    }),

  /** 查看任意用户的数据 */
  viewUserData: adminQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const db = getDb();
    const uid = input.id;
    const [vocab, wrong, recs, myPrompts, myBindings] = await Promise.all([
      db.select().from(vocabItems).where(eq(vocabItems.userId, uid)),
      db.select().from(wrongItems).where(eq(wrongItems.userId, uid)),
      db.select().from(practiceRecords).where(eq(practiceRecords.userId, uid)).orderBy(desc(practiceRecords.createdAt)),
      db.select().from(prompts).where(eq(prompts.userId, uid)),
      db.select().from(bindings).where(eq(bindings.userId, uid)),
    ]);
    return { vocab, wrongItems: wrong, practiceRecords: recs, prompts: myPrompts, bindings: myBindings };
  }),

  /** 清空任意用户的学习数据（保留账号） */
  clearUserData: adminQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = getDb();
    await Promise.all([
      db.delete(vocabItems).where(eq(vocabItems.userId, input.id)),
      db.delete(wrongItems).where(eq(wrongItems.userId, input.id)),
      db.delete(practiceRecords).where(eq(practiceRecords.userId, input.id)),
    ]);
    return { ok: true };
  }),

  /** 删除任意用户（级联删除全部数据） */
  deleteUser: adminQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    if (input.id === ctx.user.id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "不能删除自己" });
    }
    const db = getDb();
    await Promise.all([
      db.delete(vocabItems).where(eq(vocabItems.userId, input.id)),
      db.delete(wrongItems).where(eq(wrongItems.userId, input.id)),
      db.delete(practiceRecords).where(eq(practiceRecords.userId, input.id)),
      db.delete(prompts).where(eq(prompts.userId, input.id)),
      db.delete(bindings).where(eq(bindings.userId, input.id)),
      db.delete(sessions).where(eq(sessions.userId, input.id)),
      db.delete(channels).where(eq(channels.userId, input.id)),
    ]);
    await db.delete(users).where(eq(users.id, input.id));
    return { ok: true };
  }),

  /** 站点设置读/写 */
  getSettings: adminQuery.query(async () => {
    const db = getDb();
    const rows = await db.select().from(siteSettings);
    return Object.fromEntries(rows.map((r) => [r.k, r.v]));
  }),
  setSetting: adminQuery
    .input(z.object({ k: z.string().min(1).max(64), v: z.string().max(2000) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .insert(siteSettings)
        .values({ k: input.k, v: input.v })
        .onDuplicateKeyUpdate({ set: { v: input.v } });
      return { ok: true };
    }),

  /** 方法条款管理：更新内容 */
  updateClause: adminQuery
    .input(z.object({ clauseId: z.string(), title: z.string().min(1).max(64), content: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(methodClauses)
        .set({ title: input.title, content: input.content })
        .where(eq(methodClauses.clauseId, input.clauseId));
      const { invalidateMethodCache } = await import("./lib/methodKnowledge");
      invalidateMethodCache();
      return { ok: true };
    }),
});
