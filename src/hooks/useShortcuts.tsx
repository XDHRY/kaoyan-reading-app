import { useEffect, useState } from "react";
import { safeStorage } from "@/lib/safeStorage";

const IMMERSIVE_KEY = "ky_immersive";

export function isImmersive() {
  return document.documentElement.dataset.immersive === "1";
}

export function setImmersive(on: boolean) {
  if (on) document.documentElement.dataset.immersive = "1";
  else delete document.documentElement.dataset.immersive;
  safeStorage.set(IMMERSIVE_KEY, on ? "1" : "0");
  window.dispatchEvent(new CustomEvent("ky-immersive", { detail: on }));
}

/** 沉浸模式状态订阅 */
export function useImmersiveState() {
  const [on, setOn] = useState(isImmersive);
  useEffect(() => {
    const fn = (e: Event) => setOn((e as CustomEvent<boolean>).detail);
    window.addEventListener("ky-immersive", fn);
    return () => window.removeEventListener("ky-immersive", fn);
  }, []);
  return on;
}

function isTyping() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

/**
 * 全局快捷键：
 *   i       沉浸模式开关（隐去顶栏/底栏，只剩正文）
 *   ?       快捷键速查
 *   Esc     退出沉浸
 */
export function useGlobalShortcuts(onHelp: () => void) {
  useEffect(() => {
    // 启动时恢复上次的沉浸偏好
    if (safeStorage.get(IMMERSIVE_KEY) === "1") setImmersive(true);

    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isImmersive()) {
        setImmersive(false);
        return;
      }
      if (isTyping() || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "i") {
        setImmersive(!isImmersive());
      } else if (e.key === "?") {
        onHelp();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onHelp]);
}
