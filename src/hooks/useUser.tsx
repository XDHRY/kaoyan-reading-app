import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { trpc } from "@/providers/trpc";
import { safeStorage } from "@/lib/safeStorage";

export interface SessionUser {
  id: number;
  name: string;
  avatarChar: string;
  hasRecovery: boolean;
  role: "user" | "admin";
}

interface UserCtx {
  user: SessionUser | null;
  ready: boolean;
  login: (name: string, password: string) => Promise<void>;
  register: (input: {
    name: string;
    password: string;
    recoveryQuestion: string;
    recoveryAnswer: string;
    avatarChar?: string;
  }) => Promise<void>;
  getRecoveryQuestion: (name: string) => Promise<string>;
  recover: (name: string, recoveryAnswer: string, newPassword: string) => Promise<void>;
  applyUser: (u: SessionUser) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<UserCtx | null>(null);
const TOKEN_KEY = "ky_session_token";

export function getSessionToken(): string | null {
  return safeStorage.get(TOKEN_KEY);
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const utils = trpc.useUtils();

  useEffect(() => {
    let alive = true;
    (async () => {
      if (getSessionToken()) {
        try {
          const me = await utils.client.auth.me.query();
          if (alive && me) {
            setUser({ id: me.id, name: me.name, avatarChar: me.avatarChar, hasRecovery: me.hasRecovery, role: me.role });
          } else if (alive) {
            safeStorage.remove(TOKEN_KEY);
          }
        } catch (e) {
          // 仅 401（会话确实失效）才清除 token；网络抖动/5xx 保留登录态，下次自动恢复
          const msg = e instanceof Error ? e.message : "";
          if (alive && /UNAUTHORIZED|401/.test(msg)) safeStorage.remove(TOKEN_KEY);
        }
      }
      if (alive) setReady(true);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adopt = (token: string, u: SessionUser) => {
    safeStorage.set(TOKEN_KEY, token);
    setUser(u);
  };

  const login = async (name: string, password: string) => {
    const r = await utils.client.auth.login.mutate({ name, password });
    adopt(r.token, r.user);
  };

  const register: UserCtx["register"] = async (input) => {
    const r = await utils.client.auth.register.mutate(input);
    adopt(r.token, r.user);
  };

  const getRecoveryQuestion = async (name: string) => {
    const r = await utils.client.auth.recoveryQuestionFor.query({ name });
    return r.question;
  };

  const recover = async (name: string, recoveryAnswer: string, newPassword: string) => {
    const r = await utils.client.auth.resetPassword.mutate({ name, recoveryAnswer, newPassword });
    adopt(r.token, r.user);
  };

  const applyUser = (u: SessionUser) => setUser(u);

  const logout = async () => {
    try {
      await utils.client.auth.logout.mutate();
    } catch {
      /* 忽略 */
    }
    safeStorage.remove(TOKEN_KEY);
    setUser(null);
    utils.invalidate();
  };

  return (
    <Ctx.Provider value={{ user, ready, login, register, getRecoveryQuestion, recover, applyUser, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useUser(): UserCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUser must be used within UserProvider");
  return ctx;
}
