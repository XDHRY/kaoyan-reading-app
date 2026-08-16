/**
 * data URL → Blob URL 转换。
 *
 * 背景：Android WebView（Chromium）对 <img src="data:..."> 的超长 base64 有解码/渲染上限
 * （1024×1024 PNG 的 base64 常在 1.5–4MB，APK 上会出现「图已生成但显示空白」）。
 * 转成 Blob URL（blob:...）后无此限制；Electron/桌面浏览器同样适用。
 * http(s):// 远程图不受影响，原样返回。
 */
const blobUrlCache = new Map<string, string>();

export function dataUrlToBlobUrl(src: string): string {
  if (!src || !src.startsWith("data:")) return src;
  const cached = blobUrlCache.get(src);
  if (cached) return cached;
  try {
    const comma = src.indexOf(",");
    if (comma === -1) return src;
    const mime = src.slice(5, src.indexOf(";")) || "image/png";
    const b64 = src.slice(comma + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    blobUrlCache.set(src, url);
    return url;
  } catch {
    return src; // 转换失败时回退原样（浏览器自带兜底）
  }
}
