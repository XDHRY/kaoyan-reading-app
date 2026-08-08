import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { safeStorage } from "@/lib/safeStorage";

export type FontScale = "standard" | "large" | "xlarge";

const LABELS: Record<FontScale, string> = { standard: "标准", large: "大字", xlarge: "超大" };
const ORDER: FontScale[] = ["standard", "large", "xlarge"];
const STORAGE_KEY = "ky_reading_fontscale";

interface FsCtx {
  scale: FontScale;
  label: string;
  setScale: (s: FontScale) => void;
  cycle: () => void;
}

const Ctx = createContext<FsCtx | null>(null);

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [scale, setScaleState] = useState<FontScale>(() => {
    const raw = safeStorage.get(STORAGE_KEY);
    return raw === "large" || raw === "xlarge" ? raw : "standard";
  });

  useEffect(() => {
    document.documentElement.dataset.fontscale = scale;
    safeStorage.set(STORAGE_KEY, scale);
  }, [scale]);

  const setScale = (s: FontScale) => setScaleState(s);
  const cycle = () =>
    setScaleState((cur) => ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length]);

  return (
    <Ctx.Provider value={{ scale, label: LABELS[scale], setScale, cycle }}>{children}</Ctx.Provider>
  );
}

export function useFontSize(): FsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFontSize must be used within FontSizeProvider");
  return ctx;
}
