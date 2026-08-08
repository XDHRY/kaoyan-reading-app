import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

function createDb() {
  // mysql2 默认连接建立无上限等待：预览环境网络不可达时会让每个请求悬挂数分钟。
  // 15s 快速失败让接口立即报 5xx（前端可重试），而不是把请求者吊死。
  // timezone:"Z"：MySQL TIMESTAMP 按 session 时区(东八区)显示，planetscale 模式会把该显示值
  // 当作 UTC 解析而偏大 8 小时（心跳/僵尸判定因此失效），统一按 UTC 读写才能与 Date.now() 对齐。
  const pool = mysql.createPool({ uri: env.databaseUrl, connectTimeout: 15_000, waitForConnections: true, timezone: "Z" });
  return drizzle(pool, { mode: "planetscale", schema: fullSchema });
}

let instance: ReturnType<typeof createDb>;

export function getDb() {
  if (!instance) instance = createDb();
  return instance;
}
