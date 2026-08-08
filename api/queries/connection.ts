import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

function createDb() {
  // mysql2 默认连接建立无上限等待：预览环境网络不可达时会让每个请求悬挂数分钟。
  // 15s 快速失败让接口立即报 5xx（前端可重试），而不是把请求者吊死。
  const pool = mysql.createPool({ uri: env.databaseUrl, connectTimeout: 15_000, waitForConnections: true });
  return drizzle(pool, { mode: "planetscale", schema: fullSchema });
}

let instance: ReturnType<typeof createDb>;

export function getDb() {
  if (!instance) instance = createDb();
  return instance;
}
