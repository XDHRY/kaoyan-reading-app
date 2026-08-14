// 考研阅读助手 · Electron 桌面壳（主进程，ESM）
//
// 职责：单实例锁 -> 选端口 -> MySQL 编排(3307) -> 以纯 Node 模式拉起
//       dist/boot.js 后端 -> 轮询健康检查 -> 打开 BrowserWindow + 托盘。
// 退出时只杀掉自己拉起的子进程（mysqld / boot.js），不碰系统服务。
import { app, BrowserWindow, Tray, Menu, dialog } from "electron";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";

// ---------------------------------------------------------------- 常量/路径
const APP_ROOT = app.getAppPath(); // 打包后为 resources/app，开发时为项目根
const BOOT_JS = path.join(APP_ROOT, "dist", "boot.js");
const ICON = path.join(APP_ROOT, "build", "icon.ico");

// 日志与 MySQL 数据统一放到 userData（固定目录名，方便排查）
app.setPath(
  "userData",
  path.join(app.getPath("appData"), "kaoyan-reading-app")
);
const USER_DATA = app.getPath("userData");
const LOG_FILE = path.join(USER_DATA, "desktop.log");
const MYSQL_LOG_FILE = path.join(USER_DATA, "mysqld.log");

const DEFAULT_PORT = 3000;
const MYSQL_PORT = 3307;
const HEALTH_URL = (port) => `http://127.0.0.1:${port}/api/trpc/ping`;
const MYSQL_DATA_DEFAULT =
  "C:/Users/xdrhh/AppData/Local/Temp/kysop-mysql/data";

// 启动脚本里 mysqld 的完整路径（探测顺序：KYSOP_MYSQL_BIN -> 此处）
const MYSQL_BIN_DEFAULT = "C:/Program Files/MySQL/MySQL Server 8.1/bin/mysqld.exe";

// ---------------------------------------------------------------- 日志
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    /* 日志写失败不影响主流程 */
  }
  console.log(`[desktop] ${msg}`);
}

function showFatal(msg) {
  log("致命错误: " + msg);
  dialog.showErrorBox(
    "考研阅读助手 · 启动失败",
    `${msg}\n\n详细日志：${LOG_FILE}`
  );
  app.quit();
}

// ---------------------------------------------------------------- 端口策略
function portInUse(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(true));
    srv.once("listening", () => srv.close(() => resolve(false)));
    srv.listen(port, "127.0.0.1");
  });
}

// 默认 3000；被占用则向后顺延找空闲端口；KYSOP_PORT 直接覆盖
async function pickPort() {
  if (process.env.KYSOP_PORT) {
    const p = Number(process.env.KYSOP_PORT);
    if (Number.isInteger(p) && p > 0 && p < 65536) {
      log(`使用 KYSOP_PORT=${p} 覆盖默认端口`);
      return p;
    }
  }
  for (let p = DEFAULT_PORT; p < DEFAULT_PORT + 200; p++) {
    if (!(await portInUse(p))) return p;
  }
  throw new Error("3000~3199 端口均被占用，无法分配空闲端口");
}

// ---------------------------------------------------------------- TCP 探测
function tcpAlive(port, host = "127.0.0.1", timeoutMs = 1200) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
    sock.once("error", () => resolve(false));
  });
}

// ---------------------------------------------------------------- MySQL 编排
function resolveMysqlBin() {
  const candidates = [];
  if (process.env.KYSOP_MYSQL_BIN) {
    candidates.push(path.join(process.env.KYSOP_MYSQL_BIN, "mysqld.exe"));
  }
  candidates.push(MYSQL_BIN_DEFAULT);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function ensureMysql() {
  if (process.env.KYSOP_SKIP_MYSQL === "1") {
    log("KYSOP_SKIP_MYSQL=1，跳过 MySQL 检查/启动");
    return;
  }
  if (await tcpAlive(MYSQL_PORT)) {
    log(`MySQL 已在 ${MYSQL_PORT} 端口运行，跳过启动`);
    return;
  }
  const bin = resolveMysqlBin();
  if (!bin) {
    throw new Error(
      `未找到 mysqld.exe（探测过 KYSOP_MYSQL_BIN 与 ${MYSQL_BIN_DEFAULT}），且 ${MYSQL_PORT} 端口无 MySQL 在运行`
    );
  }
  const dataDir =
    process.env.KYSOP_MYSQL_DATA ||
    (fs.existsSync(MYSQL_DATA_DEFAULT) ? MYSQL_DATA_DEFAULT : null);
  if (!dataDir) {
    throw new Error(`MySQL 数据目录不存在：${MYSQL_DATA_DEFAULT}`);
  }
  // 复用启动脚本参数：datadir / --port=3307 / --bind-address / --mysqlx=OFF
  const args = [
    `--datadir=${dataDir}`,
    `--port=${MYSQL_PORT}`,
    "--bind-address=127.0.0.1",
    "--mysqlx=OFF",
    "--default-time-zone=+00:00",
  ];
  log(`启动 mysqld: ${bin} ${args.join(" ")}`);
  const child = spawn(bin, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (d) => fs.appendFileSync(MYSQL_LOG_FILE, d));
  child.stderr.on("data", (d) => fs.appendFileSync(MYSQL_LOG_FILE, d));
  child.on("exit", (code, sig) => {
    if (code !== 0 && startedMysql) {
      log(`mysqld 提前退出 code=${code} sig=${sig}，日志见 ${MYSQL_LOG_FILE}`);
      startedMysql = false;
    }
  });
  startedMysql = true;
  mysqlChild = child;
  // 等待就绪（最多 40s）
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (await tcpAlive(MYSQL_PORT)) {
      log("MySQL 就绪 ✓");
      return;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(`MySQL 40 秒内未就绪，请查看 ${MYSQL_LOG_FILE}`);
}

// ---------------------------------------------------------------- DATABASE_URL
function resolveDatabaseUrl() {
  if (process.env.KYSOP_DATABASE_URL) {
    return process.env.KYSOP_DATABASE_URL;
  }
  const envPath = path.join(APP_ROOT, ".env");
  if (fs.existsSync(envPath)) {
    const text = fs.readFileSync(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
      if (m) {
        return m[1].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return "mysql://root@127.0.0.1:3307/kaoyan_reading";
}

// 从打包内 .env（asar 根）读取单值，供私有版把真实渠道密钥注入子进程。
// 公有版不打包 .env → 返回空串 → 种子落占位符（行为与历史一致）。
function resolveEnvVar(name) {
  const envPath = path.join(APP_ROOT, ".env");
  if (fs.existsSync(envPath)) {
    const text = fs.readFileSync(envPath, "utf8");
    const re = new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`);
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(re);
      if (m) {
        return m[1].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return "";
}

// ---------------------------------------------------------------- 后端服务
let serviceChild = null;

function startService(port) {
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    PORT: String(port),
    DATABASE_URL: resolveDatabaseUrl(),
    // 私有版注入真实渠道密钥；公有版 .env 未打包 → 空串，种子落占位符
    MMKG_API_KEY: resolveEnvVar("MMKG_API_KEY"),
  };
  if (!fs.existsSync(BOOT_JS)) {
    throw new Error(`后端产物不存在：${BOOT_JS}（请先执行 npm run build）`);
  }
  log(`启动后端: ${process.execPath} ${BOOT_JS} (PORT=${port})`);
  serviceChild = spawn(process.execPath, [BOOT_JS], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  serviceChild.stdout.on("data", (d) => log("boot: " + String(d).trimEnd()));
  serviceChild.stderr.on("data", (d) => log("boot: " + String(d).trimEnd()));
  serviceChild.on("exit", (code, sig) => {
    log(`后端服务退出 code=${code} sig=${sig}`);
    serviceChild = null;
  });
}

// ---------------------------------------------------------------- 健康检查
async function waitForServer(port, timeoutMs = 60_000) {
  const url = HEALTH_URL(port);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const body = await res.text();
        log(`健康检查通过: ${url} -> ${body.trim()}`);
        return true;
      }
    } catch {
      /* 未就绪，继续轮询 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ---------------------------------------------------------------- 窗口 / 托盘
let mainWindow = null;
let tray = null;

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    icon: ICON,
    autoHideMenuBar: true,
    title: "考研阅读助手",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function setupTray() {
  if (tray) return;
  tray = new Tray(ICON);
  tray.setToolTip("考研阅读助手");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示主窗口",
        click: () => {
          if (!mainWindow) return;
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        },
      },
      { type: "separator" },
      { label: "退出", click: () => app.quit() },
    ])
  );
  tray.on("click", () => {
    if (mainWindow) mainWindow.show();
  });
}

// ---------------------------------------------------------------- 单实例锁
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ---------------------------------------------------------------- 退出清理
let startedMysql = false;
let mysqlChild = null;

function cleanup() {
  // 只杀自己拉起的子进程
  if (serviceChild) {
    log("停止后端服务…");
    try {
      serviceChild.kill();
    } catch {
      /* ignore */
    }
    serviceChild = null;
  }
  if (startedMysql && mysqlChild && mysqlChild.pid) {
    log(`停止自启 mysqld (pid=${mysqlChild.pid})…`);
    try {
      spawnSync("taskkill", ["/PID", String(mysqlChild.pid), "/T", "/F"], {
        windowsHide: true,
      });
    } catch {
      /* ignore */
    }
    startedMysql = false;
    mysqlChild = null;
  }
}

app.on("will-quit", cleanup);
app.on("window-all-closed", () => {
  app.quit();
});

// ---------------------------------------------------------------- 启动流程
if (gotLock) {
  app.whenReady().then(async () => {
    try {
      await ensureMysql();

      const port = await pickPort();
      startService(port);

      const ok = await waitForServer(port);
      if (!ok) {
        showFatal(
          `后端服务在 ${port} 端口 60 秒内未就绪，请检查 MySQL 与日志：${LOG_FILE}`
        );
        return;
      }

      createWindow(port);
      setupTray();
      log(`启动完成，窗口指向 http://127.0.0.1:${port}`);
    } catch (err) {
      showFatal(err instanceof Error ? err.message : String(err));
    }
  });
}
