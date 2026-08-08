import { useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useUser } from "@/hooks/useUser";

export interface JobStageRec {
  stage: string;
  status: "pending" | "running" | "ok" | "error";
  startedAt?: number;
  elapsedMs?: number;
  error?: string;
}

export interface PipelineJobView {
  id: number;
  userId: number | null;
  kind: "exam" | "generated";
  refId: number;
  status: "running" | "paused" | "done" | "error" | "cancelled";
  stage: string;
  stages: JobStageRec[];
  payload: Record<string, unknown>;
  answers?: Record<string, string> | null;
  errorMsg: string;
}

/**
 * 任务式解析流水线：startPipeline 立即返回任务号，后台执行，前端每 2.5s 轮询。
 * 关键能力：挂载时自动找回本人在该内容上最近一次任务（进行中/已完成/失败皆可），
 * 切页、刷新、换路由都不会再丢失解析进度与结果。
 */
export function usePipelineJob(kind: "exam" | "generated", refId: number) {
  const { user } = useUser();
  const [jobId, setJobId] = useState<number | null>(null);
  /** 收养守卫：start 之后不再被晚到的 activeQ 旧任务覆盖 */
  const adoptRef = useRef(false);
  /** 撤销守卫：用户主动"再做一遍/载入历史"后，不再复活旧任务 */
  const dismissedRef = useRef(false);
  const startMut = trpc.agent.startPipeline.useMutation();
  const retryMut = trpc.agent.retryPipeline.useMutation();
  const pauseMut = trpc.agent.pausePipeline.useMutation();
  const resumeMut = trpc.agent.resumePipeline.useMutation();
  const cancelMut = trpc.agent.cancelPipeline.useMutation();

  // 挂载/切换内容时：找回该内容最新任务
  const activeQ = trpc.agent.activeJob.useQuery(
    { kind, refId },
    { enabled: !!user, staleTime: 0 },
  );
  useEffect(() => {
    adoptRef.current = false;
    dismissedRef.current = false;
    setJobId(null);
  }, [kind, refId]);
  useEffect(() => {
    if (adoptRef.current || dismissedRef.current || !activeQ.data) return;
    adoptRef.current = true;
    setJobId(activeQ.data.id);
  }, [activeQ.data]);

  const statusQ = trpc.agent.pipelineStatus.useQuery(
    { id: jobId ?? 0 },
    {
      enabled: jobId !== null,
      refetchInterval: (q) => (q.state.data?.status === "running" ? 2500 : false),
      refetchIntervalInBackground: true,
    },
  );

  const [now, setNow] = useState(Date.now());
  const running = statusQ.data?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const start = async (answers?: Record<string, string>) => {
    // 先关收养门再发起：防止慢网络下 activeQ 旧任务晚到覆盖新任务
    adoptRef.current = true;
    dismissedRef.current = false;
    const r = await startMut.mutateAsync({ kind, refId, answers });
    setJobId(r.jobId);
    setNow(Date.now());
  };

  const retry = async () => {
    if (jobId === null) return;
    await retryMut.mutateAsync({ id: jobId });
    await statusQ.refetch();
  };

  const pause = async () => {
    if (jobId === null) return;
    await pauseMut.mutateAsync({ id: jobId });
    await statusQ.refetch();
  };

  const resume = async () => {
    if (jobId === null) return;
    await resumeMut.mutateAsync({ id: jobId });
    await statusQ.refetch();
  };

  const cancel = async () => {
    if (jobId === null) return;
    await cancelMut.mutateAsync({ id: jobId });
    await statusQ.refetch();
  };

  /** 主动放弃当前任务视图（再做一遍/载入历史）：关门，防旧任务复活 */
  const reset = () => {
    dismissedRef.current = true;
    setJobId(null);
  };

  return {
    job: (statusQ.data ?? null) as PipelineJobView | null,
    jobId,
    start,
    retry,
    pause,
    resume,
    cancel,
    reset,
    starting: startMut.isPending,
    retrying: retryMut.isPending,
    pausing: pauseMut.isPending,
    resuming: resumeMut.isPending,
    cancelling: cancelMut.isPending,
    now,
  };
}
