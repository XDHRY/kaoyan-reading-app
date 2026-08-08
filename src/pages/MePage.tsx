import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useUser } from "@/hooks/useUser";
import { BrushTitle } from "@/components/ink/decor";
import { Seal } from "@/components/ink/Seal";
import { FeedbackForm } from "@/components/FeedbackForm";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ink-card p-5 md:p-6">
      <h2 className="text-[17px] font-bold mb-4 border-l-2 border-[var(--vermilion)] pl-3">{title}</h2>
      {children}
    </section>
  );
}

interface SrcRow {
  sessions: number;
  questions: number;
  correct: number;
  accuracy: number;
  recent7dAccuracy: number | null;
  recent7dQuestions: number;
}

function Msg({ err, ok }: { err: string; ok: string }) {
  if (err) return <div className="text-[13px] text-[var(--vermilion)] mt-2">{err}</div>;
  if (ok) return <div className="text-[13px] text-[var(--jade,#2f7d5a)] mt-2">{ok}</div>;
  return null;
}

/** 解析折叠偏好开关：auto=默认折叠 / manual=默认展开，立即保存 */
function CollapsePrefSwitch() {
  const utils = trpc.useUtils();
  const { user } = useUser();
  const { data } = trpc.agent.getPref.useQuery({ key: "analysis_collapse" }, { enabled: !!user });
  const setPref = trpc.agent.setPref.useMutation({
    onSuccess: () => {
      utils.agent.getPref.invalidate({ key: "analysis_collapse" });
    },
  });
  const cur = data?.value === "auto" ? "auto" : "manual";
  return (
    <div className="flex gap-2">
      {([
        ["manual", "默认展开（一次看全）"],
        ["auto", "默认折叠（点题再看）"],
      ] as const).map(([v, l]) => (
        <button
          key={v}
          disabled={setPref.isPending}
          onClick={() => setPref.mutate({ key: "analysis_collapse", value: v })}
          className={`px-4 py-2 text-[14px] border rounded-[2px] disabled:opacity-50 ${
            cur === v ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)]"
          }`}
        >
          {l}
        </button>
      ))}
      {setPref.isSuccess && <span className="text-[12.5px] text-[var(--bamboo)] self-center">已保存</span>}
    </div>
  );
}

export default function MePage() {
  const { user, applyUser, logout } = useUser();
  const utils = trpc.useUtils();
  const { data: stats } = trpc.agent.stats.useQuery(undefined, { enabled: !!user });
  const { data: vocabCount } = trpc.vocab.list.useQuery(undefined, { enabled: !!user });

  const [name, setName] = useState(user?.name ?? "");
  const [avatarChar, setAvatarChar] = useState(user?.avatarChar ?? "");
  const [p1, setP1] = useState({ err: "", ok: "" });
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [p2, setP2] = useState({ err: "", ok: "" });
  const [pwdForRec, setPwdForRec] = useState("");
  const [recQ, setRecQ] = useState("");
  const [recA, setRecA] = useState("");
  const [p3, setP3] = useState({ err: "", ok: "" });
  const [delPwd, setDelPwd] = useState("");
  const [p4, setP4] = useState({ err: "", ok: "" });
  const [confirmDel, setConfirmDel] = useState(false);

  if (!user) return null;

  const saveProfile = async () => {
    setP1({ err: "", ok: "" });
    try {
      const r = await utils.client.auth.updateProfile.mutate({
        name: name.trim() || undefined,
        avatarChar: avatarChar.trim() || undefined,
      });
      applyUser({ id: r.user.id, name: r.user.name, avatarChar: r.user.avatarChar, hasRecovery: r.user.hasRecovery, role: r.user.role });
      setP1({ err: "", ok: "已保存" });
    } catch (e) {
      setP1({ err: e instanceof Error ? e.message : "保存失败", ok: "" });
    }
  };

  const changePwd = async () => {
    setP2({ err: "", ok: "" });
    try {
      await utils.client.auth.changePassword.mutate({ oldPassword: oldPwd, newPassword: newPwd });
      setOldPwd(""); setNewPwd("");
      setP2({ err: "", ok: "密码已更新" });
    } catch (e) {
      setP2({ err: e instanceof Error ? e.message : "修改失败", ok: "" });
    }
  };

  const changeRecovery = async () => {
    setP3({ err: "", ok: "" });
    try {
      await utils.client.auth.changeRecovery.mutate({
        password: pwdForRec,
        recoveryQuestion: recQ.trim(),
        recoveryAnswer: recA.trim(),
      });
      setPwdForRec(""); setRecQ(""); setRecA("");
      setP3({ err: "", ok: "密保已更新" });
    } catch (e) {
      setP3({ err: e instanceof Error ? e.message : "修改失败", ok: "" });
    }
  };

  const exportData = async () => {
    try {
      const data = await utils.client.auth.exportData.query();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `考研阅读-${user.name}-数据导出-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      /* 忽略 */
    }
  };

  const deleteAccount = async () => {
    setP4({ err: "", ok: "" });
    try {
      await utils.client.auth.deleteAccount.mutate({ password: delPwd });
      await logout();
    } catch (e) {
      setP4({ err: e instanceof Error ? e.message : "注销失败", ok: "" });
    }
  };

  const statCards = [
    { label: "完成篇章", value: stats?.donePassages ?? 0 },
    { label: "累计做题", value: stats?.totalQuestions ?? 0 },
    { label: "生词收录", value: vocabCount?.length ?? 0 },
    { label: "待攻克错题", value: stats?.wrongOpen ?? 0 },
  ];

  return (
    <div className="max-w-[860px] mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Seal size={64} seed={`me-${user.id}`} text="个人中心" center={user.avatarChar || user.name.charAt(0)} />
        <div>
          <BrushTitle as="h1" className="text-[30px]">个人中心</BrushTitle>
          <p className="meta-label mt-1">ACCOUNT · {user.name}</p>
        </div>
      </div>

      {/* 数据概览（主模块：真题+AI 生题综合） */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <div key={s.label} className="ink-card p-4 text-center">
            <div className="text-[28px] font-bold text-[var(--vermilion)]">{s.value}</div>
            <div className="meta-label mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* 分源评估：真题 / AI 生题 两个子模块 */}
      {(stats as { bySource?: { exam: SrcRow; generated: SrcRow } } | undefined)?.bySource && (
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ["真题", (stats as unknown as { bySource: { exam: SrcRow } }).bySource.exam],
              ["AI 生题", (stats as unknown as { bySource: { generated: SrcRow } }).bySource.generated],
            ] as [string, SrcRow][]
          ).map(([label, s]) => (
            <div key={label} className="ink-card p-4">
              <div className="meta-label mb-2">{label}正确率</div>
              {s.sessions === 0 ? (
                <p className="text-[12.5px] text-[var(--ink-3)]">尚无交卷记录</p>
              ) : (
                <>
                  <div className="text-[24px] font-bold font-['Georgia']">
                    {s.accuracy}%
                    <span className="text-[12.5px] font-normal text-[var(--ink-3)] ml-2">
                      {s.correct}/{s.questions} 题 · {s.sessions} 次交卷
                    </span>
                  </div>
                  <div className="text-[12px] text-[var(--ink-3)] mt-1">
                    近 7 天 {s.recent7dAccuracy === null ? "无判分" : `${s.recent7dAccuracy}%（${s.recent7dQuestions} 题）`}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 资料 */}
      <Section title="名号与印">
        <div className="grid md:grid-cols-2 gap-3">
          <label className="block">
            <span className="meta-label">昵称</span>
            <input className="ink-input mt-1" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="meta-label">头像字（一个汉字最佳）</span>
            <input className="ink-input mt-1" value={avatarChar} maxLength={2} onChange={(e) => setAvatarChar(e.target.value)} />
          </label>
        </div>
        <button onClick={saveProfile} className="mt-4 px-5 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow text-[14px]">
          保存资料
        </button>
        <Msg err={p1.err} ok={p1.ok} />
      </Section>

      {/* 密码 */}
      <Section title="修改密码">
        <div className="grid md:grid-cols-2 gap-3">
          <input className="ink-input" type="password" placeholder="原密码" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} />
          <input className="ink-input" type="password" placeholder="新密码（至少 6 位）" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
        </div>
        <button onClick={changePwd} disabled={!oldPwd || newPwd.length < 6} className="mt-4 px-5 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow text-[14px] disabled:opacity-50">
          更新密码
        </button>
        <Msg err={p2.err} ok={p2.ok} />
      </Section>

      {/* 密保 */}
      <Section title="密保问题（找回密码的钥匙）">
        <div className="space-y-3">
          <input className="ink-input" type="password" placeholder="当前密码（验证身份）" value={pwdForRec} onChange={(e) => setPwdForRec(e.target.value)} />
          <input className="ink-input" placeholder="新的密保问题" value={recQ} maxLength={128} onChange={(e) => setRecQ(e.target.value)} />
          <input className="ink-input" placeholder="新的密保答案" value={recA} maxLength={64} onChange={(e) => setRecA(e.target.value)} />
        </div>
        <button onClick={changeRecovery} disabled={!pwdForRec || recQ.trim().length < 2 || !recA.trim()} className="mt-4 px-5 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow text-[14px] disabled:opacity-50">
          更新密保
        </button>
        <Msg err={p3.err} ok={p3.ok} />
      </Section>

      {/* 解析面板折叠偏好 */}
      <Section title="解析面板折叠">
        <p className="text-[13px] text-[var(--ink-3)] leading-relaxed mb-3">
          控制练习页里每题「AI 教练解析」框的默认状态（任何时候都可以点击展开/收起）。
        </p>
        <CollapsePrefSwitch />
      </Section>

      {/* 反馈与工单 */}
      <Section title="反馈与工单">
        <FeedbackForm />
      </Section>

      {/* 学习档案入口 */}
      <Section title="学习档案">
        <p className="text-[13px] text-[var(--ink-3)] leading-relaxed mb-3">
          你的每一次交卷记录、对错明细与完整 AI 解析都收在档案馆里，可随时载入回味。
        </p>
        <Link to="/history" className="inline-block px-5 py-2 border border-[var(--ink)] rounded-[2px] text-[14px] hover:bg-[var(--paper-deep)]">
          打开学习档案 →
        </Link>
      </Section>

      {/* 数据 */}
      <Section title="我的数据">
        <p className="text-[13px] text-[var(--ink-3)] leading-relaxed mb-3">
          导出生词本、错题本、练习记录、个人提示词与绑定配置（JSON 格式，可自行备份）。
        </p>
        <button onClick={exportData} className="px-5 py-2 border border-[var(--ink)] rounded-[2px] text-[14px] hover:bg-[var(--paper-deep)]">
          导出全部数据
        </button>
      </Section>

      {/* 注销 */}
      <Section title="危险区">
        {!confirmDel ? (
          <button onClick={() => setConfirmDel(true)} className="px-5 py-2 border border-[var(--vermilion)] text-[var(--vermilion)] rounded-[2px] text-[14px]">
            注销账号…
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-[var(--vermilion)]">注销将永久删除账号及全部练习记录、错题、生词，不可恢复。</p>
            <input className="ink-input" type="password" placeholder="输入密码确认注销" value={delPwd} onChange={(e) => setDelPwd(e.target.value)} />
            <div className="flex gap-3">
              <button onClick={deleteAccount} disabled={!delPwd} className="px-5 py-2 bg-[var(--vermilion)] text-[var(--paper)] rounded-[2px] text-[14px] disabled:opacity-50">
                确认注销
              </button>
              <button onClick={() => { setConfirmDel(false); setDelPwd(""); }} className="px-5 py-2 border border-[var(--line)] rounded-[2px] text-[14px]">
                取消
              </button>
            </div>
            <Msg err={p4.err} ok={p4.ok} />
          </div>
        )}
      </Section>
    </div>
  );
}
