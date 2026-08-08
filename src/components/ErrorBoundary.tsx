import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** 全局错误边界：任何渲染异常都不白屏，给出水墨风格的托底页与重载入口 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-6">
        <div className="max-w-md text-center border border-[var(--line)] bg-[var(--paper)] p-8 rounded-[2px]">
          <div className="text-[40px] mb-3">🀄</div>
          <h2 className="text-[20px] font-black mb-2">这一页翻车了</h2>
          <p className="text-[14px] text-[var(--ink-2)] mb-1">
            界面渲染时出了点意外，你的学习数据都安全存在服务器上。
          </p>
          <p className="text-[12px] text-[var(--ink-3)] mb-5 font-mono break-all">
            {this.state.error.message.slice(0, 200)}
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 border border-[var(--line)] rounded-[2px] text-[14px] hover:border-[var(--ink-2)]"
            >
              重试
            </button>
            <button
              onClick={() => window.location.assign("/")}
              className="px-4 py-2 bg-[var(--ink)] text-[var(--paper)] rounded-[2px] text-[14px]"
            >
              回到首页
            </button>
          </div>
        </div>
      </div>
    );
  }
}
