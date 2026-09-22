/** 渠道配置的纯安全策略：不接数据库，也不接真实网络。 */

export function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 3)}****${key.slice(-4)}`;
}

function isInternalIpv4(v4: string): boolean {
  const parts = v4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function mappedIpv4FromIpv6(host: string): string | null {
  const mapped = host.match(/^::ffff:(.+)$/);
  if (!mapped) return null;
  const tail = mapped[1];

  if (/^\d+\.\d+\.\d+\.\d+$/.test(tail)) return tail;

  const groups = tail.split(":");
  if (groups.length !== 2 || groups.some((p) => !/^[0-9a-f]{1,4}$/i.test(p))) return null;
  const hex = groups.map((p) => p.padStart(4, "0")).join("");
  return [0, 2, 4, 6].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(".");
}

/** SSRF 防护：渠道地址必须 https，且不得直接指向内网/回环地址。 */
export function assertSafeBaseUrl(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("渠道地址不是合法 URL");
  }
  if (u.protocol !== "https:") throw new Error("渠道地址必须使用 https（防明文泄钥）");
  if (u.username || u.password) throw new Error("渠道地址不允许包含用户名或密码");

  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h) throw new Error("渠道地址缺少主机名");

  const block = () => {
    throw new Error("渠道地址不允许指向内网或回环地址");
  };

  if (h.includes(":")) {
    // IPv6：未指定地址、回环、链路本地(fe80::/10)、ULA(fc00::/7)均不允许。
    if (h === "::" || h === "::1" || /^fe[89ab]/.test(h) || /^(fc|fd)/.test(h)) block();

    const mapped = mappedIpv4FromIpv6(h);
    if (mapped && isInternalIpv4(mapped)) block();
    return;
  }

  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    isInternalIpv4(h)
  ) {
    block();
  }
}
