import { memo } from "react";

/**
 * 把英文段落拆成可点击的单词 token（点词查词用）
 * 已在生词本中的词高亮竹青下划线
 */
export const ClickableText = memo(function ClickableText({
  text,
  inBook,
  onWord,
}: {
  text: string;
  inBook?: Set<string>;
  onWord: (word: string, e: React.MouseEvent) => void;
}) {
  const parts = text.split(/([A-Za-z][A-Za-z''-]*[A-Za-z]|[A-Za-z])/g);
  return (
    <>
      {parts.map((part, i) => {
        if (!/^[A-Za-z][A-Za-z''-]*$/.test(part) || part.length < 2) {
          return <span key={i}>{part}</span>;
        }
        const lower = part.toLowerCase();
        const booked = inBook?.has(lower);
        return (
          <span
            key={i}
            className={`word-token ${booked ? "in-book" : ""}`}
            title={booked ? "已在生词本" : "点击查词"}
            onClick={(e) => {
              e.stopPropagation();
              onWord(part, e);
            }}
          >
            {part}
          </span>
        );
      })}
    </>
  );
});
