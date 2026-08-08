import { z } from "zod";
import { and, eq, asc, desc, inArray, gt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery, privateQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { passages, questions, analyses, practiceRecords, generatedSets, wrongItems, pipelineJobs, siteSettings, answerDiffs } from "@db/schema";
import { buildMethodContext } from "./lib/methodKnowledge";
import { runPipelineJob } from "./lib/pipelineRunner";
import { loadContent, normalizeGenerated, chatJson, promptOf, officialOf, passageTextOf, extractItems, buildLocateContext, FALLBACK_PROMPTS } from "./lib/agentCore";
import { ERROR_TYPES } from "@contracts/constants";
import { rateLimit } from "./lib/rate";

/** 错因六分法合法键集合（差异分析 rootCause 的校验口径，与 insightRouter 一致） */
const VALID_ROOT_CAUSES = new Set(Object.keys(ERROR_TYPES));
/** 模型偶发返回中文错因名时的反查表（含常见同义写法） */
const ROOT_CAUSE_ZH: Record<string, string> = {
  定位错误: "locate", 定位偏差: "locate",
  理解偏差: "comprehend", 理解错误: "comprehend",
  过度推断: "overinfer", 过度推理: "overinfer",
  细节忽略: "detail", 细节疏漏: "detail",
  题型误判: "mistype",
  词汇障碍: "vocab", 词汇问题: "vocab",
};
/**
 * 从模型输出里提取六选一错因标识：容忍键名变体（root_cause/cause/errorType）、
 * 大小写、中文写法、以及把标识嵌在解释文字里的情况；实在提取不到返回空串交由调用方决定。
 */
function pickRootCause(data: Record<string, unknown>): string {
  const raw = String(data.rootCause ?? data.root_cause ?? data.cause ?? data.errorType ?? "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (VALID_ROOT_CAUSES.has(lower)) return lower;
  const zhKey = ROOT_CAUSE_ZH[raw.replace(/[（(].*$/, "").trim()];
  if (zhKey) return zhKey;
  for (const k of VALID_ROOT_CAUSES) if (lower.includes(k)) return k;
  for (const [zh, en] of Object.entries(ROOT_CAUSE_ZH)) if (raw.includes(zh)) return en;
  return "";
}

/** 从审题结果提取题型集合，用于知识引擎精准装配 */
function extractQTypes(questionAnalysis: Record<string, unknown>[]): string[] {
  return Array.from(
    new Set(
      questionAnalysis
        .map((i) => String((i as { qType?: string }).qType ?? ""))
        .filter((t) => t && t !== "unknown"),
    ),
  );
}

/** 任务心跳门槛：updatedAt 10 分钟内有更新才视为活任务（静止=僵尸，执行器已死） */
const HEARTBEAT_MS = 10 * 60 * 1000;
const isAlive = (job: { status: string; updatedAt: Date }) =>
  job.status === "running" && Date.now() - job.updatedAt.getTime() < HEARTBEAT_MS;

// 限速器已抽到 api/lib/rate.ts（retro/interactive 等路由共用）



function passageText(p: typeof passages.$inferSelect): string {
  return p.paragraphs.map((para, i) => `[第${i + 1}段] ${para}`).join("\n\n");
}

async function loadPassage(id: number) {
  const db = getDb();
  const passage = await db.query.passages.findFirst({ where: eq(passages.id, id) });
  if (!passage) throw new Error("真题不存在");
  const qs = await db.select().from(questions).where(eq(questions.passageId, id)).orderBy(asc(questions.qNo));
  return { passage, questions: qs };
}

// 提示词统一收口到 agentCore.FALLBACK_PROMPTS（单一事实源，两处路由共用）

export const agentRouter = createRouter({
  /** 启动解析任务（后台执行，立即返回任务号；同一用户同篇未完成任务复用） */
  startPipeline: privateQuery
    .input(
      z.object({
        kind: z.enum(["exam", "generated"]).default("exam"),
        refId: z.number(),
        answers: z.record(z.string(), z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      rateLimit(ctx.user.id, "pipeline", 30);
      const running = await db.query.pipelineJobs.findFirst({
        where: and(
          eq(pipelineJobs.userId, ctx.user.id),
          eq(pipelineJobs.kind, input.kind),
          eq(pipelineJobs.refId, input.refId),
          eq(pipelineJobs.status, "running"),
        ),
      });
      // 心跳门槛：仅活任务可复用；僵尸（重启残留/卡死）就地标记 error，绝不再返回给前端
      if (running && isAlive(running)) return { jobId: running.id, reused: true };
      if (running) {
        await db
          .update(pipelineJobs)
          .set({ status: "error", errorMsg: "任务心跳超时（可能服务重启或上游卡死），已自动终止，可重试续跑" })
          .where(eq(pipelineJobs.id, running.id));
      }
      // 暂停中的同内容任务：直接交还前端（用户可「继续」续跑，不会另起新任务重复扣额度）
      const paused = await db.query.pipelineJobs.findFirst({
        where: and(
          eq(pipelineJobs.userId, ctx.user.id),
          eq(pipelineJobs.kind, input.kind),
          eq(pipelineJobs.refId, input.refId),
          eq(pipelineJobs.status, "paused"),
        ),
        orderBy: desc(pipelineJobs.id),
      });
      if (paused) return { jobId: paused.id, reused: true };
      const [{ id }] = await db
        .insert(pipelineJobs)
        .values({
          userId: ctx.user.id,
          kind: input.kind,
          refId: input.refId,
          stages: [],
          payload: {},
          answers: input.answers ?? null,
        })
        .$returningId();
      void runPipelineJob(id);
      return { jobId: id, reused: false };
    }),

  /** 轮询任务状态（本人或管理员可见）。僵尸 running 在此就地终审判 error：前端永远不会无限空转 */
  pipelineStatus: privateQuery.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const db = getDb();
    const job = await db.query.pipelineJobs.findFirst({ where: eq(pipelineJobs.id, input.id) });
    if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    if (job.userId !== ctx.user.id && ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "无权查看该任务" });
    }
    if (job.status === "running" && !isAlive(job)) {
      await db
        .update(pipelineJobs)
        .set({ status: "error", errorMsg: "任务心跳超时（可能服务重启或上游卡死），已自动终止，可重试续跑" })
        .where(eq(pipelineJobs.id, job.id));
      return { ...job, status: "error" as const, errorMsg: "任务心跳超时（可能服务重启或上游卡死），已自动终止，可重试续跑" };
    }
    return job;
  }),

  /** 查找本人在某内容上的最新任务（页面刷新/切换后恢复解析进度用；僵尸任务先自动终结再返回） */
  activeJob: privateQuery
    .input(z.object({ kind: z.enum(["exam", "generated"]).default("exam"), refId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const job = await db.query.pipelineJobs.findFirst({
        where: and(
          eq(pipelineJobs.userId, ctx.user.id),
          eq(pipelineJobs.kind, input.kind),
          eq(pipelineJobs.refId, input.refId),
        ),
        orderBy: desc(pipelineJobs.id),
      });
      if (!job) return null;
      if (job.status === "running" && !isAlive(job)) {
        await db
          .update(pipelineJobs)
          .set({ status: "error", errorMsg: "任务心跳超时（可能服务重启或上游卡死），已自动终止，可重试续跑" })
          .where(eq(pipelineJobs.id, job.id));
        return { id: job.id, status: "error" as const };
      }
      return { id: job.id, status: job.status };
    }),

  /** 个人偏好：解析面板默认折叠/展开等（存 site_settings，键带用户前缀） */
  getPref: privateQuery.input(z.object({ key: z.string().max(64) })).query(async ({ ctx, input }) => {
    const db = getDb();
    const row = await db.query.siteSettings.findFirst({ where: eq(siteSettings.k, `u${ctx.user.id}:${input.key}`) });
    return { value: row?.v ?? null };
  }),
  setPref: privateQuery
    .input(z.object({ key: z.string().max(64), value: z.string().max(255) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .insert(siteSettings)
        .values({ k: `u${ctx.user.id}:${input.key}`, v: input.value })
        .onDuplicateKeyUpdate({ set: { v: input.value } });
      return { ok: true };
    }),

  /** 学习档案：本人全部练习记录（附带内容标题与解析任务号） */
  history: privateQuery.query(async ({ ctx }) => {
    const db = getDb();
    const records = await db
      .select()
      .from(practiceRecords)
      .where(eq(practiceRecords.userId, ctx.user.id))
      .orderBy(desc(practiceRecords.createdAt));
    const examIds = [...new Set(records.filter((r) => r.source === "exam").map((r) => r.passageId))];
    const genIds = [...new Set(records.filter((r) => r.source === "generated").map((r) => r.passageId))];
    const examRows = examIds.length
      ? await db.select().from(passages).where(inArray(passages.id, examIds))
      : [];
    const genRows = genIds.length
      ? await db.select().from(generatedSets).where(inArray(generatedSets.id, genIds))
      : [];
    const examMap = new Map(examRows.map((p) => [p.id, `${p.year} 年 Text${p.textNo}`]));
    const genMap = new Map(genRows.map((g) => [g.id, `AI 生成 · ${g.topic}`]));
    // 每篇内容最近一次已完成的解析任务（供回看完整解析）
    const jobs = await db
      .select()
      .from(pipelineJobs)
      .where(and(eq(pipelineJobs.userId, ctx.user.id), eq(pipelineJobs.status, "done")))
      .orderBy(desc(pipelineJobs.id));
    const latestJob = new Map<string, number>();
    for (const j of jobs) {
      const key = `${j.kind}:${j.refId}`;
      if (!latestJob.has(key)) latestJob.set(key, j.id);
    }
    return records.map((r) => {
      const total = r.verdicts ? Object.keys(r.verdicts).length : 0;
      const correct = r.verdicts ? Object.values(r.verdicts).filter(Boolean).length : 0;
      return {
        id: r.id,
        source: r.source,
        refId: r.passageId,
        title: r.source === "exam" ? (examMap.get(r.passageId) ?? `真题 #${r.passageId}`) : (genMap.get(r.passageId) ?? `生成题 #${r.passageId}`),
        answers: r.answers,
        verdicts: r.verdicts,
        total,
        correct,
        durationSec: r.durationSec,
        createdAt: r.createdAt,
        jobId: latestJob.get(`${r.source}:${r.passageId}`) ?? null,
      };
    });
  }),

  /** 从断点重试（已完成的阶段自动跳过） */
  retryPipeline: privateQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const job = await db.query.pipelineJobs.findFirst({ where: eq(pipelineJobs.id, input.id) });
    if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    if (job.userId !== ctx.user.id && ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该任务" });
    }
    // 活任务防双跑；僵尸任务（心跳静止）允许重试接管，不再堵死
    if (isAlive(job)) return { ok: true, already: true };
    // 失败/卡住的阶段重置为 pending，payload 中已有产物会被执行器跳过
    const stages = job.stages.map((s) =>
      s.status === "error" || s.status === "running" ? { ...s, status: "pending" as const, error: undefined } : s,
    );
    await db
      .update(pipelineJobs)
      .set({ status: "running", errorMsg: "", stages })
      .where(eq(pipelineJobs.id, job.id));
    void runPipelineJob(job.id);
    return { ok: true };
  }),

  /** 暂停：活任务 → paused。执行器在下一个阶段检查点安静退出，已完成产物全部保留 */
  pausePipeline: privateQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const job = await db.query.pipelineJobs.findFirst({ where: eq(pipelineJobs.id, input.id) });
    if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    if (job.userId !== ctx.user.id && ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该任务" });
    }
    if (job.status !== "running") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "只有进行中的任务才能暂停" });
    }
    if (!isAlive(job)) {
      // 僵尸不可暂停：直接按心跳超时终结，让前端落到可重试的失败态
      await db
        .update(pipelineJobs)
        .set({ status: "error", errorMsg: "任务心跳超时（可能服务重启或上游卡死），已自动终止，可重试续跑" })
        .where(eq(pipelineJobs.id, job.id));
      throw new TRPCError({ code: "BAD_REQUEST", message: "任务已卡死，已帮你终止——请用断点重试" });
    }
    await db.update(pipelineJobs).set({ status: "paused" }).where(eq(pipelineJobs.id, job.id));
    return { ok: true };
  }),

  /** 继续：paused → running（断点续跑，与重试同一执行路径） */
  resumePipeline: privateQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const job = await db.query.pipelineJobs.findFirst({ where: eq(pipelineJobs.id, input.id) });
    if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    if (job.userId !== ctx.user.id && ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该任务" });
    }
    if (job.status !== "paused") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "只有已暂停的任务才能继续" });
    }
    const stages = job.stages.map((s) => (s.status === "running" ? { ...s, status: "pending" as const } : s));
    await db.update(pipelineJobs).set({ status: "running", errorMsg: "", stages }).where(eq(pipelineJobs.id, job.id));
    void runPipelineJob(job.id);
    return { ok: true };
  }),

  /** 停止：running/paused → cancelled（执行器下一检查点识别即终止；产物保留可断点重试） */
  cancelPipeline: privateQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const job = await db.query.pipelineJobs.findFirst({ where: eq(pipelineJobs.id, input.id) });
    if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
    if (job.userId !== ctx.user.id && ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该任务" });
    }
    if (job.status !== "running" && job.status !== "paused") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "任务已结束，无需停止" });
    }
    const stages = job.stages.map((s) =>
      s.status === "running" ? { ...s, status: "error" as const, error: "已停止" } : s,
    );
    await db
      .update(pipelineJobs)
      .set({ status: "cancelled", errorMsg: "已被用户停止，可从断点重试", stages })
      .where(eq(pipelineJobs.id, job.id));
    return { ok: true };
  }),

  /** A1 结构分析 */
  analyzeStructure: privateQuery
    .input(z.object({ passageId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { passage } = await loadPassage(input.passageId);
      const uid = ctx.user?.id;
      const system =
        (await promptOf("agent_structure", FALLBACK_PROMPTS.agent_structure, uid)) +
        (await buildMethodContext("agent_structure"));
      const { data, model } = await chatJson<Record<string, unknown>>(
        "agent_structure",
        system,
        passageText(passage),
        { userId: uid },
      );
      return { structure: data, model };
    }),

  /** A2 审题（一次审全部题） */
  analyzeQuestions: privateQuery
    .input(z.object({ passageId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { passage, questions: qs } = await loadPassage(input.passageId);
      const uid = ctx.user?.id;
      const system =
        (await promptOf("agent_question", FALLBACK_PROMPTS.agent_question, uid)) +
        (await buildMethodContext("agent_question"));
      const qText = qs
        .map((q) => `第${q.qNo}题：${q.stem}\n选项：${q.options.map((o, i) => `${"ABCD"[i]}. ${o}`).join(" / ")}`)
        .join("\n\n");
      const { data, model } = await chatJson<Record<string, unknown>>(
        "agent_question",
        system,
        `文章：\n${passageText(passage)}\n\n题目：\n${qText}`,
        { userId: uid },
      );
      return { items: extractItems(data, "审题结果"), model };
    }),

  /** A3 定位 */
  locate: privateQuery
    .input(z.object({ passageId: z.number(), questionAnalysis: z.array(z.record(z.string(), z.unknown())) }))
    .mutation(async ({ ctx, input }) => {
      const { passage } = await loadPassage(input.passageId);
      const uid = ctx.user?.id;
      const system =
        (await promptOf("agent_locator", FALLBACK_PROMPTS.agent_locator, uid)) +
        (await buildMethodContext("agent_locator", extractQTypes(input.questionAnalysis)));
      const { data, model } = await chatJson<Record<string, unknown>>(
        "agent_locator",
        system,
        `文章：\n${passageText(passage)}\n\n审题结果：\n${JSON.stringify(input.questionAnalysis, null, 2)}`,
        { userId: uid },
      );
      return { items: extractItems(data, "定位结果"), model };
    }),

  /** A4 解题 + A5 校验（打回最多重跑 2 次） */
  solve: privateQuery
    .input(
      z.object({
        passageId: z.number(),
        questionAnalysis: z.array(z.record(z.string(), z.unknown())),
        locateResult: z.array(z.record(z.string(), z.unknown())),
        structure: z.record(z.string(), z.unknown()).optional(),
        userAnswers: z.record(z.string(), z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { passage, questions: qs } = await loadPassage(input.passageId);
      const uid = ctx.user?.id;
      const qTypes = extractQTypes(input.questionAnalysis);
      const solverSystem =
        (await promptOf("agent_solver", FALLBACK_PROMPTS.agent_solver, uid)) +
        (await buildMethodContext("agent_solver", qTypes));
      const reviewerSystem =
        (await promptOf("agent_reviewer", FALLBACK_PROMPTS.agent_reviewer, uid)) +
        (await buildMethodContext("agent_reviewer"));
      const qText = qs
        .map((q) => `第${q.qNo}题：${q.stem}\n${q.options.map((o, i) => `${"ABCD"[i]}. ${o}`).join("\n")}`)
        .join("\n\n");
      // v5.9：逐题解题 + 校验官单次复核。废除批量解题与打回重解循环——
      // 5 题批量一次 6~8 分钟、打回重跑最多 3 轮，是解题阶段卡 10 分钟超限的根因。
      const solveItems: Record<string, unknown>[] = [];
      const trace: { stage: string; ok: boolean; note: string }[] = [];
      let lastModel = "";

      for (const q of qs) {
        const qaItem = input.questionAnalysis.find((x) => Number(x.qNo) === q.qNo) ?? {};
        const lcItem = input.locateResult.find((x) => Number(x.qNo) === q.qNo) ?? {};
        const thisCtx = buildLocateContext(passage.paragraphs, [lcItem]);
        const thisQText = `第${q.qNo}题：${q.stem}\n${q.options.map((o, i) => `${"ABCD"[i]}. ${o}`).join("\n")}`;
        const userMsg = `文章：\n${passageText(passage)}\n\n${thisQText}\n\n本题审题结果：\n${JSON.stringify(qaItem)}\n\n本题定位结果：\n${JSON.stringify(lcItem)}\n\n本题定位与上下文窗口（判断词义/指代/态度必须参考）：\n${thisCtx}`;
        const solved = await chatJson<Record<string, unknown>>(
          "agent_solver",
          solverSystem,
          userMsg,
          { maxTokens: 8192, userId: uid },
        );
        const item = extractItems(solved.data, "解题结果")[0];
        if (!item || typeof item !== "object") throw new Error(`第${q.qNo}题解题结果为空`);
        (item as Record<string, unknown>).qNo = q.qNo;
        solveItems.push(item as Record<string, unknown>);
        lastModel = solved.model;
      }
      trace.push({ stage: "solve", ok: true, note: `逐题解题 ${solveItems.length} 题完成` });

      const reviewed = await chatJson<Record<string, unknown>>(
        "agent_reviewer",
        reviewerSystem,
        `文章：\n${passageText(passage)}\n\n题目：\n${qText}\n\n审题：\n${JSON.stringify(input.questionAnalysis)}\n\n定位：\n${JSON.stringify(input.locateResult)}\n\n解题：\n${JSON.stringify({ items: solveItems })}`,
        { maxTokens: 8192, userId: uid },
      );
      const reviewData = reviewed.data;
      const pass = reviewData.pass === true;
      trace.push({
        stage: "review",
        ok: pass,
        note: pass ? "校验通过" : `校验留疑（不重跑，供学生参考）：${JSON.stringify(reviewData.issues ?? []).slice(0, 200)}`,
      });
      const solveData: { items: unknown[] } = { items: solveItems };

      // 用户答案对错判定：官方答案为唯一基准，AI 答案仅作降级
      const verdicts: Record<string, boolean> = {};
      if (input.userAnswers && solveData) {
        for (const item of solveData.items as { qNo: number; answer: string }[]) {
          const q = qs.find((x) => x.qNo === item.qNo);
          if (q && input.userAnswers[String(q.id)]) {
            const official = officialOf(q.answer, item.answer);
            if (official) verdicts[String(q.id)] = input.userAnswers[String(q.id)] === official;
          }
        }
      }

      return {
        solved: solveData?.items ?? [],
        review: reviewData,
        trace,
        verdicts,
        model: lastModel,
      };
    }),

  /** 保存解析产物 + 做题记录（含错题自动入册；skipAnalysis=任务流已归档时跳过）。
   *  安全：userId 只从 session 取（客户端传的一律忽略），根除 IDOR。 */
  saveResult: privateQuery
    .input(
      z.object({
        kind: z.enum(["exam", "generated"]).default("exam"),
        passageId: z.number(),
        payload: z.record(z.string(), z.unknown()),
        modelUsed: z.string(),
        answers: z.record(z.string(), z.string()).optional(),
        verdicts: z.record(z.string(), z.boolean()).optional(),
        solvedItems: z
          .array(z.object({ qNo: z.number(), answer: z.string(), qType: z.string().optional() }))
          .optional(),
        durationSec: z.number().optional(),
        skipAnalysis: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const uid = ctx.user.id;
      if (!input.skipAnalysis) {
        await db.insert(analyses).values({
          source: input.kind,
          passageId: input.passageId,
          payload: input.payload,
          modelUsed: input.modelUsed,
        });
      }
      if (input.answers) {
        await db.insert(practiceRecords).values({
          userId: uid,
          source: input.kind,
          passageId: input.passageId,
          answers: input.answers,
          verdicts: input.verdicts ?? null,
          durationSec: input.durationSec ?? null,
        });
        // 错题自动入册（同一用户同一题只留最新一条；真题/生成题通用；正确答案官方优先）
        if (input.verdicts) {
          const content = await loadContent(input.kind, input.passageId);
          for (const q of content.questions) {
            const mine = input.answers[q.key];
            const ok = input.verdicts[q.key];
            if (!mine || ok !== false) continue;
            const solved = input.solvedItems?.find((s) => s.qNo === q.qNo);
            const correctAnswer = officialOf(q.answer, solved?.answer);
            if (!correctAnswer) continue;
            const existing = await db.query.wrongItems.findFirst({
              where: (t, { and, eq: e, isNull }) =>
                input.kind === "exam"
                  ? and(e(t.userId, uid), e(t.source, "exam"), e(t.questionId, Number(q.key)))
                  : and(
                      e(t.userId, uid),
                      e(t.source, "generated"),
                      e(t.refId, input.passageId),
                      e(t.qNo, q.qNo),
                      isNull(t.questionId),
                    ),
            });
            if (existing) {
              await db
                .update(wrongItems)
                .set({ myAnswer: mine, correctAnswer, mastered: false, attempts: existing.attempts + 1 })
                .where(eq(wrongItems.id, existing.id));
            } else {
              await db.insert(wrongItems).values({
                userId: uid,
                source: input.kind,
                refId: input.passageId,
                questionId: input.kind === "exam" ? Number(q.key) : null,
                qNo: q.qNo,
                qType: q.qType,
                stem: q.stem,
                options: q.options,
                correctAnswer,
                myAnswer: mine,
              });
            }
          }
        }
      }
      return { ok: true };
    }),

  /** 历史解析列表（真题/生成题按 source 区分） */
  analysisList: publicQuery
    .input(z.object({ kind: z.enum(["exam", "generated"]).default("exam"), passageId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(analyses)
        .where(and(eq(analyses.source, input.kind), eq(analyses.passageId, input.passageId)))
        .orderBy(desc(analyses.createdAt));
    }),

  /** 学习统计（仪表盘 + 统计页四图）。SQL 下推：只取本人记录，不再全表加载 */
  stats: privateQuery.query(async ({ ctx }) => {
    const db = getDb();
    const userId = ctx.user.id;
    const records = await db
      .select()
      .from(practiceRecords)
      .where(eq(practiceRecords.userId, userId))
      .orderBy(desc(practiceRecords.createdAt));
    const examRecords = records.filter((r) => r.source === "exam");
    const allPassages = await db.select().from(passages);
    const doneSet = new Set(examRecords.map((r) => r.passageId));
    let correct = 0;
    let total = 0;
    for (const r of records) {
      if (!r.verdicts) continue;
      for (const v of Object.values(r.verdicts)) {
        total++;
        if (v) correct++;
      }
    }
    // 连续天数
    const days = new Set(records.map((r) => r.createdAt.toISOString().slice(0, 10)));
    let streak = 0;
    const today = new Date();
    for (;;) {
      const d = new Date(today.getTime() - streak * 86400000).toISOString().slice(0, 10);
      if (days.has(d)) streak++;
      else break;
    }
    const last = records[0] ?? null;

    // —— 趋势序列：按日期聚合正确率 ——
    const byDay = new Map<string, { c: number; t: number; durationSec: number; passages: Set<number> }>();
    for (const r of records) {
      const day = r.createdAt.toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { c: 0, t: 0, durationSec: 0, passages: new Set() });
      const agg = byDay.get(day)!;
      agg.passages.add(r.passageId);
      agg.durationSec += r.durationSec ?? 0;
      if (r.verdicts) {
        for (const v of Object.values(r.verdicts)) {
          agg.t++;
          if (v) agg.c++;
        }
      }
    }
    const trend = Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, a]) => ({ day, accuracy: a.t > 0 ? Math.round((a.c / a.t) * 100) : 0, questions: a.t }));
    const calendar = Array.from(byDay.entries()).map(([day, a]) => ({
      day,
      passages: a.passages.size,
      minutes: Math.round(a.durationSec / 60),
    }));

    // —— 八题型掌握矩阵 ——
    const qs = await db.select().from(questions);
    const qTypeById = new Map(qs.map((q) => [q.id, q.qType]));
    const typeAgg = new Map<string, { c: number; t: number }>();
    for (const r of records) {
      if (!r.verdicts) continue;
      for (const [qid, v] of Object.entries(r.verdicts)) {
        const qt = qTypeById.get(Number(qid)) ?? "unknown";
        if (!typeAgg.has(qt)) typeAgg.set(qt, { c: 0, t: 0 });
        const a = typeAgg.get(qt)!;
        a.t++;
        if (v) a.c++;
      }
    }
    const byType = Array.from(typeAgg.entries()).map(([qType, a]) => ({
      qType,
      total: a.t,
      accuracy: a.t > 0 ? Math.round((a.c / a.t) * 100) : 0,
    }));

    // —— 17 年进度矩阵 ——
    const yearMap = new Map<number, { done: Set<number>; c: number; t: number }>();
    for (const p of allPassages) {
      if (!yearMap.has(p.year)) yearMap.set(p.year, { done: new Set(), c: 0, t: 0 });
    }
    for (const r of examRecords) {
      const p = allPassages.find((x) => x.id === r.passageId);
      if (!p) continue;
      const agg = yearMap.get(p.year)!;
      agg.done.add(r.passageId);
      if (r.verdicts) {
        for (const v of Object.values(r.verdicts)) {
          agg.t++;
          if (v) agg.c++;
        }
      }
    }
    const byYear = Array.from(yearMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([year, a]) => ({
        year,
        done: a.done.size,
        accuracy: a.t > 0 ? Math.round((a.c / a.t) * 100) : 0,
      }));

    // 错题掌握情况
    const wrongs = await db.select().from(wrongItems).where(eq(wrongItems.userId, userId));
    const wrongOpen = wrongs.filter((w) => !w.mastered).length;

    // —— 分源统计：真题 / AI 生题 独立评估（主模块=上方综合，子模块=两者各自）——
    const genSetIds = [...new Set(records.filter((r) => r.source === "generated").map((r) => r.passageId))];
    const genSetRows = genSetIds.length
      ? await db.select().from(generatedSets).where(inArray(generatedSets.id, genSetIds))
      : [];
    // 生成题题型映射：`${setId}:${qNo}` → qType（生成题 verdicts 键为 g{qNo}）
    const genQType = new Map<string, string>();
    for (const s of genSetRows) {
      const p = normalizeGenerated(s.payload as Record<string, unknown>);
      for (const q of (p.questions ?? []) as { qNo: number; qType?: string }[]) {
        genQType.set(`${s.id}:${q.qNo}`, q.qType ?? "unknown");
      }
    }
    const sourceAgg = (src: "exam" | "generated") => {
      const recs = records.filter((r) => r.source === src);
      let c = 0, t = 0, c7 = 0, t7 = 0, dur = 0;
      const tAgg = new Map<string, { c: number; t: number }>();
      const now = Date.now();
      for (const r of recs) {
        dur += r.durationSec ?? 0;
        if (!r.verdicts) continue;
        const recent = now - r.createdAt.getTime() < 7 * 86400000;
        for (const [k, v] of Object.entries(r.verdicts)) {
          t++; if (v) c++;
          if (recent) { t7++; if (v) c7++; }
          const qt =
            src === "exam"
              ? (qTypeById.get(Number(k)) ?? "unknown")
              : (genQType.get(`${r.passageId}:${k.replace(/^g/, "")}`) ?? "unknown");
          if (!tAgg.has(qt)) tAgg.set(qt, { c: 0, t: 0 });
          const a = tAgg.get(qt)!;
          a.t++; if (v) a.c++;
        }
      }
      return {
        sessions: recs.length,
        passages: new Set(recs.map((r) => r.passageId)).size,
        questions: t,
        correct: c,
        accuracy: t > 0 ? Math.round((c / t) * 100) : 0,
        recent7dAccuracy: t7 > 0 ? Math.round((c7 / t7) * 100) : null,
        recent7dQuestions: t7,
        minutes: Math.round(dur / 60),
        byType: Array.from(tAgg.entries()).map(([qType, a]) => ({
          qType,
          total: a.t,
          accuracy: a.t > 0 ? Math.round((a.c / a.t) * 100) : 0,
        })),
      };
    };
    const bySource = { exam: sourceAgg("exam"), generated: sourceAgg("generated") };

    return {
      totalPassages: allPassages.length,
      donePassages: doneSet.size,
      totalQuestions: total,
      correctQuestions: correct,
      accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      streak,
      lastPassageId: last?.passageId ?? null,
      lastAt: last?.createdAt ?? null,
      trend,
      calendar,
      byType,
      byYear,
      bySource,
      wrongOpen,
      wrongTotal: wrongs.length,
    };
  }),

  /** 做题记录（按篇章，仅本人） */
  recordsByPassage: privateQuery.input(z.object({ passageId: z.number() })).query(async ({ ctx, input }) => {
    const db = getDb();
    return db
      .select()
      .from(practiceRecords)
      .where(and(eq(practiceRecords.passageId, input.passageId), eq(practiceRecords.userId, ctx.user.id)))
      .orderBy(desc(practiceRecords.createdAt));
  }),

  /** A6 AI 命题 */
  generate: privateQuery
    .input(
      z.object({
        topic: z.string().min(1),
        difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
        focusTypes: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const uid = ctx.user.id;
      rateLimit(uid, "generate", 6);
      const db = getDb();
      // 防重复：同用户同话题同难度 1 小时内已有成题 → 直接复用，不再烧一次 LLM
      const dupe = await db.query.generatedSets.findFirst({
        where: and(
          eq(generatedSets.userId, uid),
          eq(generatedSets.topic, input.topic.trim()),
          eq(generatedSets.difficulty, input.difficulty),
          gt(generatedSets.createdAt, new Date(Date.now() - 3600_000)),
        ),
        orderBy: desc(generatedSets.id),
      });
      if (dupe) {
        return { id: dupe.id, set: normalizeGenerated(dupe.payload as Record<string, unknown>), model: dupe.modelUsed, reused: true };
      }
      const system = await promptOf("agent_generator", FALLBACK_PROMPTS.agent_generator, uid);
      const methodology = await buildMethodContext("agent_generator", input.focusTypes);
      const difficultyZh = { easy: "偏简单（词汇友好）", medium: "标准考研难度", hard: "偏难（长难句多）" }[input.difficulty];
      const { data: rawData, model } = await chatJson<Record<string, unknown>>(
        "agent_generator",
        system,
        `话题：${input.topic}\n难度：${difficultyZh}\n${input.focusTypes.length ? `重点题型：${input.focusTypes.join("、")}` : ""}\n\n方法论参考：\n${methodology}`,
        { maxTokens: 16384, userId: uid },
      );
      const data = normalizeGenerated(rawData);
      const [{ id }] = await db
        .insert(generatedSets)
        .values({ topic: input.topic.trim(), difficulty: input.difficulty, payload: data, modelUsed: model, userId: uid })
        .$returningId();
      return { id, set: data, model, reused: false };
    }),

  /** 生成题练习判分：本地即时判分 + 错题入册（去重：同题只留最新一条） */
  generatedPractice: privateQuery
    .input(
      z.object({
        generatedId: z.number(),
        answers: z.record(z.string(), z.string()),
        durationSec: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const uid = ctx.user.id;
      const set = await db.query.generatedSets.findFirst({ where: eq(generatedSets.id, input.generatedId) });
      if (!set) throw new Error("生成题不存在");
      const qs = (normalizeGenerated(set.payload as Record<string, unknown>).questions ?? []) as {
        qNo: number; stem: string; qType: string; options: string[]; answer: string; design?: string;
      }[];
      const verdicts: Record<string, boolean> = {};
      let correctCount = 0;
      for (const q of qs) {
        const mine = input.answers[String(q.qNo)];
        const ok = mine === q.answer;
        verdicts[String(q.qNo)] = ok;
        if (ok) correctCount++;
        // 错题入册（去重：同一用户同一题只留最新一条）
        if (!ok && mine) {
          const existing = await db.query.wrongItems.findFirst({
            where: (t, { and, eq: e, isNull }) =>
              and(
                e(t.userId, uid),
                e(t.source, "generated"),
                e(t.refId, input.generatedId),
                e(t.qNo, q.qNo),
                isNull(t.questionId),
              ),
          });
          if (existing) {
            await db
              .update(wrongItems)
              .set({ myAnswer: mine, correctAnswer: q.answer, mastered: false, attempts: existing.attempts + 1 })
              .where(eq(wrongItems.id, existing.id));
          } else {
            await db.insert(wrongItems).values({
              userId: uid,
              source: "generated",
              refId: input.generatedId,
              questionId: null,
              qNo: q.qNo,
              qType: q.qType ?? "unknown",
              stem: q.stem,
              options: q.options,
              correctAnswer: q.answer,
              myAnswer: mine,
            });
          }
        }
      }
      await db.insert(practiceRecords).values({
        userId: uid,
        source: "generated",
        passageId: input.generatedId,
        answers: input.answers,
        verdicts,
        durationSec: input.durationSec ?? null,
      });
      return {
        verdicts,
        score: correctCount,
        total: qs.length,
        answerKey: qs.map((q) => ({ qNo: q.qNo, answer: q.answer, design: q.design ?? "" })),
      };
    }),

  /** 已生成题目列表（普通用户只见自己的；管理员见全站） */
  generatedList: privateQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows =
      ctx.user.role === "admin"
        ? await db.select().from(generatedSets).orderBy(desc(generatedSets.createdAt)).limit(200)
        : await db
            .select()
            .from(generatedSets)
            .where(eq(generatedSets.userId, ctx.user.id))
            .orderBy(desc(generatedSets.createdAt))
            .limit(200);
    return rows.map((r) => ({
      id: r.id,
      topic: r.topic,
      difficulty: r.difficulty,
      modelUsed: r.modelUsed,
      createdAt: r.createdAt,
    }));
  }),
  generatedDetail: privateQuery.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const db = getDb();
    const row = await db.query.generatedSets.findFirst({ where: eq(generatedSets.id, input.id) });
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "生成题不存在" });
    if (row.userId !== ctx.user.id && ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "无权查看该生成题" });
    }
    return row;
  }),

  /** 官方答案揭示：批量返回 {qNo, official, ai}（纯 SQL，无 LLM）。
   *  仅用于交卷后对照；前端在解析完成后才调用。 */
  revealOfficialAnswers: privateQuery
    .input(z.object({ kind: z.enum(["exam", "generated"]).default("exam"), refId: z.number() }))
    .query(async ({ input }) => {
      const content = await loadContent(input.kind, input.refId);
      return {
        items: content.questions.map((q) => ({ qNo: q.qNo, official: q.answer ?? null })),
      };
    }),

  /** 差异分析缓存状态批量查询 */
  diffStatus: privateQuery
    .input(z.object({ kind: z.enum(["exam", "generated"]).default("exam"), refId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(answerDiffs)
        .where(and(eq(answerDiffs.source, input.kind), eq(answerDiffs.passageId, input.refId)));
      return rows;
    }),

  /** 差异分析（懒生成：缓存命中直接返回；未命中调 LLM 后入库，唯一键防重） */
  diffAnalysis: privateQuery
    .input(
      z.object({
        kind: z.enum(["exam", "generated"]).default("exam"),
        refId: z.number(),
        qNo: z.number(),
        // 答案一律收窄为合法选项字母：非法输入在 schema 层 400 拒绝，不消耗 LLM
        aiAnswer: z.enum(["A", "B", "C", "D"]),
        officialAnswer: z.enum(["A", "B", "C", "D"]),
        aiReasoning: z.string().max(2000).default(""),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      rateLimit(ctx.user.id, "diff", 12);
      const cached = await db.query.answerDiffs.findFirst({
        where: and(
          eq(answerDiffs.source, input.kind),
          eq(answerDiffs.passageId, input.refId),
          eq(answerDiffs.qNo, input.qNo),
          eq(answerDiffs.aiAnswer, input.aiAnswer),
          eq(answerDiffs.officialAnswer, input.officialAnswer),
        ),
      });
      // 缓存命中但 rootCause 为空（旧版解析缺陷遗留的坏行）→ 视为未命中，走下方重新生成并覆盖
      if (cached && cached.rootCause) return { diff: cached, cached: true };
      const uid = ctx.user.id;
      const content = await loadContent(input.kind, input.refId);
      const q = content.questions.find((x) => x.qNo === input.qNo);
      if (!q) throw new TRPCError({ code: "NOT_FOUND", message: "题目不存在" });
      const qText = `第${q.qNo}题：${q.stem}\n${q.options.map((o, i) => `${"ABCD"[i]}. ${o}`).join("\n")}`;
      const system = (await promptOf("agent_diff", FALLBACK_PROMPTS.agent_diff, uid)) + (await buildMethodContext("agent_solver"));
      const userMsg = `文章：\n${passageTextOf(content.paragraphs)}\n\n题目：\n${qText}\n\nAI 的答案：${input.aiAnswer}\nAI 的解题理由：${input.aiReasoning || "（未提供）"}\n官方标准答案：${input.officialAnswer}`;
      let { data, model } = await chatJson<Record<string, unknown>>("agent_diff", system, userMsg, { maxTokens: 8192, userId: uid });
      let rootCause = pickRootCause(data);
      if (!rootCause) {
        // 模型偶发漏输出/改名 rootCause：带纠正指令重试一次（仍失败则兜底 comprehend，与错因诊断口径一致）
        const retry = await chatJson<Record<string, unknown>>(
          "agent_diff",
          system,
          `${userMsg}\n\n重要：上次输出缺少合法的 rootCause 字段。rootCause 必填，且只能是 locate/comprehend/overinfer/detail/mistype/vocab 六选一的英文标识。`,
          { maxTokens: 8192, userId: uid },
        );
        const rc2 = pickRootCause(retry.data);
        if (rc2) {
          data = retry.data;
          model = retry.model;
          rootCause = rc2;
        } else {
          rootCause = "comprehend";
        }
      }
      const values = {
        source: input.kind,
        passageId: input.refId,
        qNo: input.qNo,
        aiAnswer: input.aiAnswer,
        officialAnswer: input.officialAnswer,
        rootCause,
        aiReasoning: String(data.aiReasoning ?? ""),
        officialLogic: String(data.officialLogic ?? ""),
        userTakeaway: String(data.userTakeaway ?? ""),
        modelUsed: model,
      };
      await db.insert(answerDiffs).values(values).onDuplicateKeyUpdate({
        set: { rootCause: values.rootCause, aiReasoning: values.aiReasoning, officialLogic: values.officialLogic, userTakeaway: values.userTakeaway, modelUsed: model },
      });
      const row = await db.query.answerDiffs.findFirst({
        where: and(
          eq(answerDiffs.source, input.kind),
          eq(answerDiffs.passageId, input.refId),
          eq(answerDiffs.qNo, input.qNo),
          eq(answerDiffs.aiAnswer, input.aiAnswer),
          eq(answerDiffs.officialAnswer, input.officialAnswer),
        ),
      });
      return { diff: row, cached: false };
    }),
});
