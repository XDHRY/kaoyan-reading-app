import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useUser } from "@/hooks/useUser";
import { dataUrlToBlobUrl } from "@/lib/imageBlob";
import { BrushTitle, InkReveal, PaperCard } from "@/components/ink/decor";
import { Seal } from "@/components/ink/Seal";

interface VocabRow {
  id: number;
  word: string;
  zh: string;
  context: string | null;
  familiarity: number;
  image: string | null;
  createdAt: Date;
}

const FAM_ZH = ["生", "熟", "会了"];

export default function VocabPage() {
  const { user } = useUser();
  const [tab, setTab] = useState<number | null>(null); // null=全部
  const [flipped, setFlipped] = useState<Record<number, boolean>>({});
  const [imgState, setImgState] = useState<Record<number, { loading?: boolean; image?: string; error?: string }>>({});
  const setFam = trpc.vocab.setFamiliarity.useMutation();
  const remove = trpc.vocab.remove.useMutation();
  const genImage = trpc.vocab.image.useMutation();

  const drawImage = async (id: number) => {
    setImgState((m) => ({ ...m, [id]: { loading: true } }));
    try {
      const r = await genImage.mutateAsync({ id });
      setImgState((m) => ({ ...m, [id]: { image: r.image ?? undefined } }));
    } catch (e) {
      setImgState((m) => ({ ...m, [id]: { error: e instanceof Error ? e.message : "绘图失败" } }));
    }
  };

  const { data, refetch } = trpc.vocab.list.useQuery(
    { familiarity: tab ?? undefined },
    { enabled: !!user },
  );
  const rows = (data ?? []) as VocabRow[];
  const counts = (data ?? []).length;

  return (
    <div>
      <InkReveal>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <BrushTitle as="h1" className="text-[34px]">生词本</BrushTitle>
            <p className="text-[14px] text-[var(--ink-3)] mt-2">
              阅读原文时点单词自动收入。点卡片翻面看释义，按熟悉度归档。
            </p>
          </div>
          <Seal size={72} seed="vocab" text="厚积薄发" center="词" />
        </div>
      </InkReveal>

      <div className="flex items-center gap-2 mt-6 flex-wrap">
        <button onClick={() => setTab(null)}
          className={`px-4 py-1.5 text-[14px] border rounded-[2px] ${tab === null ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)]"}`}>
          全部（{counts}）
        </button>
        {FAM_ZH.map((z, i) => (
          <button key={i} onClick={() => setTab(i)}
            className={`px-4 py-1.5 text-[14px] border rounded-[2px] ${tab === i ? "border-[var(--ink)] font-bold" : "border-[var(--line)]"}`}>
            {z}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
        {rows.map((v) => {
          const isFlip = flipped[v.id];
          const img = imgState[v.id]?.image ?? v.image;
          return (
            <PaperCard key={v.id} className="cursor-pointer select-none" onClick={() => setFlipped((m) => ({ ...m, [v.id]: !isFlip }))}>
              {!isFlip ? (
                <div className="min-h-[120px] flex flex-col">
                  {img && <img src={dataUrlToBlobUrl(img)} alt={v.word} className="w-full h-[110px] object-cover border border-[var(--line)] rounded-[2px] mb-3" />}
                  <div className="font-['Georgia'] text-[26px] font-bold tracking-wide">{v.word}</div>
                  <div className="meta-label mt-2 text-[var(--ink-3)]">点击翻面看释义</div>
                  <div className="flex-1" />
                  <FamBadge f={v.familiarity} />
                </div>
              ) : (
                <div className="min-h-[120px] flex flex-col">
                  {img && <img src={dataUrlToBlobUrl(img)} alt={v.word} className="w-full h-[120px] object-cover border border-[var(--line)] rounded-[2px] mb-3" />}
                  <div className="text-[16px] font-bold text-[var(--vermilion)]">{v.zh || "（暂无释义）"}</div>
                  {v.context && (
                    <p className="text-[13px] text-[var(--ink-3)] mt-2 line-clamp-3 leading-relaxed">{v.context}</p>
                  )}
                  {imgState[v.id]?.error && <p className="text-[12px] text-[var(--vermilion)] mt-2">{imgState[v.id].error}</p>}
                  <div className="flex-1" />
                  <div className="flex items-center gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
                    {!img && (
                      <button
                        onClick={() => void drawImage(v.id)}
                        disabled={imgState[v.id]?.loading}
                        className="px-2.5 py-1 text-[12px] border border-[var(--ink)] rounded-[2px] disabled:opacity-40"
                      >
                        {imgState[v.id]?.loading ? "研墨中…" : "记忆配图"}
                      </button>
                    )}
                    {FAM_ZH.map((z, i) => (
                      <button key={i}
                        onClick={async () => { await setFam.mutateAsync({ id: v.id, familiarity: i }); await refetch(); }}
                        className={`px-2.5 py-1 text-[12px] border rounded-[2px] ${v.familiarity === i ? "border-[var(--bamboo)] text-[var(--bamboo)] font-bold" : "border-[var(--line)]"}`}>
                        {z}
                      </button>
                    ))}
                    <span className="flex-1" />
                    <button
                      onClick={async () => { await remove.mutateAsync({ id: v.id }); await refetch(); }}
                      className="text-[12px] text-[var(--vermilion)] underline underline-offset-4">删除</button>
                  </div>
                </div>
              )}
            </PaperCard>
          );
        })}
      </div>

      {rows.length === 0 && (
        <div className="text-center py-16 text-[var(--ink-3)]">
          <Seal size={80} seed="vocab-empty" text="一字一句" center="积" />
          <p className="mt-4">生词本还空着——去读真题，遇到生词点它一下</p>
        </div>
      )}
    </div>
  );
}

function FamBadge({ f }: { f: number }) {
  const color = f === 0 ? "var(--vermilion)" : f === 1 ? "var(--ink-3)" : "var(--bamboo)";
  return (
    <span className="meta-label mt-3 self-start border px-1.5 py-0.5" style={{ color, borderColor: color }}>
      {FAM_ZH[f]}
    </span>
  );
}
