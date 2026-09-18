/**
 * 判分事实源（全站唯一收口）：官方答案存在时一律以官方为准，
 * AI 答案仅在官方答案缺失或非法时作为降级参考。
 */
export function officialOf(
  qAnswer: string | null | undefined,
  aiAnswer?: string | null,
): string {
  const official = String(qAnswer ?? "").trim().toUpperCase();
  if (/^[A-D]$/.test(official)) return official;

  const ai = String(aiAnswer ?? "").trim().toUpperCase();
  return /^[A-D]$/.test(ai) ? ai : "";
}
