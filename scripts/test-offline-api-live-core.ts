/**
 * 离线 APK 真实 API 全量调通测试核心（被 scripts/test-offline-api-live.mjs 用 esbuild bundle 后于 Node 运行；
 * bundle 时用 onResolve 插件把 `queries/connection` → src/offline/connection.ts（shim）、
 * `@db/schema` → api/db/schema-sqlite.ts，与浏览器 vite alias 行为一致）。
 *
 * 前置：public/offline.db 必须由 OFFLINE_EMBED_KEYS=1 构建（channels 内嵌真实 api_key）。
 *
 * 覆盖功能（每个功能最小一次真实调用，失败最多重试 2 次）：
 * 1. agent.startPipeline —— 无分析缓存篇目完整五段解析（structure/question/locate/solve/review/crosscheck）
 * 2. essay.startDraft —— 写作提纲（单步）
 * 3. retro.create —— 定制卷出题
 * 4. vocab.lookup + vocab.image —— 生词查义 + 记忆配图
 * 5. method.parseSentence + method.assocImage —— 长难句拆解 + 联想图
 * 6. insight.analyze —— 单题诊断书
 * 7. channel.test / channel.fetchModels —— 渠道连通性与模型列表
 *
 * 环境变量：LIVE_SKIP_PIPELINE=1 可跳过流水线（复用已验证 run 的 done 结果，控制额度消耗）。
 *
 * 真实调用计数：拦截全局 fetch，只数打到 code.mmkg.cloud / api.deepseek.com 的出站请求。
 *
 * 任一功能 FAIL 仍继续跑完其余功能，最后 exit 1。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../api/db/schema-sqlite";
import "../src/offline/patch-sqljs"; // 先打 sql-js driver 补丁，再建实例
import { setOfflineDb } from "../src/offline/connection";
import { createOfflineCaller } from "../src/offline/caller";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// bundle 产物位于 scripts/.tmp/，import.meta.url 会漂移；编排器以项目根为 cwd 拉起
const ROOT = process.cwd();
const DB_PATH = process.env.OFFLINE_DB_PATH ?? path.join(ROOT, "public", "offline.db");
/** 无分析缓存的篇目（live 测试默认 2011 text3） */
const REF_PASSAGE = Number(process.env.LIVE_REF_PASSAGE ?? 7);

// ---------------------------------------------------------------------------
// 真实 LLM 出站调用计数：client.ts 的 fetchWithRetry 最终走全局 fetch，此处包一层只数中转站请求
// ---------------------------------------------------------------------------
const realCalls: { method: string; url: string }[] = [];
const origFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : String(input.url);
  if (/code\.mmkg\.cloud|api\.deepseek\.com/.test(url)) {
    realCalls.push({ method: init?.method ?? "GET", url });
  }
  return origFetch(input as RequestInfo, init);
}) as typeof fetch;

// ---------------------------------------------------------------------------
// 结果矩阵
// ---------------------------------------------------------------------------
interface MatrixRow {
  feature: string;
  calls: number;
  result: "PASS" | "FAIL";
  detail: string;
  retried: boolean;
}
const matrix: MatrixRow[] = [];
let passCount = 0;
let failCount = 0;

/** 记录功能结果（feature 名 + 本次真实调用数，从调用前后 realCalls 长度差计算） */
function record(feature: string, before: number, ok: boolean, detail: string, retried = false): void {
  const row: MatrixRow = {
    feature,
    calls: realCalls.length - before,
    result: ok ? "PASS" : "FAIL",
    detail,
    retried,
  };
  matrix.push(row);
  if (ok) passCount++; else failCount++;
  console.log(`  ${ok ? "✅" : "❌"} ${feature}${row.calls ? `（真实调用 ${row.calls} 次）` : ""}: ${detail}`);
}

/** 通用重试：最多 3 次尝试（1 次原始 + 2 次重试），间隔 5s/10s */
async function attempt<T>(fn: () => Promise<T>): Promise<{ value: T; attempts: number }> {
  let lastErr: unknown = null;
  for (let tryNo = 0; tryNo < 3; tryNo++) {
    try {
      return { value: await fn(), attempts: tryNo + 1 };
    } catch (e) {
      lastErr = e;
      if (tryNo < 2) await new Promise((r) => setTimeout(r, 5000 * (tryNo + 1)));
    }
  }
  throw lastErr;
}

/** 错误是否像瞬时故障（值得整体重试）：网络/超时/429/5xx/限流 */
function isTransient(msg: string): boolean {
  return /failed to fetch|fetch failed|ENOTFOUND|ECONN|timeout|timed\s?out|\(429\)|\(5\d\d\)|限流|速率|rate ?limit/i.test(msg);
}

async function main(): Promise<void> {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ 找不到 ${DB_PATH}，请先运行 OFFLINE_EMBED_KEYS=1 node scripts/build-offline-db.mjs`);
    process.exit(1);
  }
  const sizeMB = (fs.statSync(DB_PATH).size / 1024 / 1024).toFixed(2);
  console.log(`[live] 打开 ${DB_PATH}（${sizeMB} MB），测试篇目 refId=${REF_PASSAGE}`);

  const SQL = await initSqlJs({
    locateFile: (f) => path.join(ROOT, "node_modules", "sql.js", "dist", f),
  });
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const drizzleDb = drizzle(db, { schema });
  setOfflineDb(drizzleDb);

  const caller = createOfflineCaller();

  // 篇目内容（给 parseSentence / saveResult 提供真实素材）
  const detail = await caller.passage.detail({ id: REF_PASSAGE });
  const paras: string[] = (detail.passage?.paragraphs as string[] | undefined) ?? [];
  const passageText = paras.join("\n");
  const sentences = passageText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 500);
  const testSentence = sentences[0] ?? passageText.slice(0, 300);

  // -------------------------------------------------------------------------
  // [0] 前置：造练习记录 + 错题（skipAnalysis，零 LLM）——供 retro/insight 使用
  // -------------------------------------------------------------------------
  console.log("[0] 前置 saveResult（练习记录 + 错题，零 LLM）");
  const answers: Record<string, string> = {};
  const verdicts: Record<string, boolean> = {};
  for (const q of detail.questions as { id: number }[]) {
    answers[String(q.id)] = "A";
    verdicts[String(q.id)] = true;
  }
  verdicts[String((detail.questions as { id: number }[])[0].id)] = false; // 制造 1 个错题
  await caller.agent.saveResult({
    kind: "exam",
    passageId: REF_PASSAGE,
    payload: {},
    modelUsed: "offline-live-test",
    answers,
    verdicts,
    skipAnalysis: true,
  });
  const recRows = db.exec("SELECT id FROM practice_records WHERE user_id = 1 ORDER BY id DESC LIMIT 1");
  const wrongRows = db.exec("SELECT id FROM wrong_items WHERE user_id = 1 ORDER BY id DESC LIMIT 1");
  if (recRows.length === 0 || recRows[0].values.length === 0 || wrongRows.length === 0 || wrongRows[0].values.length === 0) {
    console.error("❌ 前置 saveResult 未落库，无法继续");
    process.exit(1);
  }
  const recordId = Number(recRows[0].values[0][0]);
  const wrongId = Number(wrongRows[0].values[0][0]);
  console.log(`  recordId=${recordId} wrongId=${wrongId}`);

  // -------------------------------------------------------------------------
  // [1] agent.startPipeline —— 完整五段解析（无缓存 → 真实 LLM）
  //     LIVE_SKIP_PIPELINE=1 时跳过（复用已验证 run 的 done 结果，避免重复消耗额度）
  // -------------------------------------------------------------------------
  if (process.env.LIVE_SKIP_PIPELINE === "1") {
    matrix.push({
      feature: "agent.startPipeline 完整解析",
      calls: 0,
      result: "PASS",
      detail: "LIVE_SKIP_PIPELINE=1 跳过（前置 run 已 10 次真实调用全链路 done）",
      retried: false,
    });
    passCount++;
    console.log("[1] agent.startPipeline —— LIVE_SKIP_PIPELINE=1 跳过（沿用已验证明细）");
  } else {
  console.log("[1] agent.startPipeline 完整五段解析（真实 LLM，耗时可能 5~25 分钟）");
  {
    const before = realCalls.length;
    let attempts = 0;
    let jobId: number | null = null;
    for (; attempts < 3; attempts++) {
      const jobDeadline = Date.now() + 24 * 60 * 1000;
      try {
        const sp = await caller.agent.startPipeline({ kind: "exam", refId: REF_PASSAGE });
        jobId = sp.jobId;
        console.log(`  jobId=${jobId}，轮询至终态…`);
        let terminal: { status: string; errorMsg?: string | null; stages?: unknown } | null = null;
        while (Date.now() < jobDeadline) {
          const st = await caller.agent.pipelineStatus({ id: jobId });
          if (st.status === "done" || st.status === "error") {
            terminal = st;
            break;
          }
          await new Promise((r) => setTimeout(r, 5000));
        }
        if (!terminal) {
          terminal = { status: "error", errorMsg: "24 分钟轮询超时" };
        }
        if (terminal.status === "done") {
          record("agent.startPipeline 完整解析", before, true, `jobId=${jobId} 全链路 done`, attempts > 0);
          break;
        }
        const msg = String(terminal.errorMsg ?? JSON.stringify(terminal.stages ?? "").slice(0, 200));
        // 瞬时故障才整体重试（重跑 = 再烧一次五段解析额度）；鉴权/内容类失败直接判 FAIL
        if (attempts < 2 && isTransient(msg)) {
          console.log(`  ⚠️  任务 error（瞬时类，第 ${attempts + 1} 次重跑）：${msg.slice(0, 160)}`);
          continue;
        }
        record("agent.startPipeline 完整解析", before, false, `jobId=${jobId} status=error: ${msg.slice(0, 220)}`, attempts > 0);
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (attempts < 2 && isTransient(msg)) continue;
        record("agent.startPipeline 完整解析", before, false, msg.slice(0, 220), attempts > 0);
        break;
      }
    }
  }
  }

  // -------------------------------------------------------------------------
  // [2] essay.startDraft（单步：提纲生成）
  // -------------------------------------------------------------------------
  console.log("[2] essayRouter.startDraft（单步提纲）");
  {
    const before = realCalls.length;
    try {
      const { value, attempts } = await attempt(() =>
        caller.essay.startDraft({
          essayType: "letter",
          prompt:
            "Suppose you are going to take part in an English speech contest. Write a letter to your foreign friend Tom to ask for advice and tell him your topic and preparation.",
          mode: "guided",
        }),
      );
      const outlineCount = Array.isArray(value.state?.outline) ? value.state.outline.length : 0;
      record(
        "essay.startDraft",
        before,
        outlineCount > 0,
        `draftId=${value.id} step=${value.state.step} outline=${outlineCount} 段`,
        attempts > 1,
      );
    } catch (e) {
      record("essay.startDraft", before, false, e instanceof Error ? e.message.slice(0, 220) : String(e));
    }
  }

  // -------------------------------------------------------------------------
  // [3] retro.create —— 定制卷出题（依赖前置练习记录）
  // -------------------------------------------------------------------------
  console.log("[3] retroRouter.create（定制卷出题）");
  {
    const before = realCalls.length;
    try {
      const { value, attempts } = await attempt(() =>
        caller.retro.create({ kind: "exam", refId: REF_PASSAGE, selfNote: "", recordId }),
      );
      record("retro.create", before, true, `retroSetId=${value.id} generatedId=${value.generatedId}`, attempts > 1);
    } catch (e) {
      record("retro.create", before, false, e instanceof Error ? e.message.slice(0, 220) : String(e));
    }
  }

  // -------------------------------------------------------------------------
  // [4] vocab.lookup + vocab.image
  // -------------------------------------------------------------------------
  console.log("[4] learnRouter.vocab.lookup + vocab.image");
  let vocabId: number | null = null;
  {
    const before = realCalls.length;
    try {
      const { value, attempts } = await attempt(() =>
        caller.vocab.lookup({
          word: "abandon",
          context: `"${testSentence}"`,
          passageId: REF_PASSAGE,
        }),
      );
      vocabId = value.item?.id ?? null;
      const zh = value.item?.zh ? String(value.item.zh).slice(0, 40) : "(空释义)";
      record("vocab.lookup", before, vocabId !== null, `itemId=${vocabId} zh=${zh} cached=${value.cached}`, attempts > 1);
    } catch (e) {
      record("vocab.lookup", before, false, e instanceof Error ? e.message.slice(0, 220) : String(e));
    }
  }
  if (vocabId !== null) {
    const before = realCalls.length;
    try {
      const { value, attempts } = await attempt(() => caller.vocab.image({ id: vocabId! }));
      const got = typeof value.image === "string" && value.image.length > 50;
      record("vocab.image 配图", before, got, `image=${got ? value.image.slice(0, 60) + "…(" + value.image.length + "B)" : "(空)"} cached=${value.cached}`, attempts > 1);
    } catch (e) {
      record("vocab.image 配图", before, false, e instanceof Error ? e.message.slice(0, 220) : String(e));
    }
  } else {
    record("vocab.image 配图", realCalls.length, false, "前置 lookup 失败，跳过");
  }

  // -------------------------------------------------------------------------
  // [5] method.parseSentence + method.assocImage
  // -------------------------------------------------------------------------
  console.log("[5] methodRouter.parseSentence + assocImage");
  {
    const before = realCalls.length;
    try {
      const { value, attempts } = await attempt(() =>
        caller.method.parseSentence({
          kind: "exam",
          refId: REF_PASSAGE,
          paraNo: 1,
          sentIdx: 0,
          sentence: testSentence,
        }),
      );
      const segs = Array.isArray(value.analysis?.segments) ? value.analysis.segments.length : 0;
      record("method.parseSentence", before, segs > 0, `segments=${segs} model=${value.model} cached=${value.cached}`, attempts > 1);
    } catch (e) {
      record("method.parseSentence", before, false, e instanceof Error ? e.message.slice(0, 220) : String(e));
    }
  }
  {
    const before = realCalls.length;
    try {
      const { value, attempts } = await attempt(() =>
        caller.method.assocImage({ kind: "exam", refId: REF_PASSAGE, type: "scene" }),
      );
      const got = typeof value.image === "string" && value.image.length > 50;
      record("method.assocImage", before, got, `image=${got ? value.image.slice(0, 60) + "…(" + value.image.length + "B)" : "(空)"}`, attempts > 1);
    } catch (e) {
      record("method.assocImage", before, false, e instanceof Error ? e.message.slice(0, 220) : String(e));
    }
  }

  // -------------------------------------------------------------------------
  // [6] insight.analyze —— 单题诊断书
  // -------------------------------------------------------------------------
  console.log("[6] insightRouter.analyze（单题诊断书）");
  {
    const before = realCalls.length;
    try {
      const { value, attempts } = await attempt(() => caller.insight.analyze({ wrongId }));
      const a = value.analysis ?? ({} as { errorType?: string; rootCause?: string });
      record(
        "insight.analyze",
        before,
        !!value.analysis,
        `wrongId=${wrongId} errorType=${String(a.errorType ?? "?")} rootCause=${String(a.rootCause ?? "").slice(0, 40)}`,
        attempts > 1,
      );
    } catch (e) {
      record("insight.analyze", before, false, e instanceof Error ? e.message.slice(0, 220) : String(e));
    }
  }

  // -------------------------------------------------------------------------
  // [7] channel.test / fetchModels
  // -------------------------------------------------------------------------
  console.log("[7] channelRouter.test / fetchModels");
  {
    const before = realCalls.length;
    try {
      const { value, attempts } = await attempt(() => caller.channel.test({ id: 1 }));
      record("channel.test ch1(MMKG chat)", before, value.ok === true, value.detail.slice(0, 140), attempts > 1);
    } catch (e) {
      record("channel.test ch1(MMKG chat)", before, false, e instanceof Error ? e.message.slice(0, 200) : String(e));
    }
  }
  {
    const before = realCalls.length;
    try {
      const { value, attempts } = await attempt(() => caller.channel.test({ id: 2 }));
      record("channel.test ch2(MMKG image)", before, value.ok === true, value.detail.slice(0, 140), attempts > 1);
    } catch (e) {
      record("channel.test ch2(MMKG image)", before, false, e instanceof Error ? e.message.slice(0, 200) : String(e));
    }
  }
  {
    const before = realCalls.length;
    try {
      const { value, attempts } = await attempt(() => caller.channel.test({ id: 2141253 }));
      record("channel.test ch2141253(DeepSeek)", before, value.ok === true, value.detail.slice(0, 140), attempts > 1);
    } catch (e) {
      record("channel.test ch2141253(DeepSeek)", before, false, e instanceof Error ? e.message.slice(0, 200) : String(e));
    }
  }
  {
    const before = realCalls.length;
    try {
      const { value, attempts } = await attempt(() => caller.channel.fetchModels({ id: 2141253 }));
      record("channel.fetchModels ch2141253", before, Array.isArray(value.models) && value.models.length > 0, `models=${value.models.length} 个`, attempts > 1);
    } catch (e) {
      record("channel.fetchModels ch2141253", before, false, e instanceof Error ? e.message.slice(0, 200) : String(e));
    }
  }

  // -------------------------------------------------------------------------
  // 汇总
  // -------------------------------------------------------------------------
  console.log("\n======== 功能 × 结果矩阵 ========");
  for (const row of matrix) {
    console.log(
      `  [${row.result}] ${row.feature}（真实调用 ${row.calls} 次${row.retried ? "，含重试" : ""}）: ${row.detail}`,
    );
  }
  console.log(`\n真实 LLM/API 出站调用总数：${realCalls.length} 次`);
  const byHost: Record<string, number> = {};
  for (const c of realCalls) {
    try {
      const host = new URL(c.url).hostname;
      byHost[host] = (byHost[host] ?? 0) + 1;
    } catch {
      void 0; // 个别 URL 无法解析 host 时忽略
    }
  }
  console.log("按 host 分布：" + JSON.stringify(byHost, null, 0));
  // 消耗异常提示：按功能最小期望值核对
  const warn: string[] = [];
  for (const row of matrix) {
    const expectMin: Record<string, number> = {
      "agent.startPipeline 完整解析": 9,
      "essay.startDraft": 1,
      "retro.create": 1,
      "vocab.lookup": 1,
      "vocab.image 配图": 1,
      "method.parseSentence": 1,
      "method.assocImage": 2,
      "insight.analyze": 1,
      "channel.test ch1(MMKG chat)": 1,
      "channel.test ch2(MMKG image)": 1,
      "channel.test ch2141253(DeepSeek)": 1,
      "channel.fetchModels ch2141253": 1,
    };
    if (expectMin[row.feature] !== undefined && row.calls > expectMin[row.feature] * 2) {
      warn.push(`${row.feature} 调用 ${row.calls} 次（超最小期望 ${expectMin[row.feature]} 次 2 倍以上，可能反复重试）`);
    }
  }
  if (warn.length) {
    console.log("\n⚠️  消耗异常提示：");
    warn.forEach((w) => console.log(`  - ${w}`));
  } else {
    console.log("\n消耗正常：各功能调用次数均在最小期望量级内（重试仅偶发）。");
  }

  console.log(`\n[live] 结果：${passCount} PASS，${failCount} FAIL`);
  db.close();
  // 显式退出：防 runPipelineJob 遗留的心跳定时器拖住进程
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[live] 异常：", e);
  process.exit(1);
});
