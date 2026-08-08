import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { ERROR_TYPES } from "@contracts/constants";

interface Props {
  kind: "exam" | "generated";
  refId: number;
  qNo: number;
  aiAnswer: "A" | "B" | "C" | "D";
  officialAnswer: "A" | "B" | "C" | "D";
  aiReasoning?: string;
}

/** AI vs 官方答案差异分析（懒生成：点击才调 LLM，唯一键缓存；失败可重试不阻塞） */
export function DiffAnalysisBlock({ kind, refId, qNo, aiAnswer, officialAnswer, aiReasoning }: Props) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const diffMut = trpc.agent.diffAnalysis.useMutation();
  const [diff, setDiff] = useState<{
    rootCause: string; aiReasoning: string | null; officialLogic: string | null; userTakeaway: string | null; modelUsed: string;
  } | null>(null);

  const run = async () => {
    setErr("");
    try {
      const r = await diffMut.mutateAsync({ kind, refId, qNo, aiAnswer, officialAnswer, aiReasoning: aiReasoning ?? "" });
      setDiff(r.diff as typeof diff);
      setOpen(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "生成失败");
    }
  };

  return (
    <div className="mt-3 rounded-[2px] border border-[var(--vermilion)]/50 bg-[var(--vermilion)]/5 px-3 py-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[13px]">
          ⚖️ <b className="text-[var(--vermilion)]">AI 与官方答案分歧</b>
          <span className="text-[var(--ink-2)]">：AI 选 {aiAnswer}，官方答案 {officialAnswer}</span>
        </p>
        {!diff && (
          <button
            onClick={() => void run()}
            disabled={diffMut.isPending}
            className="text-[12.5px] px-3 py-1 bg-[var(--vermilion)] text-white rounded-[2px] disabled:opacity-50"
          >
            {diffMut.isPending ? "诊断中…" : "为什么不同？（AI 根源诊断）"}
          </button>
        )}
      </div>
      {err && (
        <p className="text-[12.5px] text-[var(--vermilion)] mt-1.5">
          诊断失败：{err.slice(0, 80)}
          <button onClick={() => void run()} className="ml-2 underline font-bold">重试</button>
        </p>
      )}
      {diff && open && (
        <div className="mt-2.5 pt-2.5 border-t border-dashed border-[var(--vermilion)]/40 space-y-2 text-[13.5px]">
          <p>
            根源判定：
            <b className="text-[var(--vermilion)]">
              {ERROR_TYPES[diff.rootCause as keyof typeof ERROR_TYPES]?.zh ?? diff.rootCause ?? "理解偏差"}
            </b>
            {diff.modelUsed && <span className="text-[11px] text-[var(--ink-3)] ml-2">{diff.modelUsed}</span>}
          </p>
          {diff.aiReasoning && (
            <p className="leading-relaxed"><b className="text-[var(--ink-2)]">AI 思路复盘</b><span className="text-[var(--ink-2)]">{diff.aiReasoning}</span></p>
          )}
          {diff.officialLogic && (
            <p className="leading-relaxed"><b className="text-[var(--bamboo)]">官方逻辑</b><span className="text-[var(--ink-2)]">{diff.officialLogic}</span></p>
          )}
          {diff.userTakeaway && (
            <p className="leading-relaxed font-bold text-[var(--vermilion)]">裁决检查点：{diff.userTakeaway}</p>
          )}
        </div>
      )}
      {diff && (
        <button onClick={() => setOpen(!open)} className="mt-1.5 text-[12px] text-[var(--ink-3)] hover:text-[var(--ink)]">
          {open ? "收起诊断 ▴" : "展开诊断 ▾"}
        </button>
      )}
    </div>
  );
}
