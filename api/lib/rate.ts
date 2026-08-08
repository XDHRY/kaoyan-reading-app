import { TRPCError } from "@trpc/server";

/** 轻量限速：每用户每类 LLM 入口的内存滑动窗口。
 *  进程内 Map 实现——单实例部署足够；多实例时各实例独立计数（可接受的近似）。 */
const rateBuckets = new Map<string, number[]>();

export function rateLimit(userId: number, bucket: string, max = 20) {
  const key = `${userId}:${bucket}`;
  const now = Date.now();
  const arr = (rateBuckets.get(key) ?? []).filter((t) => now - t < 60_000);
  if (arr.length >= max) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "操作太频繁，请稍候再试" });
  arr.push(now);
  rateBuckets.set(key, arr);
}
