/**
 * 离线 tRPC caller 工厂：把整套 appRouter 搬进当前进程内执行（sql-js drizzle 后端）。
 * 浏览器内由 vite resolve.alias 生效：`../../api/queries/connection` → src/offline/connection.ts
 * （shim，getDb 只回离线实例）、`@db/schema` → api/db/schema-sqlite.ts（30 表镜像）。
 * node 测试（scripts/test-offline-caller.mjs）用 esbuild onResolve 插件做同样的替换后运行本模块，
 * 因此这里不要 import ./db（浏览器专用，顶部挂 window 监听）。
 *
 * ctx 构造：固定取 users.id=1 的本地占位用户（离线库构建时写入，role=admin），
 * 使 privateQuery/adminQuery 中间件在离线模式下放行全部登录/管理员功能。
 */
import { createCallerFactory } from "@trpc/server/unstable-core-do-not-import";
import { appRouter } from "../../api/router";
import { getDb } from "../../api/queries/connection";
import { eq } from "drizzle-orm";
import { users } from "@db/schema";
import type { TrpcContext } from "../../api/context";

/**
 * 创建离线 caller（惰性：ctx 在首次调用时才解析，getDb 未初始化会以 tRPC 错误形态暴露）。
 * 返回的 proxy 支持单段含点路径：caller["passage.list"](input)。
 */
export function createOfflineCaller() {
  const factory = createCallerFactory()(appRouter);
  return factory(async (): Promise<TrpcContext> => {
    const db = getDb();
    console.log("[offline-caller] ctx built, getDb ok");
    const user = await db.query.users.findFirst({ where: eq(users.id, 1) });
    return {
      req: new Request("http://offline.local/"),
      resHeaders: new Headers(),
      user: user ?? null,
      offline: true,
    };
  });
}
