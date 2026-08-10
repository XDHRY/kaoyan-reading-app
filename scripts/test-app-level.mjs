#!/usr/bin/env node
/**
 * P0 app 级端到端回归：真实前端 bundle（dist/public，注入 window.Capacitor 模拟壳）+ headless Chrome
 * 直接访问 /practice/1 与 /settings（P0 崩溃页），断言：
 * - 页面渲染出题目选项（"A." + 选项文本）与设置页模型列表（通道名/gpt-* 模型）
 * - Runtime.exceptionThrown 为零（旧版在此抛 "options.map is not a function" / "models.map is not a function"）
 * - console.error / Log.error 无关键异常
 *
 * 用法：node scripts/test-app-level.mjs
 * 环境变量：CHROME_PATH；PORT_APP=8125；PORT_CDP=9335
 */
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist", "public");
const WORK = path.join(ROOT, "scripts", ".tmp", "app-level");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP_PORT = Number(process.env.PORT_APP || 8125);
const CDP_PORT = Number(process.env.PORT_CDP || 9335);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;
function assert(cond, label, detail) {
  if (cond) console.log(`  [PASS] ${label}`);
  else {
    console.error(`  [FAIL] ${label}${detail ? ` — ${JSON.stringify(detail)}` : ""}`);
    exitCode = 1;
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function prepare() {
  copyDir(DIST, WORK);
  const htmlPath = path.join(WORK, "index.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  html = html.replace(
    '<script type="module"',
    '<script>window.Capacitor={}</script>\n    <script type="module"',
  );
  fs.writeFileSync(htmlPath, html);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".db": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://x");
      let p = decodeURIComponent(u.pathname);
      if (p === "/") p = "/index.html";
      let file = path.join(WORK, p);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        file = path.join(WORK, "index.html"); // SPA 回退
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(APP_PORT, "127.0.0.1", () => resolve(server));
  });
}

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
      } else c.events.push(msg);
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

async function launchChrome() {
  const profileDir = path.join(WORK, "profile");
  fs.rmSync(profileDir, { recursive: true, force: true });
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--window-size=900,1400",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let chromeErr = "";
  proc.stderr.on("data", (d) => (chromeErr += d.toString()));
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
    console.error(`CDP 端口不可用。chrome stderr:\n${chromeErr.slice(0, 1200)}`);
    try { execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"]); } catch {}
    process.exit(1);
  }
  return { proc, page };
}

async function main() {
  if (!fs.existsSync(path.join(DIST, "index.html"))) throw new Error(`dist/public 无 index.html: ${DIST}`);
  fs.rmSync(WORK, { recursive: true, force: true });
  prepare();
  const server = await startServer();
  const { proc, page } = await launchChrome();
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");

  const stream = { console: [], log: [], exceptions: [] };
  const evPoll = setInterval(() => {
    while (cdp.events.length) {
      const e = cdp.events.shift();
      if (e.method === "Runtime.consoleAPICalled" && e.params.type === "error") {
        stream.console.push(e.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
      } else if (e.method === "Log.entryAdded" && e.params.entry.level === "error") {
        stream.log.push(e.params.entry.text);
      } else if (e.method === "Runtime.exceptionThrown") {
        const d = e.params.exceptionDetails;
        stream.exceptions.push(`${d.exception?.description ?? d.text} @${d.url ?? ""}:${d.lineNumber ?? ""}`);
      }
    }
  }, 50);

  async function evalText() {
    const r = await cdp.send("Runtime.evaluate", {
      expression: "document.body.innerText || ''",
      returnByValue: true,
    });
    return String(r.result?.value ?? "");
  }

  async function visit(pathName, label, markers) {
    console.log(`\n===== 访问 /${pathName}（${label}） =====`);
    const t0 = Date.now();
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${APP_PORT}/${pathName}` });
    let body = "";
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      body = await evalText();
      if (markers.some((m) => body.includes(m))) break;
      await sleep(400);
    }
    await sleep(2500); // 收尾窗口，捕获渲染后异常
    const hit = markers.filter((m) => body.includes(m));
    console.log(`  [${Date.now() - t0}ms] body 命中标记: ${JSON.stringify(hit)}`);
    console.log(`  body 预览: ${body.replace(/\n+/g, " ").slice(0, 180)}`);
    return { body, hit };
  }

  const practice = await visit("practice/1", "P0 崩溃页-练习", ["arts criticism", "It is indicated", "A."]);
  assert(practice.hit.length > 0, "/practice/1 渲染出题目内容（含选项）", { markers: practice.hit });

  const settings = await visit("settings", "P0 崩溃页-设置", ["MMKG 中转站", "gpt-5", "模型"]);
  assert(settings.hit.length > 0, "/settings 渲染出通道/模型内容", { markers: settings.hit });

  await sleep(800);
  clearInterval(evPoll);

  console.log(`\n页面异常（exceptionThrown）: ${stream.exceptions.length}`);
  stream.exceptions.slice(0, 8).forEach((x) => console.log("  " + x.slice(0, 300)));
  console.log(`console.error: ${stream.console.length}`);
  stream.console.slice(0, 8).forEach((x) => console.log("  " + x.slice(0, 300)));
  const logErrs = stream.log.filter((t) => !t.includes("favicon.ico"));
  console.log(`Log.error: ${logErrs.length}`);
  logErrs.slice(0, 8).forEach((x) => console.log("  " + x.slice(0, 300)));

  assert(stream.exceptions.length === 0, "全程零 Runtime.exceptionThrown", stream.exceptions.slice(0, 3));
  const badConsole = stream.console.filter(
    (t) => /is not a function|Cannot read|undefined is not|TypeError/i.test(t),
  );
  assert(badConsole.length === 0, "无 TypeError 类 console.error", badConsole.slice(0, 3));

  cdp.close();
  try { execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"]); } catch {}
  server.close();
  console.log(`\n[test-app-level] ${exitCode ? "FAILED" : "ALL PASS"}`);
  process.exit(exitCode);
}

main().catch((e) => {
  console.error("[test-app-level] FATAL:", e);
  process.exit(1);
});
