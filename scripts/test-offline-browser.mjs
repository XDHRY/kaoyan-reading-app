#!/usr/bin/env node
/**
 * P0 浏览器端回归测试编排器：
 * 1. esbuild（platform=browser, iife, target es2020 与生产一致）打包两个入口：
 *    - browser-repro-entry-raw.ts ：原生行为（无补丁），暴露根因证据
 *    - browser-repro-entry-fix.ts ：导入真实补丁 src/offline/patch-sqljs.ts 后的行为
 * 2. 静态服务器：/ 加载两个 bundle，另供 sql-wasm.wasm（node_modules 原版）与 dist/public/offline.db
 * 3. headless Chrome（--remote-debugging-port）+ CDP（Node 22 原生 WebSocket）：
 *    等 window.__offlineTestFixed 出现，采集 Runtime.exceptionThrown，读两份结果
 * 4. 断言（任一失败 exit 1）：
 *    - fix: questions select options 为数组（全行）
 *    - fix: relational findMany options 为数组
 *    - fix: passages select paragraphs 为数组；channels select models 为数组
 * 另打印 raw 诊断，供根因结论用。
 *
 * 用法：node scripts/test-offline-browser.mjs
 * 环境变量：CHROME_PATH 覆盖 Chrome 路径；OFFLINE_DB_PATH 覆盖离线库。
 */
import { build } from "esbuild";
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TMP = path.join(ROOT, "scripts", ".tmp", "browser-test");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CDP_PORT = 9334;
const APP_PORT = 8124;
const DIST = path.join(ROOT, "dist", "public");
const DB_PATH = process.env.OFFLINE_DB_PATH || path.join(DIST, "offline.db");
const WASM = path.join(ROOT, "node_modules", "sql.js", "dist", "sql-wasm.wasm");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, label, detail) {
  if (cond) console.log(`  [PASS] ${label}`);
  else {
    console.error(`  [FAIL] ${label}${detail ? ` — ${JSON.stringify(detail)}` : ""}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// CDP（复用 kysop-debug-desktop 的类）
// ---------------------------------------------------------------------------
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error("WS connect failed: " + url));
    });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id) {
        const p = c.pending.get(msg.id);
        if (p) {
          c.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
          else p.resolve(msg.result);
        }
      } else {
        c.events.push(msg);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`offline.db 不存在: ${DB_PATH}`);
  if (!fs.existsSync(WASM)) throw new Error(`sql-wasm.wasm 不存在: ${WASM}`);
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  // 1) esbuild 打包两个入口
  const common = { bundle: true, platform: "browser", format: "iife", target: "es2020", logLevel: "warning" };
  await build({
    ...common,
    entryPoints: [path.join(ROOT, "scripts", "browser-repro-entry-raw.ts")],
    outfile: path.join(TMP, "entry-raw.js"),
  });
  await build({
    ...common,
    entryPoints: [path.join(ROOT, "scripts", "browser-repro-entry-fix.ts")],
    outfile: path.join(TMP, "entry-fix.js"),
  });
  console.log("[test-offline-browser] esbuild bundle 完成");

  // 2) 静态服务器
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>offline browser test</title></head>
<body><script src="/entry-raw.js"></script><script src="/entry-fix.js"></script></body></html>`;
  const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".wasm": "application/wasm", ".db": "application/octet-stream" };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    let p = decodeURIComponent(u.pathname);
    let file;
    if (p === "/" || p === "/index.html") file = { buf: Buffer.from(html), ext: ".html" };
    else if (p === "/entry-raw.js") file = { path: path.join(TMP, "entry-raw.js") };
    else if (p === "/entry-fix.js") file = { path: path.join(TMP, "entry-fix.js") };
    else if (p === "/sql-wasm.wasm") file = { path: WASM };
    else if (p === "/offline.db") file = { path: DB_PATH };
    else { res.writeHead(404); res.end("404 " + p); return; }
    let buf;
    try {
      buf = file.buf ?? fs.readFileSync(file.path);
    } catch {
      res.writeHead(500); res.end("500 " + p); return;
    }
    const ext = file.ext ?? path.extname(file.path ?? "").toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  });
  await new Promise((r) => server.listen(APP_PORT, "127.0.0.1", r));
  console.log(`[test-offline-browser] server on :${APP_PORT}`);

  // 3) headless Chrome + CDP
  const profileDir = path.join(TMP, "profile");
  const chromeArgs = [
    "--headless=new",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-gpu",
    "about:blank",
  ];
  const chrome = spawn(CHROME, chromeArgs, { stdio: ["ignore", "ignore", "pipe"] });
  let chromeErr = "";
  chrome.stderr.on("data", (d) => (chromeErr += d.toString()));
  chrome.on("exit", (code) => console.log(`[test-offline-browser] chrome exited code=${code}`));

  let page = null;
  for (let i = 0; i < 80; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      page = targets.find((t) => t.type === "page");
      if (page) break;
    } catch {}
    await sleep(200);
  }
  if (!page) {
    console.error(`[test-offline-browser] CDP 端口不可用。chrome stderr:\n${chromeErr.slice(0, 1500)}`);
    try { execFileSync("taskkill", ["/PID", String(chrome.pid), "/T", "/F"]); } catch {}
    server.close();
    process.exit(1);
  }

  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  const exceptions = [];
  const evPoll = setInterval(() => {
    while (cdp.events.length) {
      const e = cdp.events.shift();
      if (e.method === "Runtime.exceptionThrown") {
        const d = e.params.exceptionDetails;
        exceptions.push(
          `${d.exception?.description ?? d.text} @${d.url ?? ""}:${d.lineNumber ?? ""}`,
        );
      }
    }
  }, 50);

  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${APP_PORT}/` });

  // 等 fix 入口完成（raw 先完成 → fix 等 rawReady → 再跑）
  let fixed = null;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const r = await cdp.send("Runtime.evaluate", {
      expression: "JSON.stringify({raw: window.__offlineTestRaw ?? null, fixed: window.__offlineTestFixed ?? null})",
      returnByValue: true,
    });
    const v = r.result?.value;
    if (typeof v === "string") {
      const parsed = JSON.parse(v);
      if (parsed.fixed) { fixed = parsed; break; }
      if (parsed.raw && !fixed) fixed = { raw: parsed.raw }; // 先拿 raw 再说
    }
    await sleep(300);
  }
  clearInterval(evPoll);

  // 4) 打印诊断 + 断言
  console.log("\n======== 原生行为（根因证据） ========");
  if (fixed?.raw) console.log(JSON.stringify(fixed.raw, null, 2));
  else console.log("RAW 结果缺失（超时或页面失败）");

  console.log("\n======== 修复后行为 ========");
  if (fixed?.fixed) console.log(JSON.stringify(fixed.fixed, null, 2));
  else console.error("FIXED 结果缺失（超时或页面失败）");

  console.log(`\n页面异常（Runtime.exceptionThrown）: ${exceptions.length}`);
  exceptions.slice(0, 10).forEach((x) => console.log("  " + x.slice(0, 300)));

  console.log("\n======== 断言 ========");
  const f = fixed?.fixed ?? {};
  assert(!!f.selectFixed && f.selectFixed.firstOptionsIsArray === true, "select: questions.options 解码为数组", f.selectFixed);
  assert(!!f.selectFixed && f.selectFixed.allOptionsIsArray === true, "select: 全部行 options 均为数组", f.selectFixed);
  assert(!!f.relationalFixed && f.relationalFixed.firstOptionsIsArray === true, "relational: findMany options 为数组", f.relationalFixed);
  assert(!!f.passageSelectFixed && f.passageSelectFixed.paragraphsIsArray === true, "select: passages.paragraphs 为数组", f.passageSelectFixed);
  assert(!!f.channelsSelectFixed && f.channelsSelectFixed.modelsIsArray === true, "select: channels.models 为数组（settings 路径）", f.channelsSelectFixed);
  assert(!!f.returningIdFixed && f.returningIdFixed.isNumber === true && f.returningIdFixed.roundTripFound === true, "$returningId 返回数值主键且查回命中（浏览器端）", f.returningIdFixed);
  assert(exceptions.length === 0, "页面运行期零异常", exceptions.slice(0, 3));

  cdp.close();
  try { execFileSync("taskkill", ["/PID", String(chrome.pid), "/T", "/F"]); } catch {}
  server.close();
  console.log(`\n[test-offline-browser] ${process.exitCode ? "FAILED" : "ALL PASS"}`);
}

main().catch((e) => {
  console.error("[test-offline-browser] FATAL:", e);
  process.exit(1);
});
