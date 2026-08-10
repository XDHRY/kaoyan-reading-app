import { useState, type ReactNode } from "react";
import { safeStorage } from "@/lib/safeStorage";
import { API_BASE_KEY } from "@/providers/trpc";

/** 是否运行在 Capacitor 原生壳内（APK WebView）：按依赖注入判定，无需引入 @capacitor/core */
export function isNativeShell(): boolean {
  return typeof window !== "undefined" && "Capacitor" in window;
}

/** 当前 API 基址（去末尾斜杠）；空串 = 同源相对路径 / 离线模式 */
export function getApiBase(): string {
  return (safeStorage.get(API_BASE_KEY) ?? "").replace(/\/+$/, "");
}

/** 校验服务器地址：<base>/api/trpc/ping 可达即视为可用（Accept 属 CORS 安全头，不会触发预检） */
async function verifyServer(base: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${base}/api/trpc/ping`, {
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error("无法连接服务器，请检查地址、端口与网络");
  }
  if (!res.ok) throw new Error(`服务器响应异常（HTTP ${res.status}）`);
}

/** 服务器地址配置表单：校验通过才允许保存（保存后整体 reload 切换链路） */
function ServerConfigForm({
  initial,
  onSaved,
  className = "",
}: {
  initial: string;
  onSaved: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    const base = draft.trim().replace(/\/+$/, "");
    if (!base) {
      setError("请输入服务器地址，例如 http://192.168.1.10:3000");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await verifyServer(base);
      safeStorage.set(API_BASE_KEY, base);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "连接失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <input
        type="url"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="http://192.168.1.10:3000"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full bg-transparent border border-[var(--line)] rounded-[2px] px-3 py-2.5 text-[14px] outline-none focus:border-[var(--ink-2)]"
      />
      {error && <p className="mt-2 text-[13px] text-[var(--vermilion)]">{error}</p>}
      <button
        onClick={() => void save()}
        disabled={busy || !draft.trim()}
        className="mt-4 px-5 py-2.5 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow text-[14px] disabled:opacity-40"
      >
        {busy ? "校验中…" : "校验并保存"}
      </button>
    </div>
  );
}

/**
 * 原生首启拦截组件：APK 默认即离线模式（本地 sql.js 题库），无需强制配置服务器，
 * 直接放行；Web/EXE 零影响。保留导出以兼容 main.tsx 调用点。
 */
export function NativeGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** 设置页小卡片：显示当前连接模式（离线/联网），可双向切换（仅原生壳内渲染，Web/EXE 不出现） */
export function ServerSettingsCard() {
  const [editing, setEditing] = useState(false);
  if (!isNativeShell()) return null;
  const offline = !getApiBase();
  return (
    <div className="border border-[var(--line)] rounded-[2px] p-5 bg-[var(--paper)]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-[16px] font-bold">连接模式</h3>
          <p className="text-[12.5px] text-[var(--ink-3)] mt-1 break-all">
            {offline ? (
              "离线模式（本地题库，无需网络）"
            ) : (
              <>
                服务器：
                <span className="text-[var(--ink-2)]">{getApiBase()}</span>
              </>
            )}
          </p>
        </div>
        {offline ? (
          <button
            onClick={() => setEditing((v) => !v)}
            className="px-4 py-2 border border-[var(--line)] rounded-[2px] text-[13.5px] hover:border-[var(--ink-2)]"
          >
            {editing ? "取消" : "配置服务器"}
          </button>
        ) : (
          <button
            onClick={() => {
              safeStorage.remove(API_BASE_KEY);
              window.location.reload();
            }}
            className="px-4 py-2 border border-[var(--line)] rounded-[2px] text-[13.5px] hover:border-[var(--ink-2)]"
          >
            回到离线模式
          </button>
        )}
      </div>
      {editing && (
        <ServerConfigForm
          className="mt-4 border-t border-dashed border-[var(--line)] pt-4"
          initial=""
          onSaved={() => window.location.reload()}
        />
      )}
    </div>
  );
}
