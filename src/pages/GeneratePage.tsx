import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import { useUser } from "@/hooks/useUser";
import { trpc } from "@/providers/trpc";
import { BrushTitle, InkReveal, PaperCard } from "@/components/ink/decor";
import { Seal } from "@/components/ink/Seal";
import { GeneratedPractice, type GeneratedPayload } from "@/components/analysis/GeneratedPractice";
import { Q_TYPES } from "@contracts/types";

export default function GeneratePage() {
  const utils = trpc.useUtils();
  const { id: paramId } = useParams();
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [focus, setFocus] = useState<string[]>([]);
  const [view, setView] = useState<{ id: number; payload: GeneratedPayload } | null>(null);
  const { user } = useUser();

  // 直链打开某套生成题（复盘定制卷的落点）：/generate/set/:id
  useEffect(() => {
    const id = Number(paramId);
    if (!id || view?.id === id) return;
    void utils.client.agent.generatedDetail.query({ id }).then((r) => {
      if (r) setView({ id: r.id, payload: r.payload as GeneratedPayload });
    }).catch(() => {});
  }, [paramId, utils.client, view?.id]);

  const { data: list } = trpc.agent.generatedList.useQuery();
  const generate = trpc.agent.generate.useMutation({
    onSuccess: (r) => {
      setView({ id: r.id, payload: r.set as GeneratedPayload });
      utils.agent.generatedList.invalidate();
    },
  });
  const loadDetail = async (id: number) => {
    const r = await utils.client.agent.generatedDetail.query({ id });
    if (r) setView({ id: r.id, payload: r.payload as GeneratedPayload });
  };

  return (
    <div className="max-w-[1200px] mx-auto">
      <InkReveal className="mb-8">
        <div className="meta-label mb-2">AI QUESTION SMITH · 命题官</div>
        <h1 className="text-[34px] font-black">
          <BrushTitle vermilion>AI 出题</BrushTitle>
        </h1>
        <p className="text-[var(--ink-2)] mt-2 text-[15px]">
          仿考研英语一风格生成新阅读 + 5 道题。生成题与真题同等待遇：点词查词、长难句拆解、结构图、五段式 AI 解析、错题入册一应俱全。
        </p>
      </InkReveal>

      <div className="grid md:grid-cols-[320px_1fr] gap-6">
        {/* 出题面板 */}
        <div className="space-y-4">
          <PaperCard frame className="p-5">
            <div className="meta-label mb-2">TOPIC · 话题</div>
            <input
              className="w-full bg-transparent border border-[var(--line)] rounded-[2px] px-3 py-2 text-[14.5px] outline-none focus:border-[var(--ink-2)]"
              placeholder="如：人工智能与教育 / 城市公共交通…"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
            <div className="meta-label mt-4 mb-2">DIFFICULTY · 难度</div>
            <div className="flex gap-2">
              {([["easy", "偏简单"], ["medium", "标准"], ["hard", "偏难"]] as const).map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setDifficulty(v)}
                  className={`px-3 py-1.5 text-[14px] border rounded-[2px] ${difficulty === v ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)]"}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="meta-label mt-4 mb-2">FOCUS · 重点题型（可多选）</div>
            <div className="flex flex-wrap gap-1.5">
              {Q_TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setFocus((f) => (f.includes(t.id) ? f.filter((x) => x !== t.id) : [...f, t.id]))}
                  className={`px-2 py-1 text-[13px] border rounded-[2px] ${focus.includes(t.id) ? "border-[var(--vermilion)] text-[var(--vermilion)]" : "border-[var(--line)] text-[var(--ink-2)]"}`}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <button
              onClick={() => generate.mutate({ topic, difficulty, focusTypes: focus })}
              disabled={!topic || generate.isPending}
              className="w-full mt-5 px-4 py-3 bg-[var(--vermilion)] text-[var(--paper)] rounded-[2px] text-[15px] font-bold print-shadow disabled:opacity-40"
            >
              {generate.isPending ? "命题官工作中……" : "开始命题"}
            </button>
            {generate.isError && <p className="text-[13px] text-[var(--vermilion)] mt-2">{generate.error.message}</p>}
          </PaperCard>

          {/* 历史 */}
          {(list ?? []).length > 0 && (
            <PaperCard className="p-5">
              <div className="meta-label mb-2">HISTORY · 已生成</div>
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                {(list ?? []).map((g) => (
                  <button
                    key={g.id}
                    onClick={() => loadDetail(g.id)}
                    className={`w-full text-left text-[13.5px] py-1.5 border-b border-[var(--line)] last:border-b-0 hover:text-[var(--vermilion)] ${view?.id === g.id ? "text-[var(--vermilion)] font-bold" : ""}`}
                  >
                    {g.topic} <span className="text-[var(--ink-3)]">· {new Date(g.createdAt).toLocaleDateString("zh-CN")}</span>
                  </button>
                ))}
              </div>
            </PaperCard>
          )}
        </div>

        {/* 成果展示：与真题同等待遇的练习 + 解析 */}
        <div className="min-w-0">
          {generate.isPending && (
            <PaperCard className="p-16 text-center">
              <Seal size={90} seed="gen-run" center="题" animate />
              <p className="mt-4 font-bold text-[16px]">命题官正在撰写文章与题目……</p>
              <p className="text-[13px] text-[var(--ink-3)] mt-1">约 450 词文章 + 5 道题 + 干扰项设计说明</p>
            </PaperCard>
          )}
          {view && !generate.isPending && (
            <InkReveal key={view.id}>
              {user && (
                <div className="mb-4 flex justify-end">
                  <Link
                    to={`/interactive/generated/${view.id}`}
                    className="inline-block px-4 py-2 bg-[var(--bamboo)] text-[var(--paper)] rounded-[2px] text-[13px] font-bold hover:opacity-85 transition-opacity"
                  >
                    跟我练 · 逐题走步
                  </Link>
                </div>
              )}
              <GeneratedPractice setId={view.id} payload={view.payload} />
            </InkReveal>
          )}
          {!view && !generate.isPending && (
            <PaperCard className="p-16 text-center text-[var(--ink-3)]">
              <Seal size={80} seed="gen-idle" center="命" />
              <p className="mt-4 text-[15px]">输入话题，让命题官为你出一套仿真题</p>
              <p className="text-[13px] mt-2">交卷后享受与真题相同的五段式 AI 解析</p>
            </PaperCard>
          )}
        </div>
      </div>
    </div>
  );
}
