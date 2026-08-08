import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useUser } from "@/hooks/useUser";

/**
 * 全局模型选择窗口：对话模型 + 绘图模型，按渠道分组
 * 即选即生效（写入 default_chat / default_image 绑定）
 */
export function ModelSwitcher() {
  const utils = trpc.useUtils();
  const { data: channels } = trpc.channel.list.useQuery();
  const { data: bindings } = trpc.channel.listBindings.useQuery();
  const setBinding = trpc.channel.setBinding.useMutation({
    onSuccess: () => utils.channel.listBindings.invalidate(),
  });

  const chatChannels = (channels ?? []).filter((c) => c.kind === "chat" && c.enabled);
  const imageChannels = (channels ?? []).filter((c) => c.kind === "image" && c.enabled);
  const { user } = useUser();
  // 优先显示自己的个人覆盖，没有才回落全站绑定（管理员的 listBindings 含他人绑定，不能直接 find）
  const mine = (role: string) =>
    bindings?.find((b) => b.role === role && b.userId === user?.id) ??
    bindings?.find((b) => b.role === role && b.userId === null);
  const chatBinding = mine("default_chat");
  const imageBinding = mine("default_image");

  const [chatSel, setChatSel] = useState("");
  const [imageSel, setImageSel] = useState("");

  useEffect(() => {
    if (chatBinding) setChatSel(`${chatBinding.channelId}::${chatBinding.model}`);
    if (imageBinding) setImageSel(`${imageBinding.channelId}::${imageBinding.model}`);
  }, [chatBinding?.channelId, chatBinding?.model, imageBinding?.channelId, imageBinding?.model]);

  const pick = (value: string, role: string) => {
    const [cid, model] = value.split("::");
    if (!cid || !model) return;
    // 快速切换只写个人覆盖——普通用户无权写全站绑定（会被服务端拒），
    // 管理员在此处切换也不应顺手改掉全站默认（全站绑定请到设置中心改）。
    setBinding.mutate({ role, channelId: Number(cid), model, personal: true });
  };

  const renderOptions = (chs: typeof chatChannels) =>
    chs.map((c) => (
      <optgroup key={c.id} label={`${c.name}（${c.protocol === "openai" ? "OpenAI" : "Anthropic"}）`}>
        {c.models.map((m) => (
          <option key={`${c.id}::${m}`} value={`${c.id}::${m}`}>
            {m}
          </option>
        ))}
      </optgroup>
    ));

  const selectCls =
    "bg-transparent border border-[var(--line)] rounded-[2px] px-2 py-1 text-[13px] max-w-[190px] truncate focus:border-[var(--ink-2)] outline-none cursor-pointer";

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5">
        <span className="meta-label">对话</span>
        <select
          className={selectCls}
          value={chatSel}
          onChange={(e) => {
            setChatSel(e.target.value);
            pick(e.target.value, "default_chat");
          }}
          title="选择对话模型"
        >
          {!chatSel && <option value="">未配置</option>}
          {renderOptions(chatChannels)}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="meta-label">绘图</span>
        <select
          className={selectCls}
          value={imageSel}
          onChange={(e) => {
            setImageSel(e.target.value);
            pick(e.target.value, "default_image");
          }}
          title="选择绘图模型"
        >
          {!imageSel && <option value="">未配置</option>}
          {renderOptions(imageChannels)}
        </select>
      </div>
    </div>
  );
}
