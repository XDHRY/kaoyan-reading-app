/**
 * P0 浏览器复现·修复入口：先等 raw 入口完成，再导入真实补丁 src/offline/patch-sqljs.ts（驱动层），
 * 然后用与生产一致的 schema-sqlite + sql.js + drizzle 跑同样的查询路径，验证 json 列解码恢复。
 * 结果挂到 window.__offlineTestFixed，由 scripts/test-offline-browser.mjs 经 CDP 读取。
 */
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../api/db/schema-sqlite";
import { eq, asc } from "drizzle-orm";
import { questions, passages, channels, vocabItems } from "../api/db/schema-sqlite";
// P0 修复（驱动层 PreparedQuery 包装 + relational customResultMapper）：导入即生效
import "../src/offline/patch-sqljs";

declare global {
  interface Window {
    __offlineTestRawReady?: boolean;
    __offlineTestFixed?: Record<string, unknown>;
  }
}

async function waitRawDone(): Promise<void> {
  const deadline = Date.now() + 20000;
  while (!window.__offlineTestRawReady) {
    if (Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function main(): Promise<void> {
  await waitRawDone();
  const out: Record<string, unknown> = {};
  try {
    const SQL = await initSqlJs({
      locateFile: () => new URL("./sql-wasm.wasm", document.baseURI).href,
    });
    const res = await fetch(new URL("./offline.db", document.baseURI).href);
    if (!res.ok) throw new Error(`offline.db HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const sqlDb = new SQL.Database(bytes);
    const db = drizzle(sqlDb, { schema });

    // 1) select 路径（补丁后）
    try {
      const qs = await db
        .select()
        .from(questions)
        .where(eq(questions.passageId, 1))
        .orderBy(asc(questions.qNo));
      const first = qs[0] as { options?: unknown[] } | undefined;
      out.selectFixed = {
        count: qs.length,
        firstOptionsIsArray: first ? Array.isArray(first.options) : false,
        firstOptionsLen: first && Array.isArray(first.options) ? first.options.length : -1,
        allOptionsIsArray: qs.every((q) => Array.isArray((q as { options?: unknown[] }).options)),
      };
    } catch (e) {
      out.selectFixed = { error: String((e as Error)?.message ?? e) };
    }

    // 2) relational findMany（补丁后）
    try {
      const qs = await db.query.questions.findMany({
        where: eq(questions.passageId, 1),
        orderBy: asc(questions.qNo),
      });
      const first = qs[0] as { options?: unknown[] } | undefined;
      out.relationalFixed = {
        count: qs.length,
        firstOptionsIsArray: first ? Array.isArray(first.options) : false,
      };
    } catch (e) {
      out.relationalFixed = { error: String((e as Error)?.message ?? e) };
    }

    // 3) passages select（paragraphs json 列）
    try {
      const rows = await db.select().from(passages).limit(1);
      const first = rows[0] as { paragraphs?: unknown[]; paraCount?: number } | undefined;
      out.passageSelectFixed = {
        count: rows.length,
        paragraphsIsArray: first ? Array.isArray(first.paragraphs) : false,
        paragraphsLen: first && Array.isArray(first.paragraphs) ? first.paragraphs.length : -1,
      };
    } catch (e) {
      out.passageSelectFixed = { error: String((e as Error)?.message ?? e) };
    }

    // 4) channels select（models json 列——settings 页）
    try {
      const rows = await db.select().from(channels).limit(1);
      const first = rows[0] as { models?: unknown[] } | undefined;
      out.channelsSelectFixed = {
        count: rows.length,
        modelsIsArray: first ? Array.isArray(first.models) : false,
      };
    } catch (e) {
      out.channelsSelectFixed = { error: String((e as Error)?.message ?? e) };
    }

    // 5) $returningId（P0：交卷/建资源链路主键回读；mysql 方言在 sql-js 驱动缺失，由补丁补上）
    try {
      const [{ id }] = await db
        .insert(vocabItems)
        .values({ userId: 1, word: "returning-check", zh: "回归", familiarity: 0 })
        .$returningId();
      const row = await db.select().from(vocabItems).where(eq(vocabItems.id, id));
      out.returningIdFixed = {
        id,
        isNumber: typeof id === "number" && id > 0,
        roundTripFound: row.length === 1,
      };
    } catch (e) {
      out.returningIdFixed = { error: String((e as Error)?.message ?? e) };
    }
  } catch (e) {
    out.fatal = String((e as Error)?.message ?? e);
  }
  window.__offlineTestFixed = out;
}

void main();
