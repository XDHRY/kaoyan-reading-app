/**
 * P0 浏览器复现·原生行为入口（不加载任何补丁）：
 * 在真实浏览器（headless Chrome）里用与生产一致的 schema-sqlite + sql.js + drizzle-orm/sql-js
 * 执行三种查询路径，记录 json 列的实际解码情况，暴露根因证据。
 * 结果挂到 window.__offlineTestRaw，由 scripts/test-offline-browser.mjs 经 CDP 读取。
 * 与 browser-repro-entry-fix.ts 配对：本入口先运行并置 __offlineTestRawReady=true，
 * fix 入口等该标志后再运行，保证补丁不污染原生测量。
 */
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../api/db/schema-sqlite";
import { eq, asc } from "drizzle-orm";
import { questions, passages, channels, vocabItems } from "../api/db/schema-sqlite";

declare global {
  interface Window {
    __offlineTestRaw?: Record<string, unknown>;
    __offlineTestRawReady?: boolean;
  }
}

async function main(): Promise<void> {
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

    // 列对象诊断：json 列是否真的带 mapFromDriverValue=JSON.parse
    const optCol = questions.options as unknown as {
      dataType?: string;
      columnType?: string;
      mapFromDriverValue?: (...a: unknown[]) => unknown;
    };
    out.columnDiag = {
      dataType: optCol.dataType,
      columnType: optCol.columnType,
      mapFromDriverValueSrc: String(optCol.mapFromDriverValue),
      ctorName: (optCol as object).constructor?.name,
    };

    // 1) select 路径（原生）
    try {
      const qs = await db
        .select()
        .from(questions)
        .where(eq(questions.passageId, 1))
        .orderBy(asc(questions.qNo));
      const first = qs[0] as { options?: unknown; qNo?: number } | undefined;
      out.selectRaw = {
        count: qs.length,
        firstOptionsType: first ? typeof first.options : "n/a",
        firstOptionsIsArray: first ? Array.isArray(first.options) : false,
        firstOptionsSample: first && typeof first.options === "string"
          ? (first.options as string).slice(0, 60)
          : undefined,
        allOptionsTypes: [...new Set(qs.map((q) => typeof (q as { options?: unknown }).options))],
        sampleKeys: first ? Object.keys(first).slice(0, 10) : [],
      };
    } catch (e) {
      out.selectRaw = { error: String((e as Error)?.message ?? e) };
    }

    // 2) relational findMany（原生 customResultMapper，无补丁）
    try {
      const qs = await db.query.questions.findMany({
        where: eq(questions.passageId, 1),
        orderBy: asc(questions.qNo),
      });
      const first = qs[0] as { options?: unknown } | undefined;
      out.relationalRaw = {
        count: qs.length,
        firstOptionsType: first ? typeof first.options : "n/a",
        firstOptionsIsArray: first ? Array.isArray(first.options) : false,
      };
    } catch (e) {
      out.relationalRaw = { error: String((e as Error)?.message ?? e) };
    }

    // 3) passages select（paragraphs 也是 json 列——首页 passage.list 的路径）
    try {
      const rows = await db.select().from(passages).limit(1);
      const first = rows[0] as { paragraphs?: unknown; paraCount?: number } | undefined;
      out.passageSelectRaw = {
        count: rows.length,
        paragraphsIsArray: first ? Array.isArray(first.paragraphs) : false,
        paragraphsType: first ? typeof first.paragraphs : "n/a",
      };
    } catch (e) {
      out.passageSelectRaw = { error: String((e as Error)?.message ?? e) };
    }

    // 4) channels select（models 是 json 列——settings 页的路径）
    try {
      const rows = await db.select().from(channels).limit(1);
      const first = rows[0] as { models?: unknown } | undefined;
      out.channelsSelectRaw = {
        count: rows.length,
        modelsIsArray: first ? Array.isArray(first.models) : false,
        modelsType: first ? typeof first.models : "n/a",
      };
    } catch (e) {
      out.channelsSelectRaw = { error: String((e as Error)?.message ?? e) };
    }

    // 5) $returningId 原生诊断：未打补丁时方法不存在（mysql 方言在 sql-js 驱动缺失）
    try {
      const q = db.insert(vocabItems).values({ userId: 1, word: "raw-check", zh: "原生", familiarity: 0 });
      const hasMethod = typeof (q as unknown as { $returningId?: unknown }).$returningId === "function";
      out.returningIdRaw = { hasMethod };
      if (hasMethod) {
        try {
          const r = await (q as unknown as { $returningId: () => unknown }).$returningId();
          out.returningIdRaw.tryResult = String(r);
        } catch (e) {
          out.returningIdRaw.tryError = String((e as Error)?.message ?? e);
        }
      }
    } catch (e) {
      out.returningIdRaw = { error: String((e as Error)?.message ?? e) };
    }
  } catch (e) {
    out.fatal = String((e as Error)?.message ?? e);
  }
  window.__offlineTestRaw = out;
  window.__offlineTestRawReady = true;
}

void main();
