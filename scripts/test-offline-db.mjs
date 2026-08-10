#!/usr/bin/env node
/**
 * 离线库完整性测试：打开 public/offline.db 跑断言。
 *
 * 断言清单：
 * 1. passages = 68，questions = 340，且任取一篇 detail 含 5 题
 * 2. knowledge_cards = 16，method_clauses = 64
 * 3. analyses 行数 >= 100，且抽查 3 行 payload 无 data:image base64 大图
 * 4. channels 所有 api_key 为空
 * 5. site_settings 可读
 * 6. 写入测试：在临时副本上 insert 一条 practice_records 并查回，
 *    重新加载副本验证持久化（不污染交付的 public/offline.db）
 *
 * 全部 PASS 才退出 0，任一失败 exit 1。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DB_PATH = process.env.OFFLINE_DB_PATH ?? path.join(ROOT, "public", "offline.db");

let pass = 0;
let fail = 0;

function ok(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${detail ? `（${detail}）` : ""}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? `（${detail}）` : ""}`);
  }
}

function loadDb(sql, buf) {
  const db = new sql.Database(buf);
  return {
    count(table) {
      const r = db.exec(`SELECT COUNT(*) FROM "${table}"`);
      return Number(r[0].values[0][0]);
    },
    all(sqlText, params = []) {
      const stmt = db.prepare(sqlText);
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    db,
  };
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ 找不到 ${DB_PATH}，请先运行 node scripts/build-offline-db.mjs`);
    process.exit(1);
  }
  const sizeMB = (fs.statSync(DB_PATH).size / 1024 / 1024).toFixed(2);
  console.log(`[test] 打开 ${DB_PATH}（${sizeMB} MB）`);

  const SQL = await initSqlJs({
    locateFile: (f) => path.join(ROOT, "node_modules", "sql.js", "dist", f),
  });
  const q = loadDb(SQL, fs.readFileSync(DB_PATH));

  // 1. 内容表
  console.log("[1] 内容表行数");
  const pCount = q.count("passages");
  const qCount = q.count("questions");
  ok("passages = 68", pCount === 68, `实际 ${pCount}`);
  ok("questions = 340", qCount === 340, `实际 ${qCount}`);
  {
    // 任取一篇 detail 含 5 题（2010 年 text1）
    const row = q.all('SELECT id FROM "passages" ORDER BY year ASC, text_no ASC LIMIT 1');
    const pid = Number(row[0].id);
    const qs = q.all('SELECT * FROM "questions" WHERE "passage_id" = ? ORDER BY "q_no"', [pid]);
    ok("任一 passage 的 questions = 5", qs.length === 5, `passage ${pid} 实际 ${qs.length} 题`);
    const withOpts = qs.filter((x) => Array.isArray(JSON.parse(x.options)) && JSON.parse(x.options).length >= 4);
    ok("每题 options 为 JSON 数组且 >= 4 项", withOpts.length === 5);
  }

  // 2. 知识卡与条款
  console.log("[2] 知识卡与方法条款");
  ok("knowledge_cards = 16", q.count("knowledge_cards") === 16, `实际 ${q.count("knowledge_cards")}`);
  ok("method_clauses = 64", q.count("method_clauses") === 64, `实际 ${q.count("method_clauses")}`);

  // 3. analyses：行数与图片剥离
  console.log("[3] analyses 图片剥离");
  const aCount = q.count("analyses");
  ok("analyses >= 100", aCount >= 100, `实际 ${aCount}`);
  const samples = q.all('SELECT "id", "payload" FROM "analyses" ORDER BY "id" LIMIT 3');
  let picFound = false;
  for (const s of samples) {
    const payload = JSON.parse(s.payload);
    if (JSON.stringify(payload).match(/data:image/i)) picFound = true;
  }
  ok("抽查 3 行 payload 无 data:image", !picFound);
  // 抽查 3 行后，全表扫一遍确认无图（只取 payload 长度>200KB 的行更省）
  const heavy = q.all('SELECT "payload" FROM "analyses" WHERE length("payload") > 200000');
  let heavyPic = 0;
  for (const h of heavy) if (/data:image/i.test(h.payload)) heavyPic++;
  ok("无 >200KB 的 data:image payload", heavyPic === 0, `大 payload ${heavy.length} 行，含图 ${heavyPic}`);
  // 验证 payload JSON 可解析（抽查 3 行）
  let jsonOk = true;
  for (const s of samples) {
    try { JSON.parse(s.payload); } catch { jsonOk = false; }
  }
  ok("抽查 payload JSON 可解析", jsonOk);

  // 4. channels api_key：默认构建全空（GitHub 公开版剥钥）；
  //    OFFLINE_EMBED_KEYS=1 构建保留 dump 内真实密钥（离线 APK 专用，内嵌真实 key + 原生层出站调用）
  console.log("[4] channels api_key 脱敏");
  const ch = q.all('SELECT "api_key" FROM "channels"');
  ok("channels = 10", ch.length === 10, `实际 ${ch.length}`);
  if (process.env.OFFLINE_EMBED_KEYS === "1") {
    ok(
      "所有 api_key 非空（OFFLINE_EMBED_KEYS=1 内嵌真实密钥）",
      ch.every((c) => typeof c.api_key === "string" && c.api_key.length > 8),
      `实际 ${ch.map((c) => c.api_key.slice(0, 4) + "****").join(",")}`,
    );
  } else {
    ok("所有 api_key 为空（默认公开版剥钥）", ch.every((c) => c.api_key === ""));
  }

  // 5. site_settings 可读
  console.log("[5] site_settings 可读");
  const ss = q.all('SELECT "k", "v" FROM "site_settings"');
  ok("site_settings 行数 > 0", ss.length > 0, `实际 ${ss.length}`);

  // 6. 写入测试（临时副本）
  console.log("[6] 写入测试（临时副本，不污染交付库）");
  const tmpPath = path.join(os.tmpdir(), `offline-db-test-${process.pid}.db`);
  fs.copyFileSync(DB_PATH, tmpPath);
  {
    const w = loadDb(SQL, fs.readFileSync(tmpPath));
    const answers = JSON.stringify({ 1: "A", 2: "B" });
    w.db.run(
      'INSERT INTO "practice_records" ("user_id", "source", "passage_id", "answers", "duration_sec") VALUES (1, ?, ?, ?, 120)',
      ["exam", 1, answers],
    );
    const row = w.all('SELECT * FROM "practice_records" WHERE "passage_id" = 1 ORDER BY "id" DESC LIMIT 1');
    ok("插入后查回 1 条", row.length === 1);
    ok("answers JSON 原样查回", JSON.parse(row[0].answers)[1] === "A");
    ok("时间列默认值生效（created_at 为毫秒数）", typeof row[0].created_at === "number" && row[0].created_at > 0);
    // sql.js 修改仅存在于内存，需 export() 显式写回副本文件才可验证持久化
    fs.writeFileSync(tmpPath, Buffer.from(w.db.export()));
    w.db.close();
  }
  {
    // 重新加载副本验证持久化
    const w2 = loadDb(SQL, fs.readFileSync(tmpPath));
    const rows = w2.all('SELECT COUNT(*) AS c FROM "practice_records"');
    ok("重新加载副本后记录仍在", Number(rows[0].c) === 1);
    w2.db.close();
  }
  fs.rmSync(tmpPath, { force: true });

  // 收尾：统计
  console.log(`\n[test] 结果：${pass} PASS，${fail} FAIL`);
  if (fail > 0) {
    console.error("[test] 存在失败项");
    process.exit(1);
  }
  console.log("[test] 全部通过 ✅");
  q.db.close();
}

main().catch((e) => {
  console.error("[test] 异常：", e);
  process.exit(1);
});
