import { useState, type ReactNode } from "react";
import { safeStorage } from "@/lib/safeStorage";
import { API_BASE_KEY } from "@/providers/trpc";
import { BrushTitle, PaperCard } from "@/components/ink/decor";

/** 是否运行在 Capacitor 原生壳内（APK WebView）：按依赖注入判定，无需引入 @capacitor/core */
export function isNativeShell(): boolean {
  return typeof window !== "undefined" && "Capacitor" in window;
}

/** 当前 API 基址（去末尾斜杠）；空串 = 同源相对路径（Web/EXE 默认行为） */
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

/** 服务器地址配置表单：校验通过才允许保存 */
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

/** 原生首启引导：仅 Capacitor 壳内且未配置地址时全屏拦截；其余情况原样放行（Web/EXE 零影响） */
export function NativeGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(() => !isNativeShell() || !!getApiBase());
  if (!isNativeShell() || ready) return <>{children}</>;
  return (
    <div className="min-h-screen flex items-center justify-center p-5" style={{ background: "var(--paper)" }}>
      <PaperCard className="w-full max-w-md p-7">
        <div className="meta-label mb-2">首次使用 · 服务器设置</div>
        <h1 className="text-[26px] font-black">
          <BrushTitle vermilion>连接服务器</BrushTitle>
        </h1>
        <p className="text-[13.5px] text-[var(--ink-3)] mt-2 leading-relaxed">
          请填写运行本应用后端的电脑地址（手机与电脑需在同一局域网），例如 http://192.168.1.10:3000。
          校验通过后即可进入。
        </p>
        <ServerConfigForm className="mt-5" initial="" onSaved={() => setReady(true)} />
      </PaperCard>
    </div>
  );
}

/** 设置页小卡片：查看/修改服务器地址（仅原生壳内渲染，Web/EXE 不出现） */
export function ServerSettingsCard() {
  const [editing, setEditing] = useState(false);
  if (!isNativeShell()) return null;
  const base = getApiBase();
  return (
    <div className="border border-[var(--line)] rounded-[2px] p-5 bg-[var(--paper)]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-[16px] font-bold">服务器连接</h3>
          <p className="text-[12.5px] text-[var(--ink-3)] mt-1 break-all">
            当前地址：
            <span className="text-[var(--ink-2)]">{base || "未配置"}</span>
          </p>
        </div>
        <button
          onClick={() => setEditing((v) => !v)}
          className="px-4 py-2 border border-[var(--line)] rounded-[2px] text-[13.5px] hover:border-[var(--ink-2)]"
        >
          {editing ? "取消" : "修改地址"}
        </button>
      </div>
      {editing && (
        <ServerConfigForm
          className="mt-4 border-t border-dashed border-[var(--line)] pt-4"
          initial={base}
          onSaved={() => setEditing(false)}
        />
      )}
    </div>
  );
}
