#!/usr/bin/env node
/**
 * 离线 caller 冒烟测试编排器：
 * 1. 用 esbuild 把 scripts/offline-caller-core.ts（含整套 tRPC router 依赖图）bundle 成临时 ESM
 * 2. onResolve 插件模拟浏览器 vite alias：`queries/connection` → src/offline/connection.ts、
 *    `@db/schema` → api/db/schema-sqlite.ts（与 vite.config.ts 离线 alias 行为一致）
 * 3. Node 运行 → 断言全部 PASS 才 exit 0
 *
 * 用法：node scripts/test-offline-caller.mjs
 * 环境变量：OFFLINE_DB_PATH 可覆盖默认 public/offline.db。
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TMP_DIR = path.join(ROOT, "scripts", ".tmp");
const BUNDLE = path.join(TMP_DIR, "offline-caller-core.mjs");

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  try {
    await build({
      entryPoints: [path.join(ROOT, "scripts", "offline-caller-core.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      outfile: BUNDLE,
      sourcemap: false,
      logLevel: "warning",
      // sql.js 内含动态 require("node:fs")，bundle 成 ESM 后无法运行；保持 external
      external: ["sql.js"],
      plugins: [
        {
          name: "offline-alias",
          setup(build) {
            // 匹配 ./queries/connection / ../queries/connection / ../../api/queries/connection
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
    console.log("[test-offline-caller] esbuild bundle 完成");
    // Git Bash 下 process.execPath 指向 MSYS shim（无 .exe），Windows spawn 无法执行，
    // 改走 PATH 的 node.exe
    execFileSync("node", [BUNDLE], { stdio: "inherit", cwd: ROOT });
  } finally {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("[test-offline-caller] 编排失败：", e);
  process.exit(1);
});
