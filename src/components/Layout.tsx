import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { Seal } from "@/components/ink/Seal";
import { ModelManager } from "@/components/ModelManager";
import { useUser } from "@/hooks/useUser";
import { useFontSize } from "@/hooks/useFontSize";
import { AnalysisPrefProvider } from "@/components/analysis/CollapsibleAnalysis";
import { recallGate } from "@/components/ProfileGate";
import { useGlobalShortcuts, useImmersiveState, setImmersive } from "@/hooks/useShortcuts";

// 主导航只留学习高频项；工单/设置等低频去处收进用户菜单，保持顶栏呼吸感
const NAV = [
  { to: "/", label: "仪表盘", end: true },
  { to: "/sop", label: "SOP 图谱" },
  { to: "/library", label: "真题库" },
  { to: "/wrong", label: "错题本" },
  { to: "/insight", label: "顿悟室" },
  { to: "/vocab", label: "生词本" },
  { to: "/essay", label: "作文工坊" },
  { to: "/stats", label: "统计" },
  { to: "/history", label: "档案" },
  { to: "/generate", label: "AI 出题" },
  { to: "/guide", label: "指南" },
  { to: "/manual", label: "手册" },
];

/** 移动端底栏五席：最高频去处 */
const MOBILE_TABS = [
  { to: "/", label: "首页", glyph: "⌂", end: true },
  { to: "/library", label: "真题", glyph: "卷", end: false },
  { to: "/wrong", label: "错题", glyph: "改", end: false },
  { to: "/insight", label: "顿悟", glyph: "悟", end: false },
  { to: "/essay", label: "作文", glyph: "文", end: false },
];

function UserBadge() {
  const { user, logout } = useUser();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 border border-[var(--line)] rounded-full pl-1 pr-3 py-1 hover:border-[var(--ink-2)]"
      >
        <span className="w-7 h-7 rounded-full bg-[var(--vermilion)] text-[var(--paper)] flex items-center justify-center text-[14px] font-bold">
          {user.avatarChar || user.name.slice(0, 1)}
        </span>
        <span className="text-[14px] max-w-[80px] truncate">{user.name}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-44 bg-[var(--paper)] border-2 border-[var(--ink)] shadow-[3px_3px_0_rgba(16,16,16,0.85)] z-50 p-2">
          <Link
            to="/me"
            onClick={() => setOpen(false)}
            className="block w-full text-left px-3 py-2 text-[14px] rounded-[2px] hover:bg-[var(--paper-deep)]"
          >
            个人中心
          </Link>
          <Link
            to="/stats"
            onClick={() => setOpen(false)}
            className="block w-full text-left px-3 py-2 text-[14px] rounded-[2px] hover:bg-[var(--paper-deep)]"
          >
            我的统计
          </Link>
          <Link
            to="/tickets"
            onClick={() => setOpen(false)}
            className="block w-full text-left px-3 py-2 text-[14px] rounded-[2px] hover:bg-[var(--paper-deep)]"
          >
            工单与公告
          </Link>
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="block w-full text-left px-3 py-2 text-[14px] rounded-[2px] hover:bg-[var(--paper-deep)]"
          >
            设置中心
          </Link>
          {user.role === "admin" && (
            <Link
              to="/admin"
              onClick={() => setOpen(false)}
              className="block w-full text-left px-3 py-2 text-[14px] rounded-[2px] text-[var(--vermilion)] font-bold hover:bg-[var(--paper-deep)]"
            >
              管理中心 ⚑
            </Link>
          )}
          <button
            onClick={() => { void logout(); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-[13px] text-[var(--ink-3)] border-t border-[var(--line)] mt-1"
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const [modelOpen, setModelOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const immersive = useImmersiveState();
  useGlobalShortcuts(() => setHelpOpen(true));
  const { label: fsLabel, cycle } = useFontSize();
  const { user } = useUser();
  const navItems = user?.role === "admin" ? [...NAV, { to: "/admin", label: "管理" }] : NAV;

  useEffect(() => setMoreOpen(false), [pathname]);

  useEffect(() => {
    document.body.classList.add("paper-grain");
    return () => document.body.classList.remove("paper-grain");
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-screen">
      {/* 顶栏 */}
      <header className="sticky top-0 z-50 bg-[var(--paper)]/95 backdrop-blur-sm hairline-b">
        <div className="max-w-[1400px] mx-auto px-4 md:px-8 h-16 flex items-center gap-3 md:gap-5">
          <Link to="/" className="flex items-center gap-3 shrink-0">
            <Seal size={40} seed="brand" text="考研阅读" center="阅" />
            <div className="leading-tight hidden sm:block">
              <div className="font-bold text-[17px] tracking-wide">考研传统阅读</div>
              <div className="meta-label">PAPER · INK · METHOD</div>
            </div>
          </Link>
          {/* 桌面端顶栏导航；窄屏由底部 TabBar + 更多抽屉接管，避免上下双导航 */}
          <nav className="hidden md:flex flex-1 items-center gap-0.5 overflow-x-auto">
            {navItems.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `brush-link px-2.5 py-1.5 text-[15px] whitespace-nowrap rounded-[2px] transition-colors ${
                    isActive
                      ? "brush-active text-[var(--vermilion)] font-bold"
                      : "text-[var(--ink-2)] hover:text-[var(--ink)]"
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          {/* 窄屏占位：把右侧按钮组顶到最右 */}
          <div className="flex-1 md:hidden" />
          {/* 字号三档 */}
          <button
            onClick={cycle}
            title="切换字号：标准 / 大字 / 超大"
            className="shrink-0 border border-[var(--line)] rounded-[2px] px-2.5 py-1.5 text-[13px] hover:border-[var(--ink-2)]"
          >
            字·{fsLabel}
          </button>
          {/* 模型管理入口 */}
          <button
            onClick={() => setModelOpen(true)}
            className="shrink-0 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] px-3.5 py-1.5 text-[14px] print-shadow"
          >
            模型
          </button>
          {user ? <UserBadge /> : (
            <button
              onClick={() => { recallGate(); window.location.reload(); }}
              className="shrink-0 border-2 border-[var(--vermilion)] text-[var(--vermilion)] rounded-[2px] px-3.5 py-1 text-[14px] font-bold hover:bg-[var(--vermilion)]/5"
            >
              签到
            </button>
          )}
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 md:px-8 py-8">
        <AnalysisPrefProvider>{children}</AnalysisPrefProvider>
      </main>

      <footer className="hairline-b border-t border-[var(--line)] mt-16 mb-28 md:mb-0">
        <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="meta-label">KAOYAN READING · SOP COACH</span>
            <p className="text-[13px] text-[var(--ink-3)] mt-1">
              真题语料仅供个人学习使用 · 2010–2026 英语一 · 68 篇 · 340 题
            </p>
          </div>
          <Seal size={64} seed="footer" text="纸上功夫·慎思笃行" center="悟" />
        </div>
      </footer>

      {/* 移动端底部 TabBar（核心五席 + 更多抽屉） */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-[var(--paper)]/97 backdrop-blur-sm border-t-2 border-[var(--ink)] safe-bottom">
        <div className="grid grid-cols-6 text-center">
          {MOBILE_TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `py-2 text-[11px] leading-tight ${isActive ? "text-[var(--vermilion)] font-bold" : "text-[var(--ink-3)]"}`
              }
            >
              <span className="block text-[16px]">{t.glyph}</span>
              {t.label}
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen(true)}
            className="py-2 text-[11px] leading-tight text-[var(--ink-3)]"
          >
            <span className="block text-[16px]">☰</span>
            更多
          </button>
        </div>
      </nav>

      {/* 移动端「更多」全量导航抽屉 */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-[60] bg-[var(--ink)]/40" onClick={(e) => e.target === e.currentTarget && setMoreOpen(false)}>
          <div className="absolute bottom-0 inset-x-0 bg-[var(--paper)] border-t-2 border-[var(--ink)] safe-bottom p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold text-[15px]">全部去处</span>
              <button onClick={() => setMoreOpen(false)} className="text-[22px] leading-none px-2">×</button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {navItems.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    `border rounded-[2px] py-2.5 text-center text-[13.5px] ${isActive ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)] text-[var(--ink-2)]"}`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
              {/* 低频去处（顶栏不收，抽屉保留可达性） */}
              <NavLink to="/tickets" onClick={() => setMoreOpen(false)} className="border border-[var(--line)] rounded-[2px] py-2.5 text-center text-[13.5px] text-[var(--ink-2)]">
                工单
              </NavLink>
              <NavLink to="/settings" onClick={() => setMoreOpen(false)} className="border border-[var(--line)] rounded-[2px] py-2.5 text-center text-[13.5px] text-[var(--ink-2)]">
                设置
              </NavLink>
              <NavLink to="/me" onClick={() => setMoreOpen(false)} className="border border-[var(--line)] rounded-[2px] py-2.5 text-center text-[13.5px] text-[var(--ink-2)]">
                个人中心
              </NavLink>
            </div>
          </div>
        </div>
      )}

      {/* 沉浸模式退出浮标 */}
      {immersive && (
        <button
          onClick={() => setImmersive(false)}
          className="fixed bottom-5 right-5 z-[80] px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] print-shadow text-[13px] font-bold safe-bottom"
          title="退出沉浸模式（Esc）"
        >
          退出沉浸 ⏏
        </button>
      )}

      {/* 快捷键速查 */}
      {helpOpen && (
        <div className="ink-modal-mask" onClick={(e) => e.target === e.currentTarget && setHelpOpen(false)}>
          <div className="ink-modal p-6 max-w-[420px]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[18px] font-bold">快捷键</h2>
              <button onClick={() => setHelpOpen(false)} className="text-[22px] leading-none px-1">×</button>
            </div>
            <div className="space-y-2 text-[13.5px]">
              {[
                ["i", "沉浸模式开关（隐去顶栏底栏，专注正文）"],
                ["Esc", "退出沉浸模式"],
                ["?", "打开本速查"],
              ].map(([k, d]) => (
                <p key={k} className="flex items-center gap-3">
                  <kbd className="px-2 py-0.5 border border-[var(--ink-2)] rounded-[2px] font-bold text-[12.5px] min-w-[34px] text-center shadow-[2px_2px_0_rgba(16,16,16,0.6)]">{k}</kbd>
                  <span className="text-[var(--ink-2)]">{d}</span>
                </p>
              ))}
            </div>
            <p className="text-[12px] text-[var(--ink-3)] mt-4 border-t border-[var(--line)] pt-3">在输入框中按键不会触发快捷键。</p>
          </div>
        </div>
      )}

      {/* 全局模型管理弹窗 */}
      {modelOpen && (
        <div className="ink-modal-mask" onClick={(e) => e.target === e.currentTarget && setModelOpen(false)}>
          <div className="ink-modal p-6 md:p-8">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-[22px] font-bold">模型节点管理</h2>
                <p className="text-[13px] text-[var(--ink-3)] mt-1">
                  新增任意 OpenAI / Anthropic 协议节点，永久保存；思考强度与高级配置随节点走
                </p>
              </div>
              <button onClick={() => setModelOpen(false)} className="text-[24px] leading-none px-2">×</button>
            </div>
            <ModelManager />
            <p className="text-[12px] text-[var(--ink-3)] mt-5 border-t border-[var(--line)] pt-3">
              各智能体用哪个模型？到「设置」页配置角色绑定与思考强度覆盖。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
