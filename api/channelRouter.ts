import { z } from "zod";
import { and, eq, isNull, or } from "drizzle-orm";
import { createRouter, privateQuery } from "./middleware";
import type { TrpcContext } from "./context";
import { getDb } from "./queries/connection";
import { channels, bindings, type Channel, type ChannelConfig } from "@db/schema";
import { callChat, callImage, listModels, testChannel, filterModelsByKind } from "./llm/client";

/** key 脱敏：只回前端掩码 */
function mask(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 3)}****${key.slice(-4)}`;
}

function toSafe<T extends { apiKey: string }>(c: T) {
  return { ...c, apiKey: mask(c.apiKey) };
}

const isAdmin = (ctx: TrpcContext) => ctx.user?.role === "admin";

/** SSRF 防护：渠道地址必须 https，且不得指向内网/回环地址 */
function assertSafeBaseUrl(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("渠道地址不是合法 URL");
  }
  if (u.protocol !== "https:") throw new Error("渠道地址必须使用 https（防明文泄钥）");
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "::1" || h.startsWith("fe80:")
  ) {
    throw new Error("渠道地址不允许指向内网或回环地址");
  }
}

/** 渠道管理权限：管理员可管一切；普通用户只能管自己的个人渠道 */
function canManageChannel(ctx: TrpcContext, ch: Channel): boolean {
  if (!ctx.user) return false;
  if (isAdmin(ctx)) return true;
  return ch.userId !== null && ch.userId === ctx.user.id;
}

const effortEnum = z.enum(["none", "low", "medium", "high", "xhigh", "max"]);

const configSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  timeoutSec: z.number().int().positive().max(600).optional(),
  retries: z.number().int().min(0).max(5).optional(),
  extraParams: z.record(z.string(), z.unknown()).optional(),
});

export const channelRouter = createRouter({
  /** 渠道列表（key 已脱敏）：全站节点 + 我的个人节点；管理员可见全部 */
  list: privateQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = ctx.user
      ? isAdmin(ctx)
        ? await db.select().from(channels).orderBy(channels.id)
        : await db
            .select()
            .from(channels)
            .where(or(isNull(channels.userId), eq(channels.userId, ctx.user.id)))
            .orderBy(channels.id)
      : await db.select().from(channels).where(isNull(channels.userId)).orderBy(channels.id);
    return rows.map(toSafe);
  }),

  /** 新增渠道：personal=true 存为我的个人节点；全站节点仅管理员可建 */
  create: privateQuery
    .input(
      z.object({
        name: z.string().min(1).max(64),
        kind: z.enum(["chat", "image"]),
        protocol: z.enum(["openai", "anthropic"]),
        baseUrl: z.string().url(),
        apiKey: z.string().min(1),
        models: z.array(z.string()).default([]),
        reasoningEffort: effortEnum.nullable().optional(),
        config: configSchema.nullable().optional(),
        isDefault: z.boolean().default(false),
        personal: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const userId = ctx.user.id ? (input.personal ? ctx.user.id : null) : null;
      if (input.personal && !userId) throw new Error("请先登录再添加个人节点");
      if (!input.personal && !isAdmin(ctx)) throw new Error("全站节点仅管理员可管理");
      assertSafeBaseUrl(input.baseUrl);
      if (input.isDefault && !userId) {
        await db.update(channels).set({ isDefault: false }).where(eq(channels.kind, input.kind));
      }
      const [{ id }] = await db.insert(channels).values({
        ...input,
        isDefault: userId ? false : input.isDefault,
        reasoningEffort: input.reasoningEffort ?? null,
        config: input.config ?? null,
        userId,
      }).$returningId();
      const row = await db.query.channels.findFirst({ where: eq(channels.id, id) });
      return row ? toSafe(row) : null;
    }),

  /** 更新渠道（apiKey 传掩码原样则保留旧 key）；个人渠道仅本人/管理员，全站渠道仅管理员 */
  update: privateQuery
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(64).optional(),
        protocol: z.enum(["openai", "anthropic"]).optional(),
        baseUrl: z.string().url().optional(),
        apiKey: z.string().optional(),
        models: z.array(z.string()).optional(),
        reasoningEffort: effortEnum.nullable().optional(),
        config: configSchema.nullable().optional(),
        enabled: z.boolean().optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { id, apiKey, isDefault, ...rest } = input;
      const old = await db.query.channels.findFirst({ where: eq(channels.id, id) });
      if (!old) throw new Error("渠道不存在");
      if (!canManageChannel(ctx, old)) throw new Error("无权修改该渠道");
      if (rest.baseUrl) assertSafeBaseUrl(rest.baseUrl);
      if (isDefault && old.userId === null) {
        await db.update(channels).set({ isDefault: false }).where(eq(channels.kind, old.kind));
      }
      const keyChanged = apiKey && !apiKey.includes("****");
      await db
        .update(channels)
        .set({ ...rest, ...(keyChanged ? { apiKey } : {}), ...(isDefault !== undefined ? { isDefault } : {}) })
        .where(eq(channels.id, id));
      const row = await db.query.channels.findFirst({ where: eq(channels.id, id) });
      return row ? toSafe(row) : null;
    }),

  /** 删除渠道（连同其绑定） */
  remove: privateQuery.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const ch = await db.query.channels.findFirst({ where: eq(channels.id, input.id) });
    if (!ch) throw new Error("渠道不存在");
    if (!canManageChannel(ctx, ch)) throw new Error("无权删除该渠道");
    await db.delete(bindings).where(eq(bindings.channelId, input.id));
    await db.delete(channels).where(eq(channels.id, input.id));
    return { ok: true };
  }),

  /** 拉取模型列表（用完整 key，服务端执行） */
  fetchModels: privateQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const ch = await db.query.channels.findFirst({ where: eq(channels.id, input.id) });
      if (!ch) throw new Error("渠道不存在");
      if (!canManageChannel(ctx, ch)) throw new Error("无权操作该渠道");
      const all = await listModels(ch);
      const filtered = filterModelsByKind(all, ch.kind);
      const models = filtered.length > 0 ? filtered : all;
      await db.update(channels).set({ models }).where(eq(channels.id, ch.id));
      return { models };
    }),

  /** 手动追加模型名（Anthropic 等无列表接口的协议用） */
  addModel: privateQuery
    .input(z.object({ id: z.number(), model: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const ch = await db.query.channels.findFirst({ where: eq(channels.id, input.id) });
      if (!ch) throw new Error("渠道不存在");
      if (!canManageChannel(ctx, ch)) throw new Error("无权操作该渠道");
      const models = Array.from(new Set([...ch.models, input.model.trim()])).sort();
      await db.update(channels).set({ models }).where(eq(channels.id, ch.id));
      return { models };
    }),

  /** 连通性测试 */
  test: privateQuery
    .input(z.object({ id: z.number(), model: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const ch = await db.query.channels.findFirst({ where: eq(channels.id, input.id) });
      if (!ch) throw new Error("渠道不存在");
      if (!canManageChannel(ctx, ch)) throw new Error("无权测试该渠道");
      return testChannel(ch, input.model);
    }),

  /** 一键自检：可见渠道连通性 + 各角色按「我的个人绑定」解析试跑，标注来源 */
  selfCheck: privateQuery.mutation(async ({ ctx }) => {
    const db = getDb();
    const userId = ctx.user?.id;
    const visible = ctx.user
      ? await db.select().from(channels).where(or(isNull(channels.userId), eq(channels.userId, ctx.user.id)))
      : await db.select().from(channels).where(isNull(channels.userId));
    const channelResults = await Promise.all(
      visible.map(async (ch) => {
        const scope = ch.userId ? "个人" : "全站";
        if (!ch.enabled) return { id: ch.id, name: ch.name, kind: ch.kind, scope, ok: false, detail: "已停用" };
        const r = await testChannel(ch);
        return { id: ch.id, name: ch.name, kind: ch.kind, scope, ok: r.ok, detail: r.detail };
      }),
    );
    const roles = [
      "default_chat", "default_image", "agent_structure", "agent_question", "agent_locator",
      "agent_solver", "agent_reviewer", "agent_crosscheck", "agent_generator", "sentence_parser",
      "agent_diff", "agent_analyst", "agent_advisor",
      "essay_outliner", "essay_drafter", "essay_reviewer", "vocab_lookup",
    ];
    const sourceLabel = (s?: string) =>
      s === "personal" ? "个人绑定" : s === "global" ? "全站绑定" : s === "default" ? "默认回落" : s === "any" ? "任意可用" : "";
    const roleResults = await Promise.all(
      roles.map(async (role) => {
        const kind = role === "default_image" ? "image" : "chat";
        const resolved = await resolveBinding(role, kind, userId);
        if (!resolved) return { role, ok: false, source: "", detail: "无可用绑定" };
        const src = sourceLabel(resolved.source);
        if (kind === "image") {
          return { role, ok: true, source: src, detail: `${resolved.channel.name} · ${resolved.model}（绘图不试跑）` };
        }
        try {
          const r = await callChat(resolved.channel, resolved.model, [{ role: "user", content: "ping" }], {
            maxTokens: 16,
            reasoningEffort: resolved.reasoningEffort,
          });
          return { role, ok: true, source: src, detail: `${resolved.channel.name} · ${r.model} 正常` };
        } catch (e) {
          return { role, ok: false, source: src, detail: e instanceof Error ? e.message.slice(0, 200) : String(e) };
        }
      }),
    );
    return { channels: channelResults, roles: roleResults };
  }),

  /** 绑定列表：全站绑定 + 我的个人绑定（管理员看全部） */
  listBindings: privateQuery.query(async ({ ctx }) => {
    const db = getDb();
    if (ctx.user && isAdmin(ctx)) return db.select().from(bindings);
    if (ctx.user) {
      return db.select().from(bindings).where(or(isNull(bindings.userId), eq(bindings.userId, ctx.user.id)));
    }
    return db.select().from(bindings).where(isNull(bindings.userId));
  }),

  /** 设置绑定（reasoningEffort 为角色覆盖值，null=跟随渠道；personal=true 存为当前用户的个人覆盖） */
  setBinding: privateQuery
    .input(
      z.object({
        role: z.string(),
        channelId: z.number(),
        model: z.string().min(1),
        reasoningEffort: effortEnum.nullable().optional(),
        personal: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const userId = input.personal ? (ctx.user?.id ?? null) : null;
      if (input.personal && !userId) throw new Error("请先登录再设置个人绑定");
      if (!input.personal && !isAdmin(ctx)) throw new Error("全站绑定仅管理员可管理");
      const target = await db.query.channels.findFirst({ where: eq(channels.id, input.channelId) });
      if (!target) throw new Error("渠道不存在");
      if (userId && target.userId !== null && target.userId !== userId) {
        throw new Error("不能绑定他人的个人节点");
      }
      const scope = userId
        ? and(eq(bindings.role, input.role), eq(bindings.userId, userId))
        : and(eq(bindings.role, input.role), isNull(bindings.userId));
      const existing = await db.query.bindings.findFirst({ where: scope });
      if (existing) {
        await db
          .update(bindings)
          .set({
            channelId: input.channelId,
            model: input.model,
            reasoningEffort: input.reasoningEffort ?? null,
          })
          .where(eq(bindings.id, existing.id));
      } else {
        await db.insert(bindings).values({
          role: input.role,
          channelId: input.channelId,
          model: input.model,
          reasoningEffort: input.reasoningEffort ?? null,
          userId,
        });
      }
      return { ok: true };
    }),

  /** 删除绑定（personal=true 删自己的个人覆盖；全站绑定仅管理员） */
  removeBinding: privateQuery
    .input(z.object({ role: z.string(), personal: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const userId = input.personal ? (ctx.user?.id ?? null) : null;
      if (input.personal && !userId) throw new Error("请先登录");
      if (!input.personal && !isAdmin(ctx)) throw new Error("全站绑定仅管理员可管理");
      const scope = userId
        ? and(eq(bindings.role, input.role), eq(bindings.userId, userId))
        : and(eq(bindings.role, input.role), isNull(bindings.userId));
      await db.delete(bindings).where(scope);
      return { ok: true };
    }),

  /** 批量保存绑定（草稿式编辑一次落库；null 项表示删除该角色绑定=跟随全局） */
  setBindings: privateQuery
    .input(
      z.object({
        items: z
          .array(
            z.object({
              role: z.string(),
              binding: z
                .object({
                  channelId: z.number(),
                  model: z.string().min(1),
                  reasoningEffort: effortEnum.nullable().optional(),
                })
                .nullable(),
            }),
          )
          .max(32),
        personal: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const userId = input.personal ? (ctx.user?.id ?? null) : null;
      if (input.personal && !userId) throw new Error("请先登录再设置个人绑定");
      if (!input.personal && !isAdmin(ctx)) throw new Error("全站绑定仅管理员可管理");
      for (const item of input.items) {
        const scope = userId
          ? and(eq(bindings.role, item.role), eq(bindings.userId, userId))
          : and(eq(bindings.role, item.role), isNull(bindings.userId));
        if (!item.binding) {
          await db.delete(bindings).where(scope);
          continue;
        }
        const target = await db.query.channels.findFirst({ where: eq(channels.id, item.binding.channelId) });
        if (!target) throw new Error(`渠道不存在（角色 ${item.role}）`);
        if (userId && target.userId !== null && target.userId !== userId) {
          throw new Error("不能绑定他人的个人节点");
        }
        const existing = await db.query.bindings.findFirst({ where: scope });
        if (existing) {
          await db
            .update(bindings)
            .set({
              channelId: item.binding.channelId,
              model: item.binding.model,
              reasoningEffort: item.binding.reasoningEffort ?? null,
            })
            .where(eq(bindings.id, existing.id));
        } else {
          await db.insert(bindings).values({
            role: item.role,
            channelId: item.binding.channelId,
            model: item.binding.model,
            reasoningEffort: item.binding.reasoningEffort ?? null,
            userId,
          });
        }
      }
      return { ok: true, count: input.items.length };
    }),

  /** 实际路由一览：每个角色此刻真正会打到哪个渠道哪个模型、命中来源（个人/全站/默认）。
   *  纯 DB 解析无 LLM 调用——解决"我绑了个人 API 到底有没有生效"的黑盒感。 */
  routeMap: privateQuery.query(async ({ ctx }) => {
    const { BINDING_ROLES } = await import("@contracts/constants");
    const out: {
      role: string;
      kind: string;
      source: "personal" | "global" | "default" | "any" | null;
      channelId: number | null;
      channelName: string | null;
      model: string | null;
      reasoningEffort: string | null;
    }[] = [];
    for (const r of BINDING_ROLES) {
      const resolved = await resolveBinding(r.id, r.kind as "chat" | "image", ctx.user?.id);
      out.push({
        role: r.id,
        kind: r.kind,
        source: resolved?.source ?? null,
        channelId: resolved?.channel.id ?? null,
        channelName: resolved?.channel.name ?? null,
        model: resolved?.model ?? null,
        reasoningEffort: resolved?.reasoningEffort ?? null,
      });
    }
    return out;
  }),

  /** 供内部 Agent 使用：按角色取渠道+模型（含完整 key，不出服务端） */
  resolve: privateQuery
    .input(z.object({ role: z.string(), kind: z.enum(["chat", "image"]).default("chat") }))
    .query(async ({ ctx, input }) => {
      const resolved = await resolveBinding(input.role, input.kind, ctx.user?.id);
      return resolved
        ? { ...toSafe(resolved.channel), model: resolved.model, reasoningEffort: resolved.reasoningEffort }
        : null;
    }),
});

export interface ResolvedBinding {
  channel: Channel;
  model: string;
  /** 三级回落后的思考强度：角色覆盖 → 渠道默认 → undefined（不发送） */
  reasoningEffort?: string;
  /** 命中来源：个人绑定 / 全站角色绑定 / 类型默认回落 / 任意可用渠道 */
  source?: "personal" | "global" | "default" | "any";
}

/** 内部：角色 → 渠道 + 模型，回退顺序：个人绑定 → 全站角色绑定 → 类型默认 → 任意可用渠道 */
export async function resolveBinding(
  role: string,
  kind: "chat" | "image",
  userId?: number,
): Promise<ResolvedBinding | null> {
  const db = getDb();
  const load = async (b: typeof bindings.$inferSelect | undefined, source: ResolvedBinding["source"]) => {
    if (!b) return null;
    const ch = await db.query.channels.findFirst({ where: eq(channels.id, b.channelId) });
    if (!ch?.enabled) return null;
    // 个人绑定不得指向他人的个人渠道
    if (b.userId && ch.userId !== null && ch.userId !== b.userId) return null;
    return { channel: ch, model: b.model, reasoningEffort: b.reasoningEffort ?? ch.reasoningEffort ?? undefined, source };
  };
  if (userId) {
    const mine = await db.query.bindings.findFirst({
      where: and(eq(bindings.role, role), eq(bindings.userId, userId)),
    });
    const r = await load(mine, "personal");
    if (r) return r;
  }
  const b = await db.query.bindings.findFirst({
    where: and(eq(bindings.role, role), isNull(bindings.userId)),
  });
  const r0 = await load(b, "global");
  if (r0) return r0;
  const fallbackRole = kind === "chat" ? "default_chat" : "default_image";
  const fb = await db.query.bindings.findFirst({
    where: and(eq(bindings.role, fallbackRole), isNull(bindings.userId)),
  });
  const r1 = await load(fb, "default");
  if (r1) return r1;
  const anyCh = (await db.select().from(channels).where(eq(channels.kind, kind))).find(
    (c) => c.enabled && c.userId === null,
  );
  if (anyCh?.models.length) {
    return { channel: anyCh, model: anyCh.models[0], reasoningEffort: anyCh.reasoningEffort ?? undefined, source: "any" };
  }
  return null;
}

export { callChat, callImage };
export type { ChannelConfig };
