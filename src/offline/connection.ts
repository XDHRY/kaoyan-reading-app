/**
 * 浏览器端编译期替换 api/queries/connection（vite resolve.alias：`queries/connection` 相对导入 → 本模块）。
 * 服务端版本在 api/queries/connection.ts（含 mysql2 / @db/relations，仅 node 可用）；
 * 本 shim 只为 Capacitor 壳内离线模式服务：getDb() 只回离线 sql-js drizzle 实例，
 * 未注入即抛错（时序由 src/offline/db.ts 保证先初始化再放行 UI）。
 * 类型标注为宽松 unknown：运行期与 api 侧 Db 结构兼容（select/insert/update/delete/query 全量实现）。
 */
export type Db = unknown;

let offlineDb: Db | null = null;

export function setOfflineDb(db: Db | null): void {
  offlineDb = db;
  console.log("[conn] setOfflineDb =>", db === null ? "null" : "SET");
}

export function isOfflineDb(): boolean {
  return offlineDb !== null;
}

export function getDb(): Db {
  if (offlineDb === null) {
    console.warn("[conn] getDb 命中未初始化!");
    throw new Error("离线数据库未初始化（offline.db 加载失败？）");
  }
  return offlineDb;
}
