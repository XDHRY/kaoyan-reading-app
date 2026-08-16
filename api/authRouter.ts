import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createRouter, publicQuery, privateQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  users,
  sessions,
  prompts,
  bindings,
  vocabItems,
  wrongItems,
  practiceRecords,
  siteSettings,
  type User,
} from "@db/schema";
import {
  hashSecret,
  verifySecret,
  newSalt,
  newSessionToken,
  normalizeRecoveryAnswer,
  SESSION_TTL_MS,
  LOGIN_MAX_FAILS,
  LOGIN_LOCK_MS,
} from "./lib/auth";

/** 登录失败锁定（内存态，单实例部署足够） */
const failMap = new Map<string, { count: number; lockedUntil: number }>();

function sanitize(u: User) {
  return {
    id: u.id,
    name: u.name,
    avatarChar: u.avatarChar || u.name.charAt(0),
    hasRecovery: !!u.recoveryQuestion,
    role: u.role ?? "user",
    createdAt: u.createdAt,
  };
}

async function issueSession(userId: number) {
  const db = getDb();
  const token = newSessionToken();
  await db.insert(sessions).values({
    token,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

const passwordSchema = z
  .string()
  .min(6, "密码至少 6 位")
  .max(64, "密码最长 64 位");

/** 站点开关读取 */
export async function getSetting(k: string, fallback = ""): Promise<string> {
  const db = getDb();
  const row = await db.query.siteSettings.findFirst({ where: eq(siteSettings.k, k) });
  return row?.v ?? fallback;
}

/** 开关值宽松判真：兼容 "1"/"true" */
export const settingOn = (v: string) => v === "1" || v === "true";

export const authRouter = createRouter({
  /** 注册：昵称 + 密码 + 密保问题/答案 */
  register: publicQuery
    .input(
      z.object({
        name: z.string().trim().min(1, "请输入昵称").max(32),
        password: passwordSchema,
        recoveryQuestion: z.string().min(2, "请设置密保问题").max(128),
        recoveryAnswer: z.string().min(1, "请设置密保答案").max(64),
        avatarChar: z.string().max(4).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const name = input.name.trim();
      const existing = await db.query.users.findFirst({ where: eq(users.name, name) });
      if (!existing) {
        const open = await getSetting("registration_open", "1");
        if (!settingOn(open)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "管理员已暂时关闭新用户注册" });
        }
      }
      if (existing) {
        if (existing.passwordHash) {
          throw new TRPCError({ code: "CONFLICT", message: "该昵称已被注册，请直接登录或更换昵称" });
        }
        // 兼容旧昵称用户：补齐密码后返回会话
        const salt = newSalt();
        await db
          .update(users)
          .set({
            passwordHash: hashSecret(input.password, salt),
            salt,
            recoveryQuestion: input.recoveryQuestion.trim(),
            recoveryHash: hashSecret(normalizeRecoveryAnswer(input.recoveryAnswer), salt),
            recoverySalt: salt,
            avatarChar: input.avatarChar?.trim() || name.charAt(0),
          })
          .where(eq(users.id, existing.id));
        const token = await issueSession(existing.id);
        return { token, user: sanitize({ ...existing, avatarChar: input.avatarChar?.trim() || name.charAt(0), recoveryQuestion: input.recoveryQuestion } as User) };
      }
      const salt = newSalt();
      const [{ id }] = await db
        .insert(users)
        .values({
          name,
          passwordHash: hashSecret(input.password, salt),
          salt,
          recoveryQuestion: input.recoveryQuestion.trim(),
          recoveryHash: hashSecret(normalizeRecoveryAnswer(input.recoveryAnswer), salt),
          recoverySalt: salt,
          avatarChar: input.avatarChar?.trim() || name.charAt(0),
        })
        .$returningId();
      const user = await db.query.users.findFirst({ where: eq(users.id, id) });
      const token = await issueSession(id);
      return { token, user: sanitize(user!) };
    }),

  /** 登录：5 次失败锁 5 分钟 */
  login: publicQuery
    .input(z.object({ name: z.string().trim().min(1).max(32), password: z.string().min(1).max(64) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const name = input.name.trim();
      const key = name.toLowerCase();
      const rec = failMap.get(key);
      if (rec && rec.lockedUntil > Date.now()) {
        const secs = Math.ceil((rec.lockedUntil - Date.now()) / 1000);
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `失败次数过多，请 ${secs} 秒后再试` });
      }
      const user = await db.query.users.findFirst({ where: eq(users.name, name) });
      const ok = !!user && !!user.passwordHash && verifySecret(input.password, user.salt, user.passwordHash);
      if (!ok) {
        const count = (rec?.count ?? 0) + 1;
        failMap.set(key, {
          count,
          lockedUntil: count >= LOGIN_MAX_FAILS ? Date.now() + LOGIN_LOCK_MS : 0,
        });
        throw new TRPCError({ code: "UNAUTHORIZED", message: "昵称或密码不正确" });
      }
      failMap.delete(key);
      const token = await issueSession(user!.id);
      return { token, user: sanitize(user!) };
    }),

  /** 当前登录状态 */
  me: publicQuery.query(({ ctx }) => (ctx.user ? sanitize(ctx.user) : null)),

  /** 公开站点信息（注册开关、公告） */
  siteInfo: publicQuery.query(async () => ({
    registrationOpen: settingOn(await getSetting("registration_open", "1")),
    announcement: await getSetting("announcement", ""),
  })),

  logout: publicQuery.mutation(async ({ ctx }) => {
    const token = ctx.req.headers.get("x-session-token");
    if (token) {
      const db = getDb();
      await db.delete(sessions).where(eq(sessions.token, token));
    }
    return { ok: true };
  }),

  /** 找回第一步：取密保问题（不泄露是否有该用户以外的信息） */
  recoveryQuestionFor: publicQuery
    .input(z.object({ name: z.string().trim().min(1).max(32) }))
    .query(async ({ input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({ where: eq(users.name, input.name.trim()) });
      if (!user || !user.recoveryQuestion) {
        throw new TRPCError({ code: "NOT_FOUND", message: "未找到该用户或其未设置密保" });
      }
      return { question: user.recoveryQuestion };
    }),

  /** 找回第二步：验答案 → 重置密码，旧会话全部作废 */
  resetPassword: publicQuery
    .input(
      z.object({
        name: z.string().trim().min(1).max(32),
        recoveryAnswer: z.string().min(1).max(64),
        newPassword: passwordSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({ where: eq(users.name, input.name.trim()) });
      if (!user || !user.recoveryHash) {
        throw new TRPCError({ code: "NOT_FOUND", message: "未找到该用户或其未设置密保" });
      }
      // 密保专用盐（与密码盐解耦）；存量行 recoverySalt 为空时回落旧盐
      const ok = verifySecret(normalizeRecoveryAnswer(input.recoveryAnswer), user.recoverySalt || user.salt, user.recoveryHash);
      if (!ok) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "密保答案不正确" });
      }
      const salt = newSalt();
      await db
        .update(users)
        .set({ passwordHash: hashSecret(input.newPassword, salt), salt })
        .where(eq(users.id, user.id));
      await db.delete(sessions).where(eq(sessions.userId, user.id));
      const token = await issueSession(user.id);
      return { token, user: sanitize({ ...user } as User) };
    }),

  changePassword: privateQuery
    .input(z.object({ oldPassword: z.string().min(1).max(64), newPassword: passwordSchema }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id) });
      if (!user || !verifySecret(input.oldPassword, user!.salt, user!.passwordHash)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "原密码不正确" });
      }
      const salt = newSalt();
      await db
        .update(users)
        .set({ passwordHash: hashSecret(input.newPassword, salt), salt })
        .where(eq(users.id, user!.id));
      return { ok: true };
    }),

  changeRecovery: privateQuery
    .input(
      z.object({
        password: z.string().min(1).max(64),
        recoveryQuestion: z.string().min(2).max(128),
        recoveryAnswer: z.string().min(1).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id) });
      if (!user || !verifySecret(input.password, user!.salt, user!.passwordHash)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "密码不正确" });
      }
      const recoverySalt = newSalt();
      await db
        .update(users)
        .set({
          recoveryQuestion: input.recoveryQuestion.trim(),
          recoveryHash: hashSecret(normalizeRecoveryAnswer(input.recoveryAnswer), recoverySalt),
          recoverySalt,
        })
        .where(eq(users.id, user!.id));
      return { ok: true };
    }),

  updateProfile: privateQuery
    .input(
      z.object({
        name: z.string().trim().min(1).max(32).optional(),
        avatarChar: z.string().max(4).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const patch: Partial<User> = {};
      if (input.name && input.name.trim() !== ctx.user.name) {
        const dup = await db.query.users.findFirst({ where: eq(users.name, input.name.trim()) });
        if (dup) throw new TRPCError({ code: "CONFLICT", message: "该昵称已被占用" });
        patch.name = input.name.trim();
      }
      if (input.avatarChar?.trim()) patch.avatarChar = input.avatarChar.trim();
      if (Object.keys(patch).length) {
        await db.update(users).set(patch).where(eq(users.id, ctx.user.id));
      }
      const user = await db.query.users.findFirst({ where: eq(users.id, ctx.user.id) });
      return { user: sanitize(user!) };
    }),

  /** 导出我的全部数据（个人学习记录） */
  exportData: privateQuery.query(async ({ ctx }) => {
    const db = getDb();
    const uid = ctx.user.id;
    const [vocab, wrong, records, myPrompts, myBindings] = await Promise.all([
      db.select().from(vocabItems).where(eq(vocabItems.userId, uid)),
      db.select().from(wrongItems).where(eq(wrongItems.userId, uid)),
      db.select().from(practiceRecords).where(eq(practiceRecords.userId, uid)),
      db.select().from(prompts).where(eq(prompts.userId, uid)),
      db.select().from(bindings).where(eq(bindings.userId, uid)),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      user: sanitize(ctx.user),
      vocab,
      wrongItems: wrong,
      practiceRecords: records,
      prompts: myPrompts,
      bindings: myBindings.map((b) => ({ ...b })),
    };
  }),

  /** 注销账号：需密码确认，删除个人全部数据 */
  deleteAccount: privateQuery
    .input(z.object({ password: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const uid = ctx.user.id;
      const user = await db.query.users.findFirst({ where: eq(users.id, uid) });
      if (!user || !verifySecret(input.password, user!.salt, user!.passwordHash)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "密码不正确" });
      }
      await Promise.all([
        db.delete(vocabItems).where(eq(vocabItems.userId, uid)),
        db.delete(wrongItems).where(eq(wrongItems.userId, uid)),
        db.delete(practiceRecords).where(eq(practiceRecords.userId, uid)),
        db.delete(prompts).where(eq(prompts.userId, uid)),
        db.delete(bindings).where(eq(bindings.userId, uid)),
        db.delete(sessions).where(eq(sessions.userId, uid)),
      ]);
      await db.delete(users).where(eq(users.id, uid));
      return { ok: true };
    }),
});
