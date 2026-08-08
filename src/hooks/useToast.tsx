import { createContext, useCallback, useContext, useRef, useState } from "react";

type Toast = { id: number; text: string; tone: "ink" | "ok" | "warn" };
type Ctx = { toast: (text: string, tone?: Toast["tone"]) => void };

const ToastCtx = createContext<Ctx>({ toast: () => void 0 });

export function useToast() {
  return useContext(ToastCtx);
}

/** 极简 toast：顶部居中，墨块风格，3 秒自灭 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);

  const toast = useCallback((text: string, tone: Toast["tone"] = "ink") => {
    const id = ++seq.current;
    setItems((arr) => [...arr.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((arr) => arr.filter((t) => t.id !== id)), 3000);
  }, []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[90] space-y-2 pointer-events-none">
        {items.map((t) => (
          <div
            key={t.id}
            className="ink-in px-4 py-2 text-[13.5px] font-bold rounded-[2px] shadow-[3px_3px_0_rgba(16,16,16,0.85)]"
            style={{
              background: t.tone === "ok" ? "var(--bamboo)" : t.tone === "warn" ? "var(--vermilion)" : "var(--ink)",
              color: "var(--paper)",
            }}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
