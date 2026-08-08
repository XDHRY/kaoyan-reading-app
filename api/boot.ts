import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";

const app = new Hono<{ Bindings: HttpBindings }>();

/**
 * CORS 白名单：Web/EXE 走同源相对路径，无 Origin 或同源请求不受影响；
 * 仅放行 APK 壳（capacitor://localhost）、本机/局域网调试 origin 与 env CORS_ORIGINS 显式配置。
 */
function isAllowedOrigin(origin: string): boolean {
  if (env.corsOrigins.includes(origin)) return true;
  if (origin === "capacitor://localhost") return true;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  const h = u.hostname;
  if (u.protocol === "http:" || u.protocol === "https:") {
    if (h === "localhost" || h === "127.0.0.1") return true;
    // 局域网私有段：http://192.168.*.* / http://10.*.*.*
    if (u.protocol === "http:" && (h.startsWith("192.168.") || h.startsWith("10."))) return true;
  }
  return false;
}

app.use(
  "*",
  cors({
    origin: (origin) => (origin ? isAllowedOrigin(origin) ? origin : undefined : undefined),
    allowHeaders: ["Content-Type", "Accept", "x-session-token"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // 会话走 X-Session-Token 头而非 cookie，但前端 fetch 带 credentials:include，保持一致开启
    credentials: true,
    maxAge: 86400,
  }),
);

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));

/** 安全响应头（源站直出，不依赖 CDN）：CSP 放行内联样式（Tailwind 运行时类必需），脚本严格 self */
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data: https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
  );
});
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  // 先起监听：平台健康检查立即通过，页面秒开；DB 自举在后台异步收敛，
  // 收敛失败只影响登录后的数据接口（返回 5xx 可重试），不再阻断整站首屏。
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  const { bootstrap } = await import("./lib/bootstrap");
  void bootstrap().catch((e) => {
    // 不退出进程：预览环境 DB 网络可能短暂不可达，保留静态服务能力，
    // 待下一次重启/部署再收敛（迁移全部幂等，重放安全）
    console.error("[bootstrap] 自举失败（静态站点仍可用）：", e instanceof Error ? e.message : e);
  });
}
