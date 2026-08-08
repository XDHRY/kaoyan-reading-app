import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** scrypt 加盐哈希，输出 hex（128 字符） */
export function hashSecret(secret: string, salt: string): string {
  return scryptSync(secret.normalize("NFKC"), salt, 64).toString("hex");
}

export function verifySecret(secret: string, salt: string, expected: string): boolean {
  const actual = hashSecret(secret, salt);
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newSalt(): string {
  return randomBytes(16).toString("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/** 密保答案归一化：去空格、转小写，降低“答对了但被格式挡住”的概率 */
export function normalizeRecoveryAnswer(answer: string): string {
  return answer.trim().replace(/\s+/g, "").toLowerCase();
}

/** 找回密码时颁发的一次性凭证（10 分钟） */
export function newResetTicket(userId: number): string {
  const payload = `${userId}.${Date.now()}.${randomBytes(12).toString("hex")}`;
  return createHash("sha256").update(payload).digest("hex");
}

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
export const RESET_TICKET_TTL_MS = 10 * 60 * 1000;
export const LOGIN_MAX_FAILS = 5;
export const LOGIN_LOCK_MS = 5 * 60 * 1000;
