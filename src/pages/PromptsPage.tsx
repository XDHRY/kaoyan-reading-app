import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { BrushTitle, InkReveal, PaperCard } from "@/components/ink/decor";
import { AGENT_ROLES } from "@contracts/types";
import { useUser } from "@/hooks/useUser";

export default function PromptsPage() {
  const utils = trpc.useUtils();
  const { user } = useUser();
  const { data: prompts } = trpc.prompt.list.useQuery();
  const save = trpc.prompt.save.useMutation({
    onSuccess: () => utils.prompt.list.invalidate(),
  });
  const [selected, setSelected] = useState<string>(AGENT_ROLES[0].id);
  const [draft, setDraft] = useState<string | null>(null);
  const [personal, setPersonal] = useState(true);

  // 个人版优先展示；无个人版则显示全站预设
  const mine = (prompts ?? []).find((p) => p.agentRole === selected && p.isActive && p.userId === user?.id);
  const globalActive = (prompts ?? []).find((p) => p.agentRole === selected && p.isActive && p.userId === null);
  const active = mine ?? globalActive;
  const history = (prompts ?? []).filter((p) => p.agentRole === selected);
  const role = AGENT_ROLES.find((r) => r.id === selected);

  return (
    <div className="max-w-[1000px] mx-auto">
      <InkReveal className="mb-8">
        <div className="meta-label mb-2">PROMPT ASSETS · 提示词资产中心</div>
        <h1 className="text-[34px] font-black">
          <BrushTitle vermilion>提示词资产</BrushTitle>
        </h1>
        <p className="text-[var(--ink-2)] mt-2 text-[15px]">
          每个 AI 角色的提示词都可查看、可修改；保存即升版本并立即生效，旧版本留档。
        </p>
      </InkReveal>

      <div className="grid md:grid-cols-[240px_1fr] gap-6">
        <div className="space-y-1">
          {AGENT_ROLES.map((r) => (
            <button
              key={r.id}
              onClick={() => { setSelected(r.id); setDraft(null); }}
              className={`w-full text-left px-3 py-2.5 rounded-[2px] border transition-colors ${
                selected === r.id ? "border-[var(--vermilion)] font-bold text-[var(--vermilion)]" : "border-transparent hover:bg-[var(--paper-deep)]"
              }`}
            >
              <div className="text-[15px]">{r.name}</div>
              <div className="text-[12px] text-[var(--ink-3)]">{r.desc}</div>
            </button>
          ))}
        </div>

        <div>
          <PaperCard frame className="p-5">
            <div className="flex items-baseline justify-between mb-3">
              <div className="font-bold text-[17px]">{role?.name} 的提示词</div>
              {active && (
                <span className="meta-label">
                  v{active.version} · {active.userId ? "我的个人版 · 生效中" : "全站预设 · 生效中"}
                </span>
              )}
            </div>
            <p className="text-[12.5px] text-[var(--ink-3)] mb-3 leading-relaxed">
              保存为「我的个人版」后，只对你的账号生效，不影响全站预设与其他用户。
            </p>
            <textarea
              className="w-full h-[380px] bg-[var(--paper-deep)]/40 border border-[var(--line)] rounded-[2px] p-4 text-[14px] leading-relaxed font-mono outline-none focus:border-[var(--ink-2)]"
              value={draft ?? active?.content ?? "（尚未自定义，使用系统内置提示词。在此粘贴自定义内容并保存，即可覆盖内置版本）"}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="flex gap-2 mt-3 items-center flex-wrap">
              <button
                onClick={() => {
                  const content = draft ?? active?.content;
                  if (!content) return;
                  save.mutate(
                    { agentRole: selected, name: `${role?.name}提示词`, content, personal: personal && !!user },
                    { onSuccess: () => setDraft(null) },
                  );
                }}
                disabled={save.isPending || draft === null}
                className="px-4 py-2 bg-[var(--vermilion)] text-[var(--paper)] rounded-[2px] text-[14px] font-bold print-shadow disabled:opacity-40"
              >
                {personal && user ? "保存为我的个人版" : "保存为全站预设"}
              </button>
              {user && (
                <label className="flex items-center gap-1.5 text-[13px] text-[var(--ink-2)] cursor-pointer">
                  <input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} />
                  仅对我生效
                </label>
              )}
              {draft !== null && (
                <button onClick={() => setDraft(null)} className="px-4 py-2 border border-[var(--line)] rounded-[2px] text-[14px]">
                  放弃修改
                </button>
              )}
            </div>
          </PaperCard>

          {history.length > 1 && (
            <PaperCard className="p-5 mt-4">
              <div className="meta-label mb-2">VERSIONS · 历史版本</div>
              <div className="space-y-1">
                {history.map((p) => (
                  <div key={p.id} className="text-[13.5px] flex justify-between">
                    <span>v{p.version} · {new Date(p.updatedAt).toLocaleString("zh-CN")}</span>
                    <span className={p.isActive ? "text-[var(--bamboo)]" : "text-[var(--ink-3)]"}>
                      {p.isActive ? "生效中" : "留档"}
                    </span>
                  </div>
                ))}
              </div>
            </PaperCard>
          )}
        </div>
      </div>
    </div>
  );
}
