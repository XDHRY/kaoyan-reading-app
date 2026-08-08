/** 前端错误自动捕获：全局监听 error/unhandledrejection，保留最近 5 条。
 *  供浮动反馈印随单归档（marker.io 式自动上下文），不向任何第三方上报。 */

export const APP_VERSION = "5.3";

interface ErrItem {
  msg: string;
  at: string;
}

const buf: ErrItem[] = [];
let installed = false;

export function installErrorCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const push = (msg: string) => {
    if (!msg || buf.some((e) => e.msg === msg)) return;
    buf.push({ msg: msg.slice(0, 480), at: new Date().toISOString() });
    if (buf.length > 5) buf.shift();
  };
  window.addEventListener("error", (ev) => {
    const src = ev.filename ? ` @${ev.filename.split("/").pop()}:${ev.lineno}` : "";
    push(`${ev.message}${src}`);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason;
    push(`未处理的异步拒绝：${r instanceof Error ? r.message : String(r)}`);
  });
}

export function recentErrors(): ErrItem[] {
  return [...buf];
}
