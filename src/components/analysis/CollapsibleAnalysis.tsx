import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { trpc } from "@/providers/trpc";
import { useUser } from "@/hooks/useUser";

/** 解析折叠偏好：auto=默认折叠（点开再看）/ manual=默认展开（传统行为），用户可在设置页切换 */
type Pref = "auto" | "manual";

const PrefCtx = createContext<Pref>("manual");

export function useAnalysisCollapsePref(): Pref {
  return useContext(PrefCtx);
}

/** 读取偏好并向子树提供（挂在 Layout 一次即可） */
export function AnalysisPrefProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const { data } = trpc.agent.getPref.useQuery(
    { key: "analysis_collapse" },
    { enabled: !!user, staleTime: 60_000 },
  );
  const pref: Pref = data?.value === "auto" ? "auto" : "manual";
  return <PrefCtx.Provider value={pref}>{children}</PrefCtx.Provider>;
}

/**
 * AI 教练解析框：水墨氛围的可折叠容器。
 * auto 模式默认折叠成一枚印章条，点击展开，再点折叠，不再遮挡页面上的解析正文；
 * manual 模式默认展开，同样可手动收起。
 */
export function CollapsibleAnalysis({
  label = "AI 教练解析",
  en = "COACH ANALYSIS",
  defaultOpen,
  children,
}: {
  label?: string;
  en?: string;
  /** 覆盖偏好（个别场景强制展开/折叠时传入） */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const pref = useAnalysisCollapsePref();
  const [open, setOpen] = useState<boolean>(() => defaultOpen ?? pref === "manual");
  useEffect(() => {
    if (defaultOpen === undefined) setOpen(pref === "manual");
  }, [pref, defaultOpen]);

  return (
    <div className="mt-4 rounded-[2px] border border-[var(--line)] bg-[var(--paper)] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--paper-deep)]/60 transition-colors"
        aria-expanded={open}
      >
        <span
          className={`inline-flex items-center justify-center w-6 h-6 text-[12px] font-bold rounded-[2px] print-shadow transition-colors ${
            open ? "bg-[var(--vermilion)] text-[var(--paper)]" : "bg-[var(--ink)] text-[var(--paper)]"
          }`}
        >
          析
        </span>
        <span className="font-bold text-[14.5px]">{label}</span>
        <span className="meta-label">{en}</span>
        <span className="ml-auto text-[12px] text-[var(--ink-3)] select-none">{open ? "收起 ▲" : "展开 ▼"}</span>
      </button>
      {open && <div className="px-4 pb-4 border-t border-[var(--line)]/60">{children}</div>}
    </div>
  );
}
