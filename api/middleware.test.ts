import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./context";
import { adminQuery, createRouter, privateQuery, publicQuery } from "./middleware";

function makeContext(user: TrpcContext["user"] = null): TrpcContext {
  return {
    req: new Request("http://localhost/test"),
    resHeaders: new Headers(),
    user,
  };
}

function makeUser(id: number, role: "user" | "admin") {
  return {
    id,
    role,
  } as NonNullable<TrpcContext["user"]>;
}

const guardRouter = createRouter({
  open: publicQuery.query(() => "ok"),
  signedIn: privateQuery.query(({ ctx }) => ({
    id: ctx.user.id,
    role: ctx.user.role,
  })),
  adminOnly: adminQuery.query(({ ctx }) => ({
    id: ctx.user.id,
    role: ctx.user.role,
  })),
});

describe("tRPC auth guards", () => {
  it("keeps public queries available to anonymous callers", async () => {
    const caller = guardRouter.createCaller(makeContext());

    await expect(caller.open()).resolves.toBe("ok");
  });

  it("rejects anonymous callers on private queries", async () => {
    const caller = guardRouter.createCaller(makeContext());

    await expect(caller.signedIn()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "请先登录",
    });
  });

  it("passes the authenticated user through private queries", async () => {
    const caller = guardRouter.createCaller(makeContext(makeUser(101, "user")));

    await expect(caller.signedIn()).resolves.toEqual({
      id: 101,
      role: "user",
    });
  });

  it("rejects anonymous callers on admin queries before role checks", async () => {
    const caller = guardRouter.createCaller(makeContext());

    await expect(caller.adminOnly()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "请先登录",
    });
  });

  it("rejects signed-in non-admin users on admin queries", async () => {
    const caller = guardRouter.createCaller(makeContext(makeUser(102, "user")));

    await expect(caller.adminOnly()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "需要管理员权限",
    });
  });

  it("allows admin users through admin queries", async () => {
    const caller = guardRouter.createCaller(makeContext(makeUser(103, "admin")));

    await expect(caller.adminOnly()).resolves.toEqual({
      id: 103,
      role: "admin",
    });
  });
});
