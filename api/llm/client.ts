/**
 * 双协议 LLM 适配层
 * 统一内部调用格式：OpenAI /v1/chat/completions 与 Anthropic /v1/messages 双向互转
 * 支持渠道级高级配置（温度/最大token/超时/重试/自定义透传参数）与思考强度注入
 * key 只在服务端使用，永不回传前端明文
 */
import type { Channel, ChannelConfig } from "@db/schema";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  usage?: { promptTokens?: number; completionTokens?: number };
  model: string;
}

export interface CallOptions {
  maxTokens?: number;
  temperature?: number;
  /** 思考强度：none/low/medium/high/xhigh/max；三级回落后传入 */
  reasoningEffort?: string;
}

const DEFAULT_TIMEOUT_MS = 180_000;

/** 部分中转站/网关对非浏览器 UA 做风控拦截，统一携带浏览器 UA */
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function trimBase(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function cfg(channel: Channel): ChannelConfig {
  return channel.config ?? {};
}

/** 模型名自带档位（如 gpt-5.6-terra-xhigh）时不再注入 reasoning_effort */
const TIER_SUFFIX = /-(none|low|medium|high|xhigh|max)$/i;

async function fetchOnce(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 带重试的请求：仅对网络错误/429/5xx 重试，4xx（鉴权/风控）直接抛出 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  channel: Channel,
): Promise<Response> {
  const c = cfg(channel);
  const timeoutMs = (c.timeoutSec ?? 0) > 0 ? c.timeoutSec! * 1000 : DEFAULT_TIMEOUT_MS;
  const retries = Math.max(0, c.retries ?? 1);
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchOnce(url, init, timeoutMs);
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        return res;
      }
      lastErr = new Error(`HTTP ${res.status}`);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** 统一对话调用 */
export async function callChat(
  channel: Channel,
  model: string,
  messages: ChatMessage[],
  opts: CallOptions = {},
): Promise<ChatResult> {
  if (channel.protocol === "anthropic") {
    return callAnthropic(channel, model, messages, opts);
  }
  return callOpenAi(channel, model, messages, opts);
}

async function callOpenAi(
  channel: Channel,
  model: string,
  messages: ChatMessage[],
  opts: CallOptions,
): Promise<ChatResult> {
  const c = cfg(channel);
  const body: Record<string, unknown> = {
    model,
    messages,
    ...(opts.temperature !== undefined
      ? { temperature: opts.temperature }
      : c.temperature !== undefined
        ? { temperature: c.temperature }
        : {}),
    ...(opts.maxTokens ?? c.maxTokens ? { max_tokens: opts.maxTokens ?? c.maxTokens } : {}),
    // 思考强度注入：模型名已带档位时跳过
    ...(opts.reasoningEffort && !TIER_SUFFIX.test(model)
      ? { reasoning_effort: opts.reasoningEffort }
      : {}),
    // 自定义参数透传（最后合并，用户可覆盖任何字段）
    ...(c.extraParams ?? {}),
  };
  const res = await fetchWithRetry(`${trimBase(channel.baseUrl)}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${channel.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": BROWSER_UA,
    },
    body: JSON.stringify(body),
  }, channel);
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`OpenAI 协议调用失败 (${res.status}): ${data?.error?.message ?? JSON.stringify(data).slice(0, 300)}`);
  }
  const choice = data?.choices?.[0];
  return {
    content: choice?.message?.content ?? "",
    usage: {
      promptTokens: data?.usage?.prompt_tokens,
      completionTokens: data?.usage?.completion_tokens,
    },
    model: data?.model ?? model,
  };
}

async function callAnthropic(
  channel: Channel,
  model: string,
  messages: ChatMessage[],
  opts: CallOptions,
): Promise<ChatResult> {
  const c = cfg(channel);
  // OpenAI messages → Anthropic 格式：system 抽出为顶层字段
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const anthropicMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? c.maxTokens ?? 4096,
    ...(system ? { system } : {}),
    messages: anthropicMessages,
    ...(opts.temperature !== undefined
      ? { temperature: opts.temperature }
      : c.temperature !== undefined
        ? { temperature: c.temperature }
        : {}),
    // Anthropic 的思考预算等高级能力通过自定义参数透传
    ...(c.extraParams ?? {}),
  };
  const res = await fetchWithRetry(`${trimBase(channel.baseUrl)}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": channel.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      "User-Agent": BROWSER_UA,
    },
    body: JSON.stringify(body),
  }, channel);
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Anthropic 协议调用失败 (${res.status}): ${data?.error?.message ?? JSON.stringify(data).slice(0, 300)}`);
  }
  // Anthropic 返回 → 统一格式
  const content = Array.isArray(data?.content)
    ? data.content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("")
    : "";
  return {
    content,
    usage: {
      promptTokens: data?.usage?.input_tokens,
      completionTokens: data?.usage?.output_tokens,
    },
    model: data?.model ?? model,
  };
}

/** 绘图调用（OpenAI 图像格式；Anthropic 协议渠道不支持绘图，前置拦截） */
export async function callImage(
  channel: Channel,
  model: string,
  prompt: string,
  opts: { size?: string; quality?: string } = {},
): Promise<{ b64?: string; url?: string }> {
  if (channel.protocol === "anthropic") {
    throw new Error("Anthropic 协议渠道不支持绘图，请选择 OpenAI 协议的绘图渠道");
  }
  const res = await fetchWithRetry(`${trimBase(channel.baseUrl)}/v1/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${channel.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": BROWSER_UA,
    },
    body: JSON.stringify({
      model,
      prompt,
      size: opts.size ?? "1024x1024",
      ...(opts.quality ? { quality: opts.quality } : {}),
    }),
  }, channel);
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`绘图调用失败 (${res.status}): ${data?.error?.message ?? JSON.stringify(data).slice(0, 300)}`);
  }
  const item = data?.data?.[0] ?? {};
  return { b64: item.b64_json, url: item.url };
}

/** 拉取渠道模型列表 */
export async function listModels(channel: Pick<Channel, "baseUrl" | "apiKey" | "protocol">): Promise<string[]> {
  const base = trimBase(channel.baseUrl);
  const headers: Record<string, string> =
    channel.protocol === "anthropic"
      ? { "x-api-key": channel.apiKey, "anthropic-version": "2023-06-01", "User-Agent": BROWSER_UA }
      : { Authorization: `Bearer ${channel.apiKey}`, "User-Agent": BROWSER_UA };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let res: Response;
  try {
    res = await fetch(`${base}/v1/models`, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`拉取模型列表失败 (${res.status}): ${data?.error?.message ?? res.statusText}`);
  }
  const ids = (data?.data ?? []).map((m: { id?: string }) => m.id).filter(Boolean) as string[];
  return ids.sort();
}

/** 渠道连通性测试：发一条最小请求 */
export async function testChannel(channel: Channel, model?: string): Promise<{ ok: boolean; detail: string }> {
  const useModel = model ?? channel.models[0];
  if (!useModel) return { ok: false, detail: "该渠道尚无可用模型，请先拉取模型列表或手动添加" };
  try {
    if (channel.kind === "image") {
      if (channel.protocol === "anthropic") {
        return { ok: false, detail: "Anthropic 协议不支持绘图渠道" };
      }
      // 绘图测试成本较高，仅验证鉴权：拉模型列表
      await listModels(channel);
      return { ok: true, detail: "鉴权通过，绘图渠道可用" };
    }
    const result = await callChat(channel, useModel, [{ role: "user", content: "ping" }], { maxTokens: 16 });
    return { ok: true, detail: `连通成功，模型 ${result.model} 响应正常` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** 从模型列表中按用途过滤 */
export function filterModelsByKind(models: string[], kind: "chat" | "image"): string[] {
  const imagePattern = /image|dall-e|flux|sd|draw/i;
  if (kind === "image") return models.filter((m) => imagePattern.test(m));
  return models.filter((m) => !imagePattern.test(m) && !/audio|realtime|whisper|tts/i.test(m));
}
