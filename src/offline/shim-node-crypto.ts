/**
 * node:crypto 的浏览器 shim（vite resolve.alias 编译期替换，仅离线 bundle 生效）。
 * 覆盖 api/lib/auth.ts 实际用到的四个导出：
 * - randomBytes → WebCrypto getRandomValues（返回带 toString("hex") 的 Uint8Array 子类，
 *   newSalt()/newSessionToken() 依赖 hex 输出）
 * - timingSafeEqual → 恒时比较（长度不同返回 false，调用方 verifySecret 已先比长度）
 * - scryptSync / createHash → 离线不可用直接抛错（scrypt 不在 WebCrypto 标准内，无法
 *   同步实现；createHash 仅 newResetTicket 使用，api 内无人调用，tree-shaking 会移除）
 * 副作用：import 本模块即保证 shim-node-buffer 的全局 Buffer 装上（auth.ts 用裸全局 Buffer）。
 */
import { Buffer } from "./shim-node-buffer";

/** WebCrypto 生成的随机字节，toString("hex") 输出 hex（覆盖 Uint8Array 的逗号串） */
class RandomBytes extends Uint8Array {
  override toString(encoding?: string): string {
    if (encoding === "hex") {
      let s = "";
      for (const b of this) s += b.toString(16).padStart(2, "0");
      return s;
    }
    return super.toString();
  }
}

export function randomBytes(size: number): RandomBytes {
  const out = new RandomBytes(size);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** 恒时比较（简单实现：全程遍历，不提前短路） */
export function timingSafeEqual(a: Uint8Array | Buffer, b: Uint8Array | Buffer): boolean {
  const av = a instanceof Uint8Array ? a : a.toUint8Array();
  const bv = b instanceof Uint8Array ? b : b.toUint8Array();
  if (av.length !== bv.length) return false;
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  return diff === 0;
}

/** scrypt 哈希离线不可用：注册/登录/找回密码需联网模式 */
export function scryptSync(_password: string, _salt: string, _keylen: number): never {
  throw new Error("scryptSync 仅联网模式可用（离线不可注册/登录/找回密码）");
}

/** createHash 仅 newResetTicket 使用（api 内无人调用）；为完整导出保留，调用即抛 */
export function createHash(_algorithm: string): never {
  throw new Error("createHash 仅联网模式可用");
}

// 本模块作为值导入 shim-node-buffer（timingSafeEqual 类型里用到 Buffer），
// 该 import 不被 elide，副作用（globalThis.Buffer 安装）随 auth.ts → node:crypto 链路生效。
