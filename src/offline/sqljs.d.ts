/**
 * sql.js@1.14.1 无自带类型声明（dist/ 下无 .d.ts），本文件补齐最小可用的 ambient 声明。
 * 覆盖两个消费方：
 * - src/offline/db.ts：initSqlJs / SqlJsStatic / Database（new / export / close / exec / run / prepare）
 * - drizzle-orm/sql-js 内部 `import type { Database } from "sql.js"`（prepare 返回的 Statement 面）
 * 仅声明离线运行实际用到的面；缺失方法按需再补。
 */
declare module "sql.js" {
  export interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export class Statement {
    bind(values?: unknown[] | Record<string, unknown>): boolean;
    step(): boolean;
    get(): unknown[];
    getAsObject(): Record<string, unknown>;
    run(values?: unknown[] | Record<string, unknown>): void;
    free(): void;
  }

  export class Database {
    constructor(data?: ArrayLike<number> | Uint8Array | null);
    exec(sql: string, params?: unknown[] | Record<string, unknown>): { columns: string[]; values: unknown[][] }[];
    run(sql: string, params?: unknown[] | Record<string, unknown>): Database;
    prepare(sql: string, params?: unknown[] | Record<string, unknown>): Statement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }

  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}
