import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

export function serveStaticFiles(app: App) {
  // 打包后 boot.js 位于 dist/，静态产物位于 dist/public。
  // 必须用绝对路径（基于本文件位置）：生产环境 cwd 不固定时，相对路径会解析到别处导致白屏。
  const distPath = path.resolve(import.meta.dirname, "../dist/public");
  const indexPath = path.join(distPath, "index.html");

  // 启动自检：产物缺失立即点名，绝不让"根 200 子路由 404"这种哑故障溜上线
  if (!fs.existsSync(indexPath)) {
    console.error(`[static] FATAL: ${indexPath} 不存在，前端产物未随镜像发布`);
  } else {
    console.log(`[static] 前端产物就绪：${distPath}`);
  }

  // 1) 静态资源：存在的文件直接返回（含 /assets 指纹文件）
  app.use("/*", serveStatic({ root: distPath }));

  // 2) SPA 回退：非 API、接受 HTML 的 GET 一律回 index.html（子路由刷新/直链的关键）
  //    不依赖 notFound——serveStatic 未命中时会以 404 短路，必须在这里显式接管。
  app.use("/*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html") && !accept.includes("*/*")) return next();
    try {
      return c.html(fs.readFileSync(indexPath, "utf-8"));
    } catch {
      return c.text("前端产物缺失", 500);
    }
  });
}
