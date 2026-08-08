import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useUser } from "@/hooks/useUser";
import { Seal } from "@/components/ink/Seal";
import { safeStorage } from "@/lib/safeStorage";

const STEPS = [
  {
    title: "先看方法，再做题",
    body: "「SOP 图谱」是你的武功秘籍：六步审题答题法，每一步的要点和注意事项都写清楚了，英文术语全部带中文翻译。零基础建议先花 20 分钟通读一遍。",
    to: "/sop",
    toLabel: "去 SOP 图谱",
  },
  {
    title: "从一篇真题开始",
    body: "「真题库」收录 2010–2026 全部 68 篇英语一阅读。先标段，再一次性读完 5 道题，按题文同序作答——方法会一步步带你。",
    to: "/library",
    toLabel: "去真题库",
  },
  {
    title: "交卷后，AI 教练团上场",
    body: "六位 AI 角色接力：结构分析师拆文章 → 审题官判题型 → 定位官找原文 → 解题官对比选项 → 校验官复核。每位干完活立即展示，所用模型和用时都看得见。",
    to: null,
    toLabel: null,
  },
  {
    title: "错题生词，自动归队",
    body: "做错的题自动进「错题本」，可以反复重练直到做对；阅读原文里点任何单词，AI 给出释义并自动收入「生词本」。",
    to: "/wrong",
    toLabel: "看错题本",
  },
  {
    title: "模型，由你调遣",
    body: "顶栏「模型」按钮管理全部 API 节点（OpenAI / Anthropic 协议都能加）；「设置」页决定每个 AI 角色用哪个模型、思考强度多大。配好后来一次「一键自检」就放心了。",
    to: "/settings",
    toLabel: "去设置",
  },
];

const KEY = "ky_reading_tour_done";

export function OnboardingTour() {
  const { user, ready } = useUser();
  const [step, setStep] = useState(-1);

  useEffect(() => {
    if (ready && user && !safeStorage.get(KEY)) {
      setStep(0);
    }
  }, [ready, user]);

  if (step < 0) return null;

  const finish = () => {
    safeStorage.set(KEY, "1");
    setStep(-1);
  };

  const s = STEPS[step];
  return (
    <div className="tour-mask" onClick={finish}>
      <div className="tour-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <span className="meta-label">新手导览 · {step + 1} / {STEPS.length}</span>
          <Seal size={44} seed={`tour-${step}`} text="入门引路" center={["壹", "贰", "叁", "肆", "伍"][step]} />
        </div>
        <h2 className="text-[22px] font-bold mb-3">{s.title}</h2>
        <p className="text-[15px] leading-relaxed text-[var(--ink-2)] mb-6">{s.body}</p>
        <div className="flex items-center justify-between">
          <button onClick={finish} className="text-[13px] text-[var(--ink-3)] underline underline-offset-4">
            跳过导览
          </button>
          <div className="flex gap-3 items-center">
            {s.to && (
              <Link
                to={s.to}
                onClick={finish}
                className="text-[14px] text-[var(--vermilion)] font-bold underline underline-offset-4"
              >
                {s.toLabel} →
              </Link>
            )}
            <button
              onClick={() => (step === STEPS.length - 1 ? finish() : setStep(step + 1))}
              className="px-5 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow text-[15px]"
            >
              {step === STEPS.length - 1 ? "开卷" : "下一条"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
