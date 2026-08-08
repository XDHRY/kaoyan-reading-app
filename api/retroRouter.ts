import { z } from "zod";
import { createHash } from "crypto";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, privateQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { practiceRecords, wrongItems, wrongItemAnalyses, generatedSets, retroSets } from "@db/schema";
import { loadContent, normalizeGenerated, chatJson, promptOf } from "./lib/agentCore";
import { buildMethodContext } from "./lib/methodKnowledge";
import { rateLimit } from "./lib/rate";
import { ERROR_TYPES } from "@contracts/constants";

/**
 * 复盘定制卷：交卷后基于三件套（本套错因分布 + 每题 AI 诊断 + 学生自评）生成一整套仿真题。
 *
 * 设计决策：
 * - 复用 generatedSets 作为载体 → 判分/错题入册/历史档案零改动，天然闭环；
 * - 幂等键 = recordId + 自评哈希：同一套答卷同一自评 1 小时内复用，不重复烧 LLM；
 * - 自评可空：空自评哈希固定为 "none"，照样可生成（三件套变两件套）；
 * - 错题缺 AI 诊断时降级为"错因标签+错选项"，不让生成因数据不全而失败；
 * - 限流复用 generate 桶（与随手生成同额度），防刷。
 */

const FALLBACK_RETRO = `你是考研英语一命题组的研究员，同时是一位顶级私教。任务：为学生定制一整套"复盘卷"——针对他上一套题暴露的具体问题，出 5 道新阅读题，让他立刻针对性巩固。
你会拿到：学生上一套题的错因分布（六分法）、每道错题的 AI 诊断摘要（错因/干扰项套路/能力缺口）、学生自己的复盘自评（可能有，可能没有）。
命题要求：
1. 文章话题与学生弱点匹配（如错因多为"过度推断"，文章应含多处易引发过度推断的表述）；
2. 5 道题的题型分布要与学生的错因一一对应：哪种错因错得多，就多出能训练该环节的题型（错因→题型映射：locate→detail/vocab，comprehend→detail/infer，overinfer→infer，detail→detail，mistype→混合，vocab→vocab）；
3. 干扰项必须复用学生上次中招的套路（诊断里的 distractorPull 提到的手法），但换新语境；
4. 难度与考研真题一致；design 字段写清"这题针对学生的哪个弱点设计"；
5. 若学生写了自评，优先响应他在自评里点名的薄弱环节。
格式铁律：options 数组只写选项正文不带字母前缀；answer 只写单个字母（A/B/C/D）；恰好 5 道题 qNo 1-5 连续。
输出 JSON：{"title": "话题（中文）", "paragraphs": ["段落1", "..."], "questions": [{"qNo": 1, "stem": "题干", "qType": "题型英文标识", "options": ["选项正文", "...", "...", "..."], "answer": "A", "design": "针对弱点说明（中文，150字内）"}], "glossary": [{"en": "重点单词", "zh": "汉语翻译"}]}
规则：glossary 覆盖文中全部超纲词（5~8 个），全部英汉对照。`;

function noteHash(note: string): string {
  if (!note.trim()) return "none";
  return createHash("md5").update(note.trim()).digest("hex").slice(0, 16);
}

export const retroRouter = createRouter({
  /** 查询某条练习记录已生成的定制卷（用于结果区展示状态） */
  forRecord: privateQuery.input(z.object({ recordId: z.number() })).query(async ({ ctx, input }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(retroSets)
      .where(and(eq(retroSets.userId, ctx.user.id), eq(retroSets.recordId, input.recordId)))
      .orderBy(desc(retroSets.id));
    return rows.map((r) => ({ id: r.id, generatedId: r.generatedId, selfNote: r.selfNote, createdAt: r.createdAt, modelUsed: r.modelUsed }));
  }),

  /** 生成定制卷（幂等：同记录同自评 1 小时内复用） */
  create: privateQuery
    .input(
      z.object({
        kind: z.enum(["exam", "generated"]).default("exam"),
        refId: z.number(),
        selfNote: z.string().max(2000).default(""),
        /** 可选：直接指定记录 id（结果区有上下文时传入，省去查找） */
        recordId: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const uid = ctx.user.id;
      rateLimit(uid, "generate", 6); // 与随手生成同桶限流

      // 定位最近一条该内容的练习记录（必须带判分）
      const record = input.recordId
        ? await db.query.practiceRecords.findFirst({ where: and(eq(practiceRecords.id, input.recordId), eq(practiceRecords.userId, uid)) })
        : (
            await db
              .select()
              .from(practiceRecords)
              .where(and(eq(practiceRecords.userId, uid), eq(practiceRecords.source, input.kind), eq(practiceRecords.passageId, input.refId)))
              .orderBy(desc(practiceRecords.id))
              .limit(1)
          )[0];
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "找不到这套题的交卷记录，请先交卷" });
      if (!record.verdicts || Object.keys(record.verdicts).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "这套卷还没有判分记录，无法复盘定制" });
      }

      const hash = noteHash(input.selfNote);
      // 幂等：同记录同自评哈希 1 小时内复用
      const dupe = await db.query.retroSets.findFirst({
        where: and(eq(retroSets.userId, uid), eq(retroSets.recordId, record.id), eq(retroSets.noteHash, hash), gt(retroSets.createdAt, new Date(Date.now() - 3600_000))),
        orderBy: desc(retroSets.id),
      });
      if (dupe) {
        const set = await db.query.generatedSets.findFirst({ where: eq(generatedSets.id, dupe.generatedId) });
        if (set) {
          return { id: dupe.id, generatedId: set.id, set: normalizeGenerated(set.payload as Record<string, unknown>), reused: true };
        }
      }

      // 聚合三件套
      const content = await loadContent(input.kind, input.refId);
      const wrongQs = content.questions.filter((q) => record.verdicts![q.key] === false);
      if (wrongQs.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "这套卷全对，没有需要定制的弱点——去错题本挑几道陈年错题复习吧" });
      }
      // 本套错题行 + 诊断书
      const wrongRows = await db
        .select()
        .from(wrongItems)
        .where(and(eq(wrongItems.userId, uid), eq(wrongItems.source, input.kind), eq(wrongItems.refId, input.refId)));
      const analyses = wrongRows.length
        ? await db.select().from(wrongItemAnalyses).where(inArray(wrongItemAnalyses.wrongId, wrongRows.map((w) => w.id)))
        : [];
      const anaByWrong = new Map(analyses.map((a) => [a.wrongId, a]));

      const perQ = wrongQs.map((q) => {
        const w = wrongRows.find((r) => r.qNo === q.qNo);
        const a = w ? anaByWrong.get(w.id) : undefined;
        return {
          qNo: q.qNo,
          qType: q.qType,
          myAnswer: record.answers![q.key] ?? "",
          correctAnswer: q.answer ?? "",
          errorType: a?.errorType || w?.errorType || "comprehend",
          rootCause: (a?.rootCause ?? "").slice(0, 160),
          distractorPull: (a?.distractorPull ?? "").slice(0, 120),
          knowledgeGap: (a?.knowledgeGap ?? "").slice(0, 80),
        };
      });
      const dist: Record<string, number> = {};
      for (const p of perQ) dist[p.errorType] = (dist[p.errorType] ?? 0) + 1;
      const distZh = Object.fromEntries(Object.entries(dist).map(([k, v]) => [ERROR_TYPES[k as keyof typeof ERROR_TYPES]?.zh ?? k, v]));

      const context = { recordId: record.id, kind: input.kind, refId: input.refId, dist: distZh, perQ, selfNote: input.selfNote.trim() || null };

      const system = await promptOf("agent_retro", FALLBACK_RETRO, uid);
      const methodology = await buildMethodContext("agent_generator");
      const userMsg = `学生上一套题的错因分布：${JSON.stringify(distZh)}\n\n每道错题的诊断摘要：\n${JSON.stringify(perQ, null, 1)}\n\n学生的复盘自评：${input.selfNote.trim() || "（学生未写自评）"}\n\n方法论参考：\n${methodology}`;
      const { data: rawData, model } = await chatJson<Record<string, unknown>>("agent_generator", system, userMsg, { maxTokens: 16384, userId: uid });
      const data = normalizeGenerated(rawData);

      const topic = `复盘定制 · ${input.kind === "exam" ? "真题" : "仿真"}#${input.refId} · ${Object.keys(distZh).slice(0, 2).join("、")}`;
      const [{ id: genId }] = await db
        .insert(generatedSets)
        .values({ topic: topic.slice(0, 120), difficulty: "medium", payload: data, modelUsed: model, userId: uid })
        .$returningId();
      const [{ id: retroId }] = await db
        .insert(retroSets)
        .values({ userId: uid, recordId: record.id, noteHash: hash, selfNote: input.selfNote.trim() || null, context, generatedId: genId, modelUsed: model })
        .$returningId();
      return { id: retroId, generatedId: genId, set: data, reused: false };
    }),
});
