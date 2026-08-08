import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useUser } from "@/hooks/useUser";
import { BrushTitle, PaperCard } from "@/components/ink/decor";
import { Seal } from "@/components/ink/Seal";

type Tab = "overview" | "tickets" | "users" | "settings" | "clauses";

interface UserRow {
  id: number;
  name: string;
  avatarChar: string;
  role: "user" | "admin";
  hasRecovery: boolean;
  createdAt: Date;
  stats: { records: number; wrong: number; vocab: number; lastActive: Date | null };
}

export default function AdminPage() {
  const { user, ready } = useUser();
  const [tab, setTab] = useState<Tab>("overview");

  if (!ready) {
    return <div className="py-20 text-center text-[14px] text-[var(--ink-3)]">核验身份中…</div>;
  }
  if (user?.role !== "admin") {
    return (
      <PaperCard className="max-w-[560px] mx-auto p-12 text-center">
        <Seal size={72} seed="admin-deny" center="禁" />
        <p className="mt-4 font-bold text-[17px]">需要管理员权限</p>
        <p className="text-[14px] text-[var(--ink-3)] mt-2">此区域仅站长可入。</p>
      </PaperCard>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="mb-6">
        <div className="meta-label mb-2">ADMIN · 掌门云台</div>
        <h1 className="text-[32px] font-black">
          <BrushTitle vermilion>管理中心</BrushTitle>
        </h1>
      </div>
      <div className="flex gap-2 mb-6 flex-wrap">
        {([["overview", "全站总览"], ["tickets", "工单处理"], ["users", "用户治理"], ["settings", "站点闸口"], ["clauses", "知识库条款"]] as [Tab, string][]).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-[14.5px] border rounded-[2px] ${tab === k ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--ink-2)]"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab />}
      {tab === "tickets" && <TicketsAdminTab />}
      {tab === "users" && <UsersTab me={user!} />}
      {tab === "settings" && <SettingsTab />}
      {tab === "clauses" && <ClausesTab />}
    </div>
  );
}

/* ————— 全站总览 ————— */
function OverviewTab() {
  const { data } = trpc.admin.overview.useQuery(undefined, { refetchInterval: 15000 });
  const { data: clauses } = trpc.method.clauses.useQuery(undefined, { staleTime: Infinity });
  const clauseTitle = useMemo(
    () => new Map((clauses ?? []).map((c) => [c.clauseId, c.title])),
    [clauses],
  );
  if (!data) return <p className="text-[var(--ink-3)]">载入中……</p>;
  const cards: [string, number][] = [
    ["注册用户", data.totals.users],
    ["做题记录", data.totals.practiceRecords],
    ["错题条目", data.totals.wrongItems],
    ["生词条目", data.totals.vocabItems],
    ["模型节点", data.totals.channels],
    ["AI 生成套题", data.totals.generatedSets],
    ["解析存档", data.totals.analyses],
    ["方法条款", data.totals.methodClauses],
  ];
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map(([l, v]) => (
          <PaperCard key={l} className="p-4">
            <div className="meta-label">{l}</div>
            <div className="text-[26px] font-black mt-1">{v}</div>
          </PaperCard>
        ))}
      </div>

      <PaperCard className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="meta-label">解析任务 · PIPELINE JOBS</div>
          <div className="text-[13px] text-[var(--ink-3)]">
            共 {data.jobs.total} 个 · <span className={data.jobs.failed > 0 ? "text-[var(--vermilion)] font-bold" : ""}>失败 {data.jobs.failed}</span>
          </div>
        </div>
        <div className="space-y-1.5">
          {data.jobs.recent.map((j) => (
            <div key={j.id} className="flex items-center gap-3 flex-wrap border border-[var(--line)] px-3 py-2 rounded-[2px] text-[13px]">
              <span className="font-mono">#{j.id}</span>
              <span className={j.status === "done" ? "text-[var(--bamboo)]" : j.status === "error" ? "text-[var(--vermilion)] font-bold" : "text-[var(--ink-2)]"}>
                {j.status === "done" ? "✓ 完成" : j.status === "error" ? "✗ 失败" : "▸ 运行中"}
              </span>
              <span>{j.kind === "exam" ? "真题" : "生成题"} #{j.refId}</span>
              <span className="text-[var(--ink-3)]">用户 #{j.userId ?? "—"}</span>
              <span className="text-[var(--ink-3)]">{new Date(j.createdAt).toLocaleString("zh-CN")}</span>
              {j.errorMsg && <span className="text-[var(--vermilion)] text-[12px] truncate max-w-[280px]">{j.errorMsg}</span>}
            </div>
          ))}
          {data.jobs.recent.length === 0 && <p className="text-[13.5px] text-[var(--ink-3)]">暂无任务。</p>}
        </div>
      </PaperCard>

      <PaperCard className="p-5">
        <div className="meta-label mb-3">方法条款热度 · AI 最常引用的笔记条款 TOP15</div>
        <div className="space-y-1.5">
          {data.clauseHot.map((h) => (
            <div key={h.clauseId} className="flex items-center gap-3 text-[13.5px]">
              <span className="font-mono text-[12px] w-20 shrink-0">{h.clauseId}</span>
              <span className="flex-1 truncate">{clauseTitle.get(h.clauseId) ?? ""}</span>
              <span className="flex items-center gap-2">
                <span className="inline-block h-2 bg-[var(--vermilion)]/70" style={{ width: `${Math.min(120, h.count * 12)}px` }} />
                <b>{h.count}</b>
              </span>
            </div>
          ))}
          {data.clauseHot.length === 0 && <p className="text-[13.5px] text-[var(--ink-3)]">解析产生引用后自动统计。</p>}
        </div>
      </PaperCard>
    </div>
  );
}

/* ————— 用户治理 ————— */
function UsersTab({ me }: { me: { id: number } }) {
  const utils = trpc.useUtils();
  const { data: rows } = trpc.admin.listUsers.useQuery();
  const [expanded, setExpanded] = useState<number | null>(null);
  const [pwdFor, setPwdFor] = useState<number | null>(null);
  const [newPwd, setNewPwd] = useState("");
  const [msg, setMsg] = useState("");

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    try {
      await fn();
      setMsg(okMsg);
      setTimeout(() => setMsg(""), 2500);
      utils.admin.listUsers.invalidate();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-3">
      {msg && <p className="text-[13.5px] text-[var(--bamboo)] font-bold">{msg}</p>}
      {((rows ?? []) as UserRow[]).map((u) => (
        <PaperCard key={u.id} className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="w-9 h-9 rounded-full bg-[var(--ink)] text-[var(--paper)] flex items-center justify-center font-bold">
              {u.avatarChar || u.name.slice(0, 1)}
            </span>
            <div className="min-w-[140px]">
              <b className="text-[15.5px]">{u.name}</b>
              {u.role === "admin" && <span className="ml-2 text-[11px] px-1.5 py-0.5 bg-[var(--vermilion)] text-[var(--paper)] rounded-[2px]">管理员</span>}
              <div className="text-[12px] text-[var(--ink-3)]">#{u.id} · 注册于 {new Date(u.createdAt).toLocaleDateString("zh-CN")}</div>
            </div>
            <div className="text-[12.5px] text-[var(--ink-3)] flex-1">
              练习 {u.stats.records} · 错题 {u.stats.wrong} · 生词 {u.stats.vocab}
              {u.stats.lastActive && <> · 最近活跃 {new Date(u.stats.lastActive).toLocaleDateString("zh-CN")}</>}
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setExpanded(expanded === u.id ? null : u.id)} className="px-3 py-1.5 text-[13px] border border-[var(--line)] rounded-[2px] hover:border-[var(--ink-2)]">
                {expanded === u.id ? "收起" : "治理"}
              </button>
            </div>
          </div>

          {expanded === u.id && (
            <div className="mt-4 pt-4 border-t border-[var(--line)] space-y-3">
              <div className="flex gap-2 flex-wrap">
                <RenameButton u={u} onDone={(m) => setMsg(m)} />
                <button
                  onClick={() => act(() => utils.client.admin.updateUser.mutate({ id: u.id, role: u.role === "admin" ? "user" : "admin" }), "角色已更新")}
                  disabled={u.id === me.id && u.role === "admin"}
                  className="px-3 py-1.5 text-[13px] border border-[var(--line)] rounded-[2px] hover:border-[var(--ink-2)] disabled:opacity-40"
                >
                  {u.role === "admin" ? "降为普通用户" : "提拔为管理员"}
                </button>
                <button onClick={() => { setPwdFor(pwdFor === u.id ? null : u.id); setNewPwd(""); }} className="px-3 py-1.5 text-[13px] border border-[var(--line)] rounded-[2px] hover:border-[var(--ink-2)]">
                  重设密码
                </button>
                <button
                  onClick={() => {
                    const q = prompt("新的密保问题（留空取消）：");
                    if (!q) return;
                    const a = prompt("新的密保答案：");
                    if (!a) return;
                    void act(() => utils.client.admin.resetUserRecovery.mutate({ id: u.id, question: q, answer: a }), "密保已重设");
                  }}
                  className="px-3 py-1.5 text-[13px] border border-[var(--line)] rounded-[2px] hover:border-[var(--ink-2)]"
                >
                  重设密保
                </button>
                <button
                  onClick={() => {
                    void utils.client.admin.viewUserData.query({ id: u.id }).then((d) => {
                      alert(
                        `用户 #${u.id} ${u.name} 数据明细：\n` +
                        `生词 ${d.vocab.length} 条 · 错题 ${d.wrongItems.length} 条 · 练习记录 ${d.practiceRecords.length} 条\n` +
                        `个人提示词 ${d.prompts.length} 条 · 个人绑定 ${d.bindings.length} 条`,
                      );
                    });
                  }}
                  className="px-3 py-1.5 text-[13px] border border-[var(--line)] rounded-[2px] hover:border-[var(--ink-2)]"
                >
                  查看数据
                </button>
                <button
                  onClick={() => {
                    if (confirm(`清空 ${u.name} 的学习数据（生词/错题/练习记录）？账号保留。`)) {
                      void act(() => utils.client.admin.clearUserData.mutate({ id: u.id }), "数据已清空");
                    }
                  }}
                  className="px-3 py-1.5 text-[13px] border border-[var(--vermilion)]/60 text-[var(--vermilion)] rounded-[2px]"
                >
                  清空数据
                </button>
                {u.id !== me.id && (
                  <button
                    onClick={() => {
                      if (confirm(`彻底注销 ${u.name}？账号与全部数据删除，不可恢复。`)) {
                        void act(() => utils.client.admin.deleteUser.mutate({ id: u.id }), "用户已注销");
                      }
                    }}
                    className="px-3 py-1.5 text-[13px] bg-[var(--vermilion)] text-[var(--paper)] rounded-[2px]"
                  >
                    注销账号
                  </button>
                )}
              </div>
              {pwdFor === u.id && (
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    placeholder="新密码（至少 6 位）"
                    className="bg-transparent border border-[var(--line)] rounded-[2px] px-3 py-1.5 text-[14px] outline-none focus:border-[var(--ink-2)]"
                  />
                  <button
                    onClick={() => {
                      if (newPwd.length < 6) return alert("至少 6 位");
                      void act(async () => {
                        await utils.client.admin.resetUserPassword.mutate({ id: u.id, newPassword: newPwd });
                        setPwdFor(null);
                      }, "密码已重设，该用户全部会话已下线");
                    }}
                    className="px-3 py-1.5 text-[13px] bg-[var(--ink)] text-[var(--paper)] rounded-[2px]"
                  >
                    确认重设
                  </button>
                </div>
              )}
            </div>
          )}
        </PaperCard>
      ))}
    </div>
  );
}

function RenameButton({ u, onDone }: { u: UserRow; onDone: (m: string) => void }) {
  const utils = trpc.useUtils();
  return (
    <button
      onClick={() => {
        const name = prompt(`修改昵称（当前：${u.name}）：`);
        if (!name || name === u.name) return;
        const avatarChar = prompt("头像字（1 个汉字，留空不变）：") || undefined;
        void utils.client.admin.updateUser
          .mutate({ id: u.id, name, ...(avatarChar ? { avatarChar } : {}) })
          .then(() => { onDone("昵称已更新"); utils.admin.listUsers.invalidate(); })
          .catch((e) => alert(e instanceof Error ? e.message : String(e)));
      }}
      className="px-3 py-1.5 text-[13px] border border-[var(--line)] rounded-[2px] hover:border-[var(--ink-2)]"
    >
      改昵称/头像
    </button>
  );
}

/* ————— 站点闸口 ————— */
function SettingsTab() {
  const utils = trpc.useUtils();
  const { data: settings } = trpc.admin.getSettings.useQuery();
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const open = (settings?.registration_open ?? "1") !== "0";
  const ann = announcement ?? settings?.announcement ?? "";

  const save = async (k: string, v: string) => {
    await utils.client.admin.setSetting.mutate({ k, v });
    utils.admin.getSettings.invalidate();
    utils.auth.siteInfo.invalidate();
  };

  return (
    <div className="space-y-5 max-w-[720px]">
      <PaperCard frame className="p-6">
        <div className="meta-label mb-2">REGISTRATION GATE · 注册闸口</div>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[15px] font-bold">{open ? "新用户注册：开放中" : "新用户注册：已关闭"}</p>
            <p className="text-[13px] text-[var(--ink-3)] mt-1">关闭后，注册页不再接受新账号，已有用户登录不受影响。</p>
          </div>
          <button
            onClick={() => void save("registration_open", open ? "0" : "1")}
            className={`px-5 py-2.5 rounded-[2px] text-[14.5px] font-bold ${open ? "bg-[var(--vermilion)] text-[var(--paper)]" : "bg-[var(--bamboo)] text-[var(--paper)]"}`}
          >
            {open ? "立即关闭注册" : "重新开放注册"}
          </button>
        </div>
      </PaperCard>

      <PaperCard className="p-6">
        <div className="meta-label mb-2">ANNOUNCEMENT · 全站公告</div>
        <textarea
          value={ann}
          onChange={(e) => setAnnouncement(e.target.value)}
          rows={3}
          placeholder="留空则不显示公告"
          className="w-full bg-transparent border border-[var(--line)] rounded-[2px] px-3 py-2 text-[14.5px] outline-none focus:border-[var(--ink-2)]"
        />
        <button
          onClick={() => void save("announcement", ann)}
          className="mt-3 px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] text-[14px]"
        >
          发布公告
        </button>
        <p className="text-[12.5px] text-[var(--ink-3)] mt-2">公告会显示在首页顶部，所有访客可见。</p>
      </PaperCard>
    </div>
  );
}

/* ————— 知识库条款 ————— */
function ClausesTab() {
  const utils = trpc.useUtils();
  const { data: clauses } = trpc.method.clauses.useQuery();
  const [editId, setEditId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const save = async () => {
    if (!editId) return;
    await utils.client.admin.updateClause.mutate({ clauseId: editId, title, content });
    setEditId(null);
    utils.method.clauses.invalidate();
  };

  return (
    <div className="space-y-2">
      <p className="text-[13.5px] text-[var(--ink-3)] mb-3">
        条款是 AI 教练团的方法论知识源，改动即时生效于下一次解析。
      </p>
      {(clauses ?? []).map((c) => (
        <PaperCard key={c.clauseId} className="p-4">
          {editId === c.clauseId ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] text-[var(--ink-3)]">{c.clauseId}</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className="flex-1 bg-transparent border border-[var(--line)] rounded-[2px] px-2 py-1 text-[14px] font-bold outline-none" />
              </div>
              <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} className="w-full bg-transparent border border-[var(--line)] rounded-[2px] px-2 py-1.5 text-[13.5px] outline-none" />
              <div className="flex gap-2">
                <button onClick={() => void save()} className="px-3 py-1.5 text-[13px] bg-[var(--ink)] text-[var(--paper)] rounded-[2px]">保存</button>
                <button onClick={() => setEditId(null)} className="px-3 py-1.5 text-[13px] border border-[var(--line)] rounded-[2px]">取消</button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <span className="font-mono text-[12px] text-[var(--ink-3)] w-20 shrink-0 pt-0.5">{c.clauseId}</span>
              <div className="flex-1 min-w-0">
                <b className="text-[14px]">{c.title}</b>
                <p className="text-[13px] text-[var(--ink-3)] mt-0.5 leading-relaxed">{c.content}</p>
              </div>
              <button
                onClick={() => { setEditId(c.clauseId); setTitle(c.title); setContent(c.content); }}
                className="shrink-0 px-3 py-1 text-[12.5px] border border-[var(--line)] rounded-[2px] hover:border-[var(--ink-2)]"
              >
                编辑
              </button>
            </div>
          )}
        </PaperCard>
      ))}
    </div>
  );
}

/* ————— 工单处理台 ————— */
const TICKET_STATUS: [string, string][] = [["all", "全部"], ["open", "待处理"], ["processing", "处理中"], ["resolved", "已解决"], ["closed", "已关闭"]];
const TICKET_KIND: Record<string, string> = { bug: "报错", suggest: "建议", question: "疑问", other: "其他" };

function TicketsAdminTab() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState("open");
  const { data } = trpc.ticket.adminList.useQuery({ status: status as never });
  const [openId, setOpenId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [nextStatus, setNextStatus] = useState<string>("");
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeDigest, setNoticeDigest] = useState("");
  const [noticeBody, setNoticeBody] = useState("");
  const { data: notices, refetch: refetchNotices } = trpc.ticket.notices.useQuery();
  const detailQ = trpc.ticket.detail.useQuery({ id: openId ?? 0 }, { enabled: openId !== null });
  const adminReply = trpc.ticket.adminReply.useMutation({
    onSuccess: () => {
      setReplyText(""); setNextStatus("");
      void detailQ.refetch();
      void utils.ticket.adminList.invalidate();
    },
  });
  const publish = trpc.ticket.publishNotice.useMutation({
    onSuccess: () => { setNoticeTitle(""); setNoticeDigest(""); setNoticeBody(""); void refetchNotices(); void utils.auth.siteInfo.invalidate(); },
  });
  const removeNotice = trpc.ticket.removeNotice.useMutation({ onSuccess: () => { void refetchNotices(); void utils.auth.siteInfo.invalidate(); } });
  const rows = data ?? [];

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-6">
      {/* 左：工单队列 */}
      <div>
        <div className="flex gap-2 mb-4 flex-wrap">
          {TICKET_STATUS.map(([k, l]) => (
            <button key={k} onClick={() => setStatus(k)}
              className={`px-3 py-1 text-[13px] border rounded-[2px] ${status === k ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)]"}`}
            >{l}</button>
          ))}
        </div>
        <div className="space-y-3">
          {rows.map((t) => (
            <PaperCard key={t.id} className="p-4">
              <button className="w-full text-left" onClick={() => { setOpenId(openId === t.id ? null : t.id); setReplyText(""); setNextStatus(""); }}>
                <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
                  <span className="meta-label">#{t.id}</span>
                  <span className="meta-label text-[var(--ink-2)]">{TICKET_KIND[t.kind] ?? t.kind}</span>
                  <span className="meta-label text-[var(--ink-3)]">{t.userName}</span>
                  {t.pageUrl && <span className="meta-label text-[var(--ink-3)]">{t.pageUrl}</span>}
                  <span className="flex-1" />
                  <b className={`text-[12px] ${t.status === "open" ? "text-[var(--vermilion)]" : t.status === "resolved" ? "text-[var(--bamboo)]" : "text-[var(--ink-3)]"}`}>
                    {TICKET_STATUS.find(([k]) => k === t.status)?.[1] ?? t.status}
                  </b>
                </div>
                <p className="font-bold text-[15px] mt-1.5">{t.title}</p>
              </button>

              {openId === t.id && detailQ.data && (
                <div className="mt-3 border-t border-dashed border-[var(--line)] pt-3 space-y-3">
                  <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{detailQ.data.ticket.content}</p>
                  {detailQ.data.ticket.errorText && (
                    <p className="text-[12.5px] border-l-2 border-[var(--vermilion)] pl-2 text-[var(--ink-2)] whitespace-pre-wrap">{detailQ.data.ticket.errorText}</p>
                  )}
                  {detailQ.data.attachments.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {detailQ.data.attachments.map((a) => (
                        <a key={a.id} href={`data:${a.mime};base64,${a.dataBase64}`} target="_blank" rel="noreferrer">
                          <img src={`data:${a.mime};base64,${a.dataBase64}`} alt={a.name} className="h-20 border border-[var(--line)] rounded-[2px]" />
                        </a>
                      ))}
                    </div>
                  )}
                  <p className="text-[11.5px] text-[var(--ink-3)]">
                    页面 {detailQ.data.ticket.pageUrl || "—"} · 视口 {detailQ.data.ticket.viewport} · v{detailQ.data.ticket.appVersion} · {detailQ.data.ticket.userAgent.slice(0, 80)}
                  </p>
                  {(detailQ.data.ticket.consoleErrors as { msg: string }[] | null)?.length ? (
                    <ul className="space-y-0.5">
                      {(detailQ.data.ticket.consoleErrors as { msg: string }[]).map((e, i) => (
                        <li key={i} className="text-[11.5px] text-[var(--vermilion)]">⚑ {e.msg}</li>
                      ))}
                    </ul>
                  ) : null}
                  {detailQ.data.replies.map((r) => (
                    <div key={r.id} className={`border rounded-[2px] p-2.5 text-[13px] ${r.authorRole === "admin" ? "border-[var(--vermilion)]/40" : "border-[var(--line)]"}`}>
                      <span className="text-[11.5px] text-[var(--ink-3)]">{r.authorRole === "admin" ? "掌门" : r.authorName} · {new Date(r.createdAt).toLocaleString("zh-CN")}</span>
                      <p className="mt-0.5 whitespace-pre-wrap">{r.content}</p>
                    </div>
                  ))}
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    rows={2}
                    placeholder="回复用户（可同步流转状态）……"
                    className="w-full border border-[var(--line)] rounded-[2px] px-3 py-2 text-[13.5px] bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)]"
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => adminReply.mutate({ ticketId: t.id, content: replyText.trim(), status: (nextStatus || undefined) as never })}
                      disabled={adminReply.isPending || !replyText.trim()}
                      className="px-4 py-1.5 text-[13px] font-bold bg-[var(--ink)] text-[var(--paper)] rounded-[2px] disabled:opacity-40"
                    >回复</button>
                    {[["processing", "标为处理中"], ["resolved", "标为已解决"], ["closed", "关闭"], ["open", "重开"]].map(([k, l]) => (
                      <button key={k} onClick={() => setNextStatus(nextStatus === k ? "" : k)}
                        className={`px-2.5 py-1 text-[12px] border rounded-[2px] ${nextStatus === k ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)] text-[var(--ink-3)]"}`}
                      >{l}</button>
                    ))}
                  </div>
                </div>
              )}
            </PaperCard>
          ))}
          {rows.length === 0 && <p className="text-center py-10 text-[13.5px] text-[var(--ink-3)]">该状态下没有工单。</p>}
        </div>
      </div>

      {/* 右：发公告 + 历期 */}
      <div className="space-y-4">
        <PaperCard frame className="p-5">
          <div className="meta-label mb-2">NOTICE · 发新一期公告</div>
          <input
            value={noticeTitle}
            onChange={(e) => setNoticeTitle(e.target.value)}
            maxLength={128}
            placeholder="期号标题（如：第五期 · 定制卷上线）"
            className="w-full border border-[var(--line)] rounded-[2px] px-3 py-2 text-[14px] bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)] mb-2"
          />
          <input
            value={noticeDigest}
            onChange={(e) => setNoticeDigest(e.target.value)}
            maxLength={160}
            placeholder="一句话简介（首页横幅与公告榜摘要位；留空则自动从正文提取）"
            className="w-full border border-[var(--line)] rounded-[2px] px-3 py-2 text-[13.5px] bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)] mb-2"
          />
          <textarea
            value={noticeBody}
            onChange={(e) => setNoticeBody(e.target.value)}
            rows={4}
            maxLength={8000}
            placeholder="正文……"
            className="w-full border border-[var(--line)] rounded-[2px] px-3 py-2 text-[13.5px] bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)]"
          />
          <button
            onClick={() => publish.mutate({ title: noticeTitle.trim(), content: noticeBody.trim(), digest: noticeDigest.trim() || undefined })}
            disabled={publish.isPending || noticeTitle.trim().length < 2 || noticeBody.trim().length < 2}
            className="mt-2 px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] text-[13.5px] font-bold disabled:opacity-40"
          >发布并同步首页横幅</button>
          <p className="text-[11.5px] text-[var(--ink-3)] mt-2">每一期都会留在「工单中心 · 公告榜」，用户可逐期回看。</p>
        </PaperCard>
        <div className="space-y-2">
          {(notices ?? []).map((n) => (
            <PaperCard key={n.id} className="p-3.5">
              <div className="flex items-baseline gap-2">
                <b className="text-[13.5px]">{n.title}</b>
                <span className="flex-1" />
                <span className="text-[11px] text-[var(--ink-3)]">{new Date(n.createdAt).toLocaleDateString("zh-CN")}</span>
                <button onClick={() => { if (confirm("撤下这一期？")) removeNotice.mutate({ id: n.id }); }}
                  className="text-[11.5px] text-[var(--vermilion)] underline underline-offset-2">撤下</button>
              </div>
              <p className="text-[12px] text-[var(--ink-3)] mt-1 line-clamp-2">{n.digest || n.content}</p>
            </PaperCard>
          ))}
        </div>
      </div>
    </div>
  );
}
