import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, privateQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  practiceRecords,
  wrongItems,
  wrongItemAnalyses,
  wrongInsights,
  vocabItems,
  generatedSets,
  essays,
  essayDrafts,
  userMaterials,
} from "@db/schema";

/** 数据导出中心：全量备份 / 恢复（全部 private，只导本人数据） */
export const exportRouter = createRouter({
  /** 全量备份：用户全部学习数据的结构化 JSON */
  fullBackup: privateQuery.query(async ({ ctx }) => {
    const db = getDb();
    const uid = ctx.user.id;
    const [records, wrongs, insights, vocab, gens, essayRows, drafts, materials] = await Promise.all([
      db.select().from(practiceRecords).where(eq(practiceRecords.userId, uid)).orderBy(desc(practiceRecords.createdAt)),
      db.select().from(wrongItems).where(eq(wrongItems.userId, uid)),
      db.select().from(wrongInsights).where(eq(wrongInsights.userId, uid)),
      db.select().from(vocabItems).where(eq(vocabItems.userId, uid)),
      db.select().from(generatedSets).where(eq(generatedSets.userId, uid)).orderBy(desc(generatedSets.createdAt)).limit(100),
      db.select().from(essays).where(eq(essays.userId, uid)),
      db.select().from(essayDrafts).where(eq(essayDrafts.userId, uid)),
      db.select().from(userMaterials).where(eq(userMaterials.userId, uid)),
    ]);
    const wrongIds = new Set(wrongs.map((w) => w.id));
    const analysesRows = wrongIds.size
      ? (await db.select().from(wrongItemAnalyses)).filter((a) => wrongIds.has(a.wrongId))
      : [];
    return {
      version: "v5",
      exportedAt: new Date().toISOString(),
      practiceRecords: records,
      wrongItems: wrongs,
      wrongItemAnalyses: analysesRows,
      wrongInsights: insights,
      vocabItems: vocab.map((v) => ({ ...v, image: undefined })), // 配图 dataURL 体积大，不随备份走（可再生）
      generatedSets: gens,
      essays: essayRows,
      essayDrafts: drafts,
      userMaterials: materials,
    };
  }),

  /** 恢复备份：按策略导入（skip=跳过已有 / overwrite=覆盖）。导入前 dryRun 预览计数。 */
  importBackup: privateQuery
    .input(
      z.object({
        backup: z.record(z.string(), z.unknown()),
        strategy: z.enum(["skip", "overwrite"]).default("skip"),
        dryRun: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const uid = ctx.user.id;
      const b = input.backup;
      if (b.version !== "v5") throw new TRPCError({ code: "BAD_REQUEST", message: "备份格式不受支持（需要 v5 格式）" });
      const report = { vocab: { add: 0, skip: 0 }, materials: { add: 0, skip: 0 }, insights: { add: 0 } };

      const vocab = (b.vocabItems as { word?: string; zh?: string; context?: string; familiarity?: number }[] | undefined) ?? [];
      const existingWords = new Set(
        (await db.select({ word: vocabItems.word }).from(vocabItems).where(eq(vocabItems.userId, uid))).map((r) => r.word),
      );
      for (const v of vocab) {
        if (!v.word) continue;
        if (existingWords.has(v.word)) {
          report.vocab.skip++;
          if (input.strategy === "overwrite" && !input.dryRun) {
            await db.update(vocabItems).set({ zh: v.zh ?? "", familiarity: v.familiarity ?? 0 }).where(eq(vocabItems.userId, uid));
          }
          continue;
        }
        report.vocab.add++;
        if (!input.dryRun) {
          await db.insert(vocabItems).values({ userId: uid, word: v.word, zh: v.zh ?? "", context: v.context ?? null, familiarity: v.familiarity ?? 0 });
          existingWords.add(v.word);
        }
      }

      const materials = (b.userMaterials as { kind?: string; title?: string; content?: string }[] | undefined) ?? [];
      const existingTitles = new Set(
        (await db.select({ title: userMaterials.title }).from(userMaterials).where(eq(userMaterials.userId, uid))).map((r) => r.title),
      );
      for (const m of materials) {
        if (!m.title || !m.content) continue;
        if (existingTitles.has(m.title) && input.strategy === "skip") {
          report.materials.skip++;
          continue;
        }
        report.materials.add++;
        if (!input.dryRun) {
          await db.insert(userMaterials).values({ userId: uid, kind: m.kind ?? "note", title: m.title, content: m.content });
        }
      }

      const insights = (b.wrongInsights as { errorType?: string; content?: string; status?: string }[] | undefined) ?? [];
      for (const i of insights) {
        if (!i.content) continue;
        report.insights.add++;
        if (!input.dryRun) {
          await db.insert(wrongInsights).values({
            userId: uid,
            wrongId: null,
            errorType: i.errorType ?? "",
            content: i.content,
            status: i.status === "understood" ? "understood" : "attention",
          });
        }
      }
      return { dryRun: input.dryRun, report };
    }),
});
