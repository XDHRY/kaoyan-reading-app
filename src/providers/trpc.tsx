import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";
import { safeStorage } from "@/lib/safeStorage";

export const trpc = createTRPCReact<AppRouter>();

const TOKEN_KEY = "ky_session_token";
/** API 基址：空串 = 同源相对路径（Web/EXE 不变）；APK 由原生引导页写入绝对地址 */
export const API_BASE_KEY = "kysop.apiBase";

const queryClient = new QueryClient();
const trpcClient = trpc.createClient({
  links: [
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
  ],
});

export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
