import { useState } from "react";
import { useUser } from "@/hooks/useUser";
import { trpc } from "@/providers/trpc";
import { Seal } from "@/components/ink/Seal";
import { safeStorage } from "@/lib/safeStorage";

export const GUEST_KEY = "ky_guest_mode";

/** 游客模式：顶栏「签到」按钮清掉此标记即可唤回闸门 */
export function dismissGate() {
  safeStorage.set(GUEST_KEY, "1");
}
export function recallGate() {
  safeStorage.remove(GUEST_KEY);
}

type Mode = "login" | "register" | "recover";

/** 账号闸门：登录 / 注册（含密保） / 找回密码；注册闸口由管理员控制 */
export function ProfileGate() {
  const { user, ready, login, register, getRecoveryQuestion, recover } = useUser();
  const { data: siteInfo } = trpc.auth.siteInfo.useQuery(undefined, { staleTime: 60_000 });
  const registrationOpen = siteInfo?.registrationOpen !== false;
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [recQ, setRecQ] = useState("");
  const [recA, setRecA] = useState("");
  const [fetchedQ, setFetchedQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [guest, setGuest] = useState(() => safeStorage.get(GUEST_KEY) === "1");

  if (!ready || user || guest) return null;

  const reset = (m: Mode) => {
    setMode(m);
    setErr("");
    setPassword("");
    setPassword2("");
    setFetchedQ("");
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "操作失败，请再试一次");
    } finally {
      setBusy(false);
    }
  };

  const submitLogin = () =>
    run(async () => {
      if (!name.trim() || !password) throw new Error("请输入昵称和密码");
      await login(name.trim(), password);
    });

  const submitRegister = () =>
    run(async () => {
      if (!name.trim()) throw new Error("请输入昵称");
      if (password.length < 6) throw new Error("密码至少 6 位");
      if (password !== password2) throw new Error("两次输入的密码不一致");
      if (!recQ.trim() || !recA.trim()) throw new Error("请设置密保问题和答案（忘记密码时靠它找回）");
      await register({
        name: name.trim(),
        password,
        recoveryQuestion: recQ.trim(),
        recoveryAnswer: recA.trim(),
      });
    });

  const fetchQuestion = () =>
    run(async () => {
      if (!name.trim()) throw new Error("先输入你的昵称");
      const q = await getRecoveryQuestion(name.trim());
      setFetchedQ(q);
    });

  const submitRecover = () =>
    run(async () => {
      if (!fetchedQ) throw new Error("请先获取密保问题");
      if (!recA.trim()) throw new Error("请输入密保答案");
      if (password.length < 6) throw new Error("新密码至少 6 位");
      await recover(name.trim(), recA.trim(), password);
    });

  return (
    <div className="tour-mask">
      <div className="tour-card text-left">
        <div className="flex flex-col items-center mb-5">
          <Seal size={72} seed="gate" text="考研传统阅读" center="名" />
          <h1 className="text-[22px] font-bold mt-3">
            {mode === "login" && "开卷之前，先签到"}
            {mode === "register" && "立下你的名号"}
            {mode === "recover" && "密保找回"}
          </h1>
        </div>

        {/* 选项卡 */}
        <div className="flex border border-[var(--line)] rounded-[2px] overflow-hidden mb-5 text-[14px]">
          {(["login", "register", "recover"] as Mode[]).map((m) => {
            const disabled = m === "register" && !registrationOpen;
            return (
              <button
                key={m}
                onClick={() => !disabled && reset(m)}
                disabled={disabled}
                title={disabled ? "管理员已关闭新用户注册" : undefined}
                className={`flex-1 py-2 ${disabled ? "opacity-40 cursor-not-allowed" : mode === m ? "bg-[var(--ink)] text-[var(--paper)] font-bold" : "hover:bg-[var(--paper-deep)]"}`}
              >
                {m === "login" ? "登录" : m === "register" ? "注册" : "忘记密码"}
              </button>
            );
          })}
        </div>
        {!registrationOpen && mode !== "register" && (
          <p className="text-[12.5px] text-[var(--vermilion)] mb-3 -mt-2">本站已关闭新用户注册，仅已有账号可登录。</p>
        )}

        <div className="space-y-3">
          <input
            className="ink-input text-[16px]"
            placeholder="昵称"
            value={name}
            maxLength={32}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />

          {mode === "login" && (
            <input
              className="ink-input text-[16px]"
              type="password"
              placeholder="密码"
              value={password}
              maxLength={64}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitLogin()}
            />
          )}

          {mode === "register" && (
            <>
              <input
                className="ink-input text-[16px]"
                type="password"
                placeholder="密码（至少 6 位）"
                value={password}
                maxLength={64}
                onChange={(e) => setPassword(e.target.value)}
              />
              <input
                className="ink-input text-[16px]"
                type="password"
                placeholder="再输一遍密码"
                value={password2}
                maxLength={64}
                onChange={(e) => setPassword2(e.target.value)}
              />
              <div className="border border-[var(--line)] rounded-[2px] p-3 bg-[var(--paper-deep)]/50">
                <div className="meta-label mb-2">密保设置 · 忘记密码时用它找回</div>
                <input
                  className="ink-input text-[15px] mb-2"
                  placeholder="密保问题，如：我的高中班主任姓什么？"
                  value={recQ}
                  maxLength={128}
                  onChange={(e) => setRecQ(e.target.value)}
                />
                <input
                  className="ink-input text-[15px]"
                  placeholder="密保答案（请记牢，答案不区分大小写和空格）"
                  value={recA}
                  maxLength={64}
                  onChange={(e) => setRecA(e.target.value)}
                />
              </div>
            </>
          )}

          {mode === "recover" && (
            <>
              {!fetchedQ ? (
                <p className="text-[13px] text-[var(--ink-3)] leading-relaxed">
                  输入昵称后点「获取密保问题」，答对预设的密保答案即可重设密码。
                </p>
              ) : (
                <>
                  <div className="border-l-2 border-[var(--vermilion)] pl-3 py-1 text-[15px]">
                    <span className="meta-label mr-2">密保问题</span>
                    {fetchedQ}
                  </div>
                  <input
                    className="ink-input text-[16px]"
                    placeholder="你的密保答案"
                    value={recA}
                    maxLength={64}
                    onChange={(e) => setRecA(e.target.value)}
                  />
                  <input
                    className="ink-input text-[16px]"
                    type="password"
                    placeholder="新密码（至少 6 位）"
                    value={password}
                    maxLength={64}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </>
              )}
            </>
          )}
        </div>

        {err && <div className="text-[13px] text-[var(--vermilion)] mt-3">{err}</div>}

        <button
          onClick={
            mode === "login" ? submitLogin : mode === "register" ? submitRegister : fetchedQ ? submitRecover : fetchQuestion
          }
          disabled={busy}
          className="w-full mt-5 py-3 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow text-[16px] disabled:opacity-50"
        >
          {busy
            ? "落笔中…"
            : mode === "login"
              ? "登录，开始研习"
              : mode === "register"
                ? "注册并开始研习"
                : fetchedQ
                  ? "重设密码并登录"
                  : "获取密保问题"}
        </button>

        <p className="text-[12px] text-[var(--ink-3)] mt-4 text-center leading-relaxed">
          密码与密保答案均加密存储，本站不保存明文。练习记录、错题本、生词本全部归属你的账号。
        </p>

        <button
          onClick={() => { dismissGate(); setGuest(true); }}
          className="w-full mt-3 py-2 text-[13px] text-[var(--ink-3)] border border-dashed border-[var(--line)] rounded-[2px] hover:border-[var(--ink-2)] hover:text-[var(--ink-2)]"
        >
          先随便逛逛（SOP 图谱、指南、真题文章都能看；交卷解析时再签到）
        </button>
      </div>
    </div>
  );
}
