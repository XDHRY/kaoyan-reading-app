/**
 * 离线 caller 冒烟测试核心（被 scripts/test-offline-caller.mjs 用 esbuild bundle 后于 Node 运行；
 * bundle 时用 onResolve 插件把 `queries/connection` → src/offline/connection.ts（shim）、
 * `@db/schema` → api/db/schema-sqlite.ts，与浏览器 vite alias 行为一致）。
 *
 * 断言清单（全部走 tRPC caller 链路，验证 sql-js 后端下整套 router 可用）：
 * 1. ping + passage.list/detail + knowledge.list/byNode + method.clauses（公开/只读）
 * 2. interactive.availability + stepQuestion（读 analyses 缓存，零 LLM）
 * 3. 生词本：原始插入一条 → vocab.setFamiliarity → vocab.list 查回（写 + 读）
 * 4. agent.saveResult（skipAnalysis）→ practice_records + wrong_items 落库
 * 5. insight.insightList + export.fullBackup 出 JSON
 *
 * 全部 PASS 才 exit 0，任一失败 exit 1。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import { eq, asc } from "drizzle-orm";
import * as schema from "../api/db/schema-sqlite";
import { questions, channels } from "../api/db/schema-sqlite";
import "../src/offline/patch-sqljs"; // 先打 sql-js driver 补丁，再建实例
import { setOfflineDb } from "../src/offline/connection";
import { createOfflineCaller } from "../src/offline/caller";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// bundle 产物位于 scripts/.tmp/，import.meta.url 会漂移；编排器以项目根为 cwd 拉起
const ROOT = process.cwd();
const DB_PATH = process.env.OFFLINE_DB_PATH ?? path.join(ROOT, "public", "offline.db");

let pass = 0;
let fail = 0;

function ok(name: string, cond: unknown, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${detail ? `（${detail}）` : ""}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? `（${detail}）` : ""}`);
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ 找不到 ${DB_PATH}，请先运行 node scripts/build-offline-db.mjs`);
    process.exit(1);
  }
  const sizeMB = (fs.statSync(DB_PATH).size / 1024 / 1024).toFixed(2);
  console.log(`[offline-caller] 打开 ${DB_PATH}（${sizeMB} MB）`);

  const SQL = await initSqlJs({
    locateFile: (f) => path.join(ROOT, "node_modules", "sql.js", "dist", f),
  });
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  const drizzleDb = drizzle(db, { schema });
  setOfflineDb(drizzleDb);

  const caller = createOfflineCaller();

  // 1. ping 与公开查询
  console.log("[1] ping 与公开查询");
  const ping = await caller.ping();
  ok("ping.ok === true", ping.ok === true);
  ok("ping.ts 为毫秒时间戳", typeof ping.ts === "number" && ping.ts > 0);

  const pList = await caller.passage.list();
  ok("passage.list 返回 68 篇", pList.length === 68, `实际 ${pList.length}`);
  const first = pList[0];
  ok(
    "list 项含 id/year/textNo/paraCount",
    !!first && typeof first.id === "number" && typeof first.year === "number" && typeof first.paraCount === "number",
  );

  const detail = await caller.passage.detail({ id: first.id });
  ok("passage.detail 含 5 题", detail.questions.length === 5, `实际 ${detail.questions.length}`);
  ok("detail.passage.id 与入参一致", detail.passage.id === first.id);
  // P0 回归：json 列必须解码为结构化值（select 与关系型两条路径都要真）
  ok("detail.questions[0].options 为数组", Array.isArray(detail.questions[0]?.options), `实际 ${typeof detail.questions[0]?.options}`);
  ok("detail.passage.paragraphs 为数组", Array.isArray(detail.passage?.paragraphs), `实际 ${typeof detail.passage?.paragraphs}`);
  const selQs = await drizzleDb.select().from(questions).where(eq(questions.passageId, first.id)).orderBy(asc(questions.qNo));
  ok(
    "db.select().from(questions) options 全部为数组",
    selQs.length > 0 && selQs.every((q) => Array.isArray(q.options)),
    `实际 ${selQs.map((q) => typeof q.options).join(",")}`,
  );
  const selCh = await drizzleDb.select().from(channels);
  ok(
    "db.select().from(channels) models 为数组（settings 路径）",
    selCh.length > 0 && selCh.every((c) => Array.isArray(c.models)),
    `实际 ${selCh.map((c) => typeof c.models).join(",")}`,
  );

  const kList = await caller.knowledge.list();
  ok("knowledge.list 非空", kList.length > 0, `实际 ${kList.length}`);
  const byNode = await caller.knowledge.byNode({ nodeId: kList[0].nodeId });
  ok("knowledge.byNode 命中同一张卡", byNode?.nodeId === kList[0].nodeId);

  const clauses = await caller.method.clauses();
  ok("method.clauses 非空", clauses.length > 0, `实际 ${clauses.length}`);

  // 2. interactive：读 analyses 缓存（零 LLM）
  console.log("[2] interactive 读缓存链路");
  const ana = db.exec(
    'SELECT "passage_id", "payload" FROM "analyses" WHERE "source" = \'exam\' ORDER BY "id" DESC LIMIT 1',
  );
  ok("offline.db 存在 exam analyses 缓存", ana.length > 0 && ana[0].values.length > 0);
  let refId = 1;
  let qNo = 1;
  if (ana.length > 0 && ana[0].values.length > 0) {
    refId = Number(ana[0].values[0][0]);
    try {
      const payload = JSON.parse(String(ana[0].values[0][1]));
      const arr = Array.isArray((payload as { questions?: unknown[] })?.questions)
        ? ((payload as { questions: { qNo?: number }[] }).questions)
        : [];
      if (arr.length > 0) qNo = Number(arr[0].qNo ?? 1);
    } catch {
      // payload 解析失败：断言会在下方失败
    }
  }
  const avail = await caller.interactive.availability({ kind: "exam", refId });
  ok("interactive.availability.ready === true", avail.ready === true, `refId=${refId}`);
  ok("availability.qCount > 0", avail.qCount > 0, `实际 ${avail.qCount}`);
  const step = await caller.interactive.stepQuestion({ kind: "exam", refId, qNo });
  ok("stepQuestion 返回 stem", typeof step.stem === "string" && step.stem.length > 0);
  ok("stepQuestion.options >= 4", Array.isArray(step.options) && step.options.length >= 4);

  // 3. 生词本：原始插入一条（vocab 无离线建词入口）→ setFamiliarity → list 查回
  console.log("[3] 生词本写入链路");
  db.run('INSERT INTO "vocab_items" ("user_id", "word", "zh", "familiarity") VALUES (1, ?, ?, 0)', [
    "abandon",
    "放弃",
  ]);
  const vid = Number(db.exec("SELECT last_insert_rowid() AS id")[0].values[0][0]);
  const sf = await caller.vocab.setFamiliarity({ id: vid, familiarity: 2 });
  ok("vocab.setFamiliarity 返回 ok", sf.ok === true);
  const vList = await caller.vocab.list();
  const mine = vList.find((v: { id: number }) => v.id === vid);
  ok("vocab.list 可见刚写入的词", !!mine, `id=${vid}`);
  ok("familiarity 已更新为 2", mine?.familiarity === 2);

  // 4. agent.saveResult：造练习记录 + 错题自动入册（skipAnalysis 免构造 payload）
  console.log("[4] agent.saveResult 落库（练习 + 错题）");
  const wrongQ = detail.questions.find((x) => x.answer) ?? detail.questions[0];
  const answers: Record<string, string> = {};
  const verdicts: Record<string, boolean> = {};
  for (const xq of detail.questions) {
    answers[String(xq.id)] = "A";
    verdicts[String(xq.id)] = xq.id !== wrongQ.id; // 仅 wrongQ 判错
  }
  const sr = await caller.agent.saveResult({
    kind: "exam",
    passageId: first.id,
    payload: {},
    modelUsed: "offline-test",
    answers,
    verdicts,
    skipAnalysis: true,
  });
  ok("saveResult 返回 ok", sr.ok === true);
  const pr = db.exec('SELECT COUNT(*) AS c FROM "practice_records" WHERE "user_id" = 1');
  ok("practice_records 已写入", Number(pr[0].values[0][0]) >= 1, `实际 ${pr[0].values[0][0]}`);
  const wr = db.exec("SELECT COUNT(*) AS c FROM \"wrong_items\" WHERE \"user_id\" = 1 AND \"source\" = 'exam'");
  ok("wrong_items 已自动入册", Number(wr[0].values[0][0]) >= 1, `实际 ${wr[0].values[0][0]}`);

  // 5. insight 与导出
  console.log("[5] insight 与导出");
  const insights = await caller.insight.insightList();
  ok("insight.insightList 返回数组", Array.isArray(insights));
  const backup = await caller.export.fullBackup();
  ok("fullBackup.version === 'v5'", backup.version === "v5");
  ok("fullBackup 含 practiceRecords", Array.isArray(backup.practiceRecords) && backup.practiceRecords.length >= 1);
  ok("fullBackup 含 wrongItems", Array.isArray(backup.wrongItems) && backup.wrongItems.length >= 1);

  // 6. startPipeline：建 job 依赖 $returningId（P0 修复验证）。
  //    refId 沿用 [2] 已断言 availability.ready 的缓存篇目 → offlineHydratePayload 水合成功，
  //    runPipelineJob 各 LLM 阶段全部跳过，快速 done；若水合失败走离线 LLM 也会转 error（属预期，不算败）。
  console.log("[6] startPipeline 建 job（$returningId 链路）");
  const sp = await caller.agent.startPipeline({ kind: "exam", refId });
  ok(
    "startPipeline 返回数值 jobId（$returningId 生效）",
    typeof sp.jobId === "number" && sp.jobId > 0,
    `jobId=${sp.jobId}`,
  );
  ok("startPipeline 新建而非复用", sp.reused === false);
  const jobRows = db.exec(`SELECT "id", "status" FROM "pipeline_jobs" WHERE "id" = ${sp.jobId}`);
  ok(
    "pipeline_jobs 落库命中 jobId",
    jobRows.length > 0 && Number(jobRows[0].values[0]?.[0]) === sp.jobId,
    JSON.stringify(jobRows[0]?.values),
  );
  let terminal: string | null = null;
  const termDeadline = Date.now() + 15000;
  while (Date.now() < termDeadline) {
    const st = await caller.agent.pipelineStatus({ id: sp.jobId });
    if (st.status === "done" || st.status === "error") {
      terminal = st.status;
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  ok(
    "job 到达终态（done 或 error；error=离线 LLM 失败属预期）",
    terminal === "done" || terminal === "error",
    `status=${terminal ?? "running(15s 超时)"}`,
  );
  if (terminal === "done") console.log("  ℹ️  job 经水合缓存全链路 done（零 LLM）");
  else if (terminal === "error") console.log("  ℹ️  job 为 error（离线 LLM 失败，预期不算败）");

  console.log(`\n[offline-caller] 结果：${pass} PASS，${fail} FAIL`);
  if (fail > 0) {
    console.error("[offline-caller] 存在失败项");
    db.close();
    process.exit(1);
  }
  console.log("[offline-caller] 全部通过 ✅");
  db.close();
  // 显式退出：防止 runPipelineJob 遗留的后台网络句柄拖住进程（正常路径已完成断言，此处只是保险）
  process.exit(0);
}

main().catch((e) => {
  console.error("[offline-caller] 异常：", e);
  process.exit(1);
});
