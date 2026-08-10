#!/usr/bin/env node
/**
 * 离线 APK 真实 API 全量调通测试编排器：
 * 1. 用 esbuild 把 scripts/test-offline-api-live-core.ts（含整套 tRPC router 依赖图）
 *    bundle 成临时 ESM
 * 2. onResolve 插件模拟浏览器 vite alias：`queries/connection` → src/offline/connection.ts、
 *    `@db/schema` → api/db/schema-sqlite.ts（与 vite.config.ts 离线 alias 行为一致）
 * 3. Node 运行 → 逐功能真实调用中转站 LLM（每功能最小一次，失败最多重试 2 次）
 *
 * 用法：node scripts/test-offline-api-live.mjs
 * 环境变量：OFFLINE_DB_PATH 覆盖离线库；LIVE_REF_PASSAGE 覆盖测试篇目。
 *
 * ⚠️ 会真实消耗 LLM 额度（完整解析一篇 ≈10 次对话 + 2 次绘图）。全程约 10~25 分钟。
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TMP_DIR = path.join(ROOT, "scripts", ".tmp");
const BUNDLE = path.join(TMP_DIR, "test-offline-api-live.mjs");

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  try {
    await build({
      entryPoints: [path.join(ROOT, "scripts", "test-offline-api-live-core.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      outfile: BUNDLE,
      sourcemap: false,
      logLevel: "warning",
      external: ["sql.js"],
      plugins: [
        {
          name: "offline-alias",
          setup(build) {
            build.onResolve({ filter: /queries\/connection$/ }, (args) => ({
              path: path.join(ROOT, "src", "offline", "connection.ts"),
              namespace: args.namespace,
            }));
            build.onResolve({ filter: /^@db\/schema$/ }, () => ({
              path: path.join(ROOT, "api", "db", "schema-sqlite.ts"),
            }));
          },
        },
      ],
    });
    console.log("[test-offline-api-live] esbuild bundle 完成");
    execFileSync("node", [BUNDLE], { stdio: "inherit", cwd: ROOT });
  } finally {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("[test-offline-api-live] 编排失败：", e);
  process.exit(1);
});
