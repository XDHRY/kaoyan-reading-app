import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { rateLimit } from "./rate";

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the configured limit and then rejects the next one", () => {
    const userId = 910001;
    const bucket = "unit-limit";

    expect(() => rateLimit(userId, bucket, 2)).not.toThrow();
    expect(() => rateLimit(userId, bucket, 2)).not.toThrow();

    try {
      rateLimit(userId, bucket, 2);
      throw new Error("expected rateLimit to reject the third request");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("TOO_MANY_REQUESTS");
      expect((error as TRPCError).message).toBe("操作太频繁，请稍候再试");
    }
  });

  it("isolates counters by user and bucket", () => {
    const userId = 910002;

    expect(() => rateLimit(userId, "agent-a", 1)).not.toThrow();
    expect(() => rateLimit(userId + 1, "agent-a", 1)).not.toThrow();
    expect(() => rateLimit(userId, "agent-b", 1)).not.toThrow();

    expect(() => rateLimit(userId, "agent-a", 1)).toThrowError(TRPCError);
  });

  it("expires entries once the 60-second sliding window has elapsed", () => {
    const userId = 910003;
    const bucket = "unit-expiry";

    expect(() => rateLimit(userId, bucket, 1)).not.toThrow();
    expect(() => rateLimit(userId, bucket, 1)).toThrowError(TRPCError);

    vi.advanceTimersByTime(60_000);

    expect(() => rateLimit(userId, bucket, 1)).not.toThrow();
  });
});
