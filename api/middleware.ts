import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  // 离线模式把整套 appRouter 打进浏览器 bundle 用进程内 caller 直调（src/offline/link.ts）；
  // tRPC v11 默认守卫「非服务端环境拒绝初始化」，此处显式放行（Node 端守卫本就通过，无副作用）
  allowOutsideOfServer: true,
});

export const createRouter = t.router;
export const publicQuery = t.procedure;

/** 需要登录：ctx.user 必须存在 */
export const privateQuery = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/** 需要管理员：role = admin */
export const adminQuery = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
  }
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});
