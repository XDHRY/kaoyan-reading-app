import { useCallback, useEffect, useState } from "react";

/**
 * 音效系统：落章（关键动作完成）与翻页（卡片翻动/状态推进）。
 *
 * 设计决策：
 * - 默认开启，但只由用户手势（点击）触发播放，天然满足浏览器 autoplay 策略；
 * - play() 返回的 promise 一律 catch 静默（隐私模式/未交互场景下拒绝播放不报错）；
 * - Audio 实例按需创建并缓存，避免每次 new 造成重复请求（浏览器本身也有 HTTP 缓存）；
 * - 开关持久化 ky_sound（"on"/"off"），并派发自定义事件让设置页与播放端同源同步。
 */

const KEY = "ky_sound";
const EVENT = "ky-sound-change";

type SoundName = "seal" | "page";

const SRC: Record<SoundName, string> = {
  seal: "/sounds/seal-stamp.mp3",
  page: "/sounds/page-turn.mp3",
};

const pool: Partial<Record<SoundName, HTMLAudioElement>> = {};

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* 隐私模式写入失败不影响当次设置 */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** 播放一个音效（开关关闭或播放被拦截时静默跳过） */
export function playSound(name: SoundName) {
  if (!soundEnabled()) return;
  try {
    const a = pool[name] ?? new Audio(SRC[name]);
    pool[name] = a;
    a.volume = 0.5;
    a.currentTime = 0;
    void a.play().catch(() => {});
  } catch {
    /* Audio 不可用（SSR/旧浏览器）直接忽略 */
  }
}

/** React 侧读取开关状态（设置页用），监听同源事件保持多组件一致 */
export function useSoundState(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(soundEnabled);
  useEffect(() => {
    const sync = () => setOn(soundEnabled());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const set = useCallback((v: boolean) => {
    setSoundEnabled(v);
    setOn(v);
  }, []);
  return [on, set];
}
