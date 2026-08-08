import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { eq, and, gt } from "drizzle-orm";
import { getDb } from "./queries/connection";
import { sessions, users, type User } from "@db/schema";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  /** 通过 X-Session-Token 识别的当前登录用户；未登录为 null */
  user: User | null;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  let user: User | null = null;
  const token = opts.req.headers.get("x-session-token");
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    try {
      const db = getDb();
      const now = new Date();
      const session = await db.query.sessions.findFirst({
        where: and(eq(sessions.token, token), gt(sessions.expiresAt, now)),
      });
      if (session) {
        user =
          (await db.query.users.findFirst({ where: eq(users.id, session.userId) })) ?? null;
      }
    } catch {
      user = null;
    }
  }
  return { req: opts.req, resHeaders: opts.resHeaders, user };
}
