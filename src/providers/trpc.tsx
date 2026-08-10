import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, type TRPCLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import { useEffect, useState, type ReactNode } from "react";
import { safeStorage } from "@/lib/safeStorage";
import { offlineLink } from "@/offline/link";
import { initOfflineDb } from "@/offline/db";

export const trpc = createTRPCReact<AppRouter>();

const TOKEN_KEY = "ky_session_token";
/** API 基址：空串 = 同源相对路径（Web/EXE 不变）；APK 由原生引导页写入绝对地址 */
export const API_BASE_KEY = "kysop.apiBase";

/**
 * 离线模式判定：Capacitor 壳内且未配置服务器地址 → 本地 sql.js 直跑整套 tRPC。
 * 调试开关（桌面复现白屏用，生产无害）：URL 带 ?offline=1 或 localStorage kysop.forceOffline='1'
 * 时在任意环境强制走离线链路；Capacitor 壳内行为不受影响（原判定仍然生效）。
 */
export function isOfflineMode(): boolean {
  if (typeof window === "undefined") return false;
  const force =
    new URLSearchParams(window.location.search).get("offline") === "1" ||
    safeStorage.get("kysop.forceOffline") === "1";
  if (force) return true;
  return (
    "Capacitor" in window && !(safeStorage.get(API_BASE_KEY) ?? "").trim()
  );
}

const queryClient = new QueryClient();
const links: TRPCLink<AppRouter>[] = isOfflineMode()
  ? [offlineLink()]
  : [
      httpBatchLink({
        // url 保持同源相对路径（Web/EXE 零变化）；绝对基址在下方 fetch 钩子里按需前置
        url: "/api/trpc",
        transformer: superjson,
        headers() {
          const token = safeStorage.get(TOKEN_KEY);
          return token ? { "x-session-token": token } : {};
        },
        fetch(input, init) {
          // 每次请求重读基址：空串 = 相对路径（默认）；APK 配置后前置绝对地址，改地址即时生效
          const base = (safeStorage.get(API_BASE_KEY) ?? "").replace(/\/+$/, "");
          const url =
            base && typeof input === "string" ? base + input : input;
          return globalThis.fetch(url, {
            ...(init ?? {}),
            credentials: "include",
          });
        },
      }),
    ];
const trpcClient = trpc.createClient({ links });

export function TRPCProvider({ children }: { children: ReactNode }) {
  // 离线模式需先加载 offline.db（IndexedDB > 随包资源）再放行 UI；联网模式立即放行
  const [ready, setReady] = useState(() => !isOfflineMode());
  useEffect(() => {
    if (!isOfflineMode()) return;
    initOfflineDb()
      .then(() => setReady(true))
      .catch((e) => {
        // 失败也放行：getDb 未初始化会以 tRPC 错误形态暴露在页面内，便于用户看到具体原因
        console.error("[offline] 离线库初始化失败", e);
        setReady(true);
      });
  }, []);
  if (!ready) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-5"
        style={{ background: "var(--paper)" }}
      >
        <p className="meta-label">正在载入离线题库…</p>
      </div>
    );
  }
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
