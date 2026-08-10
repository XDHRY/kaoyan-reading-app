/**
 * 离线数据库运行时（浏览器 / Capacitor WebView）：
 * - sql.js（wasm）+ drizzle-orm/sql-js 实例化，schema 用 api/db/schema-sqlite（30 表镜像）
 * - 数据源优先级：IndexedDB 缓存的离线库（上次会话写入）> public/offline.db（随包资源）
 * - 写操作后 schedulePersist() 2s 防抖回写 IndexedDB；visibilitychange(hidden)/beforeunload 兜底冲刷
 * - 所有 IDB 操作 try/catch：隐私模式 / 容量不足时静默降级为内存库
 * 注意：本模块只在浏览器被 import（trpc.tsx 离线分支）；node 测试（scripts/test-offline-caller.mjs）
 * 自行构建 sql.js 实例并 setOfflineDb，不经过本文件（本文件顶部挂 window 监听，node 下不可运行）。
 */
import initSqlJs from "sql.js";
import type { SqlJsStatic, Database as SqlJsDatabase_ } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { drizzle } from "drizzle-orm/sql-js";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../../api/db/schema-sqlite";
import { setOfflineDb } from "./connection";
// 必须先于任何 drizzle 查询执行（修复 sql-js driver 丢弃 customResultMapper 的缺陷）
import "./patch-sqljs";

const IDB_NAME = "kysop_offline";
const IDB_STORE = "db";
const IDB_KEY = "main";

let initPromise: Promise<void> | null = null;
let dbInstance: SQLJsDatabase<typeof schema> | null = null;
let sqlJs: SqlJsStatic | null = null;
let sqlDatabase: SqlJsDatabase_ | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// IndexedDB 读写（结构化克隆直接存 Uint8Array）
// ---------------------------------------------------------------------------

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 打开失败"));
  });
}

async function idbLoad(): Promise<Uint8Array | null> {
  let conn: IDBDatabase;
  try {
    conn = await idbOpen();
  } catch {
    return null;
  }
  try {
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = conn.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => {
        const v = req.result;
        if (v instanceof Uint8Array) resolve(v);
        else if (v instanceof ArrayBuffer) resolve(new Uint8Array(v));
        else resolve(null);
      };
      req.onerror = () => reject(req.error ?? new Error("IndexedDB 读取失败"));
    });
  } catch {
    return null;
  } finally {
    conn.close();
  }
}

async function idbSave(bytes: Uint8Array): Promise<void> {
  let conn: IDBDatabase;
  try {
    conn = await idbOpen();
  } catch {
    return;
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = conn.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB 写入失败"));
    });
  } catch {
    // 隐私模式/容量不足：仅内存可用，不阻断功能
  } finally {
    conn.close();
  }
}

// ---------------------------------------------------------------------------
// 初始化与持久化
// ---------------------------------------------------------------------------

async function doInit(): Promise<void> {
  if (dbInstance) return;
  let bytes: Uint8Array | null = null;
  bytes = await idbLoad();
  console.log("[offline-db] idbLoad =>", bytes ? bytes.length + "B" : "null");
  if (!bytes || bytes.length === 0) {
    // 首次启动：从随包资源加载 offline.db
    const res = await fetch(`${import.meta.env.BASE_URL}offline.db`);
    console.log("[offline-db] fetch offline.db =>", res.status);
    if (!res.ok) throw new Error(`offline.db 加载失败（HTTP ${res.status}）`);
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  sqlJs ??= await initSqlJs({ locateFile: () => wasmUrl });
  sqlDatabase = new sqlJs.Database(bytes);
  dbInstance = drizzle(sqlDatabase, { schema });
  setOfflineDb(dbInstance);
  console.log("[offline-db] setOfflineDb done, rows?", sqlDatabase.exec("SELECT COUNT(*) FROM passages")[0]?.values[0][0]);
}

/** 幂等且并发安全：多次调用共享同一次初始化 */
export function initOfflineDb(): Promise<void> {
  initPromise ??= doInit().catch((e) => {
    initPromise = null; // 失败可重试（TRPCProvider 会展示错误并可重试）
    throw e;
  });
  return initPromise;
}

async function persistNow(): Promise<void> {
  if (!sqlDatabase) return;
  try {
    await idbSave(sqlDatabase.export());
  } catch {
    // 静默：写回失败不影响内存库
  }
}

/** 变更后调用：2s 防抖合并写回 IndexedDB */
export function schedulePersist(): void {
  if (!dbInstance) return;
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistNow();
  }, 2000);
}

/** 立即导出当前离线库字节（调试/备份用；未初始化返回 null） */
export function exportOfflineDb(): Uint8Array | null {
  return sqlDatabase ? sqlDatabase.export() : null;
}

function flush(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
    void persistNow();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("beforeunload", flush);
}
