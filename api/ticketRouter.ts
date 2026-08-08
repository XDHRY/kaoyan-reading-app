import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminQuery, createRouter, privateQuery, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { announcements, ticketAttachments, ticketReplies, tickets, siteSettings, users } from "@db/schema";
import { rateLimit } from "./lib/rate";

/**
 * 工单与公告（参考 marker.io 的自动上下文捕获 + Fider/Astuto 的状态流转与对话）。
 *
 * 设计决策：
 * - **只加不改**：与练习/判分链路零耦合，独立四表，失败不影响主流程；
 * - 截图由客户端压缩（≤400KB JPEG）后 base64 落库——无文件系统依赖，随备份一起走；
 * - 状态流转即「处理路线」：statusLog 追加式记录，用户随时可见进展；
 * - 公告每一期留档（announcements 表），发布时同步首页横幅（siteSettings.announcement），
 *   历史公告永不丢失。
 */

const attachmentInput = z.object({
  name: z.string().max(128).default("screenshot.jpg"),
  mime: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
  dataBase64: z.string().max(600_000), // ~450KB base64
});

const STATUS_FLOW = ["open", "processing", "resolved", "closed"] as const;

/** 未填简介时自动提取：取正文首段，压平空白，截到 ~90 字 */
function deriveDigest(content: string): string {
  const firstPara = content.split(/\n\s*\n|\n/)[0] ?? "";
  const flat = firstPara.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? `${flat.slice(0, 90)}……` : flat;
}

async function assertTicketOwner(ticketId: number, userId: number) {
  const db = getDb();
  const t = await db.query.tickets.findFirst({ where: and(eq(tickets.id, ticketId), eq(tickets.userId, userId)) });
  if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "工单不存在" });
  return t;
}

export const ticketRouter = createRouter({
  /** 提交工单（浮动反馈印：页面位置/控制台报错/UA/视口自动随单归档） */
  create: privateQuery
    .input(
      z.object({
        kind: z.enum(["bug", "suggest", "question", "other"]).default("bug"),
        title: z.string().min(2).max(128),
        content: z.string().min(2).max(4000),
        pageUrl: z.string().max(255).default(""),
        locationText: z.string().max(255).default(""),
        errorText: z.string().max(4000).default(""),
        consoleErrors: z.array(z.object({ msg: z.string().max(500), at: z.string().max(40) })).max(5).default([]),
        userAgent: z.string().max(255).default(""),
        viewport: z.string().max(32).default(""),
        appVersion: z.string().max(32).default(""),
        attachments: z.array(attachmentInput).max(3).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const uid = ctx.user.id;
      rateLimit(uid, "ticket", 6);
      const now = new Date().toISOString();
      const [{ id }] = await db
        .insert(tickets)
        .values({
          userId: uid,
          kind: input.kind,
          title: input.title,
          content: input.content,
          pageUrl: input.pageUrl,
          locationText: input.locationText,
          errorText: input.errorText || null,
          consoleErrors: input.consoleErrors,
          userAgent: input.userAgent,
          viewport: input.viewport,
          appVersion: input.appVersion,
          status: "open",
          statusLog: [{ status: "open", at: now, note: "工单已提交" }],
        })
        .$returningId();
      for (const a of input.attachments) {
        await db.insert(ticketAttachments).values({
          ticketId: id,
          name: a.name,
          mime: a.mime,
          size: Math.round(a.dataBase64.length * 0.75),
          dataBase64: a.dataBase64,
        });
      }
      return { id };
    }),

  /** 我的工单列表（含最新回复预览与状态） */
  myList: privateQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(tickets)
      .where(eq(tickets.userId, ctx.user.id))
      .orderBy(desc(tickets.updatedAt));
    const replyRows = rows.length
      ? await db.select().from(ticketReplies).orderBy(desc(ticketReplies.id))
      : [];
    const lastByTicket = new Map<number, { content: string; authorRole: string; createdAt: Date }>();
    for (const r of replyRows) {
      if (!lastByTicket.has(r.ticketId)) {
        lastByTicket.set(r.ticketId, { content: r.content.slice(0, 60), authorRole: r.authorRole, createdAt: r.createdAt });
      }
    }
    const attRows = rows.length ? await db.select({ ticketId: ticketAttachments.ticketId }).from(ticketAttachments) : [];
    const attCount = new Map<number, number>();
    for (const a of attRows) attCount.set(a.ticketId, (attCount.get(a.ticketId) ?? 0) + 1);
    return rows.map((t) => ({
      id: t.id,
      kind: t.kind,
      title: t.title,
      status: t.status,
      pageUrl: t.pageUrl,
      attachmentCount: attCount.get(t.id) ?? 0,
      lastReply: lastByTicket.get(t.id) ?? null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  }),

  /** 工单详情：正文 + 上下文 + 截图 + 对话流 + 处理路线 */
  detail: privateQuery.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const db = getDb();
    const isAdmin = ctx.user.role === "admin";
    const t = isAdmin
      ? await db.query.tickets.findFirst({ where: eq(tickets.id, input.id) })
      : await assertTicketOwner(input.id, ctx.user.id);
    if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "工单不存在" });
    const replies = await db
      .select()
      .from(ticketReplies)
      .where(eq(ticketReplies.ticketId, t.id))
      .orderBy(ticketReplies.createdAt);
    const atts = await db
      .select({ id: ticketAttachments.id, name: ticketAttachments.name, mime: ticketAttachments.mime, size: ticketAttachments.size, dataBase64: ticketAttachments.dataBase64 })
      .from(ticketAttachments)
      .where(eq(ticketAttachments.ticketId, t.id));
    const author = await db.query.users.findFirst({ where: eq(users.id, t.userId) });
    return { ticket: t, replies, attachments: atts, authorName: author?.name ?? "" };
  }),

  /** 用户追问（工单未关闭时可继续补充） */
  reply: privateQuery
    .input(z.object({ ticketId: z.number(), content: z.string().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const t = await assertTicketOwner(input.ticketId, ctx.user.id);
      if (t.status === "closed") throw new TRPCError({ code: "BAD_REQUEST", message: "工单已关闭，如有新问题请另开一单" });
      await db.insert(ticketReplies).values({
        ticketId: t.id,
        authorId: ctx.user.id,
        authorRole: "user",
        authorName: ctx.user.name,
        content: input.content,
      });
      // 用户追问后若管理员已标记解决，回到处理中（对话未完）
      if (t.status === "resolved") {
        const log = [...(t.statusLog as { status: string; at: string; note?: string }[]), { status: "processing", at: new Date().toISOString(), note: "用户补充了新情况" }];
        await db.update(tickets).set({ status: "processing", statusLog: log }).where(eq(tickets.id, t.id));
      }
      return { ok: true };
    }),

  /** 用户主动关闭自己的工单 */
  close: privateQuery.input(z.object({ ticketId: z.number() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const t = await assertTicketOwner(input.ticketId, ctx.user.id);
    const log = [...(t.statusLog as { status: string; at: string; note?: string }[]), { status: "closed", at: new Date().toISOString(), note: "用户自行关闭" }];
    await db.update(tickets).set({ status: "closed", statusLog: log }).where(eq(tickets.id, t.id));
    return { ok: true };
  }),

  /** 公告中心（公开）：每一期公告按时间倒序 */
  notices: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db.select().from(announcements).orderBy(desc(announcements.id));
    return rows;
  }),

  // ———— 管理端 ————

  /** 管理员工单列表（按状态筛选） */
  adminList: adminQuery
    .input(z.object({ status: z.enum(["all", ...STATUS_FLOW]).default("all") }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(tickets)
        .where(input.status === "all" ? undefined : eq(tickets.status, input.status))
        .orderBy(desc(tickets.updatedAt));
      const userIds = [...new Set(rows.map((r) => r.userId))];
      const us = userIds.length ? await db.query.users.findMany({ where: inArray(users.id, userIds) }) : [];
      const nameOf = new Map(us.map((u) => [u.id, u.name]));
      return rows.map((t) => ({
        id: t.id,
        kind: t.kind,
        title: t.title,
        status: t.status,
        pageUrl: t.pageUrl,
        userName: nameOf.get(t.userId) ?? `#${t.userId}`,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }));
    }),

  /** 管理员回复（可同时流转状态——回复即处理路线的一笔） */
  adminReply: adminQuery
    .input(
      z.object({
        ticketId: z.number(),
        content: z.string().min(1).max(4000),
        status: z.enum(STATUS_FLOW).optional(),
        note: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const t = await db.query.tickets.findFirst({ where: eq(tickets.id, input.ticketId) });
      if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "工单不存在" });
      await db.insert(ticketReplies).values({
        ticketId: t.id,
        authorId: ctx.user.id,
        authorRole: "admin",
        authorName: ctx.user.name || "掌门",
        content: input.content,
      });
      if (input.status && input.status !== t.status) {
        const log = [...(t.statusLog as { status: string; at: string; note?: string }[]), { status: input.status, at: new Date().toISOString(), note: input.note }];
        await db.update(tickets).set({ status: input.status, statusLog: log }).where(eq(tickets.id, t.id));
      }
      return { ok: true };
    }),

  /** 发布公告（每一期留档 + 同步首页横幅；横幅只用标题+简介，不上全文） */
  publishNotice: adminQuery
    .input(
      z.object({
        title: z.string().min(2).max(128),
        content: z.string().min(2).max(8000),
        // 一句话简介：横幅与公告榜摘要位；可不填，自动从正文提取
        digest: z.string().max(160).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const digest = (input.digest ?? "").trim() || deriveDigest(input.content);
      const [{ id }] = await db
        .insert(announcements)
        .values({ title: input.title, digest, content: input.content, authorName: ctx.user.name || "掌门" })
        .$returningId();
      // 兼容旧横幅：最新一期同步到 siteSettings.announcement（摘要格式）
      await db
        .insert(siteSettings)
        .values({ k: "announcement", v: `【${input.title}】${digest}` })
        .onDuplicateKeyUpdate({ set: { v: `【${input.title}】${digest}` } });
      return { id };
    }),

  /** 撤下一期公告（不影响其他期；若撤的是最新期，横幅回退到次新一期） */
  removeNotice: adminQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
    const db = getDb();
    await db.delete(announcements).where(eq(announcements.id, input.id));
    const latest = (await db.select().from(announcements).orderBy(desc(announcements.id)).limit(1))[0];
    const banner = latest ? `【${latest.title}】${latest.digest || deriveDigest(latest.content)}` : "";
    await db
      .insert(siteSettings)
      .values({ k: "announcement", v: banner })
      .onDuplicateKeyUpdate({ set: { v: banner } });
    return { ok: true };
  }),
});
