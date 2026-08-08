import { useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { useUser } from "@/hooks/useUser";
import { BrushTitle, InkReveal, PaperCard } from "@/components/ink/decor";
import { Seal } from "@/components/ink/Seal";
import { Q_TYPES } from "@contracts/constants";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from "recharts";

interface SourceStats {
  sessions: number;
  passages: number;
  questions: number;
  correct: number;
  accuracy: number;
  recent7dAccuracy: number | null;
  recent7dQuestions: number;
  minutes: number;
  byType: { qType: string; total: number; accuracy: number }[];
}

interface StatsData {
  accuracy: number;
  totalQuestions: number;
  donePassages: number;
  totalPassages: number;
  streak: number;
  wrongOpen: number;
  wrongTotal: number;
  trend: { day: string; accuracy: number; questions: number }[];
  calendar: { day: string; passages: number; minutes: number }[];
  byType: { qType: string; total: number; accuracy: number }[];
  byYear: { year: number; done: number; accuracy: number }[];
  bySource?: { exam: SourceStats; generated: SourceStats };
}

const INK = "#101010";
const VERMILION = "#c0392b";
const BAMBOO = "#6b7f5e";

export default function StatsPage() {
  const { user } = useUser();
  const { data } = trpc.agent.stats.useQuery(undefined, { enabled: !!user });
  const stats = data as StatsData | undefined;

  // 热力图：近 12 周（84 天）
  const heat = useMemo(() => {
    const map = new Map((stats?.calendar ?? []).map((c) => [c.day, c.passages]));
    const cells: { day: string; level: number }[] = [];
    const today = new Date();
    // 对齐到周日开头，共 12 周
    const start = new Date(today.getTime() - 83 * 86400000);
    start.setDate(start.getDate() - start.getDay());
    for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const n = map.get(key) ?? 0;
      cells.push({ day: key, level: n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 3 : 4 });
    }
    return cells;
  }, [stats?.calendar]);

  const radarData = useMemo(
    () =>
      Q_TYPES.map((t) => {
        const row = stats?.byType.find((x) => x.qType === t.id);
        return { type: t.name, accuracy: row?.accuracy ?? 0, total: row?.total ?? 0 };
      }),
    [stats?.byType],
  );

  if (!stats) {
    return <div className="text-center py-24 text-[var(--ink-3)]">研墨中…</div>;
  }

  return (
    <div>
      <InkReveal>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <BrushTitle as="h1" className="text-[34px]">学习统计</BrushTitle>
            <p className="text-[14px] text-[var(--ink-3)] mt-2">
              {user?.name ?? "访客"}的功课单：练了才知道深浅。
            </p>
          </div>
          <Seal size={72} seed="stats" text="日拱一卒" center="功" />
        </div>
      </InkReveal>

      {/* 总览格 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-0 mt-8 border border-[var(--line)]">
        {[
          { n: `${stats.donePassages}/${stats.totalPassages}`, l: "已练篇章" },
          { n: `${stats.accuracy}%`, l: "总正确率" },
          { n: stats.streak, l: "连续学习（天）" },
          { n: stats.wrongOpen, l: "待攻克错题" },
        ].map((s, i) => (
          <div key={i} className="p-5 text-center border-[var(--line)] [&:not(:last-child)]:border-r max-md:[&:nth-child(-n+2)]:border-b max-md:odd:border-r">
            <div className="text-[30px] font-bold font-['Georgia']">{s.n}</div>
            <div className="meta-label mt-1">{s.l}</div>
          </div>
        ))}
      </div>

      {/* 分源评估：真题 / AI 生题 两个子模块（主模块=全页综合数据） */}
      {stats.bySource && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <SourceCard title="真题" enLabel="REAL EXAMS" seal="真" s={stats.bySource.exam} />
          <SourceCard title="AI 生题" enLabel="AI GENERATED" seal="仿" s={stats.bySource.generated} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
        {/* 正确率趋势 */}
        <PaperCard>
          <div className="meta-label mb-3">正确率趋势 · ACCURACY TREND</div>
          {stats.trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={stats.trend} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="#ddd5c3" strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#8a8478" }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#8a8478" }} unit="%" />
                <Tooltip
                  contentStyle={{ background: "#f6f2e8", border: "1px solid #101010", borderRadius: 2, fontSize: 13 }}
                  formatter={(v) => [`${v}%`, "正确率"]}
                  labelFormatter={(d) => `日期 ${d}`}
                />
                <Line type="monotone" dataKey="accuracy" stroke={VERMILION} strokeWidth={2} dot={{ r: 3, fill: VERMILION }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyHint text="还没有练习数据，做完一篇真题就有曲线了" />
          )}
        </PaperCard>

        {/* 八题型雷达 */}
        <PaperCard>
          <div className="meta-label mb-3">八种题型掌握度 · BY QUESTION TYPE</div>
          {stats.byType.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <RadarChart data={radarData} outerRadius="72%">
                <PolarGrid stroke="#ddd5c3" />
                <PolarAngleAxis dataKey="type" tick={{ fontSize: 12, fill: INK }} />
                <Radar dataKey="accuracy" stroke={BAMBOO} fill={BAMBOO} fillOpacity={0.25} strokeWidth={2} />
                <Tooltip
                  contentStyle={{ background: "#f6f2e8", border: "1px solid #101010", borderRadius: 2, fontSize: 13 }}
                  formatter={(v, _n, item) => [`${v}%（${(item.payload as { total: number }).total} 题）`, "正确率"]}
                />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyHint text="做过题才能画雷达图" />
          )}
        </PaperCard>
      </div>

      {/* 日历热力图 */}
      <PaperCard className="mt-6">
        <div className="meta-label mb-3">学习日历（近 12 周）· STUDY CALENDAR</div>
        <div className="overflow-x-auto pb-2">
          <div className="heatmap">
            {heat.map((c) => (
              <div key={c.day} className={`cell ${c.level ? `l${c.level}` : ""}`} title={`${c.day}${c.level ? ` · 练了` : ""}`} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3 text-[12px] text-[var(--ink-3)]">
          少
          {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`cell inline-block ${l ? `l${l}` : ""}`} />)}
          多
        </div>
      </PaperCard>

      {/* 17 年进度 */}
      <PaperCard className="mt-6">
        <div className="meta-label mb-4">十七年真题进度 · 2010–2026</div>
        <div className="space-y-2.5">
          {stats.byYear.map((y) => (
            <div key={y.year} className="flex items-center gap-3">
              <span className="w-12 text-[14px] font-bold font-['Georgia']">{y.year}</span>
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={`w-7 h-4 border rounded-[1px] ${i < y.done ? "bg-[var(--bamboo)] border-[var(--bamboo)]" : "border-[var(--line)]"}`}
                  />
                ))}
              </div>
              <span className="text-[13px] text-[var(--ink-3)] w-20">{y.done}/4 篇</span>
              <span className={`text-[13px] ${y.done ? "text-[var(--ink-2)]" : "text-[var(--ink-3)]"}`}>
                {y.done ? `正确率 ${y.accuracy}%` : "未开始"}
              </span>
            </div>
          ))}
        </div>
      </PaperCard>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <div className="h-[240px] flex items-center justify-center text-[var(--ink-3)] text-[14px]">{text}</div>;
}

/** 分源子模块卡：真题 / AI 生题 独立评估 */
function SourceCard({ title, enLabel, seal, s }: { title: string; enLabel: string; seal: string; s: SourceStats }) {
  const typeZh = new Map(Q_TYPES.map((t) => [t.id, t.name]));
  const empty = s.sessions === 0;
  return (
    <PaperCard>
      <div className="flex items-center justify-between mb-4">
        <div className="meta-label">{title} · {enLabel}</div>
        <Seal size={44} seed={`src-${seal}`} center={seal} />
      </div>
      {empty ? (
        <p className="text-[13.5px] text-[var(--ink-3)] py-6 text-center">还没有{title}的交卷记录</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-0 border border-[var(--line)] text-center">
            {[
              { n: s.sessions, l: "交卷" },
              { n: s.questions, l: "判分题" },
              { n: `${s.accuracy}%`, l: "正确率" },
              { n: s.recent7dAccuracy === null ? "—" : `${s.recent7dAccuracy}%`, l: "近7天" },
            ].map((x, i) => (
              <div key={i} className="p-3 [&:not(:last-child)]:border-r border-[var(--line)]">
                <div className="text-[20px] font-bold font-['Georgia']">{x.n}</div>
                <div className="meta-label mt-0.5">{x.l}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[12.5px] text-[var(--ink-3)]">
            练过 {s.passages} 篇 · 累计约 {s.minutes} 分钟 · 近 7 天判分 {s.recent7dQuestions} 题
          </div>
          {s.byType.length > 0 && (
            <div className="mt-3 space-y-1">
              {s.byType
                .slice()
                .sort((a, b) => b.total - a.total)
                .map((t) => (
                  <div key={t.qType} className="flex items-center gap-2 text-[12.5px]">
                    <span className="w-16 shrink-0">{typeZh.get(t.qType) ?? t.qType}</span>
                    <span className="flex-1 h-2 bg-[var(--paper-deep)] rounded-[1px] overflow-hidden">
                      <span
                        className="block h-full"
                        style={{
                          width: `${t.accuracy}%`,
                          background: t.accuracy >= 60 ? "var(--bamboo)" : "var(--vermilion)",
                        }}
                      />
                    </span>
                    <span className="w-20 text-right text-[var(--ink-3)]">{t.accuracy}%（{t.total}题）</span>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </PaperCard>
  );
}
