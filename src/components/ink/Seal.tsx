import { useMemo } from "react";

/**
 * 印章（chop seal）：环形文字 + 中心字，印泥做旧滤镜
 * 落章角度由 seed 确定性伪随机生成，像手工盖上去的
 */
function seeded(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

export function Seal({
  text = "考研阅读·纸上功夫",
  center = "阅",
  size = 96,
  seed = "seal",
  className = "",
  animate = false,
}: {
  text?: string;
  center?: string;
  size?: number;
  seed?: string;
  className?: string;
  animate?: boolean;
}) {
  const rot = useMemo(() => 8 + (seeded(seed) % 33), [seed]); // 8°~40°
  const id = useMemo(() => `seal-${seeded(seed + text).toString(36)}`, [seed, text]);
  const chars = text.split("");
  const filterId = `${id}-f`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className={`${animate ? "seal-stamp " : ""}${className}`}
      style={{ ["--seal-rot" as string]: `${rot}deg`, transform: `rotate(${rot}deg)` }}
      aria-hidden="true"
    >
      <defs>
        {/* 印泥洇纸：模糊后提高对比，制造盖章边缘的残破感 */}
        <filter id={filterId}>
          <feGaussianBlur stdDeviation="0.9" />
          <feColorMatrix type="matrix" values="5 0 0 0 -3.6  0 5 0 0 -3.6  0 0 5 0 -3.6  0 0 0 0.9 0" />
        </filter>
        <path id={`${id}-circle`} d="M 60,60 m -42,0 a 42,42 0 1,1 84,0 a 42,42 0 1,1 -84,0" />
      </defs>
      <g filter={`url(#${filterId})`} fill="none" stroke="var(--vermilion)" strokeWidth="2.5">
        <rect x="16" y="16" width="88" height="88" rx="4" />
      </g>
      <g filter={`url(#${filterId})`}>
        <text
          fill="var(--vermilion)"
          fontSize="12.5"
          fontFamily="var(--font-zh)"
          fontWeight="700"
          letterSpacing="2"
        >
          <textPath href={`#${id}-circle`} startOffset="2%">
            {chars.join("")}
          </textPath>
        </text>
        <text
          x="60"
          y="74"
          textAnchor="middle"
          fill="var(--vermilion)"
          fontSize="44"
          fontFamily="var(--font-brush)"
        >
          {center}
        </text>
      </g>
    </svg>
  );
}

/** 序号章：壹贰叁肆伍陆 */
export function StepSeal({
  num,
  active = false,
  done = false,
  size = 56,
  seed,
}: {
  num: string;
  active?: boolean;
  done?: boolean;
  size?: number;
  seed: string;
}) {
  const rot = useMemo(() => 6 + (seeded(seed) % 28), [seed]);
  return (
    <div
      className="relative flex items-center justify-center shrink-0"
      style={{
        width: size,
        height: size,
        transform: `rotate(${rot}deg)`,
        border: `2px solid ${active ? "var(--vermilion)" : done ? "var(--bamboo)" : "var(--ink-3)"}`,
        borderRadius: 3,
        color: active ? "var(--vermilion)" : done ? "var(--bamboo)" : "var(--ink-3)",
        fontFamily: "var(--font-brush)",
        fontSize: size * 0.52,
        background: active ? "rgba(192,57,43,0.07)" : "transparent",
        transition: "all 0.4s var(--ease-ink)",
      }}
      aria-hidden="true"
    >
      {num}
    </div>
  );
}
