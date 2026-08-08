import type { ReactNode } from "react";
import { Seal } from "@/components/ink/Seal";
import type { PipelineJobView } from "@/hooks/usePipelineJob";

const STAGE_META: { key: string; label: string; short: string }[] = [
  { key: "structure", label: "结构分析师 · 拆解行文结构", short: "结构" },
  { key: "question", label: "审题官 · 读题 3Q", short: "审题" },
  { key: "locate", label: "定位官 · 定位解题范围", short: "定位" },
  { key: "solve", label: "解题官 + 校验官 · 对比解题", short: "解题" },
  { key: "crosscheck", label: "交叉验证 · 第二模型陪审", short: "交叉" },
];

function fmt(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m${sec % 60}s`;
}

interface Props {
  job: PipelineJobView | null;
  now: number;
  starting: boolean;
  retrying: boolean;
  pausing?: boolean;
  resuming?: boolean;
  cancelling?: boolean;
  canSubmit: boolean;
  remaining: number;
  onStart: () => void;
  onRetry: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onClose?: () => void;
  doneSlot?: ReactNode;
}

/** 阶段行渲染（进行中/暂停/失败三态共用） */
function StageLines({ job, now }: { job: PipelineJobView; now: number }) {
  const byStage = new Map(job.stages.map((s) => [s.stage, s]));
  return (
    <div className="text-[12.5px] text-[var(--ink-3)] mt-3 space-y-1 text-left inline-block">
      {STAGE_META.map((m) => {
        const rec = byStage.get(m.key);
        if (rec?.status === "ok") {
          const skipped = rec.error === "已跳过";
          return (
            <div key={m.key} className={skipped ? "opacity-60" : ""}>
              {skipped ? "⊘" : "✓"} {m.short}（{fmt(Math.round((rec.elapsedMs ?? 0) / 1000))}）
            </div>
          );
        }
        if (rec?.status === "running") {
          const el = rec.startedAt ? Math.max(0, Math.round((now - rec.startedAt) / 1000)) : 0;
          return (
            <div key={m.key} className="text-[var(--vermilion)] font-bold">
              ▸ {m.short} 进行中… {fmt(el)}
            </div>
          );
        }
        if (rec?.status === "error") {
          return (
            <div key={m.key} className="text-[var(--vermilion)]">
              ✗ {m.short}{rec.error === "已停止" ? " 已停止" : " 失败"}
            </div>
          );
        }
        return (
          <div key={m.key} className="opacity-40">
            ○ {m.short}
          </div>
        );
      })}
    </div>
  );
}

/** 流水线提交/进度卡：任务式执行 + 实时计时 + 断点重试 + 暂停/继续/停止/关闭全控制 */
export function PipelinePanel({
  job, now, starting, retrying, pausing, resuming, cancelling,
  canSubmit, remaining, onStart, onRetry, onPause, onResume, onCancel, onClose, doneSlot,
}: Props) {
  // —— 进行中：可暂停、可停止 ——
  if (job?.status === "running") {
    return (
      <div>
        <Seal size={72} seed={`run-${job.stage}`} center="析" animate />
        <p className="mt-3 font-bold text-[16px]">AI 教练团接力解析中……</p>
        <StageLines job={job} now={now} />
        <div className="flex items-center justify-center gap-3 mt-4 flex-wrap">
          {onPause && (
            <button
              onClick={onPause}
              disabled={pausing || cancelling}
              className="px-4 py-1.5 border border-[var(--ink)] rounded-[2px] text-[13.5px] hover:bg-[var(--paper-deep)] disabled:opacity-40"
            >
              {pausing ? "暂停中…" : "⏸ 暂停"}
            </button>
          )}
          {onCancel && (
            <button
              onClick={onCancel}
              disabled={cancelling || pausing}
              className="px-4 py-1.5 border border-[var(--vermilion)] text-[var(--vermilion)] rounded-[2px] text-[13.5px] hover:bg-[var(--vermilion)]/10 disabled:opacity-40"
            >
              {cancelling ? "停止中…" : "■ 停止"}
            </button>
          )}
        </div>
        <p className="text-[12px] text-[var(--ink-3)] mt-3">
          任务在后台执行，离开本页也不会中断 · 任务号 #{job.id} · 暂停/停止后进度保留，可随时续跑
        </p>
      </div>
    );
  }

  // —— 已暂停：可继续、可停止 ——
  if (job?.status === "paused") {
    return (
      <div>
        <Seal size={72} seed={`pause-${job.stage}`} center="歇" />
        <p className="mt-3 font-bold text-[16px]">解析已暂停</p>
        <StageLines job={job} now={now} />
        <div className="flex items-center justify-center gap-3 mt-4 flex-wrap">
          {onResume && (
            <button
              onClick={onResume}
              disabled={resuming || cancelling}
              className="px-5 py-2 bg-[var(--vermilion)] text-[var(--paper)] rounded-[2px] text-[14.5px] font-bold print-shadow disabled:opacity-40"
            >
              {resuming ? "正在续跑……" : "▶ 继续解析（断点续跑）"}
            </button>
          )}
          {onCancel && (
            <button
              onClick={onCancel}
              disabled={cancelling || resuming}
              className="px-4 py-1.5 border border-[var(--vermilion)] text-[var(--vermilion)] rounded-[2px] text-[13.5px] hover:bg-[var(--vermilion)]/10 disabled:opacity-40"
            >
              {cancelling ? "停止中…" : "■ 停止"}
            </button>
          )}
        </div>
        <p className="text-[12px] text-[var(--ink-3)] mt-2">已完成阶段的产物全部保留，继续时自动跳过</p>
      </div>
    );
  }

  // —— 失败 / 已停止：断点重试 + 关闭 ——
  if (job?.status === "error" || job?.status === "cancelled") {
    const failedStage = job.stages.find((s) => s.status === "error");
    const stopped = job.status === "cancelled";
    return (
      <div>
        <div className="text-[var(--vermilion)] text-[14.5px] mb-3 leading-relaxed">
          <b>{stopped ? "解析已停止：" : "解析中断："}</b>
          {!stopped && failedStage ? `「${STAGE_META.find((m) => m.key === failedStage.stage)?.short ?? failedStage.stage}」阶段出错` : ""}
          <br />
          <span className="text-[13px]">{job.errorMsg || failedStage?.error || "未知错误"}</span>
        </div>
        <StageLines job={job} now={now} />
        <div className="flex items-center justify-center gap-3 mt-4 flex-wrap">
          <button
            onClick={onRetry}
            disabled={retrying}
            className="px-6 py-2.5 bg-[var(--vermilion)] text-[var(--paper)] rounded-[2px] text-[15px] font-bold print-shadow disabled:opacity-40"
          >
            {retrying ? "正在续跑……" : "断点重试 · 已完成阶段自动跳过"}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="px-4 py-2 border border-[var(--ink-3)] text-[var(--ink-2)] rounded-[2px] text-[13.5px] hover:bg-[var(--paper-deep)]"
            >
              关闭
            </button>
          )}
        </div>
        <p className="text-[12px] text-[var(--ink-3)] mt-2">{stopped ? "进度不会丢失：重试从断点续跑；关闭则回到交卷前" : "失败多为模型网关超时，重试即可；进度不会丢失"}</p>
      </div>
    );
  }

  // —— 完成 ——
  if (job?.status === "done") {
    const total = job.stages.reduce((a, s) => a + (s.elapsedMs ?? 0), 0);
    return (
      <div>
        {doneSlot}
        <p className="text-[12px] text-[var(--ink-3)] mt-3">
          流水线总耗时 {fmt(Math.round(total / 1000))} ·{" "}
          {job.stages
            .filter((s) => s.status === "ok")
            .map((s) => `${STAGE_META.find((m) => m.key === s.stage)?.short ?? s.stage} ${fmt(Math.round((s.elapsedMs ?? 0) / 1000))}`)
            .join(" · ")}
        </p>
      </div>
    );
  }

  // —— 待提交 ——
  return (
    <div>
      <button
        onClick={onStart}
        disabled={!canSubmit || starting}
        className={`px-8 py-3 rounded-[2px] text-[16px] font-bold transition-colors ${
          canSubmit && !starting
            ? "bg-[var(--vermilion)] text-[var(--paper)] print-shadow hover:bg-[var(--vermilion-deep)]"
            : "bg-[var(--paper-deep)] text-[var(--ink-3)] cursor-not-allowed"
        }`}
      >
        {starting ? "任务创建中……" : canSubmit ? "交卷 · AI 教练解析" : `还剩 ${remaining} 题未答`}
      </button>
      <p className="text-[12px] text-[var(--ink-3)] mt-2">
        后台任务式解析：结构 ∥ 审题 → 定位 → 解题+校验 → 交叉验证（第二模型）
      </p>
    </div>
  );
}
