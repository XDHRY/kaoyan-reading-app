/**
 * safeStorage：localStorage 的安全封装。
 * 隐私模式/配额满/禁用 Cookie 时 localStorage 会抛 SecurityError，
 * 全站所有读写必须经此收口，绝不裸调 localStorage（裸调=白屏风险）。
 */
const memoryFallback = new Map<string, string>();

function store(): Storage | null {
  try {
    const s = window.localStorage;
    s.setItem("__ky_probe__", "1");
    s.removeItem("__ky_probe__");
    return s;
  } catch {
    return null;
  }
}

export const safeStorage = {
  get(key: string): string | null {
    const s = store();
    if (s) {
      try {
        return s.getItem(key);
      } catch {
        /* fallthrough */
      }
    }
    return memoryFallback.get(key) ?? null;
  },
  set(key: string, value: string): void {
    const s = store();
    if (s) {
      try {
        s.setItem(key, value);
        return;
      } catch {
        /* 配额满等：落内存兜底 */
      }
    }
    memoryFallback.set(key, value);
  },
  remove(key: string): void {
    const s = store();
    if (s) {
      try {
        s.removeItem(key);
      } catch {
        /* fallthrough */
      }
    }
    memoryFallback.delete(key);
  },
  getJSON<T>(key: string): T | null {
    const raw = this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  setJSON(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value));
  },
};
