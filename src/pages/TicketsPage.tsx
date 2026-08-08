import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { useUser } from "@/hooks/useUser";
import { useToast } from "@/hooks/useToast";
import { BrushTitle, InkReveal, PaperCard, InkDivider } from "@/components/ink/decor";
import { Seal, StepSeal } from "@/components/ink/Seal";

const KIND_ZH: Record<string, string> = { bug: "报错", suggest: "建议", question: "疑问", other: "其他" };
const STATUS_ZH: Record<string, string> = { open: "待处理", processing: "处理中", resolved: "已解决", closed: "已关闭" };
const STATUS_TONE: Record<string, string> = {
  open: "text-[var(--vermilion)] border-[var(--vermilion)]/50",
  processing: "border-[var(--line)] text-[var(--ink-2)]",
  resolved: "text-[var(--bamboo)] border-[var(--bamboo)]/60",
  closed: "text-[var(--ink-3)] border-[var(--line)]",
};

/** 单张工单的详情：上下文 + 截图 + 对话流 + 处理路线 */
function TicketDetail({ id, onChanged }: { id: number; onChanged: () => void }) {
  const { toast } = useToast();
  const [replyText, setReplyText] = useState("");
  const { data, refetch } = trpc.ticket.detail.useQuery({ id });
  const reply = trpc.ticket.reply.useMutation({
    onSuccess: () => { setReplyText(""); void refetch(); onChanged(); },
    onError: (e) => toast(e.message),
  });
  const close = trpc.ticket.close.useMutation({
    onSuccess: () => { void refetch(); onChanged(); toast("工单已关闭"); },
  });
  if (!data) return <p className="mt-3 text-[13px] text-[var(--ink-3)]">载入工单…</p>;
  const { ticket: t, replies, attachments } = data;
  const log = (t.statusLog as { status: string; at: string; note?: string }[]) ?? [];

  return (
    <div className="mt-4 border-t border-dashed border-[var(--line)] pt-4 space-y-4">
      <p className="text-[14.5px] leading-[1.9] whitespace-pre-wrap">{t.content}</p>

      {(t.locationText || t.errorText) && (
        <div className="space-y-1.5 text-[13px]">
          {t.locationText && <p><b>具体位置：</b><span className="text-[var(--ink-2)]">{t.locationText}</span></p>}
          {t.errorText && (
            <p className="border-l-2 border-[var(--vermilion)] pl-2.5">
              <b className="text-[var(--vermilion)]">报错内容：</b>
              <span className="text-[var(--ink-2)] whitespace-pre-wrap">{t.errorText}</span>
            </p>
          )}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {attachments.map((a) => (
            <a key={a.id} href={`data:${a.mime};base64,${a.dataBase64}`} target="_blank" rel="noreferrer">
              <img src={`data:${a.mime};base64,${a.dataBase64}`} alt={a.name} className="h-24 border border-[var(--line)] rounded-[2px] hover:opacity-85" />
            </a>
          ))}
        </div>
      )}

      {/* 自动上下文 */}
      <div className="border border-[var(--line)] rounded-[2px] p-2.5 bg-[var(--paper-deep)]/40 text-[11.5px] text-[var(--ink-3)]">
        <span className="meta-label mr-2">随单信息</span>
        页面 {t.pageUrl || "—"} · 视口 {t.viewport} · v{t.appVersion}
        {(t.consoleErrors as { msg: string }[] | null)?.length ? (
          <ul className="mt-1 space-y-0.5">
            {(t.consoleErrors as { msg: string }[]).map((e, i) => (
              <li key={i} className="text-[var(--vermilion)] truncate">⚑ {e.msg}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* 处理路线 */}
      <div>
        <div className="meta-label mb-2">处理路线 · STATUS TRAIL</div>
        <div className="flex items-center gap-2 flex-wrap">
          {log.map((s, i) => (
            <span key={i} className="flex items-center gap-2">
              {i > 0 && <span className="text-[var(--line)]">→</span>}
              <span className={`text-[12px] px-2 py-0.5 border rounded-[2px] ${STATUS_TONE[s.status] ?? "border-[var(--line)]"}`}>
                {STATUS_ZH[s.status] ?? s.status}
                {s.note && <span className="text-[var(--ink-3)]"> · {s.note}</span>}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* 对话流 */}
      <div>
        <div className="meta-label mb-2">往来 · CONVERSATION</div>
        {replies.length === 0 && <p className="text-[13px] text-[var(--ink-3)]">掌门尚未回复，耐心稍候。</p>}
        <div className="space-y-2.5">
          {replies.map((r) => (
            <div key={r.id} className={`border rounded-[2px] p-3 ${r.authorRole === "admin" ? "border-[var(--vermilion)]/50 bg-[var(--vermilion)]/5" : "border-[var(--line)]"}`}>
              <div className="flex items-baseline gap-2 text-[12px] text-[var(--ink-3)]">
                <b className={r.authorRole === "admin" ? "text-[var(--vermilion)]" : "text-[var(--ink)]"}>
                  {r.authorRole === "admin" ? `掌门 · ${r.authorName}` : "我"}
                </b>
                <span>{new Date(r.createdAt).toLocaleString("zh-CN")}</span>
              </div>
              <p className="text-[13.5px] leading-relaxed mt-1 whitespace-pre-wrap">{r.content}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 追问 / 关闭 */}
      {t.status !== "closed" && (
        <div>
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={2}
            maxLength={4000}
            placeholder="补充新情况，或回复掌门……"
            className="w-full border border-[var(--line)] rounded-[2px] px-3 py-2 text-[13.5px] bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)]"
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => reply.mutate({ ticketId: t.id, content: replyText.trim() })}
              disabled={reply.isPending || !replyText.trim()}
              className="px-4 py-1.5 text-[13px] font-bold bg-[var(--ink)] text-[var(--paper)] rounded-[2px] disabled:opacity-40"
            >补充回复</button>
            <button
              onClick={() => { if (confirm("关闭这张工单？")) close.mutate({ ticketId: t.id }); }}
              className="text-[13px] underline underline-offset-4 text-[var(--ink-3)]"
            >关闭工单</button>
          </div>
        </div>
      )}
    </div>
  );
}

function MyTickets() {
  const { data, refetch } = trpc.ticket.myList.useQuery();
  const [openId, setOpenId] = useState<number | null>(null);
  const rows = data ?? [];
  return (
    <div className="space-y-3 ink-stagger">
      {rows.map((t) => (
        <PaperCard key={t.id} className="p-5">
          <button className="w-full text-left" onClick={() => setOpenId(openId === t.id ? null : t.id)}>
            <div className="flex items-center gap-2 flex-wrap text-[13px]">
              <span className="meta-label border border-[var(--line)] px-1.5 py-0.5">#{t.id}</span>
              <span className="meta-label text-[var(--ink-2)]">{KIND_ZH[t.kind] ?? t.kind}</span>
              <span className={`text-[11.5px] font-bold border px-1.5 py-0.5 rounded-[2px] ${STATUS_TONE[t.status]}`}>{STATUS_ZH[t.status]}</span>
              {t.attachmentCount > 0 && <span className="meta-label text-[var(--ink-3)]">📎 {t.attachmentCount}</span>}
              <span className="flex-1" />
              <span className="text-[12px] text-[var(--ink-3)]">{new Date(t.updatedAt).toLocaleDateString("zh-CN")}</span>
            </div>
            <p className="font-bold text-[15.5px] mt-2">{t.title}</p>
            {t.lastReply && (
              <p className="text-[12.5px] text-[var(--ink-3)] mt-1">
                {t.lastReply.authorRole === "admin" ? "掌门回复" : "我"}：{t.lastReply.content}…
              </p>
            )}
          </button>
          {openId === t.id && <TicketDetail id={t.id} onChanged={() => void refetch()} />}
        </PaperCard>
      ))}
      {rows.length === 0 && (
        <div className="text-center py-14 text-[var(--ink-3)]">
          <Seal size={76} seed="ticket-empty" text="天下无障" center="顺" />
          <p className="mt-4 text-[14px]">还没有递过工单。个人中心的「反馈与工单」区，随叫随到。</p>
        </div>
      )}
    </div>
  );
}

function NoticeBoard() {
  const { data } = trpc.ticket.notices.useQuery();
  const rows = data ?? [];
  return (
    <div className="space-y-4 ink-stagger">
      {rows.map((n, i) => (
        <PaperCard key={n.id} frame={i === 0} className="p-5">
          <div className="flex items-baseline gap-3 flex-wrap">
            <StepSeal num={String(rows.length - i)} active={i === 0} seed={`notice-${n.id}`} size={40} />
            <b className="text-[16px]">{n.title}</b>
            {i === 0 && <span className="text-[11px] font-bold text-[var(--vermilion)] border border-[var(--vermilion)]/50 px-1.5 py-0.5 rounded-[2px]">最新一期</span>}
            <span className="flex-1" />
            <span className="text-[12px] text-[var(--ink-3)]">{n.authorName} · {new Date(n.createdAt).toLocaleDateString("zh-CN")}</span>
          </div>
          {n.digest && (
            <p className="text-[13px] text-[var(--ink-3)] mt-2 border-l-2 border-[var(--vermilion)]/40 pl-3">{n.digest}</p>
          )}
          <p className="text-[14px] leading-[1.9] text-[var(--ink-2)] mt-3 whitespace-pre-wrap">{n.content}</p>
        </PaperCard>
      ))}
      {rows.length === 0 && (
        <div className="text-center py-14 text-[var(--ink-3)]">
          <Seal size={76} seed="notice-empty" text="暂无榜文" center="告" />
          <p className="mt-4 text-[14px]">还没有公告。掌门发榜后，每一期都会留在这里。</p>
        </div>
      )}
    </div>
  );
}

export default function TicketsPage() {
  const { user, ready } = useUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const wantNotices = searchParams.get("tab") === "notices";
  const [tab, setTab] = useState<"mine" | "notices">(wantNotices ? "notices" : "mine");
  // 带 ?tab=notices 进来的（如首页横幅「公告榜 →」），一律直达公告页；
  // 游客默认也落在公告页（不看签到门）
  useEffect(() => {
    if (wantNotices || (ready && !user)) setTab("notices");
  }, [wantNotices, ready, user]);
  const switchTab = (t: "mine" | "notices") => {
    setTab(t);
    setSearchParams(t === "notices" ? { tab: "notices" } : {}, { replace: true });
  };
  return (
    <div className="max-w-[860px] mx-auto">
      <InkReveal>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="meta-label mb-2">HELP DESK · 工单与公告</div>
            <BrushTitle as="h1" className="text-[34px]">工单中心</BrushTitle>
            <p className="text-[14px] text-[var(--ink-3)] mt-2">
              在个人中心「反馈与工单」递单，在这里追踪处理路线与掌门回复；公告每一期都留档。
            </p>
          </div>
          <Seal size={72} seed="tickets" text="有求必应" center="应" />
        </div>
      </InkReveal>

      <div className="flex items-center gap-2 mt-6 mb-6">
        <button
          onClick={() => switchTab("mine")}
          className={`px-4 py-1.5 text-[14px] border rounded-[2px] ${tab === "mine" ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)]"}`}
        >我的工单</button>
        <button
          onClick={() => switchTab("notices")}
          className={`px-4 py-1.5 text-[14px] border rounded-[2px] ${tab === "notices" ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)]"}`}
        >公告榜</button>
      </div>

      {tab === "mine" ? (
        user ? <MyTickets /> : (
          <PaperCard className="p-10 text-center">
            <p className="text-[14px] text-[var(--ink-3)]">签到后才能递工单、看回复。</p>
            <Link to="/" className="inline-block mt-4 px-5 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[2px]">去签到</Link>
          </PaperCard>
        )
      ) : (
        <>
          <InkDivider className="mb-6" />
          <NoticeBoard />
        </>
      )}
    </div>
  );
}
