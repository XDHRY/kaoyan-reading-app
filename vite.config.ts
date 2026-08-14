import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

/**
 * 离线运行时 alias（仅浏览器 bundle 生效）：
 * - `@db/schema` 通过下方 resolve.alias 首位条目 → api/db/schema-sqlite.ts（sqlite 版 schema，
 *   30 表同名同结构）。必须放在通用 `@db` 条目之前，且不能用独立插件实现：vite 内置
 *   `vite:pre-alias`（enforce:pre，先于用户 pre 插件执行）会把 `@db/schema` 先解析成
 *   `db/schema.ts` 的绝对路径再交给其他插件，插件里的 `source === "@db/schema"` 分支永远
 *   命中不了——离线包因此把 mysql 版 schema 打进了客户端 bundle，sqlite 方言的
 *   `$returningId` 等对 mysql 表读 SQLiteInlineForeignKeys 符号直接崩（v5.12.2 查词崩溃根因）。
 * - `queries/connection` 相对导入 → src/offline/connection.ts（无 mysql2 的浏览器 shim）
 * - node:crypto / node:buffer → src/offline/shim-node-*.ts（WebCrypto 实现）
 *
 * 其余几个用独立插件而非 alias 条目的原因：alias entries.find 只取第一个匹配项，customResolver
 * 返回 null 不会回退到后续 entry；SSR（dev server 的 ssrLoadModule）下 `@db/schema` 由
 * 下方 customResolver 显式放回真实 mysql schema（db/schema.ts），其余 alias 不介入 SSR。
 */
const offlineAliasPlugin: Plugin = {
  name: "offline-alias",
  enforce: "pre",
  resolveId(source, _importer, resolveOptions) {
    if (resolveOptions?.ssr) return null; // dev server（@hono/vite-dev-server 走 ssrLoadModule）不介入
    // Windows 下 path.resolve 返回反斜杠路径，与 vite 内置解析（正斜杠）会产生不同模块 ID，
    // 导致同一文件被打包两份（如 connection.ts：setOfflineDb 与 getDb 各属一份、状态不互通）。
    // 统一转正斜杠，保证 alias 命中与相对导入指向同一模块。
    const toPosix = (p: string) => p.replace(/\\/g, "/");
    if (/queries\/connection$/.test(source)) return toPosix(path.resolve(__dirname, "./src/offline/connection.ts"));
    if (source === "node:crypto") return toPosix(path.resolve(__dirname, "./src/offline/shim-node-crypto.ts"));
    if (source === "node:buffer") return toPosix(path.resolve(__dirname, "./src/offline/shim-node-buffer.ts"));
    return null;
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    offlineAliasPlugin,
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    inspectAttr(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: [
      // @db/schema 必须在通用 @db 之前：vite alias 取首个匹配项，通用 @db 会把 @db/schema
      // 解析到 db/schema.ts（mysql）。customResolver 在 SSR（dev server ssrLoadModule）下
      // 显式返回 mysql 版 schema，保证服务端行为与改动前一致。
      {
        find: "@db/schema",
        replacement: path.resolve(__dirname, "./api/db/schema-sqlite.ts"),
        customResolver: (_source, _importer, options) => {
          // vite 的类型声明未暴露 ssr 字段，但运行时 resolveOptions 恒包含它
          if ((options as { ssr?: boolean } | undefined)?.ssr) {
            return path.resolve(__dirname, "./db/schema.ts");
          }
          return path.resolve(__dirname, "./api/db/schema-sqlite.ts").replace(/\\/g, "/");
        },
      },
      // 原有通用 alias（顺序保持，与旧配置一致）
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      { find: "@contracts", replacement: path.resolve(__dirname, "./contracts") },
      { find: "@db", replacement: path.resolve(__dirname, "./db") },
      { find: "db", replacement: path.resolve(__dirname, "./db") },
    ],
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    // minSdk 26 老设备 WebView（≈Chrome 62）兼容：显式降至 es2020，避免 vite 7 默认
    // baseline-widely-available（≈Chrome 107+）产出 ??= 等 es2021+ 语法导致整包 SyntaxError
    target: "es2020",
  },
});
