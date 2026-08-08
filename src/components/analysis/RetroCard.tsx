import { useEffect, useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { PaperCard, InkDivider } from "@/components/ink/decor";
import { playSound } from "@/hooks/useSound";
import { useToast } from "@/hooks/useToast";

interface Props {
  kind: "exam" | "generated";
  refId: number;
  /** 本套判分（用来判断有没有错题、值不值得定制） */
  verdicts: Record<string, boolean>;
}

/**
 * 复盘定制卷：交卷判分后出现。
 * 三件套 = 本套错因分布（自动聚合）+ 每题 AI 诊断（自动聚合）+ 你的自评（可填可不填）。
 * 生成一整套 5 道仿真题，直接进练习页，判分/错题入册与随手生成完全同路。
 */
export function RetroCard({ kind, refId, verdicts }: Props) {
  const utils = trpc.useUtils();
  const { toast } = useToast();
  const wrongCount = Object.values(verdicts).filter((v) => v === false).length;
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<number | null>(null);

  const createMut = trpc.retro.create.useMutation();
  // 判分记录刚落库，forRecord 只用于展示历史定制卷；首次生成走 create 的幂等
  const { data: history } = trpc.retro.forRecord.useQuery(
    { recordId: 0 },
    { enabled: false }, // 记录 id 结果区拿不到时不查；create 内部会定位最近记录
  );

  useEffect(() => {
    if (created) playSound("seal");
  }, [created]);

  if (wrongCount === 0) {
    return (
      <PaperCard className="p-5 mt-6 border-l-2 border-l-[var(--bamboo)]">
        <div className="meta-label mb-1.5">RETRO TAILORED</div>
        <p className="text-[14.5px]">
          <b className="text-[var(--bamboo)]">全对！</b>
          这套没有弱点需要定制——去错题本翻几道陈年错题，或者直接开下一套。
        </p>
      </PaperCard>
    );
  }

  const run = async () => {
    try {
      const r = await createMut.mutateAsync({ kind, refId, selfNote: note.trim() });
      setCreated(r.generatedId);
      void utils.agent.history.invalidate();
      toast(r.reused ? "命中 1 小时内的同款定制卷，直接续练" : "定制卷已出，落章为证", "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "生成失败，请重试", "warn");
    }
  };

  return (
    <PaperCard frame className="p-5 mt-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="meta-label mb-1.5">RETRO TAILORED · 复盘定制卷</div>
          <p className="text-[15px] leading-relaxed">
            这套错了 <b className="text-[var(--vermilion)] text-[18px]">{wrongCount}</b> 道。
            把<b>错因</b>、<b>AI 诊断</b>和你的<b>自评</b>揉成一整套新卷，趁热打铁。
          </p>
        </div>
        {created ? (
          <Link
            to={`/generate/set/${created}`}
            className="px-5 py-2.5 text-[14px] font-bold bg-[var(--vermilion)] text-[var(--paper)] rounded-[2px] print-shadow hover:opacity-90 shrink-0"
          >
            开练定制卷 →
          </Link>
        ) : (
          <button
            onClick={() => void run()}
            disabled={createMut.isPending}
            className="px-5 py-2.5 text-[14px] font-bold bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow hover:opacity-90 disabled:opacity-40 shrink-0"
          >
            {createMut.isPending ? "命题官组卷中…" : `为这 ${wrongCount} 道错题定制新卷`}
          </button>
        )}
      </div>

      {!created && (
        <>
          <button onClick={() => setOpen(!open)} className="mt-3 text-[13px] underline underline-offset-4 text-[var(--ink-2)]">
            {open ? "收起自评 ▴" : "写两句自评（可不写，写了更准）▾"}
          </button>
          {open && (
            <div className="mt-3">
              <InkDivider />
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={`例：这两道推断题我都是想太多，看到"可能"就脑补成"一定"；下次要先找原文证据再下结论。`}
                className="ink-textarea mt-3"
              />
              <p className="text-[12px] text-[var(--ink-3)] mt-1.5">
                可不填。写了的话，命题官会优先照顾你点名的薄弱环节。{note.length}/2000
              </p>
            </div>
          )}
        </>
      )}
      {history === undefined && null}
    </PaperCard>
  );
}
