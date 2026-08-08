interface ParaRole {
  no: number;
  role: string;
  topic?: string;
}

/**
 * 篇章结构 SVG 示意图（免费、即时、始终可用）：
 * 由结构分析结果直接绘制的纵向流程图，水墨风格节点 + 笔锋箭头。
 */
export function StructureDiagram({ pattern, paragraphs }: { pattern?: string; paragraphs: ParaRole[] }) {
  if (!paragraphs.length) return null;
  const nodeH = 46;
  const gap = 26;
  const w = 320;
  const h = paragraphs.length * (nodeH + gap) - gap + 64;
  const cx = w / 2;

  return (
    <div className="border border-[var(--line)] rounded-[2px] bg-[var(--paper)] p-3 w-fit max-w-full">
      <div className="meta-label mb-2 text-center">篇章结构图 · 结构速览</div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="max-w-full h-auto" role="img" aria-label="篇章结构图">
        <defs>
          <marker id="ink-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="var(--ink-3)" strokeWidth="1.6" />
          </marker>
        </defs>
        {pattern && (
          <text x={cx} y={18} textAnchor="middle" fontSize="12.5" fill="var(--vermilion)" fontWeight="bold">
            {pattern}
          </text>
        )}
        {paragraphs.map((p, i) => {
          const y = 32 + i * (nodeH + gap);
          const label = `第${p.no}段 · ${p.role}`;
          const topic = p.topic && p.topic.length > 22 ? `${p.topic.slice(0, 22)}…` : p.topic;
          return (
            <g key={p.no}>
              {i > 0 && (
                <line
                  x1={cx}
                  y1={y - gap + nodeH + 4}
                  x2={cx}
                  y2={y - 4}
                  stroke="var(--ink-3)"
                  strokeWidth="1.6"
                  strokeDasharray="1 3"
                  strokeLinecap="round"
                  markerEnd="url(#ink-arrow)"
                />
              )}
              <rect
                x={28}
                y={y}
                width={w - 56}
                height={nodeH}
                rx={2}
                fill="var(--paper-deep)"
                fillOpacity={0.55}
                stroke="var(--ink-2)"
                strokeWidth="1.2"
              />
              <rect x={28} y={y} width={3.5} height={nodeH} fill="var(--vermilion)" />
              <text x={44} y={y + 20} fontSize="12.5" fontWeight="bold" fill="var(--ink)">
                {label.length > 20 ? `${label.slice(0, 20)}…` : label}
              </text>
              {topic && (
                <text x={44} y={y + 37} fontSize="11" fill="var(--ink-3)">
                  {topic}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
