/** 常见英文缩写 / 小数 / 姓名首字母的句点保护——避免切句时把 "Mr." "U.S." "3.5" "J. R. R." 误斩 */
const ABBRS = [
  "Mr", "Mrs", "Ms", "Dr", "Prof", "St", "vs", "etc", "e.g", "i.e", "a.m", "p.m",
  "Jr", "Sr", "Fig", "Eq", "No", "Nos", "Vol", "pp", "p", "al", "cf", "Inc", "Ltd", "Corp",
  "U.S", "U.K", "U.N", "E.U", "D.C", "Ph.D", "M.D", "B.C", "A.D",
];
const DOT = "‥"; // 占位符（two-dot leader，正常文本不会出现）

export function splitSentences(paragraph: string): string[] {
  let t = paragraph;
  // 1) 缩写保护（长短语优先，如 U.S. 先于 St.）
  for (const ab of ABBRS.sort((a, b) => b.length - a.length)) {
    t = t.replace(new RegExp(`\\b${ab.replace(/\./g, "\\.")}\\.`, "g"), (m) => m.slice(0, -1) + DOT);
  }
  // 2) 小数点保护 3.5 → 3‥5
  t = t.replace(/(\d)\.(\d)/g, `$1${DOT}$2`);
  // 3) 连续首字母 J. R. R. → 保护（大写字母+句点 后面还跟大写首字母或名字）
  t = t.replace(/\b([A-Z])\.(?=\s+[A-Z])/g, `$1${DOT}`);
  // 4) 省略号 ... 保护
  t = t.replace(/\.\.\./g, DOT + DOT + DOT);

  const parts = t.match(/[^.!?]+[.!?]+["'”’)\]]*\s*|[^.!?]+$/g);
  return (parts ?? [t])
    .map((s) => s.replaceAll(DOT, ".").trim())
    .filter((s) => s.length > 2);
}
