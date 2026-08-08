import { useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { BrushTitle, InkReveal, PaperCard, StatusDot } from "@/components/ink/decor";
import { ServerSettingsCard } from "@/components/ServerConfig";
import { ModelManager } from "@/components/ModelManager";
import { BINDING_ROLES } from "@contracts/types";
import { useUser } from "@/hooks/useUser";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { useToast } from "@/hooks/useToast";
import { useSoundState } from "@/hooks/useSound";

function systemTheme(): "light" | "dark" {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

function BindingsPanel() {
  const utils = trpc.useUtils();
  const { user } = useUser();
  const { toast } = useToast();
  const isAdmin = user?.role === "admin";
  const [personal, setPersonal] = useState(!isAdmin);
  const { data: channels } = trpc.channel.list.useQuery();
  const { data: bindings } = trpc.channel.listBindings.useQuery();
  const { data: routeMap } = trpc.channel.routeMap.useQuery();
  const setBindings = trpc.channel.setBindings.useMutation({
    onSuccess: (r) => {
      utils.channel.listBindings.invalidate();
      utils.channel.routeMap.invalidate();
      setDraft({});
      toast(`已保存 ${r.count} 项绑定配置`, "ok");
    },
    onError: (e) => toast(e.message, "warn"),
  });

  /** 草稿：role -> "cid::model" | ""（跟随全局）；只存被改过的行 */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [applyAll, setApplyAll] = useState("");
  const dirtyCount = Object.keys(draft).length;

  const currentOf = (roleId: string) =>
    personal
      ? bindings?.find((x) => x.role === roleId && x.userId === user?.id)
      : bindings?.find((x) => x.role === roleId && x.userId === null);
  const valueOf = (roleId: string) => {
    if (roleId in draft) return draft[roleId];
    const b = currentOf(roleId);
    return b ? `${b.channelId}::${b.model}` : "";
  };

  const SOURCE_ZH: Record<string, string> = {
    personal: "个人覆盖", global: "全站绑定", default: "默认回落", any: "任意可用",
  };

  const save = () => {
    const items = Object.entries(draft).map(([role, v]) => {
      if (!v) return { role, binding: null };
      const [cid, model] = v.split("::");
      return { role, binding: { channelId: Number(cid), model } };
    });
    if (!items.length) return;
    setBindings.mutate({ items, personal });
  };

  return (
    <PaperCard className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <div className="font-bold text-[17px]">智能体模型绑定</div>
        {user && (
          <label className="flex items-center gap-1.5 text-[13px] text-[var(--ink-2)] cursor-pointer">
            <input
              type="checkbox"
              checked={personal}
              onChange={(e) => { setPersonal(e.target.checked); setDraft({}); }}
            />
            配置我的个人覆盖（仅对我生效）
          </label>
        )}
      </div>
      <p className="text-[13px] text-[var(--ink-3)] mb-3">
        每个 AI 角色可单独绑定不同渠道的不同模型——粗活用低配省钱，校验用顶配拉满。
        改动先存草稿，点「保存绑定配置」一次生效。
        {personal
          ? <span className="text-[var(--vermilion)]"> 当前正在编辑你的个人覆盖。</span>
          : isAdmin
            ? <span className="text-[var(--vermilion)]"> 当前正在编辑全站绑定（影响所有用户）。</span>
            : null}
      </p>

      {/* 一键套用：把同一渠道模型铺到全部对话角色（进草稿，仍需保存） */}
      <div className="flex flex-wrap items-center gap-2 mb-4 rounded-[2px] border border-dashed border-[var(--line)] px-3 py-2.5 bg-[var(--paper-deep)]/40">
        <span className="text-[13px] font-bold shrink-0">一键套用</span>
        <select
          className="flex-1 min-w-[220px] bg-transparent border border-[var(--line)] rounded-[2px] px-2 py-1.5 text-[13px] outline-none cursor-pointer"
          value={applyAll}
          onChange={(e) => setApplyAll(e.target.value)}
        >
          <option value="">选一个渠道 + 模型…</option>
          {(channels ?? []).filter((c) => c.kind === "chat" && c.enabled).map((c) => (
            <optgroup key={c.id} label={`${c.name}${c.userId ? "（我的个人节点）" : "（全站）"}`}>
              {c.models.map((m) => (
                <option key={`${c.id}::${m}`} value={`${c.id}::${m}`}>{m}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          disabled={!applyAll}
          onClick={() => {
            const next = { ...draft };
            for (const r of BINDING_ROLES) if (r.kind === "chat") next[r.id] = applyAll;
            setDraft(next);
            toast("已填入草稿，请点下方「保存绑定配置」生效", "ok");
          }}
          className="px-3.5 py-1.5 border border-[var(--ink)] rounded-[2px] text-[13px] font-bold disabled:opacity-40"
        >
          应用到全部对话角色
        </button>
      </div>

      <div className="space-y-3">
        {BINDING_ROLES.map((r) => {
          const chs = (channels ?? []).filter((c) => c.kind === r.kind && c.enabled);
          const route = routeMap?.find((x) => x.role === r.id);
          const dirty = r.id in draft;
          return (
            <div key={r.id} className="py-2 border-b border-[var(--line)] last:border-b-0">
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-40 shrink-0">
                  <div className="font-bold text-[14.5px]">{r.name}</div>
                  <div className="meta-label">{r.id}</div>
                </div>
                <select
                  className={`flex-1 min-w-[240px] bg-transparent border rounded-[2px] px-2 py-1.5 text-[13.5px] outline-none cursor-pointer ${dirty ? "border-[var(--vermilion)]" : "border-[var(--line)]"}`}
                  value={valueOf(r.id)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDraft((d) => {
                      const b = currentOf(r.id);
                      const orig = b ? `${b.channelId}::${b.model}` : "";
                      const next = { ...d };
                      if (v === orig) delete next[r.id];
                      else next[r.id] = v;
                      return next;
                    });
                  }}
                >
                  <option value="">跟随全局默认</option>
                  {chs.map((c) => (
                    <optgroup key={c.id} label={`${c.name}${c.userId ? "（我的个人节点）" : "（全站）"}`}>
                      {c.models.map((m) => (
                        <option key={`${c.id}::${m}`} value={`${c.id}::${m}`}>{m}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {dirty && <span className="meta-label text-[var(--vermilion)] shrink-0">未保存</span>}
              </div>
              {/* 实际路由：此刻这个角色真正会打到哪里 */}
              {route && route.channelName && (
                <div className="mt-1 ml-0 md:ml-[172px] flex items-center gap-1.5 text-[12px] text-[var(--ink-3)]">
                  <span>实际路由 →</span>
                  <span className="font-bold text-[var(--ink-2)]">{route.channelName} / {route.model}</span>
                  <span className={`meta-label border px-1 py-0.5 ${
                    route.source === "personal"
                      ? "border-[var(--bamboo)] text-[var(--bamboo)]"
                      : route.source === "global"
                        ? "border-[var(--line)] text-[var(--ink-3)]"
                        : "border-dashed border-[var(--line)] text-[var(--ink-3)]"
                  }`}>
                    {SOURCE_ZH[route.source ?? ""] ?? "未配置"}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3 flex-wrap">
        <button
          onClick={save}
          disabled={!dirtyCount || setBindings.isPending}
          className="px-5 py-2.5 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow text-[14.5px] disabled:opacity-40"
        >
          {setBindings.isPending ? "保存中…" : `保存绑定配置${dirtyCount ? `（${dirtyCount} 项改动）` : ""}`}
        </button>
        {dirtyCount > 0 && (
          <button
            onClick={() => setDraft({})}
            className="px-4 py-2 border border-[var(--line)] rounded-[2px] text-[13.5px]"
          >
            放弃修改
          </button>
        )}
        <span className="text-[12px] text-[var(--ink-3)]">
          {dirtyCount ? "改动还未保存——保存前不会生效。" : "所有改动已生效。「实际路由」即此刻真实生效的渠道。"}
        </span>
      </div>
    </PaperCard>
  );
}

interface CheckReport {
  channels: { id: number; name: string; kind: string; scope: string; ok: boolean; detail: string }[];
  roles: { role: string; ok: boolean; source: string; detail: string }[];
}

const ROLE_ZH: Record<string, string> = {
  default_chat: "默认对话", default_image: "默认绘图",
  agent_structure: "结构分析师", agent_question: "审题官", agent_locator: "定位官",
  agent_solver: "解题官", agent_reviewer: "校验官", agent_crosscheck: "交叉验证官",
  agent_generator: "命题官", sentence_parser: "拆句教练", vocab_lookup: "查词词典",
};

function SelfCheckPanel() {
  const [report, setReport] = useState<CheckReport | null>(null);
  const selfCheck = trpc.channel.selfCheck.useMutation({ onSuccess: (r) => setReport(r as CheckReport) });

  return (
    <PaperCard className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="font-bold text-[17px]">一键自检</div>
          <p className="text-[13px] text-[var(--ink-3)] mt-1">
            测试全部可见渠道连通性，并按「你的个人绑定」解析每个角色试跑——你在上面改了什么，这里就自检什么。
          </p>
        </div>
        <button
          onClick={() => { setReport(null); selfCheck.mutate(); }}
          disabled={selfCheck.isPending}
          className="px-5 py-2.5 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow text-[15px] disabled:opacity-50"
        >
          {selfCheck.isPending ? "体检中（约 1 分钟）…" : "开始自检"}
        </button>
      </div>
      {report && (
        <div className="mt-5 grid md:grid-cols-2 gap-5">
          <div>
            <div className="meta-label mb-2">渠道连通性</div>
            <div className="space-y-1.5">
              {report.channels.map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-[13.5px]">
                  <StatusDot ok={c.ok} warn={!c.ok} />
                  <span className="font-bold shrink-0">{c.name}</span>
                  <span className={`meta-label shrink-0 border px-1 py-0.5 ${c.scope === "个人" ? "border-[var(--bamboo)] text-[var(--bamboo)]" : "border-[var(--line)] text-[var(--ink-3)]"}`}>{c.scope}</span>
                  <span className={`truncate ${c.ok ? "text-[var(--ink-3)]" : "text-[var(--vermilion)]"}`}>{c.detail}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="meta-label mb-2">角色绑定试跑（按你的个人绑定解析）</div>
            <div className="space-y-1.5">
              {report.roles.map((r) => (
                <div key={r.role} className="flex items-center gap-2 text-[13.5px]">
                  <StatusDot ok={r.ok} warn={!r.ok} />
                  <span className="font-bold shrink-0">{ROLE_ZH[r.role] ?? r.role}</span>
                  {r.source && (
                    <span className={`meta-label shrink-0 border px-1 py-0.5 ${r.source === "个人绑定" ? "border-[var(--bamboo)] text-[var(--bamboo)]" : "border-[var(--line)] text-[var(--ink-3)]"}`}>{r.source}</span>
                  )}
                  <span className={`truncate ${r.ok ? "text-[var(--ink-3)]" : "text-[var(--vermilion)]"}`}>{r.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </PaperCard>
  );
}

/** 外观面板：主题三态 + 快捷键说明 */
function AppearancePanel() {
  const { theme, resolved, setTheme } = useTheme();
  const opts: { key: Theme; label: string; desc: string }[] = [
    { key: "system", label: "跟随系统", desc: `当前系统为${systemTheme() === "dark" ? "深色" : "浅色"}` },
    { key: "light", label: "宣纸浅", desc: "默认纸墨" },
    { key: "dark", label: "松烟深", desc: "夜读不伤眼" },
  ];
  return (
    <div className="border border-[var(--line)] rounded-[2px] p-5 bg-[var(--paper)]">
      <h3 className="text-[16px] font-bold">外观</h3>
      <p className="text-[12.5px] text-[var(--ink-3)] mt-1">当前生效：{resolved === "dark" ? "深色" : "浅色"}</p>
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {opts.map((o) => (
          <button
            key={o.key}
            onClick={() => setTheme(o.key)}
            className={`px-4 py-2 border rounded-[2px] text-left ${theme === o.key ? "border-[var(--vermilion)] text-[var(--vermilion)]" : "border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--ink-2)]"}`}
          >
            <span className="block text-[13.5px] font-bold">{o.label}</span>
            <span className="block text-[11.5px] opacity-70 mt-0.5">{o.desc}</span>
          </button>
        ))}
      </div>
      <p className="text-[12px] text-[var(--ink-3)] mt-3 border-t border-dashed border-[var(--line)] pt-2.5">
        快捷键：按 <kbd className="px-1.5 py-0.5 border border-[var(--line)] rounded-[2px] font-bold">i</kbd> 进入沉浸阅读（Esc 退出）·
        按 <kbd className="px-1.5 py-0.5 border border-[var(--line)] rounded-[2px] font-bold">?</kbd> 查看全部快捷键
      </p>
      <SoundToggle />
    </div>
  );
}

/** 音效开关：落章/翻书提示音，默认开（仅由点击触发，不会自动播放打扰） */
function SoundToggle() {
  const [on, setOn] = useSoundState();
  return (
    <div className="mt-3 border-t border-dashed border-[var(--line)] pt-2.5 flex items-center justify-between gap-3">
      <div>
        <span className="text-[13px] font-bold">动作音效</span>
        <span className="block text-[11.5px] text-[var(--ink-3)] mt-0.5">交卷落章 · 复习揭榜翻书（只在点击时播放）</span>
      </div>
      <button
        onClick={() => setOn(!on)}
        aria-pressed={on}
        className={`px-4 py-1.5 border rounded-[2px] text-[13px] font-bold transition-colors ${
          on ? "border-[var(--bamboo)] text-[var(--bamboo)]" : "border-[var(--line)] text-[var(--ink-3)]"
        }`}
      >
        {on ? "开" : "关"}
      </button>
    </div>
  );
}

/** 导出中心：全量备份下载 + 恢复（先预览计数再落库） */
function ExportPanel() {
  const { user } = useUser();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [importPreview, setImportPreview] = useState<{ report: ImportReport; backup: Record<string, unknown>; strategy: "skip" | "overwrite" } | null>(null);
  const [strategy, setStrategy] = useState<"skip" | "overwrite">("skip");
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    try {
      const data = await utils.export.fullBackup.fetch();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `考研阅读备份_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("备份已下载", "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "导出失败", "warn");
    }
  };

  const importMut = trpc.export.importBackup.useMutation();

  const pickFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const backup = JSON.parse(String(reader.result)) as Record<string, unknown>;
        if (backup.version !== "v5") {
          toast("备份格式不受支持（需要 v5 格式）", "warn");
          return;
        }
        const r = await importMut.mutateAsync({ backup, strategy, dryRun: true });
        setImportPreview({ report: r.report as ImportReport, backup, strategy });
      } catch (e) {
        toast(e instanceof Error ? e.message : "备份文件解析失败", "warn");
      }
    };
    reader.readAsText(f);
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    try {
      const r = await importMut.mutateAsync({ backup: importPreview.backup, strategy: importPreview.strategy, dryRun: false });
      setImportPreview(null);
      toast(`恢复完成：生词 +${r.report.vocab.add} · 素材 +${r.report.materials.add} · 感悟 +${r.report.insights.add}`, "ok");
      void utils.invalidate();
    } catch (e) {
      toast(e instanceof Error ? e.message : "恢复失败", "warn");
    }
  };

  if (!user) {
    return (
      <div className="border border-[var(--line)] rounded-[2px] p-5 bg-[var(--paper)]">
        <h3 className="text-[16px] font-bold">数据备份与恢复</h3>
        <p className="text-[13px] text-[var(--ink-3)] mt-2">登录后可导出全量学习档案（练习记录/错题/感悟/生词/作文/素材）。</p>
      </div>
    );
  }

  return (
    <div className="border border-[var(--line)] rounded-[2px] p-5 bg-[var(--paper)]">
      <h3 className="text-[16px] font-bold">数据备份与恢复</h3>
      <p className="text-[12.5px] text-[var(--ink-3)] mt-1">
        全量打包：练习记录 · 错题与诊断书 · 感悟 · 生词 · AI 仿真题 · 作文与写作会话 · 素材库（生词配图可再生，不随包走）
      </p>
      <div className="flex items-center gap-3 mt-4 flex-wrap">
        <button onClick={() => void doExport()} className="px-5 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow text-[13.5px] font-bold hover:opacity-90">
          ⬇ 导出全量备份
        </button>
        <button onClick={() => fileRef.current?.click()} className="px-5 py-2 border border-[var(--ink)] rounded-[2px] text-[13.5px] font-bold hover:bg-[var(--paper-deep)]">
          ⬆ 选择备份文件恢复…
        </button>
        <select value={strategy} onChange={(e) => setStrategy(e.target.value as "skip" | "overwrite")} className="border border-[var(--line)] rounded-[2px] px-2.5 py-2 text-[13px] bg-[var(--paper)]">
          <option value="skip">遇重跳过</option>
          <option value="overwrite">遇重覆盖</option>
        </select>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ""; }} />
      </div>
      {importMut.isPending && <p className="text-[13px] text-[var(--ink-3)] mt-3">解析备份中…</p>}
      {importPreview && (
        <div className="mt-4 border-2 border-[var(--ink)] rounded-[2px] p-4 bg-[var(--paper-deep)]/40">
          <p className="text-[13.5px] font-bold">恢复预览（{importPreview.strategy === "skip" ? "遇重跳过" : "遇重覆盖"}）</p>
          <p className="text-[13px] text-[var(--ink-2)] mt-2">
            生词：新增 {importPreview.report.vocab.add} · 跳过 {importPreview.report.vocab.skip}
            素材：新增 {importPreview.report.materials.add} · 跳过 {importPreview.report.materials.skip}
            感悟：新增 {importPreview.report.insights.add}
          </p>
          <p className="text-[12px] text-[var(--ink-3)] mt-1">练习记录/错题等历史档案只读不回灌，避免覆盖现有进度。</p>
          <div className="flex items-center gap-2.5 mt-3">
            <button onClick={() => void confirmImport()} disabled={importMut.isPending} className="px-4 py-1.5 bg-[var(--vermilion)] text-[var(--paper)] rounded-[2px] print-shadow text-[13px] font-bold disabled:opacity-40">
              确认恢复
            </button>
            <button onClick={() => setImportPreview(null)} className="px-4 py-1.5 border border-[var(--line)] rounded-[2px] text-[13px]">取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

type ImportReport = { vocab: { add: number; skip: number }; materials: { add: number; skip: number }; insights: { add: number } };

export default function SettingsPage() {
  return (
    <div className="max-w-[960px] mx-auto">
      <InkReveal className="mb-8">
        <div className="meta-label mb-2">CHANNELS · BINDINGS · HEALTH</div>
        <h1 className="text-[34px] font-black">
          <BrushTitle vermilion>设置中心</BrushTitle>
        </h1>
        <p className="text-[var(--ink-2)] mt-2 text-[15px]">
          节点永久入库，OpenAI / Anthropic 双协议；Key 只存服务端，前端仅显示掩码。顶栏「模型」按钮可随时快捷管理。
        </p>
      </InkReveal>

      <InkReveal delay={60}>
        <h2 className="text-[20px] font-bold mb-3">外观与数据</h2>
        <div className="space-y-4">
          <AppearancePanel />
          <ExportPanel />
          <ServerSettingsCard />
        </div>
      </InkReveal>

      <InkReveal delay={80} className="mt-10">
        <h2 className="text-[20px] font-bold mb-3">API 节点</h2>
        <ModelManager />
      </InkReveal>

      <InkReveal delay={140} className="mt-10">
        <BindingsPanel />
      </InkReveal>

      <InkReveal delay={200} className="mt-6">
        <SelfCheckPanel />
      </InkReveal>
    </div>
  );
}
