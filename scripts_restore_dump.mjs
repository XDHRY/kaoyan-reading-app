import mysql from "mysql2/promise";
import fs from "node:fs";
import "dotenv/config";

const dir = "db/dump_parts";
const files = fs.readdirSync(dir).filter((f) => f.startsWith("part_") && f.endsWith(".json")).sort();
const c = await mysql.createConnection({ uri: process.env.DATABASE_URL });
await c.query("SET FOREIGN_KEY_CHECKS=0");
// 表列缓存：以 SHOW COLUMNS 为准，对齐 dump 与 schema 的列差异（跳过已废弃列），
// 使旧快照能在新 schema 上安全追加导入
const colCache = new Map();
async function tableCols(tb) {
  if (!colCache.has(tb)) {
    const [cols] = await c.query(`SHOW COLUMNS FROM \`${tb}\``);
    colCache.set(tb, new Set(cols.map((x) => x.Field)));
  }
  return colCache.get(tb);
}
let total = 0;
for (const f of files) {
  const dump = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
  for (const [tb, rows] of Object.entries(dump)) {
    if (!rows.length) continue;
    const valid = await tableCols(tb);
    const cols = Object.keys(rows[0]).filter((k) => valid.has(k));
    if (!cols.length) continue; // 表已无任何可用列，跳过整表
    const colList = cols.map((x) => "`" + x + "`").join(",");
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      const ph = batch.map(() => "(" + cols.map(() => "?").join(",") + ")").join(",");
      const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;
      const values = batch.flatMap((r) => cols.map((k) => {
        const v = r[k];
        if (v === null || v === undefined) return null;
        if (v instanceof Date) return v.toISOString().slice(0, 23).replace("T", " ");
        if (typeof v === "object") return JSON.stringify(v);
        if (typeof v === "string" && ISO.test(v)) return v.slice(0, 19).replace("T", " ");
        return v;
      }));
      await c.query(`INSERT INTO \`${tb}\` (${colList}) VALUES ${ph}`, values);
    }
    total += rows.length;
    console.log(tb, "+", rows.length);
  }
}
await c.query("SET FOREIGN_KEY_CHECKS=1");
console.log("restored rows:", total);
await c.end(); process.exit(0);
