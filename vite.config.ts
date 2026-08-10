import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

/**
 * 离线运行时 alias（仅浏览器 bundle 生效，enforce:pre 先于 vite 内置 alias 插件执行）：
 * - @db/schema → api/db/schema-sqlite.ts（sqlite 版 schema，30 表同名同结构）
 * - `queries/connection` 相对导入 → src/offline/connection.ts（无 mysql2 的浏览器 shim）
 * - node:crypto / node:buffer → src/offline/shim-node-*.ts（WebCrypto 实现）
 *
 * 用独立插件而非 resolve.alias 数组的原因：alias 插件 entries.find 只取第一个匹配项，
 * customResolver 返回 null 不会回退到后续 entry（如通用 `@db`），SSR 下 `@db/schema`
 * 将整体无法解析。独立插件在 SSR（dev server 的 ssrLoadModule）下直接 return null，
 * 由 vite 内置 alias 与默认解析器走真实模块——MySQL 路径行为零变化。
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
    if (source === "@db/schema") return toPosix(path.resolve(__dirname, "./api/db/schema-sqlite.ts"));
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
