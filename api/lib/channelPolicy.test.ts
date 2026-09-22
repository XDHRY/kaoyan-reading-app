import { describe, expect, it } from "vitest";
import { assertSafeBaseUrl, maskApiKey } from "./channelPolicy";

describe("maskApiKey", () => {
  it("fully masks short keys and keeps only a small prefix/suffix for long keys", () => {
    expect(maskApiKey("12345678")).toBe("****");
    expect(maskApiKey("sk-1234567890")).toBe("sk-****7890");
  });
});

describe("assertSafeBaseUrl", () => {
  it.each([
    "https://api.openai.com/v1",
    "https://example.com/compatible/v1",
    "https://[2606:4700:4700::1111]/v1",
  ])("accepts public HTTPS endpoints: %s", (url) => {
    expect(() => assertSafeBaseUrl(url)).not.toThrow();
  });

  it("rejects malformed and plaintext URLs", () => {
    expect(() => assertSafeBaseUrl("not-a-url")).toThrow("渠道地址不是合法 URL");
    expect(() => assertSafeBaseUrl("http://api.example.com/v1")).toThrow("渠道地址必须使用 https");
  });

  it("rejects embedded URL credentials", () => {
    expect(() => assertSafeBaseUrl("https://user:secret@api.example.com/v1")).toThrow(
      "渠道地址不允许包含用户名或密码",
    );
  });

  it.each([
    "https://localhost/v1",
    "https://localhost./v1",
    "https://api.localhost/v1",
    "https://service.local/v1",
    "https://service.internal/v1",
  ])("rejects local hostnames: %s", (url) => {
    expect(() => assertSafeBaseUrl(url)).toThrow("渠道地址不允许指向内网或回环地址");
  });

  it.each([
    "https://127.0.0.1/v1",
    "https://10.0.0.1/v1",
    "https://172.16.0.1/v1",
    "https://172.31.255.254/v1",
    "https://192.168.1.1/v1",
    "https://169.254.169.254/latest/meta-data",
    "https://0.0.0.0/v1",
    "https://2130706433/v1",
    "https://0x7f000001/v1",
  ])("rejects private/link-local IPv4 endpoints: %s", (url) => {
    expect(() => assertSafeBaseUrl(url)).toThrow("渠道地址不允许指向内网或回环地址");
  });

  it.each([
    "https://[::]/v1",
    "https://[::1]/v1",
    "https://[fe80::1]/v1",
    "https://[fc00::1]/v1",
    "https://[fd12:3456::1]/v1",
    "https://[::ffff:127.0.0.1]/v1",
    "https://[::ffff:7f00:1]/v1",
    "https://[::ffff:a00:1]/v1",
    "https://[::ffff:c0a8:101]/v1",
  ])("rejects local/private IPv6 endpoints: %s", (url) => {
    expect(() => assertSafeBaseUrl(url)).toThrow("渠道地址不允许指向内网或回环地址");
  });
});
