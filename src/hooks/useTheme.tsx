import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { safeStorage } from "@/lib/safeStorage";

export type Theme = "system" | "light" | "dark";
const STORAGE_KEY = "ky_reading_theme";

interface ThemeCtx {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

function systemTheme(): "light" | "dark" {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const raw = safeStorage.get(STORAGE_KEY);
    return raw === "dark" || raw === "light" ? raw : "system";
  });
  const [resolved, setResolved] = useState<"light" | "dark">(() => (theme === "system" ? systemTheme() : theme));

  useEffect(() => {
    const apply = () => {
      const r = theme === "system" ? systemTheme() : theme;
      setResolved(r);
      document.documentElement.dataset.theme = r;
    };
    apply();
    safeStorage.set(STORAGE_KEY, theme);
    if (theme !== "system") return;
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", apply);
      return () => mq?.removeEventListener("change", apply);
    } catch {
      return;
    }
  }, [theme]);

  return <Ctx.Provider value={{ theme, resolved, setTheme: setThemeState }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
