/**
 * node:buffer 的浏览器 shim（vite resolve.alias 编译期替换，仅离线 bundle 生效）。
 * 覆盖 api/lib/auth.ts 实际用到的极小面：Buffer.from(str, "hex") / Buffer.from(u8) /
 * .toString("hex") / .length。auth.ts 以裸全局 Buffer 使用（verifySecret 里
 * Buffer.from(actual, "hex")），故本模块副作用补齐 globalThis.Buffer。
 * 离线模式下密码相关（scrypt 哈希）本就不可用，Buffer 只服务于 salt/会话令牌的 hex 编解码。
 */
export class Buffer {
  private readonly _data: Uint8Array;

  private constructor(data: Uint8Array) {
    this._data = data;
  }

  static from(input: string | Uint8Array, encoding?: string): Buffer {
    if (input instanceof Uint8Array) return new Buffer(input.slice());
    if (!encoding || encoding === "hex") {
      // hex 解码（容忍奇数长度，首字符补 0，与 node 行为一致）
      const clean = input.length % 2 === 1 ? `0${input}` : input;
      const out = new Uint8Array(clean.length / 2);
      for (let i = 0; i < out.length; i++) {
        out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
      }
      return new Buffer(out);
    }
    return new Buffer(new TextEncoder().encode(input));
  }

  /** Node Buffer 判型（drizzle sqlite-core blob 列的 mapFromDriverValue 会裸调 Buffer.isBuffer） */
  static isBuffer(obj: unknown): obj is Buffer {
    return obj instanceof Buffer;
  }

  /** ArrayBuffer.isView 别名，语义与 node Buffer.isView 一致（对象是否 ArrayBufferView） */
  static isView(obj: unknown): boolean {
    return ArrayBuffer.isView(obj);
  }

  get length(): number {
    return this._data.length;
  }

  /** 暴露底层字节（恒时比较等场景需要按索引访问） */
  toUint8Array(): Uint8Array {
    return this._data;
  }

  toString(encoding?: string): string {
    if (encoding === "hex") {
      let s = "";
      for (const b of this._data) s += b.toString(16).padStart(2, "0");
      return s;
    }
    return new TextDecoder().decode(this._data);
  }
}

// auth.ts 用裸全局 Buffer；TS 里 node types 已声明全局 Buffer，类型不同故断言覆盖
(globalThis as Record<string, unknown>).Buffer ??= Buffer;
