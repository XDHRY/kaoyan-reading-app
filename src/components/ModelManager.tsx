import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { StatusDot } from "@/components/ink/decor";
import { useUser } from "@/hooks/useUser";

/** 与后端 Channel 对应的脱敏形状 */
interface ChannelSafe {
  id: number;
  name: string;
  kind: "chat" | "image";
  protocol: "openai" | "anthropic";
  baseUrl: string;
  apiKey: string;
  models: string[];
  reasoningEffort: string | null;
  config: {
    temperature?: number;
    maxTokens?: number;
    timeoutSec?: number;
    retries?: number;
    extraParams?: Record<string, unknown>;
  } | null;
  enabled: boolean;
  isDefault: boolean;
  /** null=全站节点；数字=该用户的个人节点 */
  userId: number | null;
}

const EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
const EFFORT_ZH: Record<string, string> = {
  none: "无", low: "低", medium: "中", high: "高", xhigh: "超高", max: "顶格",
};

interface FormState {
  name: string;
  kind: "chat" | "image";
  protocol: "openai" | "anthropic";
  baseUrl: string;
  apiKey: string;
  reasoningEffort: string; // "" = 不发送
  temperature: string;
  maxTokens: string;
  timeoutSec: string;
  retries: string;
  extraParams: string;
  isDefault: boolean;
  personal: boolean;
}

const emptyForm: FormState = {
  name: "", kind: "chat", protocol: "openai", baseUrl: "", apiKey: "",
  reasoningEffort: "", temperature: "", maxTokens: "", timeoutSec: "", retries: "", extraParams: "",
  isDefault: false, personal: true,
};

function formOf(c: ChannelSafe): FormState {
  return {
    name: c.name, kind: c.kind, protocol: c.protocol, baseUrl: c.baseUrl, apiKey: c.apiKey,
    reasoningEffort: c.reasoningEffort ?? "",
    temperature: c.config?.temperature?.toString() ?? "",
    maxTokens: c.config?.maxTokens?.toString() ?? "",
    timeoutSec: c.config?.timeoutSec?.toString() ?? "",
    retries: c.config?.retries?.toString() ?? "",
    extraParams: c.config?.extraParams ? JSON.stringify(c.config.extraParams, null, 2) : "",
    isDefault: c.isDefault,
    personal: c.userId !== null,
  };
}

export function ModelManager({ onChanged }: { onChanged?: () => void }) {
  const utils = trpc.useUtils();
  const { user } = useUser();
  const isAdmin = user?.role === "admin";
  const { data: channels, refetch } = trpc.channel.list.useQuery();
  const [editing, setEditing] = useState<ChannelSafe | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [manualModel, setManualModel] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testResult, setTestResult] = useState<Record<number, { ok: boolean; detail: string }>>({});
  const [msg, setMsg] = useState("");

  const create = trpc.channel.create.useMutation();
  const update = trpc.channel.update.useMutation();
  const remove = trpc.channel.remove.useMutation();
  const test = trpc.channel.test.useMutation();

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(""), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  const startCreate = (personal: boolean) => {
    setEditing(null);
    setForm({ ...emptyForm, personal });
    setModels([]);
    setShowAdvanced(false);
  };

  const startEdit = (c: ChannelSafe) => {
    setEditing(c);
    setForm(formOf(c));
    setModels(c.models);
    setShowAdvanced(!!(c.config && Object.keys(c.config).length));
  };

  const cancel = () => {
    setEditing(null);
    setForm(null);
  };

  const refresh = async () => {
    await refetch();
    await utils.channel.listBindings.invalidate();
    onChanged?.();
  };

  const parseConfig = () => {
    if (!form) return null;
    const cfg: NonNullable<ChannelSafe["config"]> = {};
    if (form.temperature.trim()) cfg.temperature = Number(form.temperature);
    if (form.maxTokens.trim()) cfg.maxTokens = Number(form.maxTokens);
    if (form.timeoutSec.trim()) cfg.timeoutSec = Number(form.timeoutSec);
    if (form.retries.trim()) cfg.retries = Number(form.retries);
    if (form.extraParams.trim()) {
      const parsed = JSON.parse(form.extraParams);
      if (typeof parsed !== "object" || !parsed) throw new Error("自定义参数必须是 JSON 对象");
      cfg.extraParams = parsed;
    }
    return Object.keys(cfg).length ? cfg : null;
  };

  const save = async () => {
    if (!form) return;
    try {
      const config = parseConfig();
      const effort = form.reasoningEffort ? (form.reasoningEffort as (typeof EFFORTS)[number]) : null;
      if (editing) {
        await update.mutateAsync({
          id: editing.id, name: form.name, protocol: form.protocol, baseUrl: form.baseUrl,
          apiKey: form.apiKey, models, reasoningEffort: effort, config, isDefault: form.isDefault,
        });
        setMsg(`节点「${form.name}」已保存`);
      } else {
        await create.mutateAsync({
          name: form.name, kind: form.kind, protocol: form.protocol, baseUrl: form.baseUrl,
          apiKey: form.apiKey, models, reasoningEffort: effort, config,
          isDefault: form.personal ? false : form.isDefault,
          personal: form.personal,
        });
        setMsg(`${form.personal ? "个人" : "全站"}节点「${form.name}」已创建`);
      }
      cancel();
      await refresh();
    } catch (e) {
      setMsg(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const doTest = async (id: number) => {
    setTestResult((m) => ({ ...m, [id]: { ok: false, detail: "测试中…" } }));
    const r = await test.mutateAsync({ id });
    setTestResult((m) => ({ ...m, [id]: r }));
  };

  const fetchModelList = async () => {
    if (!editing) {
      setMsg("请先保存节点，再拉取模型列表");
      return;
    }
    try {
      const r = await utils.client.channel.fetchModels.mutate({ id: editing.id });
      setModels(r.models);
      setMsg(`已拉取 ${r.models.length} 个模型`);
      await refresh();
    } catch (e) {
      setMsg(`拉取失败：${e instanceof Error ? e.message.slice(0, 120) : String(e)}（可手动输入模型名）`);
    }
  };

  const addManual = async () => {
    const name = manualModel.trim();
    if (!name) return;
    if (editing) {
      const r = await utils.client.channel.addModel.mutate({ id: editing.id, model: name });
      setModels(r.models);
      await refresh();
    } else {
      setModels((m) => Array.from(new Set([...m, name])).sort());
    }
    setManualModel("");
  };

  const removeModel = async (m: string) => {
    const next = models.filter((x) => x !== m);
    setModels(next);
    if (editing) {
      await update.mutateAsync({ id: editing.id, models: next });
      await refresh();
    }
  };

  const mine = (channels as ChannelSafe[] | undefined)?.filter((c) => c.userId !== null) ?? [];
  const global = (channels as ChannelSafe[] | undefined)?.filter((c) => c.userId === null) ?? [];

  const renderChannel = (c: ChannelSafe) => {
    const manageable = isAdmin || c.userId === user?.id;
    return (
      <div key={c.id} className="border border-[var(--line)] bg-[#fffdf7] p-4 rounded-[2px]">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusDot ok={testResult[c.id]?.ok ?? (c.enabled ? null : false)} />
          <span className="font-bold">{c.name}</span>
          <span className="meta-label border border-[var(--line)] px-1.5 py-0.5">{c.protocol === "openai" ? "OPENAI" : "ANTHROPIC"}</span>
          <span className="meta-label border border-[var(--line)] px-1.5 py-0.5">{c.kind === "chat" ? "对话" : "绘图"}</span>
          {c.userId !== null && <span className="meta-label text-[var(--bamboo)] border border-[var(--bamboo)] px-1.5 py-0.5">个人</span>}
          {c.isDefault && <span className="meta-label text-[var(--vermilion)] border border-[var(--vermilion)] px-1.5 py-0.5">默认</span>}
          {!c.enabled && <span className="meta-label text-[var(--ink-3)]">已停用</span>}
          {c.reasoningEffort && (
            <span className="meta-label text-[var(--bamboo)]">思考·{EFFORT_ZH[c.reasoningEffort] ?? c.reasoningEffort}</span>
          )}
          <span className="flex-1" />
          {manageable && (
            <>
              <button className="text-[13px] underline underline-offset-4" onClick={() => doTest(c.id)}>测试</button>
              <button className="text-[13px] underline underline-offset-4" onClick={() => startEdit(c)}>编辑</button>
              <button
                className="text-[13px] underline underline-offset-4 text-[var(--vermilion)]"
                onClick={async () => {
                  if (confirm(`确定删除节点「${c.name}」？相关绑定会一并清除`)) {
                    await remove.mutateAsync({ id: c.id });
                    await refresh();
                  }
                }}
              >删除</button>
            </>
          )}
          {!manageable && <span className="meta-label text-[var(--ink-3)]">管理员维护</span>}
        </div>
        <div className="meta-label mt-2 text-[var(--ink-3)]">
          {c.baseUrl} · {c.apiKey} · {c.models.length} 个模型
        </div>
        {testResult[c.id] && (
          <div className={`mt-2 text-[13px] ${testResult[c.id].ok ? "text-[var(--bamboo)]" : "text-[var(--vermilion)]"}`}>
            {testResult[c.id].detail}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* 我的个人节点 */}
      <div className="meta-label mb-2">MY CHANNELS · 我的个人节点（key 仅自己可见可用）</div>
      <div className="space-y-3">
        {mine.map(renderChannel)}
        {mine.length === 0 && (
          <p className="text-[13px] text-[var(--ink-3)] border border-dashed border-[var(--line)] rounded-[2px] px-4 py-3">
            还没有个人节点。添加你自己的 API 中转站/key，再到下方「智能体模型绑定」勾选「配置我的个人覆盖」，全站配置不动，你的账号走自己的渠道。
          </p>
        )}
      </div>
      {!form && user && (
        <button
          onClick={() => startCreate(true)}
          className="mt-3 w-full border-2 border-dashed border-[var(--bamboo)]/60 py-3 text-[15px] text-[var(--bamboo)] hover:border-[var(--bamboo)] transition-colors"
        >
          ＋ 保存我的个人 API 节点
        </button>
      )}
      {!form && !user && (
        <p className="mt-3 text-[13px] text-[var(--vermilion)]">登录后即可保存你的个人 API 节点。</p>
      )}

      {/* 全站节点 */}
      <div className="meta-label mt-7 mb-2">GLOBAL CHANNELS · 全站节点{isAdmin ? "（你是管理员，可维护）" : "（管理员维护）"}</div>
      <div className="space-y-3">
        {global.map(renderChannel)}
      </div>
      {!form && isAdmin && (
        <button
          onClick={() => startCreate(false)}
          className="mt-3 w-full border-2 border-dashed border-[var(--line)] py-3 text-[15px] hover:border-[var(--vermilion)] hover:text-[var(--vermilion)] transition-colors"
        >
          ＋ 新增全站 API 节点
        </button>
      )}

      {/* 编辑表单 */}
      {form && (
        <div className="mt-4 border-2 border-[var(--ink)] bg-[#fffdf7] p-5 rounded-[2px]">
          <div className="font-bold mb-1">
            {editing ? `编辑节点 · ${editing.name}` : form.personal ? "新增我的个人节点" : "新增全站节点"}
          </div>
          <p className="text-[12.5px] text-[var(--ink-3)] mb-4">
            {form.personal
              ? "个人节点只属于你的账号：其他用户看不见、用不了；配好后到「智能体模型绑定」勾选个人覆盖即可启用。"
              : "全站节点对所有用户生效，仅管理员可维护。"}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="ink-label">节点名称</label>
              <input className="ink-input" placeholder="例如：我的中转站·对话" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="ink-label">协议</label>
                <select className="ink-select" value={form.protocol}
                  onChange={(e) => setForm({ ...form, protocol: e.target.value as "openai" | "anthropic" })}>
                  <option value="openai">OpenAI 兼容</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </div>
              <div>
                <label className="ink-label">用途</label>
                <select className="ink-select" value={form.kind} disabled={!!editing}
                  onChange={(e) => setForm({ ...form, kind: e.target.value as "chat" | "image" })}>
                  <option value="chat">对话</option>
                  <option value="image">绘图</option>
                </select>
              </div>
            </div>
            <div>
              <label className="ink-label">模型地址 BASE URL</label>
              <input className="ink-input" placeholder="https://api.example.com（/v1 可省）" value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
            </div>
            <div>
              <label className="ink-label">API KEY</label>
              <input className="ink-input" placeholder="sk-...（编辑时不改动即保留原 key）" value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
            </div>
            <div>
              <label className="ink-label">思考强度默认值 REASONING EFFORT</label>
              <select className="ink-select" value={form.reasoningEffort}
                onChange={(e) => setForm({ ...form, reasoningEffort: e.target.value })}>
                <option value="">不发送（由模型档位决定）</option>
                {EFFORTS.map((x) => <option key={x} value={x}>{x} · {EFFORT_ZH[x]}</option>)}
              </select>
            </div>
            {!form.personal && (
              <div className="flex items-end gap-2 pb-1">
                <label className="flex items-center gap-2 text-[14px] cursor-pointer">
                  <input type="checkbox" checked={form.isDefault}
                    onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
                  设为该用途默认渠道
                </label>
              </div>
            )}
          </div>

          {/* 模型清单 */}
          <div className="mt-5">
            <label className="ink-label">模型清单（{models.length}）</label>
            <div className="flex gap-2 mb-2">
              <button onClick={fetchModelList} className="px-3 py-1.5 text-[13px] border border-[var(--ink-2)] rounded-[2px] hover:bg-[var(--paper-deep)]">
                一键拉取模型
              </button>
              <input className="ink-input flex-1" placeholder="手动输入模型名，回车追加（Anthropic 常用）"
                value={manualModel} onChange={(e) => setManualModel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addManual()} />
              <button onClick={addManual} className="px-3 py-1.5 text-[13px] border border-[var(--ink-2)] rounded-[2px] hover:bg-[var(--paper-deep)]">追加</button>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
              {models.map((m) => (
                <span key={m} className="meta-label border border-[var(--line)] px-1.5 py-0.5 bg-[var(--paper)]">
                  {m}
                  <button className="ml-1 text-[var(--vermilion)]" onClick={() => removeModel(m)}>×</button>
                </span>
              ))}
              {models.length === 0 && <span className="text-[13px] text-[var(--ink-3)]">暂无模型，拉取或手动添加</span>}
            </div>
          </div>

          {/* 高级配置 */}
          <div className="mt-5">
            <button onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-[13px] underline underline-offset-4 text-[var(--ink-3)]">
              {showAdvanced ? "▾ 收起高级配置" : "▸ 高级配置（温度 / token / 超时重试 / 自定义参数）"}
            </button>
            {showAdvanced && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                <div>
                  <label className="ink-label">温度</label>
                  <input className="ink-input" placeholder="0-2，空=默认" value={form.temperature}
                    onChange={(e) => setForm({ ...form, temperature: e.target.value })} />
                </div>
                <div>
                  <label className="ink-label">最大输出 TOKEN</label>
                  <input className="ink-input" placeholder="如 8192" value={form.maxTokens}
                    onChange={(e) => setForm({ ...form, maxTokens: e.target.value })} />
                </div>
                <div>
                  <label className="ink-label">超时（秒）</label>
                  <input className="ink-input" placeholder="默认 180" value={form.timeoutSec}
                    onChange={(e) => setForm({ ...form, timeoutSec: e.target.value })} />
                </div>
                <div>
                  <label className="ink-label">失败重试次数</label>
                  <input className="ink-input" placeholder="默认 1" value={form.retries}
                    onChange={(e) => setForm({ ...form, retries: e.target.value })} />
                </div>
                <div className="col-span-2 md:col-span-4">
                  <label className="ink-label">自定义请求参数（JSON，原样合并进请求体）</label>
                  <textarea className="ink-textarea font-mono text-[12px]" rows={3}
                    placeholder={'{"top_p": 0.9, "presence_penalty": 0.1}'}
                    value={form.extraParams} onChange={(e) => setForm({ ...form, extraParams: e.target.value })} />
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3 mt-5">
            <button onClick={save} disabled={create.isPending || update.isPending}
              className="px-5 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow text-[15px] disabled:opacity-50">
              {create.isPending || update.isPending ? "保存中…" : "保存节点"}
            </button>
            <button onClick={cancel} className="px-5 py-2 border border-[var(--line)] rounded-[2px] text-[15px]">取消</button>
          </div>
        </div>
      )}

      {msg && <div className="mt-3 text-[13px] text-[var(--ink-2)] border-l-2 border-[var(--vermilion)] pl-2">{msg}</div>}
    </div>
  );
}
