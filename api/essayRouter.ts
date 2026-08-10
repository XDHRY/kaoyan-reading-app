import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, privateQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { essays, essayDrafts, userMaterials } from "@db/schema";
import { chatJson, promptOf, FALLBACK_PROMPTS, extractItems } from "./lib/agentCore";

/** 引导式写作状态机：outline(待确认提纲) → drafting(逐段生成/确认) → done(已合成成稿)
 *  mode: guided=接力引导（逐段人机接力）；auto=一气呵成（AI 走完全阶段，人给参考意见再进化） */
interface DraftState {
  step: "outline" | "drafting" | "done";
  mode?: "guided" | "auto";
  outline: { para: number; purpose: string; points: string[]; keyExpressions: string[] }[];
  tips?: string;
  wordTarget?: string;
  paragraphs: string[];
  highlights: { para: number; highlights: string[]; note: string }[];
  currentPara: number;
  useMaterials: boolean;
}

const essayTypeEnum = z.enum(["letter", "notice", "memo", "picture", "chart"]);
const ESSAY_TYPE_ZH: Record<string, string> = {
  letter: "小作文·书信", notice: "小作文·通知", memo: "小作文·备忘录",
  picture: "大作文·图画作文", chart: "大作文·图表作文",
};

async function assertDraftOwner(id: number, userId: number) {
  const db = getDb();
  const draft = await db.query.essayDrafts.findFirst({ where: eq(essayDrafts.id, id) });
  if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "写作会话不存在" });
  if (draft.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该写作会话" });
  return draft;
}

async function assertEssayOwner(id: number, userId: number) {
  const db = getDb();
  const essay = await db.query.essays.findFirst({ where: eq(essays.id, id) });
  if (!essay) throw new TRPCError({ code: "NOT_FOUND", message: "作文不存在" });
  if (essay.userId !== userId) throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该作文" });
  return essay;
}

/** 宽容提取段落正文：模型偶尔不用约定键名（paragraph/text/content/draft），
 *  依次回退，最后取对象里最长的字符串值——宁宽容不误杀（v5.6 假推进根因修复） */
function extractParagraph(data: Record<string, unknown>): string {
  for (const k of ["paragraph", "text", "content", "draft", "essay"]) {
    const v = data[k];
    if (typeof v === "string" && v.trim().length > 20) return v.trim();
  }
  let best = "";
  for (const v of Object.values(data)) {
    if (typeof v === "string" && v.trim().length > best.length) best = v.trim();
  }
  return best;
}

/** 亮点归一化：提示词产出对象 {en,zh,why}，统一成一行字符串供前端直接渲染 */
function normalizeHighlights(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((h) => {
      if (typeof h === "string") return h;
      if (h && typeof h === "object") {
        const o = h as Record<string, unknown>;
        const en = String(o.en ?? "").trim();
        const zh = String(o.zh ?? "").trim();
        const why = String(o.why ?? "").trim();
        return [en, zh && `（${zh}）`, why && `——${why}`].filter(Boolean).join("");
      }
      return "";
    })
    .filter(Boolean);
}

/** 用户素材注入文本（useMaterials 开启时） */
async function materialsText(userId: number): Promise<string> {
  const db = getDb();
  const rows = await db.select().from(userMaterials).where(eq(userMaterials.userId, userId)).orderBy(desc(userMaterials.usedCount)).limit(6);
  if (rows.length === 0) return "";
  return rows.map((m) => `【${m.title}】${m.content.slice(0, 400)}`).join("\n");
}

export const essayRouter = createRouter({
  // —— 作文 CRUD ——
  list: privateQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db.select().from(essays).where(eq(essays.userId, ctx.user.id)).orderBy(desc(essays.updatedAt));
    return rows.map((e) => ({
      id: e.id, title: e.title, essayType: e.essayType, typeZh: ESSAY_TYPE_ZH[e.essayType] ?? e.essayType,
      prompt: e.prompt.slice(0, 120), score: e.score, reviewed: !!e.review, updatedAt: e.updatedAt, createdAt: e.createdAt,
    }));
  }),

  detail: privateQuery.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    return assertEssayOwner(input.id, ctx.user.id);
  }),

  save: privateQuery
    .input(
      z.object({
        id: z.number().optional(),
        title: z.string().max(128).default(""),
        essayType: essayTypeEnum,
        prompt: z.string().min(1).max(4000),
        content: z.string().max(20000).default(""),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      if (input.id) {
        await assertEssayOwner(input.id, ctx.user.id);
        await db
          .update(essays)
          .set({ title: input.title, essayType: input.essayType, prompt: input.prompt, content: input.content, updatedAt: new Date() })
          .where(eq(essays.id, input.id));
        return { id: input.id };
      }
      const [{ id }] = await db
        .insert(essays)
        .values({ userId: ctx.user.id, title: input.title || `${ESSAY_TYPE_ZH[input.essayType]}练习`, essayType: input.essayType, prompt: input.prompt, content: input.content })
        .$returningId();
      return { id };
    }),

  remove: privateQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    await assertEssayOwner(input.id, ctx.user.id);
    await db.delete(essays).where(eq(essays.id, input.id));
    return { ok: true };
  }),

  // —— 引导式写作（交互式状态机）——
  startDraft: privateQuery
    .input(
      z.object({
        essayType: essayTypeEnum,
        prompt: z.string().trim().min(10, "题目太短了：至少写一句完整的 Directions").max(4000),
        useMaterials: z.boolean().default(false),
        mode: z.enum(["guided", "auto"]).default("guided"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const uid = ctx.user.id;
      const materials = input.useMaterials ? await materialsText(uid) : "";
      const { data } = await chatJson<Record<string, unknown>>(
        "essay_outliner",
        await promptOf("essay_outliner", FALLBACK_PROMPTS.essay_outliner, uid),
        `作文类型：${ESSAY_TYPE_ZH[input.essayType]}\n题目：\n${input.prompt}${materials ? `\n\n学生的个人素材（可参考）：\n${materials}` : ""}`,
        { maxTokens: 8192, userId: uid },
      );
      const state: DraftState = {
        step: "outline",
        mode: input.mode,
        outline: extractItems(data, "写作提纲") as DraftState["outline"],
        tips: String(data.tips ?? ""),
        wordTarget: String(data.wordTarget ?? ""),
        paragraphs: [],
        highlights: [],
        currentPara: 1,
        useMaterials: input.useMaterials,
      };
      const [{ id }] = await db
        .insert(essayDrafts)
        .values({ userId: uid, title: `${ESSAY_TYPE_ZH[input.essayType]}练习`, essayType: input.essayType, prompt: input.prompt, state: state as unknown as Record<string, unknown> })
        .$returningId();
      return { id, state };
    }),

  /** 确认提纲（可整体替换为用户修改版）→ 进入逐段写作 */
  confirmOutline: privateQuery
    .input(z.object({ draftId: z.number(), outline: z.array(z.object({ para: z.number(), purpose: z.string(), points: z.array(z.string()), keyExpressions: z.array(z.string()) })).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const draft = await assertDraftOwner(input.draftId, ctx.user.id);
      const state = draft.state as unknown as DraftState;
      if (input.outline?.length) state.outline = input.outline;
      state.step = "drafting";
      state.currentPara = 1;
      await db.update(essayDrafts).set({ state: state as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(essayDrafts.id, draft.id));
      return { state };
    }),

  /** 生成下一段（用户可要求重生成：regenerate=true 覆盖当前段） */
  generateParagraph: privateQuery
    .input(z.object({ draftId: z.number(), regenerate: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const uid = ctx.user.id;
      const draft = await assertDraftOwner(input.draftId, uid);
      const state = draft.state as unknown as DraftState;
      if (state.step !== "drafting") throw new TRPCError({ code: "BAD_REQUEST", message: "请先确认提纲" });
      const paraNo = state.currentPara;
      const outlineItem = state.outline.find((o) => o.para === paraNo) ?? state.outline[paraNo - 1];
      if (!outlineItem) throw new TRPCError({ code: "BAD_REQUEST", message: "提纲段数已写完，请确认收稿" });
      const materials = state.useMaterials ? await materialsText(uid) : "";
      const { data } = await chatJson<Record<string, unknown>>(
        "essay_drafter",
        await promptOf("essay_drafter", FALLBACK_PROMPTS.essay_drafter, uid),
        `作文类型：${ESSAY_TYPE_ZH[draft.essayType]}\n题目：\n${draft.prompt}\n\n完整提纲：\n${JSON.stringify(state.outline)}\n\n当前要写第 ${paraNo} 段：${JSON.stringify(outlineItem)}\n已完成段落：\n${state.paragraphs.join("\n\n") || "（无）"}${materials ? `\n\n学生的个人素材（可参考）：\n${materials}` : ""}`,
        { maxTokens: 4096, userId: uid },
      );
      const paragraph = extractParagraph(data);
      if (!paragraph) throw new Error("模型未返回段落正文，请重试");
      state.paragraphs[paraNo - 1] = paragraph;
      state.highlights[paraNo - 1] = { para: paraNo, highlights: normalizeHighlights(data.highlights), note: String(data.note ?? "") };
      await db.update(essayDrafts).set({ state: state as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(essayDrafts.id, draft.id));
      return { state, paragraph, paraNo, totalParas: state.outline.length };
    }),

  /** 按人的参考意见进化提纲（仅提纲阶段可用） */
  reviseOutline: privateQuery
    .input(z.object({ draftId: z.number(), note: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const uid = ctx.user.id;
      const draft = await assertDraftOwner(input.draftId, uid);
      const state = draft.state as unknown as DraftState;
      if (state.step !== "outline") throw new TRPCError({ code: "BAD_REQUEST", message: "提纲已确认，进入写作阶段后不能再改提纲" });
      const { data } = await chatJson<Record<string, unknown>>(
        "essay_outliner",
        await promptOf("essay_outliner", FALLBACK_PROMPTS.essay_outliner, uid),
        `作文类型：${ESSAY_TYPE_ZH[draft.essayType]}\n题目：\n${draft.prompt}\n\n上一版提纲：\n${JSON.stringify(state.outline)}\n\n学生的修改意见：${input.note}\n\n请按意见给出进化后的完整提纲。`,
        { maxTokens: 4096, userId: uid },
      );
      state.outline = extractItems(data, "写作提纲") as DraftState["outline"];
      state.tips = String(data.tips ?? state.tips ?? "");
      await db.update(essayDrafts).set({ state: state as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(essayDrafts.id, draft.id));
      return { state };
    }),

  /** 一气呵成：AI 依次写完所有剩余段落（auto 模式主入口；guided 模式亦可用来补全余段） */
  generateAll: privateQuery
    .input(z.object({ draftId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const uid = ctx.user.id;
      const draft = await assertDraftOwner(input.draftId, uid);
      const state = draft.state as unknown as DraftState;
      if (state.step !== "drafting") throw new TRPCError({ code: "BAD_REQUEST", message: "请先确认提纲" });
      const materials = state.useMaterials ? await materialsText(uid) : "";
      const total = state.outline.length;
      for (let paraNo = 1; paraNo <= total; paraNo++) {
        if (state.paragraphs[paraNo - 1]) continue; // 幂等：已写的段跳过
        const outlineItem = state.outline.find((o) => o.para === paraNo) ?? state.outline[paraNo - 1];
        const { data } = await chatJson<Record<string, unknown>>(
          "essay_drafter",
          await promptOf("essay_drafter", FALLBACK_PROMPTS.essay_drafter, uid),
          `作文类型：${ESSAY_TYPE_ZH[draft.essayType]}\n题目：\n${draft.prompt}\n\n完整提纲：\n${JSON.stringify(state.outline)}\n\n当前要写第 ${paraNo} 段：${JSON.stringify(outlineItem)}\n已完成段落：\n${state.paragraphs.filter(Boolean).join("\n\n") || "（无）"}${materials ? `\n\n学生的个人素材（可参考）：\n${materials}` : ""}`,
          { maxTokens: 4096, userId: uid },
        );
        const paragraph = extractParagraph(data);
        if (!paragraph) throw new Error(`第 ${paraNo} 段未生成成功，请重试（已完成的段落会保留）`);
        state.paragraphs[paraNo - 1] = paragraph;
        state.highlights[paraNo - 1] = { para: paraNo, highlights: normalizeHighlights(data.highlights), note: String(data.note ?? "") };
        // 每段落库一次：中途失败不丢已完成进度
        await db.update(essayDrafts).set({ state: state as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(essayDrafts.id, draft.id));
      }
      state.currentPara = total + 1;
      await db.update(essayDrafts).set({ state: state as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(essayDrafts.id, draft.id));
      return { state, totalParas: total };
    }),

  /** 按人的参考意见进化某一段（两种模式通用：人给意见 → AI 重写该段） */
  reviseParagraph: privateQuery
    .input(z.object({ draftId: z.number(), paraNo: z.number(), note: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const uid = ctx.user.id;
      const draft = await assertDraftOwner(input.draftId, uid);
      const state = draft.state as unknown as DraftState;
      if (state.step !== "drafting") throw new TRPCError({ code: "BAD_REQUEST", message: "请先确认提纲" });
      const current = state.paragraphs[input.paraNo - 1];
      if (!current) throw new TRPCError({ code: "BAD_REQUEST", message: "该段还没有正文，请先生成或自己写" });
      const outlineItem = state.outline.find((o) => o.para === input.paraNo) ?? state.outline[input.paraNo - 1];
      const materials = state.useMaterials ? await materialsText(uid) : "";
      const { data } = await chatJson<Record<string, unknown>>(
        "essay_drafter",
        await promptOf("essay_drafter", FALLBACK_PROMPTS.essay_drafter, uid),
        `作文类型：${ESSAY_TYPE_ZH[draft.essayType]}\n题目：\n${draft.prompt}\n\n完整提纲：\n${JSON.stringify(state.outline)}\n\n当前要重写第 ${input.paraNo} 段：${JSON.stringify(outlineItem)}\n该段现状：\n${current}\n\n学生的修改意见：${input.note}\n其他段落（保持衔接）：\n${state.paragraphs.filter((p, i) => p && i !== input.paraNo - 1).join("\n\n") || "（无）"}${materials ? `\n\n学生的个人素材（可参考）：\n${materials}` : ""}`,
        { maxTokens: 4096, userId: uid },
      );
      const paragraph = extractParagraph(data);
      if (!paragraph) throw new Error("模型未返回段落正文，请重试");
      state.paragraphs[input.paraNo - 1] = paragraph;
      state.highlights[input.paraNo - 1] = { para: input.paraNo, highlights: normalizeHighlights(data.highlights), note: String(data.note ?? "") };
      await db.update(essayDrafts).set({ state: state as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(essayDrafts.id, draft.id));
      return { state, paragraph, paraNo: input.paraNo };
    }),

  /** 确认当前段（可替换为用户修改版）→ 推进到下一段 */
  confirmParagraph: privateQuery
    .input(z.object({ draftId: z.number(), paraNo: z.number(), content: z.string().min(1).max(8000) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const draft = await assertDraftOwner(input.draftId, ctx.user.id);
      const state = draft.state as unknown as DraftState;
      state.paragraphs[input.paraNo - 1] = input.content;
      if (input.paraNo >= state.currentPara) state.currentPara = input.paraNo + 1; // 回改旧段不倒退进度
      await db.update(essayDrafts).set({ state: state as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(essayDrafts.id, draft.id));
      return { state, nextPara: state.currentPara, totalParas: state.outline.length };
    }),

  /** 收稿：合成完整作文 → 生成正式作文记录 */
  finishDraft: privateQuery
    .input(z.object({ draftId: z.number(), title: z.string().max(128).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const draft = await assertDraftOwner(input.draftId, ctx.user.id);
      const state = draft.state as unknown as DraftState;
      const content = state.paragraphs.filter(Boolean).join("\n\n");
      if (!content) throw new TRPCError({ code: "BAD_REQUEST", message: "还没有任何段落" });
      const [{ id: essayId }] = await db
        .insert(essays)
        .values({
          userId: ctx.user.id,
          title: input.title || draft.title,
          essayType: draft.essayType,
          prompt: draft.prompt,
          content,
        })
        .$returningId();
      state.step = "done";
      await db.update(essayDrafts).set({ state: state as unknown as Record<string, unknown>, essayId, updatedAt: new Date() }).where(eq(essayDrafts.id, draft.id));
      return { essayId, content };
    }),

  draftStatus: privateQuery.input(z.object({ draftId: z.number() })).query(async ({ ctx, input }) => {
    const draft = await assertDraftOwner(input.draftId, ctx.user.id);
    return { id: draft.id, title: draft.title, essayType: draft.essayType, prompt: draft.prompt, state: draft.state, essayId: draft.essayId, updatedAt: draft.updatedAt };
  }),

  /** 丢弃草稿（未成文的写作会话；收稿后的正式作文不受影响） */
  removeDraft: privateQuery.input(z.object({ draftId: z.number() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    await assertDraftOwner(input.draftId, ctx.user.id);
    await db.delete(essayDrafts).where(eq(essayDrafts.id, input.draftId));
    return { ok: true };
  }),

  draftList: privateQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db.select().from(essayDrafts).where(eq(essayDrafts.userId, ctx.user.id)).orderBy(desc(essayDrafts.updatedAt));
    return rows.map((d) => ({
      id: d.id, title: d.title, essayType: d.essayType, step: (d.state as { step?: string }).step ?? "outline",
      essayId: d.essayId, updatedAt: d.updatedAt,
    }));
  }),

  // —— AI 批改 ——
  review: privateQuery.input(z.object({ essayId: z.number() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const uid = ctx.user.id;
    const essay = await assertEssayOwner(input.essayId, uid);
    if (!essay.content.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "作文还没有正文，无法批改" });
    const { data, model } = await chatJson<Record<string, unknown>>(
      "essay_reviewer",
      await promptOf("essay_reviewer", FALLBACK_PROMPTS.essay_reviewer, uid),
      `作文类型：${ESSAY_TYPE_ZH[essay.essayType] ?? essay.essayType}\n题目：\n${essay.prompt}\n\n学生作文：\n${essay.content}`,
      { maxTokens: 12288, userId: uid },
    );
    const score = Number(data.score) || null;
    await db.update(essays).set({ review: { ...data, modelUsed: model }, score, updatedAt: new Date() }).where(eq(essays.id, essay.id));
    return { review: { ...data, modelUsed: model }, score };
  }),

  // —— 素材库 ——
  materialList: privateQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db.select().from(userMaterials).where(eq(userMaterials.userId, ctx.user.id)).orderBy(desc(userMaterials.createdAt));
  }),

  materialSave: privateQuery
    .input(
      z.object({
        id: z.number().optional(),
        kind: z.enum(["template", "sentence", "note", "model", "vocab"]).default("note"),
        title: z.string().min(1).max(128),
        content: z.string().min(1).max(10000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      if (input.id) {
        const row = await db.query.userMaterials.findFirst({ where: eq(userMaterials.id, input.id) });
        if (!row || row.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "素材不存在" });
        await db.update(userMaterials).set({ kind: input.kind, title: input.title, content: input.content }).where(eq(userMaterials.id, input.id));
        return { id: input.id };
      }
      const [{ id }] = await db
        .insert(userMaterials)
        .values({ userId: ctx.user.id, kind: input.kind, title: input.title, content: input.content })
        .$returningId();
      return { id };
    }),

  materialRemove: privateQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const row = await db.query.userMaterials.findFirst({ where: eq(userMaterials.id, input.id) });
    if (!row || row.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "素材不存在" });
    await db.delete(userMaterials).where(eq(userMaterials.id, input.id));
    return { ok: true };
  }),
});
