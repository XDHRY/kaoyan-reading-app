/**
 * 离线 tRPC link：终止型 link，把 op 直接派发给进程内 appRouter（sql-js 后端），
 * 等价于 @trpc/client 官方 unstable_localLink 的 callProcedure 直调路径，差异点：
 * - ctx 每次调用惰性重建（getDb 未初始化即抛，前端以 tRPC 错误形态暴露）
 * - mutation 成功后 schedulePersist()（2s 防抖回写 IndexedDB）
 * - 数据/错误 envelope 做 superjson 往返，与 httpLink（服务端序列化 + 客户端反序列化）行为对齐
 */
import { observable } from "@trpc/server/observable";
import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { getTRPCErrorFromUnknown, getTRPCErrorShape } from "@trpc/server";
import superjson from "superjson";
import { appRouter, type AppRouter } from "../../api/router";
import { createOfflineCaller } from "./caller";
import { schedulePersist } from "./db";

let caller: ReturnType<typeof createOfflineCaller> | null = null;

function getCaller(): ReturnType<typeof createOfflineCaller> {
  caller ??= createOfflineCaller();
  return caller;
}

/** superjson 往返：归一化 Date/undefined 等，与 http 链路客户端所见一致 */
function transformChunk(chunk: unknown): unknown {
  if (chunk === undefined) return chunk;
  return superjson.deserialize(JSON.parse(JSON.stringify(superjson.serialize(chunk))));
}

export function offlineLink(): TRPCLink<AppRouter> {
  return () => {
    return ({ op }) =>
      observable((observer) => {
        void (async () => {
          try {
            const result = await (getCaller() as unknown as { [path: string]: (input: unknown) => Promise<unknown> })[op.path](op.input);
            observer.next({ result: { data: transformChunk(result) } } as never);
            if (op.type === "mutation") schedulePersist();
            observer.complete();
          } catch (cause) {
            const error = getTRPCErrorFromUnknown(cause);
            const shape = getTRPCErrorShape({
              config: appRouter._def._config,
              ctx: undefined,
              error,
              input: op.input,
              path: op.path,
              type: op.type,
            });
            observer.error(
              TRPCClientError.from(
                { error: transformChunk(shape) } as never,
                { cause: cause instanceof Error ? cause : undefined },
              ),
            );
          }
        })();
        return () => {
          // 离线调用为单次 promise 语义，无取消状态可清理
        };
      });
  };
}
