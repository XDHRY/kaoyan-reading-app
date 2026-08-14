/**
 * drizzle-orm@0.45.1 sql-js driver 缺陷补丁（导入本模块即生效，须在任何 drizzle 查询前执行）。
 *
 * 缺陷 1：`SQLJsSession.prepareQuery(query, fields, executeMethod, isResponseInArrayMode)` 只收 4 个
 * 参数，把关系型查询构造器（sqlite-core/query-builders/query.js）传入的第 5 个 `customResultMapper`
 * 丢掉了。后果：`db.query.<table>`（findFirst/findMany）不走 mapRelationalRow，直接返回
 * `stmt.getAsObject()` 的裸行——键为 DB 列名（`user_id` 而非 `userId`），json/boolean/timestamp
 * 列也不解码（payload 返回原始字符串、Date 返回毫秒数）。
 *
 * 缺陷 2：`PreparedQuery.get()` 的空结果守卫 `row.length === 0 && fields.length > 0` 假定
 * `fields` 恒非空；sql.js 的 `stmt.get()` 无行时返回 `[]`（truthy），relational 路径 fields 为
 * undefined → 判空时读 `fields.length` 直接 TypeError。
 *
 * 修复（两条配合）：
 * - 补挂 customResultMapper，并把它包装一层：get() 空结果（`[[]]`）→ undefined，all() 空结果
 *   （`[]`）→ `[]`；
 * - relational 查询 fields 置空数组，让 get() 的守卫不崩（空行由包装层处理）。
 * 服务端 mysql2 driver 无此问题，故只在离线运行时（浏览器 db.ts / node 测试核心）注入。
 *
 * 缺陷 3（P0，5.12.1）：浏览器端 `db.select()`（fields 路径）在部分构建形态下未对
 * `text(..., { mode: "json" })` 列调用 mapFromDriverValue，json 列以原始 JSON 字符串返回，
 * 导致 PracticePage `options.map` / SettingsPage `models.map` 崩溃。根因细节见
 * scripts/test-offline-browser.mjs 的诊断输出；此处用 PreparedQuery.all/get 包装层做驱动层兜底：
 * 按查询字段元数据（dataType === "json"）把结果对象中的字符串值 JSON.parse 一次，
 * 值非字符串（mapResultRow 已解码 / 非 json 列）时原样透传，幂等安全。
 */
import { PreparedQuery, SQLJsSession } from "drizzle-orm/sql-js";
import { SQLiteInsertBase } from "drizzle-orm/sqlite-core/query-builders/insert";

type OriginalPrepareQuery = (
  query: unknown,
  fields: unknown,
  executeMethod: unknown,
  isResponseInArrayMode: unknown,
) => unknown;

type PreparedQueryLike = { customResultMapper?: unknown; fields?: unknown };

type ResultMapper = (rows: unknown[][], mapColumnValue: (v: unknown) => unknown) => unknown;

const originalPrepareQuery = SQLJsSession.prototype.prepareQuery as unknown as OriginalPrepareQuery;

function patchedPrepareQuery(this: unknown, ...args: unknown[]): unknown {
  // 原方法内部用 this.client / this.logger，必须保留 this（session 实例）
  const prepared = originalPrepareQuery.apply(
    this,
    args as [unknown, unknown, unknown, unknown],
  ) as PreparedQueryLike;
  const mapper = args[4] as ResultMapper | undefined;
  if (mapper) {
    const origMapper = mapper;
    prepared.customResultMapper = (rows: unknown[][], mapColumnValue: (v: unknown) => unknown) => {
      if (rows.length === 0) return rows; // findMany 空结果
      if (rows.length === 1 && Array.isArray(rows[0]) && rows[0].length === 0) {
        return undefined; // findFirst 空结果（sql.js get() 返回 []）
      }
      return origMapper(rows, mapColumnValue);
    };
    prepared.fields ??= []; // get() 守卫 `fields.length`：置空数组防崩（空行由上方包装层处理）
  }
  return prepared;
}

// SQLJsSession.prepareQuery 同时是 prepareOneTimeQuery 的落点（sqlite-core/session.js 委托），
// 补丁一处即可覆盖全部关系型查询入口。
(SQLJsSession.prototype as unknown as { prepareQuery: typeof patchedPrepareQuery }).prepareQuery =
  patchedPrepareQuery;

// ---------------------------------------------------------------------------
// P0 兜底：PreparedQuery.all/get 结果按字段元数据对 json 列做 JSON.parse
// ---------------------------------------------------------------------------

type FieldEntry = { path?: string[]; field?: { dataType?: string; columnType?: string } };

/** 结果对象中 dataType==="json" 的列若仍是字符串（浏览器端未解码），则 JSON.parse 为原值。 */
function decodeJsonInObjects<T>(rows: T[], fields: unknown): T[] {
  const jsonKeys: string[] = [];
  if (Array.isArray(fields)) {
    for (const f of fields as FieldEntry[]) {
      const field = f?.field;
      const dataType = field?.dataType ?? field?.columnType;
      if (dataType === "json" && Array.isArray(f.path) && f.path.length === 1) {
        jsonKeys.push(f.path[0]);
      }
    }
  }
  if (jsonKeys.length === 0) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const obj = row as Record<string, unknown>;
    for (const key of jsonKeys) {
      const v = obj[key];
      if (typeof v === "string") {
        try {
          obj[key] = JSON.parse(v);
        } catch {
          // 非 JSON 文本（普通字符串列落错位等极端情况）：保持原值，不吞查询
        }
      }
    }
    return row;
  });
}

type PreparedQueryInstance = { fields?: unknown };
type PreparedQueryProtoLike = {
  all: (this: PreparedQueryInstance, placeholderValues?: unknown) => unknown;
  get: (this: PreparedQueryInstance, placeholderValues?: unknown) => unknown;
};

const preparedQueryProto = PreparedQuery.prototype as unknown as PreparedQueryProtoLike;
const originalAll = preparedQueryProto.all;
const originalGet = preparedQueryProto.get;

preparedQueryProto.all = function (this: PreparedQueryInstance, placeholderValues?: unknown) {
  const rows = originalAll.call(this, placeholderValues);
  if (Array.isArray(rows)) {
    return decodeJsonInObjects(rows, this.fields);
  }
  return rows;
};

preparedQueryProto.get = function (this: PreparedQueryInstance, placeholderValues?: unknown) {
  const row = originalGet.call(this, placeholderValues);
  if (row && typeof row === "object") {
    return decodeJsonInObjects([row], this.fields)[0];
  }
  return row;
};

// ---------------------------------------------------------------------------
// P0：SQLiteInsertBase.$returningId —— 对齐 mysql 方言语义（api/ 内 11+ 处调用依赖）
// ---------------------------------------------------------------------------

/**
 * mysql 版（MySqlInsertBase.$returningId）把主键列写入 config.returning，执行时由驱动用
 * insertId 造出 `[{ <列名>: <id> }]` 数组。sqlite 原生支持 RETURNING，这里直接走同一形态：
 * 用表对象的 Columns 符号找唯一 autoincrement integer 主键列，把 `[{ field, path }]` 写入
 * config.returning，后续 execute()/then → all() → mapResultRow 得到 `[{ <列名>: <自增id> }]`；
 * 多行 insert 每行一个元素（与 mysql 按 affectedRows 逐个造元素对齐），调用方统一
 * `const [{ id }] = await db.insert(...).values(...).$returningId()` 解构首行 id。
 * 返回 this 保持 thenable 链式语义。
 *
 * 注意：不能走 `getTableConfig`（sqlite 版）——它读 `SQLiteInlineForeignKeys` 符号，对
 * mysql 版表对象（vite:pre-alias 竞态泄漏进客户端 bundle 时会出现）该符号为 undefined，
 * 直接 `Object.values(undefined)` 崩（v5.12.2 查词崩溃根因）。这里直接读两种表都带有的
 * `Symbol.for("drizzle:Columns")`，对 mysql/sqlite 表都鲁棒。
 */
type SQLiteInsertBaseLike = { config: { table: unknown; returning?: unknown } };
type PkColumnLike = { name: string; primary?: boolean; autoIncrement?: boolean };

(SQLiteInsertBase.prototype as unknown as { $returningId: () => unknown }).$returningId =
  function $returningId(this: SQLiteInsertBaseLike) {
    const table = this.config.table as Record<PropertyKey, unknown>;
    const columns =
      (table[Symbol.for("drizzle:Columns")] as Record<string, PkColumnLike> | undefined) ?? {};
    const pkCols = Object.values(columns);
    // 优先唯一 autoincrement 主键（sqlite 表标准形态）；mysql 表列上 autoIncrement 恒为
    // false（auto_increment 走 dialect insertId），回退到唯一主键列，避免漏检。
    const auto =
      pkCols.filter((c) => c.primary === true && c.autoIncrement === true);
    const picked = auto.length === 1 ? auto : pkCols.filter((c) => c.primary === true);
    if (picked.length !== 1) {
      const name = (table[Symbol.for("drizzle:Name")] as string | undefined) ?? "?";
      throw new Error(
        `$returningId 仅支持唯一 autoincrement integer 主键列；表 ${name} 命中 ` +
          `${picked.length} 个，请改用 .returning()`,
      );
    }
    const col = picked[0] as unknown as PkColumnLike;
    this.config.returning = [{ field: col as never, path: [col.name] }];
    return this;
  };
