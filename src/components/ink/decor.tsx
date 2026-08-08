import type { ReactNode } from "react";

/** 笔触标题：不规则墨条衬底 + 可选朱砂 */
export function BrushTitle({
  children,
  vermilion = false,
  className = "",
  as: Tag = "span",
}: {
  children: ReactNode;
  vermilion?: boolean;
  className?: string;
  as?: "h1" | "h2" | "h3" | "span";
}) {
  return (
    <Tag className={`relative inline-block font-bold ${className}`} style={{ fontFamily: "var(--font-zh)" }}>
      <svg
        className="absolute left-0 bottom-0 w-full"
        style={{ height: "0.42em", zIndex: 0 }}
        viewBox="0 0 200 20"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M2 12 C 30 6, 60 15, 95 10 S 160 6, 198 12 L 197 17 C 150 13, 100 19, 50 16 S 10 18, 2 15 Z"
          fill={vermilion ? "rgba(192,57,43,0.30)" : "rgba(16,16,16,0.14)"}
        />
      </svg>
      <span className="relative" style={{ zIndex: 1 }}>
        {children}
      </span>
    </Tag>
  );
}

/** 墨线分隔符：一笔画过去的横线 */
export function InkDivider({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="100%" height="14" viewBox="0 0 400 14" preserveAspectRatio="none" aria-hidden="true">
      <path
        className="ink-line-draw"
        d="M2 8 C 60 4, 120 10, 200 7 S 340 5, 398 8"
        fill="none"
        stroke="var(--ink-3)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 晕染入场容器 */
export function InkReveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div className={`ink-in ${className}`} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** 纸面卡片：双线框或发丝线，不用柔光阴影 */
export function PaperCard({
  children,
  frame = false,
  className = "",
  onClick,
  id,
}: {
  children: ReactNode;
  frame?: boolean;
  className?: string;
  onClick?: () => void;
  id?: string;
}) {
  return (
    <div
      id={id}
      onClick={onClick}
      className={`${frame ? "book-frame" : "border border-[var(--line)]"} bg-[var(--paper)] rounded-[2px] ${onClick ? "cursor-pointer hover:border-[var(--ink-2)] transition-colors" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/** 状态灯 */
export function StatusDot({ ok, warn }: { ok?: boolean; warn?: boolean }) {
  const color = ok ? "var(--bamboo)" : warn ? "#b98a2f" : "var(--ink-3)";
  return (
    <span
      className="inline-block rounded-full"
      style={{ width: 8, height: 8, background: color, boxShadow: `0 0 0 2px ${color}33` }}
      aria-hidden="true"
    />
  );
}
