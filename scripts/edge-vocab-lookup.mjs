#!/usr/bin/env node
/**
 * 边界测试：vocab.lookup 离线兜底行为（第 7 轮代码审查发现 zh 空值无二次校验）
 * 覆盖：正常词 / 空词 / 超长词(>1000) / 超大 context(>2000 应被 z 校验拒绝) / 特殊字符词
 * 环境：离线 caller（lookup 走 LLM 失败 → catch 兜底 → 空释义入册，属预期设计）
 * 用法：node scripts/edge-vocab-lookup.mjs
 */
import initSqlJs from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../api/db/schema-sqlite";
import { setOfflineDb } from "../src/offline/connection";
import "../src/offline/patch-sqljs"; // 与真实离线运行时一致
import { createOfflineCaller } from "../src/offline/caller";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DB_PATH = process.env.OFFLINE_DB_PATH ?? "C:/Users/xdrhh/AppData/Local/Temp/kysop-gh/kaoyan-reading-app/public/offline.db";

let pass = 0, fail = 0;
function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? `（${detail}）` : ""}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? `（${detail}）` : ""}`); }
}

const SQL = await initSqlJs({ locateFile: (f) => "C:/Users/xdrhh/AppData/Local/Temp/kysop-gh/kaoyan-reading-app/node_modules/sql.js/dist/" + f });
const db = new SQL.Database(fs.readFileSync(DB_PATH));
setOfflineDb(drizzle(db, { schema }));
const caller = createOfflineCaller();

console.log("[edge] vocab.lookup 边界");

// 1. 正常词：离线兜底应返回空释义词条（cached=false，item 存在）
{
  const r = await caller.vocab.lookup({ word: "testedge", context: "a normal context", passageId: 1 });
  ok("正常词：item 存在", !!r.item, `id=${r.item?.id}`);
  ok("正常词：离线兜底 zh 为空（预期）", r.item?.zh === "" || r.item?.zh === null, `zh=${JSON.stringify(r.item?.zh)}`);
  ok("正常词：cached=false", r.cached === false);
}

// 2. 空词：trim 后为空 → 应被 z.string().min(1) 拒绝
{
  try {
    await caller.vocab.lookup({ word: "   " });
    ok("空词：被拒绝", false, "未抛错");
  } catch (e) {
    ok("空词：被拒绝", true, e.message.slice(0, 80));
  }
}

// 3. 超长词（>2000）：z.string().max(2000) 应拒绝
{
  const longWord = "x".repeat(2500);
  try {
    await caller.vocab.lookup({ word: longWord });
    ok("超长词：被拒绝", false, "未抛错");
  } catch (e) {
    ok("超长词：被拒绝", true, e.message.slice(0, 80));
  }
}

// 4. 超大 context（>2000）：z.string().max(2000) 应拒绝
{
  try {
    await caller.vocab.lookup({ word: "bigctx", context: "y".repeat(2500) });
    ok("超大 context：被拒绝", false, "未抛错");
  } catch (e) {
    ok("超大 context：被拒绝", true, e.message.slice(0, 80));
  }
}

// 5. 特殊字符词：应正常入册（兜底）
{
  const r = await caller.vocab.lookup({ word: "self-check'\"", context: "special" });
  ok("特殊字符词：item 存在", !!r.item, `id=${r.item?.id}`);
}

console.log(`\n[edge] 结果：${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
