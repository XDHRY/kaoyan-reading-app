import { z } from "zod";
import { eq, and, asc, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery, privateQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users, vocabItems, wrongItems, passages } from "@db/schema";
import { resolveBinding, callChat, callImage } from "./channelRouter";

/** 用户（轻量昵称制）：只暴露安全字段，凭证哈希绝不出库 */
export const userRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select({ id: users.id, name: users.name, avatarChar: users.avatarChar, createdAt: users.createdAt })
      .from(users)
      .orderBy(asc(users.id));
    return rows;
  }),
});

/** 生词本（全部 private：userId 只从 session 取，写操作校验归属） */
export const vocabRouter = createRouter({
  list: privateQuery
    .input(z.object({ familiarity: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(vocabItems)
        .where(eq(vocabItems.userId, ctx.user.id))
        .orderBy(desc(vocabItems.createdAt));
      return input?.familiarity !== undefined ? rows.filter((r) => r.familiarity === input.familiarity) : rows;
    }),

  /** AI 查词：先查缓存（本用户已收录的直接返回），否则调用默认对话渠道翻译 */
  lookup: privateQuery
    .input(
      z.object({
        word: z.string().min(1).max(64),
        context: z.string().max(2000).optional(),
        passageId: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const uid = ctx.user.id;
      const word = input.word.trim().toLowerCase();
      const cached = await db.query.vocabItems.findFirst({
        where: and(eq(vocabItems.userId, uid), eq(vocabItems.word, word)),
      });
      if (cached) return { item: cached, cached: true };

      const resolved = await resolveBinding("vocab_lookup", "chat", uid);
      if (!resolved) throw new Error("没有可用的对话渠道，请先在「模型」里配置");
      const prompt = `你是考研英语词典。给出单词 "${word}" 的考研语境释义。
${input.context ? `出处原句：${input.context.slice(0, 500)}` : ""}
只输出 JSON：{"zh": "汉语释义（含词性，30字内）", "contextZh": "原句在该语境中的含义（无原句则填空字符串）"}`;
      let zh = "";
      let contextZh = "";
      try {
        const result = await callChat(
          resolved.channel,
          resolved.model,
          [
            { role: "system", content: prompt + "\n\n只输出合法 JSON，不要任何其他文字。" },
            { role: "user", content: word },
          ],
          { maxTokens: 512, reasoningEffort: resolved.reasoningEffort },
        );
        try {
          const text = result.content.trim().replace(/^```(?:json)?|```$/g, "").trim();
          const s = text.indexOf("{");
          const e = text.lastIndexOf("}");
          const parsed = JSON.parse(text.slice(s, e + 1));
          zh = String(parsed.zh ?? "");
          contextZh = String(parsed.contextZh ?? "");
        } catch {
          zh = result.content.slice(0, 120);
        }
      } catch (e) {
        if (!ctx.offline) throw e;
        // 离线兜底：AI 释义不可得时仍收藏生词（释义留空待联网补全，前端已支持空释义展示）
        zh = "";
        contextZh = "";
      }
      // 直接入册（查词即收藏，用户可在生词本删除）
      const [{ id }] = await db
        .insert(vocabItems)
        .values({
          userId: uid,
          word,
          zh,
          context: contextZh ? `${input.context ?? ""}\n译：${contextZh}` : (input.context ?? null),
          passageId: input.passageId ?? null,
        })
        .$returningId();
      const item = await db.query.vocabItems.findFirst({ where: eq(vocabItems.id, id) });
      return { item, cached: false };
    }),

  setFamiliarity: privateQuery
    .input(z.object({ id: z.number(), familiarity: z.number().min(0).max(2) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await assertVocabOwner(input.id, ctx.user.id);
      await db.update(vocabItems).set({ familiarity: input.familiarity }).where(eq(vocabItems.id, input.id));
      return { ok: true };
    }),

  /** 记忆配图：AI 绘图生成单词意象图，缓存于词条 */
  image: privateQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const item = await assertVocabOwner(input.id, ctx.user.id);
    if (item.image) return { image: item.image, cached: true };
    const resolved = await resolveBinding("default_image", "image", ctx.user.id);
    if (!resolved) throw new Error("未配置绘图渠道，请先到「模型」里绑定绘图模型");
    const prompt = [
      "Minimalist Chinese ink-wash illustration on rice paper visualizing the English word",
      `"${item.word}" (meaning: ${item.zh}).`,
      "One clear central visual metaphor, sumi-e brush strokes, single vermilion seal stamp, generous negative space, no text, no photorealism.",
    ].join(" ");
    const img = await callImage(resolved.channel, resolved.model, prompt);
    const dataUrl = img.b64 ? `data:image/png;base64,${img.b64}` : img.url ? img.url : null;
    if (!dataUrl) throw new Error("绘图渠道未返回图像");
    await db.update(vocabItems).set({ image: dataUrl }).where(eq(vocabItems.id, item.id));
    return { image: dataUrl, cached: false };
  }),

  remove: privateQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    await assertVocabOwner(input.id, ctx.user.id);
    await db.delete(vocabItems).where(eq(vocabItems.id, input.id));
    return { ok: true };
  }),
});

async function assertVocabOwner(id: number, userId: number) {
  const db = getDb();
  const item = await db.query.vocabItems.findFirst({ where: eq(vocabItems.id, id) });
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "词条不存在" });
  if (item.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该词条" });
  return item;
}

async function assertWrongOwner(id: number, userId: number) {
  const db = getDb();
  const item = await db.query.wrongItems.findFirst({ where: eq(wrongItems.id, id) });
  if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "错题不存在" });
  if (item.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该错题" });
  return item;
}

/** 错题本（全部 private：userId 只从 session 取，写操作校验归属） */
export const wrongRouter = createRouter({
  list: privateQuery
    .input(z.object({ mastered: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(wrongItems)
        .where(eq(wrongItems.userId, ctx.user.id))
        .orderBy(desc(wrongItems.updatedAt));
      const filtered = input?.mastered !== undefined ? rows.filter((r) => r.mastered === input.mastered) : rows;
      // 补充篇章年份信息
      const ps = await db.select().from(passages);
      return filtered.map((w) => {
        const p = w.source === "exam" ? ps.find((x) => x.id === w.refId) : null;
        return { ...w, year: p?.year ?? null, textNo: p?.textNo ?? null };
      });
    }),

  /** 重练判分：做对 → 已掌握；做错 → 尝试次数+1 */
  retry: privateQuery
    .input(z.object({ id: z.number(), answer: z.enum(["A", "B", "C", "D"]) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const item = await assertWrongOwner(input.id, ctx.user.id);
      const ok = input.answer === item.correctAnswer;
      await db
        .update(wrongItems)
        .set({ attempts: item.attempts + 1, mastered: ok ? true : item.mastered, myAnswer: input.answer, updatedAt: new Date() })
        .where(eq(wrongItems.id, item.id));
      return { ok, correctAnswer: item.correctAnswer };
    }),

  unmaster: privateQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    await assertWrongOwner(input.id, ctx.user.id);
    await db.update(wrongItems).set({ mastered: false, updatedAt: new Date() }).where(eq(wrongItems.id, input.id));
    return { ok: true };
  }),

  remove: privateQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    await assertWrongOwner(input.id, ctx.user.id);
    await db.delete(wrongItems).where(eq(wrongItems.id, input.id));
    return { ok: true };
  }),
});
