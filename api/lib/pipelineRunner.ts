import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { pipelineJobs, methodClauses, analyses, type PipelineJob } from "@db/schema";
import { buildMethodContext } from "./methodKnowledge";
import {
  loadContent,
  passageTextOf,
  FALLBACK_PROMPTS,
  chatJson,
  promptOf,
  extractQTypes,
  extractItems,
  officialOf,
  buildLocateContext,
  type ContentPack,
} from "./agentCore";

type StageRec = { stage: string; status: "pending" | "running" | "ok" | "error"; startedAt?: number; elapsedMs?: number; error?: string };

const STAGE_ORDER = ["structure", "question", "locate", "solve", "crosscheck"];

/** 用户控制信号：暂停/停止（执行器在阶段检查点识别后安静退出，产物已落库不丢） */
class ControlSignal extends Error {
  control: "paused" | "cancelled";
  constructor(control: "paused" | "cancelled") {
    super(control);
    this.control = control;
    this.name = "ControlSignal";
  }
}
/** 总 deadline：25 分钟。
 * 实测推理模型节奏：结构+审题并行 ~2min、定位 ~1.5min、解题（含一次打回重解）可达 ~9min、
 * 复核 ~2min —— 现实最坏 ≈15min；25 分钟保留 1.7 倍安全余量，又仍能拦住真正的死等 */
const JOB_DEADLINE_MS = 25 * 60 * 1000;
/** 任务级心跳：长跑 LLM 调用期间每 60s 写一次库（updatedAt 随写刷新），
 * 防止单次调用超过僵尸判定窗口（10min）时，健康任务被误判为僵尸 */
const HEARTBEAT_TICK_MS = 60 * 1000;

/** methodRefs 服务端校验：剔除幻觉条款 ID */
async function sanitizeMethodRefs(solved: Record<string, unknown>[]): Promise<void> {
  const db = getDb();
  const valid = new Set((await db.select({ id: methodClauses.clauseId }).from(methodClauses)).map((r) => r.id));
  for (const item of solved) {
    const refs = item.methodRefs as { clauseId?: string }[] | undefined;
    if (Array.isArray(refs)) {
      item.methodRefs = refs.filter((r) => r.clauseId && valid.has(r.clauseId));
    }
  }
}

async function save(jobId: number, patch: Partial<PipelineJob>) {
  const db = getDb();
  await db.update(pipelineJobs).set(patch).where(eq(pipelineJobs.id, jobId));
}

/**
 * 后台执行解析流水线（断点续跑：payload 中已有的阶段直接跳过）。
 * 绝不抛出：失败写入 job.status='error'。
 */
export async function runPipelineJob(jobId: number): Promise<void> {
  const db = getDb();
  const job = await db.query.pipelineJobs.findFirst({ where: eq(pipelineJobs.id, jobId) });
  if (!job || job.status === "done") return;
  const uid = job.userId ?? undefined;
  const stages: StageRec[] = job.stages.length
    ? job.stages
    : STAGE_ORDER.map((s) => ({ stage: s, status: "pending" as const }));
  const payload: Record<string, unknown> = { ...(job.payload ?? {}) };

  const jobStartTs = Date.now();
  /** 每阶段开始前检查总 deadline，防止极端慢上游导致无限静默等待 */
  const checkDeadline = () => {
    if (Date.now() - jobStartTs > JOB_DEADLINE_MS) {
      throw new Error("任务超过 25 分钟总时限，已中止（可点重试从断点续跑）");
    }
  };

  /** 用户控制检查点：回读任务状态，paused/cancelled 时抛控制信号（LLM 调用返回后必经 setStage，最迟在此被拦截） */
  const checkControl = async () => {
    const j = await db.query.pipelineJobs.findFirst({
      where: eq(pipelineJobs.id, jobId),
      columns: { status: true },
    });
    if (j?.status === "paused" || j?.status === "cancelled") throw new ControlSignal(j.status);
  };

  /** 任务级心跳定时器：LLM 长调用期间也持续刷新 updatedAt，僵尸判定永不误伤活任务 */
  const heartbeat = setInterval(() => {
    void save(jobId, { stage: stages.find((s) => s.status === "running")?.stage ?? job.stage }).catch(() => {});
  }, HEARTBEAT_TICK_MS);

  const setStage = async (stage: string, status: StageRec["status"], extra: Partial<StageRec> = {}) => {
    await checkControl(); // 写库前先确认未被用户暂停/停止
    const rec = stages.find((s) => s.stage === stage)!;
    rec.status = status;
    if (status === "running") rec.startedAt = Date.now();
    Object.assign(rec, extra);
    await save(jobId, { stage, stages, payload }); // updatedAt 随写库自动刷新 = 天然心跳
  };

  try {
    const content: ContentPack = await loadContent(job.kind, job.refId);
    const text = passageTextOf(content.paragraphs);
    const qText = content.questions
      .map((q) => `第${q.qNo}题：${q.stem}\n${q.options.map((o, i) => `${"ABCD"[i]}. ${o}`).join("\n")}`)
      .join("\n\n");
    const qTypes = payload.qAnalysis ? extractQTypes(payload.qAnalysis as Record<string, unknown>[]) : [];

    // —— 阶段 1+2：结构与审题（并行）——
    if (!payload.structure || !payload.qAnalysis) {
      checkDeadline();
      const t0 = Date.now();
      await setStage("structure", "running");
      await setStage("question", "running");
      try {
        const [structRes, qaRes] = await Promise.all([
          payload.structure
            ? Promise.resolve(null)
            : chatJson<Record<string, unknown>>(
                "agent_structure",
                (await promptOf("agent_structure", FALLBACK_PROMPTS.agent_structure, uid)) +
                  (await buildMethodContext("agent_structure")),
                text,
                { userId: uid },
              ),
          payload.qAnalysis
            ? Promise.resolve(null)
            : chatJson<{ items: Record<string, unknown>[] }>(
                "agent_question",
                (await promptOf("agent_question", FALLBACK_PROMPTS.agent_question, uid)) +
                  (await buildMethodContext("agent_question")),
                `文章：\n${text}\n\n题目：\n${qText}`,
                { userId: uid },
              ),
        ]);
        if (structRes) {
          payload.structure = structRes.data;
          payload.modelStructure = structRes.model;
        }
        if (qaRes) {
          payload.qAnalysis = extractItems(qaRes.data as unknown as Record<string, unknown>, "审题结果");
          payload.modelQuestion = qaRes.model;
        }
        const el = Date.now() - t0;
        await setStage("structure", "ok", { elapsedMs: el });
        await setStage("question", "ok", { elapsedMs: el });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await setStage("structure", "error", { error: msg });
        await setStage("question", "error", { error: msg });
        throw e;
      }
    }

    const effectiveQTypes = qTypes.length
      ? qTypes
      : extractQTypes(payload.qAnalysis as Record<string, unknown>[]);

    // —— 阶段 3：定位 ——
    if (!payload.locate) {
      checkDeadline();
      const t0 = Date.now();
      await setStage("locate", "running");
      try {
        const res = await chatJson<{ items: Record<string, unknown>[] }>(
          "agent_locator",
          (await promptOf("agent_locator", FALLBACK_PROMPTS.agent_locator, uid)) +
            (await buildMethodContext("agent_locator", effectiveQTypes)),
          `文章：\n${text}\n\n审题结果：\n${JSON.stringify(payload.qAnalysis, null, 2)}`,
          { maxTokens: 16384, userId: uid },
        );
        payload.locate = extractItems(res.data as unknown as Record<string, unknown>, "定位结果");
        payload.modelLocate = res.model;
        await setStage("locate", "ok", { elapsedMs: Date.now() - t0 });
      } catch (e) {
        await setStage("locate", "error", { error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    }

    // —— 阶段 4：解题 + 校验（打回重跑）——
    if (!payload.solved) {
      checkDeadline();
      const t0 = Date.now();
      await setStage("solve", "running");
      try {
        const solverSystem =
          (await promptOf("agent_solver", FALLBACK_PROMPTS.agent_solver, uid)) +
          (await buildMethodContext("agent_solver", effectiveQTypes));
        const reviewerSystem =
          (await promptOf("agent_reviewer", FALLBACK_PROMPTS.agent_reviewer, uid)) +
          (await buildMethodContext("agent_reviewer"));
        const locateArr = (payload.locate ?? []) as Record<string, unknown>[];
        const qaArr = (payload.qAnalysis ?? []) as Record<string, unknown>[];

        // —— 解题官：逐题调用（根治"解题阶段卡 10 分钟"——5 题一次出曾要 6-8 分钟推理+巨量输出；
        //    逐题后单次 1-2 分钟，可控、可断点（payload.solveParts 逐题落库），质量反而更专注 ——
        const solveParts: Record<string, Record<string, unknown>> =
          (payload.solveParts as Record<string, Record<string, unknown>> | undefined) ?? {};
        payload.solveParts = solveParts;
        const solvedItems: Record<string, unknown>[] = [];
        let lastModel = "";
        for (const q of content.questions) {
          const key = String(q.qNo);
          if (solveParts[key]) {
            solvedItems.push(solveParts[key]);
            continue;
          }
          const qaItem = qaArr.find((x) => Number(x.qNo) === q.qNo) ?? {};
          const lcItem = locateArr.find((x) => Number(x.qNo) === q.qNo) ?? {};
          const thisCtx = buildLocateContext(content.paragraphs, [lcItem]);
          const thisQText = `第${q.qNo}题：${q.stem}\n${q.options.map((o, i) => `${"ABCD"[i]}. ${o}`).join("\n")}`;
          const userMsg = `文章：\n${text}\n\n${thisQText}\n\n本题审题结果：\n${JSON.stringify(qaItem)}\n\n本题定位结果：\n${JSON.stringify(lcItem)}\n\n本题定位与上下文窗口（判断词义/指代/态度必须参考）：\n${thisCtx}`;
          const solved = await chatJson<Record<string, unknown>>(
            "agent_solver",
            solverSystem,
            userMsg,
            { maxTokens: 8192, userId: uid },
          );
          const item = extractItems(solved.data as unknown as Record<string, unknown>, "解题结果")[0];
          if (!item || typeof item !== "object") throw new Error(`第${q.qNo}题解题结果为空`);
          (item as Record<string, unknown>).qNo = q.qNo;
          solveParts[key] = item as Record<string, unknown>;
          solvedItems.push(item as Record<string, unknown>);
          lastModel = solved.model;
          // 每题落库一次：断点续跑只补没解的题，也兼作阶段内心跳
          await save(jobId, { payload });
        }

        // —— 校验官：只复核一次（v5.8 起打回重解已废除——打回重跑是解题阶段超时主因；
        //    校验意见保留展示，问题由交叉验证与差异分析兜底）——
        const reviewData = (
          await chatJson<Record<string, unknown>>(
            "agent_reviewer",
            reviewerSystem,
            `文章：\n${text}\n\n题目：\n${qText}\n\n审题：\n${JSON.stringify(payload.qAnalysis)}\n\n定位：\n${JSON.stringify(payload.locate)}\n\n解题：\n${JSON.stringify({ items: solvedItems })}`,
            { maxTokens: 8192, userId: uid },
          )
        ).data;
        const trace = [
          { stage: "solve", ok: true, note: `逐题解题 ${solvedItems.length} 题完成` },
          {
            stage: "review",
            ok: reviewData.pass === true,
            note:
              reviewData.pass === true
                ? "校验通过"
                : `校验留疑（不重跑，供学生参考）：${JSON.stringify(reviewData.issues ?? []).slice(0, 200)}`,
          },
        ];
        const solveData = { items: solvedItems };
        await sanitizeMethodRefs(solveData.items);
        payload.solved = solveData.items;
        payload.review = reviewData;
        payload.trace = trace;
        payload.modelSolve = lastModel;

        // 判分：官方答案为唯一基准（officialOf 收口），AI 答案仅作无官方时的降级
        if (job.answers) {
          const verdicts: Record<string, boolean> = {};
          for (const item of solveData.items as { qNo: number; answer: string }[]) {
            const q = content.questions.find((x) => x.qNo === item.qNo);
            const mine = q ? job.answers[q.key] : undefined;
            if (q && mine) {
              const official = officialOf(q.answer, item.answer);
              if (official) verdicts[q.key] = mine === official;
            }
          }
          payload.verdicts = verdicts;
        }
        // 官方答案一并入产物，供前端"答案揭示"与差异分析
        payload.officialAnswers = content.questions.map((q) => ({
          qNo: q.qNo,
          official: q.answer ?? null,
          ai: (solveData.items as { qNo: number; answer: string }[]).find((s) => s.qNo === q.qNo)?.answer ?? null,
        }));
        await setStage("solve", "ok", { elapsedMs: Date.now() - t0 });
      } catch (e) {
        await setStage("solve", "error", { error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    }

    // —— 阶段 5：交叉验证（第二模型陪审团；失败不阻塞）——
    if (!payload.crosscheck) {
      checkDeadline();
      const t0 = Date.now();
      await setStage("crosscheck", "running");
      try {
        const solved = payload.solved as { qNo: number; answer: string }[];
        const locate = payload.locate as Record<string, unknown>[];
        const res = await chatJson<{ items: { qNo: number; answer: string; why?: string }[] }>(
          "agent_crosscheck",
          (await promptOf("agent_crosscheck", FALLBACK_PROMPTS.agent_crosscheck, uid)) +
            (await buildMethodContext("agent_reviewer")),
          `文章：\n${text}\n\n题目：\n${qText}\n\n定位证据：\n${JSON.stringify(locate)}`,
          { maxTokens: 4096, userId: uid },
        );
        let flagSource: { qNo: number; answer: string; why?: string }[] = [];
        try {
          flagSource = extractItems(res.data as unknown as Record<string, unknown>, "交叉验证结果") as typeof flagSource;
        } catch {
          /* 交叉验证是辅助阶段：缺列表时降级为空标记，不拖垮已完成的解题产物 */
        }
        const flags = flagSource
          .map((c) => {
            const mine = solved.find((s) => s.qNo === c.qNo);
            return {
              qNo: c.qNo,
              crossAnswer: c.answer,
              why: c.why ?? "",
              agree: mine ? mine.answer === c.answer : null,
            };
          })
          .filter((x) => x.agree !== null);
        payload.crosscheck = { items: flags, model: res.model, disagree: flags.filter((f) => f.agree === false).length };
        await setStage("crosscheck", "ok", { elapsedMs: Date.now() - t0 });
      } catch (e) {
        // 交叉验证是增强项：失败降级为跳过，不拖垮整条流水线
        payload.crosscheck = { skipped: true, reason: e instanceof Error ? e.message.slice(0, 200) : String(e) };
        await setStage("crosscheck", "ok", { elapsedMs: Date.now() - t0, error: "已跳过" });
      }
    }

    // 归档解析产物
    await db.insert(analyses).values({
      source: job.kind,
      passageId: job.refId,
      payload: {
        structure: payload.structure,
        questionAnalysis: payload.qAnalysis,
        locateResult: payload.locate,
        solved: payload.solved,
        review: payload.review,
        crosscheck: payload.crosscheck,
      },
      modelUsed: `pipeline:${[payload.modelStructure, payload.modelQuestion, payload.modelLocate, payload.modelSolve]
        .filter(Boolean)
        .join(" | ")}`,
    });
    await save(jobId, { status: "done", stage: "done", payload, stages });
  } catch (e) {
    if (e instanceof ControlSignal) {
      // 用户主动暂停/停止：进行中的阶段回到待跑（已完成产物在 payload 中保留，续跑自动跳过）
      for (const s of stages) {
        if (s.status === "running") {
          s.status = e.control === "paused" ? "pending" : "error";
          if (e.control === "cancelled") s.error = "已停止";
        }
      }
      await save(jobId, {
        ...(e.control === "cancelled" ? { errorMsg: "已被用户停止，可从断点重试" } : {}),
        payload,
        stages,
      });
    } else {
      await save(jobId, {
        status: "error",
        errorMsg: (e instanceof Error ? e.message : String(e)).slice(0, 500),
        payload,
        stages,
      });
    }
  } finally {
    clearInterval(heartbeat);
  }
}
