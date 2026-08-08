import { useMemo, useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useUser } from "@/hooks/useUser";
import { BrushTitle } from "@/components/ink/decor";
import { Seal } from "@/components/ink/Seal";

type Row = {
  id: number;
  source: "exam" | "generated";
  refId: number;
  title: string;
  answers: Record<string, string>;
  verdicts: Record<string, boolean> | null;
  total: number;
  correct: number;
  durationSec: number | null;
  createdAt: string | Date;
  jobId: number | null;
};

function fmtDur(sec: number | null) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}分${s}秒` : `${s}秒`;
}

/** 学习档案：每次交卷的记录都在此——查看对错、载入回到该篇回味完整解析 */
export default function HistoryPage() {
  const { user } = useUser();
  const { data, isLoading } = trpc.agent.history.useQuery(undefined, { enabled: !!user });
  const [tab, setTab] = useState<"all" | "exam" | "generated">("all");

  const rows = useMemo(() => {
    const all = (data ?? []) as Row[];
    return tab === "all" ? all : all.filter((r) => r.source === tab);
  }, [data, tab]);

  const overview = useMemo(() => {
    const all = (data ?? []) as Row[];
    const sessions = all.length;
    const correct = all.reduce((a, r) => a + r.correct, 0);
    const total = all.reduce((a, r) => a + r.total, 0);
    const rate = total ? Math.round((correct / total) * 100) : 0;
    return { sessions, correct, total, rate };
  }, [data]);

  if (!user) {
    return (
      <div className="max-w-[720px] mx-auto text-center py-20">
        <BrushTitle as="h1" className="text-[30px]">学习档案</BrushTitle>
        <p className="mt-4 text-[var(--ink-3)]">登录后，你的每一次交卷与解析都会收进这座档案馆。</p>
      </div>
    );
  }

  return (
    <div className="max-w-[960px] mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Seal size={64} seed="history" text="学习档案" center="档" />
        <div>
          <BrushTitle as="h1" className="text-[30px]">学习档案</BrushTitle>
          <p className="meta-label mt-1">ARCHIVE · 查看 · 回味 · 再出发</p>
        </div>
      </div>

      {/* 总览 */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "交卷次数", value: overview.sessions },
          { label: "累计判分题", value: overview.total },
          { label: "总正确率", value: `${overview.rate}%` },
        ].map((s) => (
          <div key={s.label} className="ink-card p-4 text-center">
            <div className="text-[26px] font-bold text-[var(--vermilion)]">{s.value}</div>
            <div className="meta-label mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* 过滤 */}
      <div className="flex gap-2 mb-4">
        {([["all", "全部"], ["exam", "真题"], ["generated", "AI 生成题"]] as const).map(([v, l]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`px-3 py-1.5 text-[14px] border rounded-[2px] ${tab === v ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)]"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-[var(--ink-3)]">翻阅卷宗中……</p>}
      {!isLoading && rows.length === 0 && (
        <p className="text-[var(--ink-3)] py-10 text-center">
          档案室还空着——去 <Link to="/library" className="text-[var(--vermilion)] font-bold">真题库</Link> 或{" "}
          <Link to="/generate" className="text-[var(--vermilion)] font-bold">AI 出题</Link> 交一次卷，这里就会有你的第一卷档案。
        </p>
      )}

      {/* 时间线 */}
      <div className="space-y-3">
        {rows.map((r) => {
          const pct = r.total ? Math.round((r.correct / r.total) * 100) : 0;
          const to = r.source === "exam" ? `/practice/${r.refId}` : `/generate/set/${r.refId}`;
          return (
            <div key={r.id} className="ink-card p-4 flex flex-wrap items-center gap-3">
              <div className="w-[46px] shrink-0 text-center">
                <div className={`text-[20px] font-black ${pct >= 60 ? "text-[var(--bamboo)]" : "text-[var(--vermilion)]"}`}>
                  {r.total ? `${r.correct}/${r.total}` : "—"}
                </div>
                <div className="meta-label">{r.total ? `${pct}%` : "未判分"}</div>
              </div>
              <div className="flex-1 min-w-[180px]">
                <div className="font-bold text-[15px]">{r.title}</div>
                <div className="text-[12.5px] text-[var(--ink-3)] mt-0.5">
                  {new Date(r.createdAt).toLocaleString("zh-CN")} · 用时 {fmtDur(r.durationSec)}
                  {r.source === "generated" && <span className="ml-2 border border-[var(--bamboo)] text-[var(--bamboo)] px-1 rounded-[2px] text-[11px]">AI 题</span>}
                </div>
                {r.verdicts && (
                  <div className="flex gap-1 mt-1.5">
                    {Object.entries(r.verdicts)
                      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
                      .map(([k, v]) => (
                        <span
                          key={k}
                          className={`inline-block w-5 h-5 text-center leading-5 text-[11px] font-bold rounded-[2px] ${
                            v ? "bg-[var(--bamboo)]/15 text-[var(--bamboo)]" : "bg-[var(--vermilion)]/15 text-[var(--vermilion)]"
                          }`}
                          title={`${k}：${v ? "对" : "错"}`}
                        >
                          {v ? "✓" : "✗"}
                        </span>
                      ))}
                  </div>
                )}
              </div>
              <Link
                to={to}
                className="px-4 py-2 border border-[var(--ink)] rounded-[2px] text-[13.5px] hover:bg-[var(--paper-deep)] shrink-0"
              >
                载入回味 →
              </Link>
            </div>
          );
        })}
      </div>

      <p className="text-[12.5px] text-[var(--ink-3)] mt-6 leading-relaxed">
        载入回味会回到该篇练习页：你的作答、判分、完整五段式 AI 解析（审题 / 定位 / 解题 / 交叉验证）都会原样恢复，可再读、可导出、可折叠。
      </p>
    </div>
  );
}
