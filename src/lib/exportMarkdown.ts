/** 把一篇真题的完整 AI 解析产物导出为 Markdown */

export interface ExportPayload {
  title: string;
  paragraphs: string[];
  structure?: Record<string, unknown> | null;
  questionAnalysis?: unknown[];
  locateResult?: unknown[];
  solved?: unknown[];
  review?: Record<string, unknown> | null;
  modelUsed?: string;
  exportedAt?: Date;
}

const s = (v: unknown) => String(v ?? "");

export function buildAnalysisMarkdown(p: ExportPayload): string {
  const lines: string[] = [];
  lines.push(`# ${p.title} · AI 解析`);
  lines.push("");
  lines.push(`> 导出时间：${(p.exportedAt ?? new Date()).toLocaleString("zh-CN")}`);
  if (p.modelUsed) lines.push(`> 所用模型：${p.modelUsed}`);
  lines.push("");

  if (p.structure) {
    lines.push("## 一、行文结构分析");
    lines.push("");
    lines.push(`- **篇章模式**：${s(p.structure.pattern)}`);
    lines.push(`- **全文主旨**：${s(p.structure.gist)}`);
    lines.push(`- **逻辑推进**：${s(p.structure.logicFlow)}`);
    lines.push("");
    const paras = (p.structure.paragraphs as { no: number; role: string; topic: string; keySentence?: string }[]) ?? [];
    for (const para of paras) {
      lines.push(`- **第 ${para.no} 段** · ${para.role} — ${para.topic}`);
      if (para.keySentence) lines.push(`  - 主旨句：${para.keySentence}`);
    }
    lines.push("");
  }

  const qa = (p.questionAnalysis ?? []) as Record<string, unknown>[];
  const lc = (p.locateResult ?? []) as Record<string, unknown>[];
  const sv = (p.solved ?? []) as Record<string, unknown>[];

  lines.push("## 二、逐题解析");
  for (const item of sv) {
    const qNo = item.qNo;
    lines.push("");
    lines.push(`### 第 ${s(qNo)} 题 · 答案 ${s(item.answer)}`);
    const q = qa.find((x) => x.qNo === qNo);
    if (q) {
      lines.push(`- **题型**：${s(q.qTypeZh ?? q.qType)}（${s(q.reasoning)}）`);
      lines.push(`- **题干翻译**：${s(q.stemZh)}`);
      lines.push(`- **定位词**：${((q.locators as string[]) ?? []).join(" / ")}`);
    }
    const l = lc.find((x) => x.qNo === qNo);
    if (l) {
      lines.push(`- **定位**：第 ${s(l.paraNo)} 段 · ${s(l.scope)}`);
      if (l.sentence) lines.push(`  - 定位句：${s(l.sentence)}`);
      if (l.sentenceZh) lines.push(`  - 句译：${s(l.sentenceZh)}`);
    }
    if (item.answerFeature) lines.push(`- **正确项特征**：${s(item.answerFeature)}`);
    if (item.answerZh) lines.push(`- **正确项翻译**：${s(item.answerZh)}`);
    const opts = (item.options as { label: string; verdict: string; flawType?: string; analysis: string }[]) ?? [];
    if (opts.length) {
      lines.push(`- **逐项分析**：`);
      for (const o of opts) {
        lines.push(`  - [${o.label}] ${o.verdict === "对" ? "✓" : "✗"} ${o.analysis}${o.flawType ? `（${o.flawType}）` : ""}`);
      }
    }
    if (item.reasoning) lines.push(`- **解题思路**：${s(item.reasoning)}`);
  }
  lines.push("");

  if (p.review) {
    lines.push("## 三、校验官总评");
    lines.push("");
    lines.push(s(p.review.comment));
    lines.push("");
  }

  lines.push("---");
  lines.push("*由「考研传统阅读助手」生成 · 仅供个人学习使用*");
  return lines.join("\n");
}

export function downloadMarkdown(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
