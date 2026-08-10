#!/usr/bin/env node
/**
 * 离线库构建编排器：
 * 1. 用 esbuild 把 scripts/offline-build-core.ts（含 schema-sqlite 元信息）
 *    bundle 成临时 ESM，运行于 Node（sql.js 的 wasm 在 node_modules 内绝对路径加载）
 * 2. 运行核心逻辑 → 产出 public/offline.db
 * 3. 清理临时产物
 *
 * 用法：node scripts/build-offline-db.mjs
 * 环境变量：OFFLINE_DUMP_PATH / OFFLINE_CORPUS_PATH / OFFLINE_OUT_PATH 可覆盖默认路径。
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TMP_DIR = path.join(ROOT, "scripts", ".tmp");
const BUNDLE = path.join(TMP_DIR, "offline-build-core.mjs");

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  try {
    await build({
      entryPoints: [path.join(ROOT, "scripts", "offline-build-core.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      outfile: BUNDLE,
      sourcemap: false,
      logLevel: "warning",
      // sql.js 内含动态 require("node:fs")，bundle 成 ESM 后无法运行；
      // 保持 external，运行时由 Node 直接加载 node_modules 里的 CJS 原包
      external: ["sql.js"],
    });
    console.log("[build] esbuild bundle 完成");
    // Git Bash 下 process.execPath 指向 MSYS shim（无 .exe），Windows spawn 无法执行，
    // 改走 PATH 的 node.exe
    execFileSync("node", [BUNDLE], { stdio: "inherit", cwd: ROOT });
  } finally {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("[build] 编排失败：", e);
  process.exit(1);
});
