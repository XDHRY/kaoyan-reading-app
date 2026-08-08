/**
 * 真题语料入库：db/final_corpus.json → passages + questions
 * 幂等：按 year+textNo 判断，存在则跳过
 * 运行：npx tsx db/seedCorpus.ts
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { getDb } from "../api/queries/connection";
import { passages, questions } from "./schema";
import { and, eq } from "drizzle-orm";

type CorpusItem = {
  year: number;
  textNo: number;
  paragraphs: string[];
  sourceTag: string;
  verifyStatus: "verified" | "single_source" | "flagged";
  verifyNote: string;
  questions: {
    qNo: number;
    stem: string;
    options: string[];
    answer: string | null;
    qType: string;
  }[];
};

export async function seedCorpus() {
  const db = getDb();
  // 兼容源码运行（db/ 目录）、打包 bundle（dist/）与旧 cwd 约定：
  // __dirname 在 bundle 中即 boot.js 所在目录，取父级 db/final_corpus.json
  // 可在打包后（app.asar 内）依然命中，不依赖 process.cwd()。
  const candidates = [
    path.join(__dirname, "final_corpus.json"),
    path.resolve(__dirname, "..", "db", "final_corpus.json"),
    path.resolve(process.cwd(), "db", "final_corpus.json"),
    path.resolve(process.cwd(), "final_corpus.json"),
  ];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) throw new Error(`找不到 final_corpus.json（尝试过：${candidates.join(", ")}）`);
  const corpus = JSON.parse(fs.readFileSync(file, "utf-8")) as CorpusItem[];
  let inserted = 0;
  let skipped = 0;
  for (const item of corpus) {
    const existing = await db.query.passages.findFirst({
      where: and(eq(passages.year, item.year), eq(passages.textNo, item.textNo)),
    });
    if (existing) {
      skipped++;
      continue;
    }
    const [{ id }] = await db
      .insert(passages)
      .values({
        year: item.year,
        textNo: item.textNo,
        paragraphs: item.paragraphs,
        sourceTag: item.sourceTag,
        verifyStatus: item.verifyStatus,
        verifyNote: item.verifyNote || null,
      })
      .$returningId();
    for (const q of item.questions) {
      await db.insert(questions).values({
        passageId: id,
        qNo: q.qNo,
        stem: q.stem,
        qType: q.qType,
        options: q.options,
        answer: q.answer,
      });
    }
    inserted++;
  }
  console.log(`真题入库完成：新增 ${inserted} 篇，跳过已存在 ${skipped} 篇`);
}

if (process.argv[1]?.endsWith("seedCorpus.ts")) {
  seedCorpus()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
