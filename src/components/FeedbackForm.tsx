import { useRef, useState } from "react";
import { useLocation, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Seal } from "@/components/ink/Seal";
import { APP_VERSION, recentErrors } from "@/lib/errorLog";
import { useToast } from "@/hooks/useToast";

const KINDS = [
  { id: "bug", label: "报错" },
  { id: "suggest", label: "建议" },
  { id: "question", label: "疑问" },
  { id: "other", label: "其他" },
] as const;

interface Shot {
  name: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
  dataBase64: string;
  preview: string;
}

/** 图片压缩：最长边 1280、JPEG 0.72 —— 截图可读性与体积的平衡点（≤400KB/张） */
async function compressImage(file: File): Promise<Shot> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.72));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
  const dataBase64 = btoa(bin);
  if (dataBase64.length > 600_000) throw new Error("图片过大，请裁小后再传");
  return { name: file.name || "screenshot.jpg", mime: "image/jpeg", dataBase64, preview: `data:image/jpeg;base64,${dataBase64}` };
}

/** 工单反馈表单（个人中心嵌入版）：页面位置、控制台报错、UA、视口自动随单归档。
 *  原为全站浮动反馈印，v5.5 起收进个人中心，保持各页界面洁净。 */
export function FeedbackForm({ onDone }: { onDone?: () => void }) {
  const { toast } = useToast();
  const loc = useLocation();
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("bug");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [locationText, setLocationText] = useState("");
  const [errorText, setErrorText] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [compressing, setCompressing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const errs = recentErrors();

  const create = trpc.ticket.create.useMutation({
    onSuccess: () => {
      toast("工单已递上，掌门会尽快处理");
      setTitle(""); setContent(""); setLocationText(""); setErrorText(""); setShots([]);
      onDone?.();
    },
    onError: (e) => toast(e.message || "提交失败，请稍后再试"),
  });

  const pickFiles = async (files: FileList | null) => {
    if (!files) return;
    setCompressing(true);
    try {
      for (const f of Array.from(files).slice(0, 3 - shots.length)) {
        if (!f.type.startsWith("image/")) continue;
        const shot = await compressImage(f);
        setShots((s) => (s.length < 3 ? [...s, shot] : s));
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "图片处理失败");
    } finally {
      setCompressing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = () => {
    if (title.trim().length < 2 || content.trim().length < 2) return;
    create.mutate({
      kind,
      title: title.trim(),
      content: content.trim(),
      // 表单常驻个人中心，真实事发页请写在「具体位置」里；此处记录提交页即可
      pageUrl: loc.pathname + loc.search,
      locationText: locationText.trim(),
      errorText: errorText.trim(),
      consoleErrors: errs,
      userAgent: navigator.userAgent.slice(0, 250),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      appVersion: APP_VERSION,
      attachments: shots.map(({ name, mime, dataBase64 }) => ({ name, mime, dataBase64 })),
    });
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-4">
        <p className="text-[12.5px] text-[var(--ink-3)] leading-relaxed max-w-[420px]">
          报错日志、设备信息会自动随单附上；事发页面请写进「具体位置」。进度在
          <Link to="/tickets" className="text-[var(--vermilion)] underline underline-offset-2">工单中心</Link>查看。
        </p>
        <Seal size={46} seed="feedback" center="递" />
      </div>

      {/* 分类 */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {KINDS.map((k) => (
          <button
            key={k.id}
            onClick={() => setKind(k.id)}
            className={`px-3 py-1 text-[13px] border rounded-[2px] ${kind === k.id ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)]"}`}
          >{k.label}</button>
        ))}
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={128}
        placeholder="一句话说清问题（必填）"
        className="w-full border border-[var(--line)] rounded-[2px] px-3 py-2 text-[14px] bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)] mb-2.5"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        maxLength={4000}
        placeholder="详细描述：你在做什么、期望什么、实际发生了什么……（必填）"
        className="w-full border border-[var(--line)] rounded-[2px] px-3 py-2 text-[14px] bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)] mb-2.5"
      />
      <input
        value={locationText}
        onChange={(e) => setLocationText(e.target.value)}
        maxLength={255}
        placeholder="具体位置（可空，如：顿悟室第三题的解析框）"
        className="w-full border border-[var(--line)] rounded-[2px] px-3 py-2 text-[13px] bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)] mb-2.5"
      />
      <textarea
        value={errorText}
        onChange={(e) => setErrorText(e.target.value)}
        rows={2}
        maxLength={4000}
        placeholder="报错内容（可空，粘贴页面红字/提示原文）"
        className="w-full border border-[var(--line)] rounded-[2px] px-3 py-2 text-[13px] bg-[var(--paper)] focus:outline-none focus:border-[var(--ink-2)] mb-2.5"
      />

      {/* 截图 */}
      <div className="mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={shots.length >= 3 || compressing}
            className="px-3 py-1.5 text-[13px] border border-dashed border-[var(--ink-2)] rounded-[2px] disabled:opacity-40"
          >{compressing ? "处理中…" : `＋ 附截图（${shots.length}/3）`}</button>
          {shots.map((s, i) => (
            <span key={i} className="relative inline-block">
              <img src={s.preview} alt={`截图${i + 1}`} className="h-14 border border-[var(--line)] rounded-[2px]" />
              <button
                onClick={() => setShots((arr) => arr.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 text-[10px] bg-[var(--vermilion)] text-[var(--paper)] rounded-full leading-none"
              >×</button>
            </span>
          ))}
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void pickFiles(e.target.files)} />
        </div>
        <p className="text-[11.5px] text-[var(--ink-3)] mt-1">截图自动压缩，随单存档，仅你与掌门可见。</p>
      </div>

      {/* 自动捕获预览 */}
      <div className="border border-[var(--line)] rounded-[2px] p-2.5 mb-4 bg-[var(--paper-deep)]/40">
        <div className="meta-label mb-1.5">自动随单信息</div>
        <p className="text-[11.5px] text-[var(--ink-3)]">提交页 {loc.pathname} · 视口 {typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "-"} · v{APP_VERSION}</p>
        {errs.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {errs.map((e, i) => (
              <li key={i} className="text-[11px] text-[var(--vermilion)] truncate">⚑ {e.msg}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-[var(--ink-3)] mt-0.5">近期无控制台报错（好事）</p>
        )}
      </div>

      <button
        onClick={submit}
        disabled={create.isPending || title.trim().length < 2 || content.trim().length < 2 || compressing}
        className="px-5 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] text-[14px] font-bold disabled:opacity-40"
      >{create.isPending ? "递单中…" : "递上工单"}</button>
    </div>
  );
}
