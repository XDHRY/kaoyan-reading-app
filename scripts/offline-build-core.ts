/**
 * 离线库构建核心（被 scripts/build-offline-db.mjs 用 esbuild bundle 后执行）。
 *
 * 数据来源：
 * 1. db/final_corpus.json → passages/questions（复用 seedCorpus 的灌入逻辑）
 * 2. MySQL dump（流式 gunzip + 字符级状态机解析，严禁整体解压落盘）→
 *    knowledge_cards / method_clauses / analyses（剥 payload.image 大图）/
 *    sentence_analyses / answer_diffs / prompts / site_settings / bindings /
 *    announcements / channels（api_key 默认置空；OFFLINE_EMBED_KEYS=1 时保留真实密钥）
 * 3. users 表写入本地占位用户（id=1，role=admin，scrypt 哈希）
 *
 * 输出：public/offline.db（sql.js 导出二进制）。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { scryptSync, randomBytes } from "node:crypto";
import initSqlJs from "sql.js";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "../api/db/schema-sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// bundle 产物位于 scripts/.tmp/，import.meta.url 会漂移；编排器以项目根为 cwd 拉起，
// 故以 process.cwd() 为根（兼容直接 node 运行 core 的场景）。
const ROOT = process.cwd();

/** 覆盖式环境变量，便于换 dump 重建 */
const DUMP_PATH =
  process.env.OFFLINE_DUMP_PATH ??
  "E:/zhuomian/04-娱乐与创作/ky/release-v5.11.0/db-kaoyan_reading-20260809.sql.gz";
const CORPUS_PATH = process.env.OFFLINE_CORPUS_PATH ?? path.join(ROOT, "db", "final_corpus.json");
const OUT_PATH = process.env.OFFLINE_OUT_PATH ?? path.join(ROOT, "public", "offline.db");

/** 从 dump 抽取的表（只读缓存/配置类 + 知识卡与条款） */
const DUMP_TABLES = [
  "analyses",
  "sentence_analyses",
  "answer_diffs",
  "prompts",
  "site_settings",
  "bindings",
  "announcements",
  "channels",
  "knowledge_cards",
  "method_clauses",
];

const ALL_TABLES = Object.values(schema).filter((v) => v instanceof SQLiteTable);

// ---------------------------------------------------------------------------
// DDL 生成（以 schema-sqlite.ts 元信息为唯一事实源）
// ---------------------------------------------------------------------------

function sqliteType(col: { columnType: string }): string {
  switch (col.columnType) {
    case "SQLiteInteger":
    case "SQLiteBoolean":
    case "SQLiteTimestamp":
      return "INTEGER";
    case "SQLiteText":
    case "SQLiteTextJson":
      return "TEXT";
    case "SQLiteReal":
      return "REAL";
    case "SQLiteNumeric":
      return "NUMERIC";
    case "SQLiteBlob":
      return "BLOB";
    default:
      throw new Error(`未知 sqlite 列类型: ${col.columnType}`);
  }
}

function isSqlDefault(v: unknown): boolean {
  return !!v && typeof v === "object" && "queryChunks" in v;
}

function renderDefault(col: {
  default: unknown;
  dataType: string;
}): string {
  const v = col.default;
  if (v === undefined) return "";
  if (isSqlDefault(v)) return " DEFAULT (unixepoch() * 1000)"; // schema 唯一 SQL 默认：时间戳
  if (typeof v === "string") return ` DEFAULT '${v.replace(/'/g, "''")}'`;
  if (typeof v === "number") return ` DEFAULT ${v}`;
  if (typeof v === "boolean") return ` DEFAULT ${v ? 1 : 0}`;
  return "";
}

function ddlForTable(table: typeof schema.passages): string {
  const cfg = getTableConfig(table);
  const colDefs = cfg.columns.map((c) => {
    let def = `  "${c.name}" ${sqliteType(c)}`;
    if (c.primary) def += " PRIMARY KEY";
    if (c.autoIncrement && c.primary) def += " AUTOINCREMENT";
    if (c.notNull) def += " NOT NULL";
    if (c.isUnique) def += " UNIQUE";
    def += renderDefault(c);
    return def;
  });
  for (const idx of cfg.indexes) {
    if (idx.config.unique) {
      const cols = idx.config.columns.map((c) => `"${c.name}"`).join(", ");
      colDefs.push(`  UNIQUE(${cols})`);
    }
  }
  return `CREATE TABLE "${cfg.name}" (\n${colDefs.join(",\n")}\n);`;
}

function indexesForTable(table: typeof schema.passages): string[] {
  const cfg = getTableConfig(table);
  const out: string[] = [];
  for (const idx of cfg.indexes) {
    if (idx.config.unique) continue; // 已并入 CREATE TABLE
    const cols = idx.config.columns.map((c) => `"${c.name}"`).join(", ");
    out.push(`CREATE INDEX "${idx.config.name}" ON "${cfg.name}"(${cols});`);
  }
  return out;
}

/** schema 列元信息表：tableName -> columns（保留 schema 定义顺序） */
function buildSchemaCols() {
  const map = new Map<string, ReturnType<typeof getTableConfig>["columns"]>();
  for (const t of ALL_TABLES) {
    const cfg = getTableConfig(t);
    map.set(cfg.name, cfg.columns);
  }
  return map;
}

// ---------------------------------------------------------------------------
// dump 解析：字符级状态机（容忍字符串内裸换行 / 转义引号 / 内嵌分号）
// ---------------------------------------------------------------------------

/** 引号感知：从 start 起找语句结束的 ';'（不在字符串内）。找不到返回 -1。
 *  注意：mysqldump 字符串字面量只用单引号，JSON 列值内嵌的双引号是普通字符，不参与边界判断。 */
function findStatementEnd(s: string, start: number): number {
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === "'") inStr = false;
      continue;
    }
    if (c === "'") { inStr = true; continue; }
    if (c === ";") return i;
  }
  return -1;
}

/** 按顶层 '),(' 切分 VALUES 括号组；每组以 '(' 开头（去掉组间前导逗号） */
function splitValues(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'") { i = skipString(body, i); continue; }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) { out.push(body.slice(start, i + 1)); start = i + 1; }
    }
  }
  return out.map((g) => g.trim().replace(/^,/, ""));
}

/** 按顶层逗号切分一行 value 的列 */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") { i = skipString(s, i); continue; }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) { out.push(s.slice(start, i).trim()); start = i + 1; }
  }
  out.push(s.slice(start).trim());
  return out;
}

function skipString(s: string, i: number): number {
  i++;
  while (i < s.length) {
    if (s[i] === "\\") { i += 2; continue; }
    if (s[i] === "'") return i;
    i++;
  }
  return i;
}

/** mysqldump 字符串字面量转义还原 */
function sqlUnescape(s: string): string {
  return s
    .replace(/\\(["'\\])/g, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\0/g, "\0")
    .replace(/\\b/g, "\b")
    .replace(/\\Z/g, "\x1a");
}

interface DumpResult {
  columns: string[];
  rows: string[][];
}

/**
 * 流式扫描 dump：提取目标表的列序 + 原始行值。
 * 每条语句先完整落入 buffer（引号感知找结束 ';'），再按语句类型处理；
 * CREATE TABLE 取列序（生产库实际列序，value 顺序与之对应）。
 */
async function scanDump(gzPath: string, targets: string[]): Promise<Record<string, DumpResult>> {
  const wanted = new Set(targets);
  const result: Record<string, DumpResult> = {};
  for (const t of targets) result[t] = { columns: [], rows: [] };

  let buffer = "";
  const stream = fs.createReadStream(gzPath).pipe(zlib.createGunzip());
  let totalRows = 0;

  const feed = async () => {
    for await (const chunk of stream) {
      buffer += chunk.toString("utf8");
      while (buffer.length) {
        const head = buffer.replace(/^[\s\n\r]+/, "");
        if (!head.length) { buffer = ""; break; }

        // -- 行注释
        if (head.startsWith("--")) {
          const nl = head.indexOf("\n");
          if (nl === -1) { buffer = head; break; } // 等下一 chunk
          buffer = head.slice(nl + 1);
          continue;
        }
        // /* ... */ 块注释 / 版本化注释
        if (head.startsWith("/*")) {
          const end = head.indexOf("*/");
          if (end === -1) { buffer = head; break; }
          buffer = head.slice(end + 2);
          continue;
        }
        // CREATE TABLE
        const mCreate = head.match(/^CREATE TABLE `([^`]+)`\s*\(/);
        if (mCreate) {
          const stmtStart = mCreate[0].length;
          const end = findStatementEnd(head, stmtStart);
          if (end === -1) { buffer = head; break; }
          const def = head.slice(stmtStart, end);
          if (wanted.has(mCreate[1])) {
            // 列定义行：`name` <type...>，排除 PRIMARY KEY ( / UNIQUE KEY ( 等表级子句
            const cols = [...def.matchAll(/^\s*`([^`]+)`\s+(bigint|int|varchar|text|json|timestamp|tinyint|mediumtext|longtext|enum|boolean|serial)/gm)].map((m) => m[1]);
            if (cols.length) result[mCreate[1]].columns = cols;
          }
          buffer = head.slice(end + 1);
          continue;
        }
        // INSERT INTO
        const mInsert = head.match(/^INSERT INTO `([^`]+)`\s+VALUES\s*\(/);
        if (mInsert) {
          const name = mInsert[1];
          const bodyStart = mInsert[0].length - 1; // 指向 '('
          if (!wanted.has(name)) {
            const end = findStatementEnd(head, bodyStart);
            if (end === -1) { buffer = head; break; }
            buffer = head.slice(end + 1);
            continue;
          }
          const end = findStatementEnd(head, bodyStart);
          if (end === -1) { buffer = head; break; }
          const body = head.slice(bodyStart, end); // '(' ... ')'（不含 ;）
          const groups = splitValues(body);
          for (const g of groups) {
            if (!g.startsWith("(")) continue;
            const cols = splitTopLevel(g.slice(1, -1));
            if (cols.length !== result[name].columns.length) {
              console.warn(`[dump] ${name} 行列数 ${cols.length} != 列数 ${result[name].columns.length}，跳过`);
              continue;
            }
            result[name].rows.push(cols);
            totalRows++;
          }
          buffer = head.slice(end + 1);
          continue;
        }
        // 其他语句：跳到 ';'（SET/LOCK/UNLOCK/DROP/USE 等）
        const end = findStatementEnd(head, 0);
        if (end === -1) { buffer = head; break; }
        buffer = head.slice(end + 1);
      }
      if (totalRows % 200 === 0 && totalRows > 0) {
        // 进度（不刷屏：仅在有批次时输出一次）
      }
    }
  };
  await feed();
  return result;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[build] 根目录: ${ROOT}`);
  console.log(`[build] dump: ${DUMP_PATH}`);
  if (!fs.existsSync(DUMP_PATH)) throw new Error(`dump 不存在: ${DUMP_PATH}`);
  console.log(`[build] 语料: ${CORPUS_PATH}`);
  if (!fs.existsSync(CORPUS_PATH)) throw new Error(`final_corpus.json 不存在: ${CORPUS_PATH}`);

  const SQL = await initSqlJs({
    locateFile: (f) => path.join(ROOT, "node_modules", "sql.js", "dist", f),
  });
  const db = new SQL.Database();

  // 1) 建表 DDL + 索引
  db.run("BEGIN TRANSACTION");
  const schemaCols = buildSchemaCols();
  let tableCount = 0;
  for (const t of ALL_TABLES) {
    db.run(ddlForTable(t));
    for (const idx of indexesForTable(t)) db.run(idx);
    tableCount++;
  }
  db.run("COMMIT");
  console.log(`[build] DDL 完成：${tableCount} 张表 + 索引`);

  // 2) 灌内容表：final_corpus.json → passages/questions
  {
    const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, "utf-8")) as {
      year: number;
      textNo: number;
      paragraphs: string[];
      sourceTag: string;
      verifyStatus: string;
      verifyNote: string | null;
      questions: { qNo: number; stem: string; options: string[]; answer: string | null; qType: string }[];
    }[];
    db.run("BEGIN TRANSACTION");
    const pStmt = db.prepare(
      'INSERT INTO "passages" ("year", "text_no", "paragraphs", "source_tag", "verify_status", "verify_note") VALUES (?, ?, ?, ?, ?, ?)',
    );
    const qStmt = db.prepare(
      'INSERT INTO "questions" ("passage_id", "q_no", "stem", "q_type", "options", "answer") VALUES (?, ?, ?, ?, ?, ?)',
    );
    let p = 0;
    let q = 0;
    for (const item of corpus) {
      pStmt.run([
        item.year,
        item.textNo,
        JSON.stringify(item.paragraphs),
        item.sourceTag,
        item.verifyStatus,
        item.verifyNote ?? null,
      ]);
      const pid = Number(db.exec("SELECT last_insert_rowid() AS id")[0].values[0][0]);
      p++;
      for (const qq of item.questions) {
        qStmt.run([pid, qq.qNo, qq.stem, qq.qType, JSON.stringify(qq.options), qq.answer]);
        q++;
      }
    }
    pStmt.free();
    qStmt.free();
    db.run("COMMIT");
    console.log(`[build] 内容表：passages=${p}，questions=${q}`);
  }

  // 3) dump 抽取
  {
    console.log(`[build] 流式解析 dump（目标表 ${DUMP_TABLES.length} 张）…`);
    const dumped = await scanDump(DUMP_PATH, DUMP_TABLES);
    db.run("BEGIN TRANSACTION");
    for (const tname of DUMP_TABLES) {
      const info = dumped[tname];
      const schemaColsArr = schemaCols.get(tname);
      if (!schemaColsArr) throw new Error(`schema 无表 ${tname}`);
      if (!info.columns.length) {
        console.warn(`[build] dump 中无 ${tname} 的 CREATE TABLE 定义，跳过`);
        continue;
      }
      // 列交集：只插 dump 与 schema 都有的列（多余列丢弃，缺失列走默认）
      const schemaNames = new Set(schemaColsArr.map((c) => c.name));
      const common = info.columns.filter((n) => schemaNames.has(n));
      const dumpIdxOf = (n: string) => info.columns.indexOf(n);
      const insertCols = schemaColsArr.filter((c) => common.includes(c.name));

      const colSql = insertCols.map((c) => `"${c.name}"`).join(", ");
      const qmarks = insertCols.map(() => "?").join(", ");
      const stmt = db.prepare(`INSERT INTO "${tname}" (${colSql}) VALUES (${qmarks})`);

      let n = 0;
      let strippedPics = 0;
      let clearedKeys = 0;
      for (const rawRow of info.rows) {
        const binds: unknown[] = insertCols.map((c) => {
          const raw = rawRow[dumpIdxOf(c.name)];
          if (raw === "NULL") return null;
          if (c.columnType === "SQLiteTimestamp") {
            // dump 时区固定为 +00:00，时间戳字符串按 UTC 解析为 ms
            const s = raw.replace(/^'|'$/g, "");
            return Date.parse(s.replace(" ", "T") + "Z");
          }
          if (c.name === "payload" && tname === "analyses") {
            // 剥除内嵌 base64 结构图（payload.image，最大可达数 MB）
            const s = sqlUnescape(raw.slice(1, -1));
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(s);
            } catch {
              return sqlUnescape(raw.slice(1, -1));
            }
            if (payload && typeof payload === "object" && "image" in payload) {
              delete payload.image;
              strippedPics++;
            }
            return JSON.stringify(payload);
          }
          if (c.name === "api_key" && tname === "channels") {
            // 默认剥除密钥（GitHub 公开版安全）；OFFLINE_EMBED_KEYS=1 时保留 dump 内真实
            // api_key（离线 APK 专用构建：内嵌真实密钥 + CapacitorHttp 原生层出站调用）。
            if (process.env.OFFLINE_EMBED_KEYS !== "1") {
              clearedKeys++;
              return "";
            }
            return sqlUnescape(raw.slice(1, -1));
          }
          if (c.name === "models" && tname === "channels") return sqlUnescape(raw.slice(1, -1));
          if (c.dataType === "json") return sqlUnescape(raw.slice(1, -1));
          if (c.dataType === "boolean") return Number(raw);
          if (c.dataType === "date") return null; // 理论不可达（timestamp 已在上分支）
          if (raw.startsWith("'")) return sqlUnescape(raw.slice(1, -1));
          return Number(raw);
        });
        stmt.run(binds);
        n++;
      }
      stmt.free();
      console.log(
        `[build] ${tname}: ${n} 行${strippedPics ? `（剥图 ${strippedPics} 行）` : ""}${clearedKeys ? `（清空 api_key ${clearedKeys} 行）` : ""}`,
      );
    }
    db.run("COMMIT");
  }

  // 4) 本地用户（id=1，离线占位）
  {
    const salt = randomBytes(16).toString("hex");
    const recoverySalt = randomBytes(16).toString("hex");
    // 固定离线占位口令（仅离线场景，登录路由下一阶段接入；哈希存库，不落明文）
    const passwordHash = scryptSync("local-offline", salt, 64).toString("hex");
    db.run(
      'INSERT INTO "users" ("name", "password_hash", "salt", "recovery_question", "recovery_hash", "recovery_salt", "avatar_char", "role") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ["local", passwordHash, salt, "", scryptSync("阅", recoverySalt, 64).toString("hex"), recoverySalt, "离", "admin"],
    );
    console.log("[build] 本地用户 local(id=1, role=admin) 已写入");
  }

  // 5) 导出
  const buf = Buffer.from(db.export());
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, buf);
  console.log(`[build] 已输出 ${OUT_PATH}（${(buf.length / 1024 / 1024).toFixed(2)} MB）`);

  // 6) 行数统计
  for (const t of ALL_TABLES) {
    const cfg = getTableConfig(t);
    const r = db.exec(`SELECT COUNT(*) FROM "${cfg.name}"`);
    console.log(`  ${cfg.name}: ${r[0].values[0][0]} 行`);
  }

  db.close();
}

main().catch((e) => {
  console.error("[build] 失败：", e);
  process.exit(1);
});
