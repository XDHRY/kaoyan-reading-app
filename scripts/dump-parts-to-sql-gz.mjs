#!/usr/bin/env node
/**
 * Convert scripts_export_dump.mjs JSON parts into the minimal mysqldump-shaped
 * gzip stream understood by offline-build-core.ts.
 *
 * Usage:
 *   node scripts/dump-parts-to-sql-gz.mjs <extracted-dir> <out.sql.gz>
 *
 * This is a compatibility bridge only: it does not create/restore a MySQL
 * server and it emits only CREATE TABLE column order + INSERT ... VALUES data.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  console.error("usage: node scripts/dump-parts-to-sql-gz.mjs <extracted-dir> <out.sql.gz>");
  process.exit(2);
}

const inputDir = path.resolve(inputArg);
const outputPath = path.resolve(outputArg);

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.isFile() && /^part_.+\.json$/.test(ent.name)) out.push(p);
  }
  return out.sort();
}

function escapeSqlString(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\0/g, "\\0")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\x08/g, "\\b")
    .replace(/\x1a/g, "\\Z")
    .replace(/'/g, "\\'");
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
function literal(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "object") return `'${escapeSqlString(JSON.stringify(value))}'`;
  let s = String(value);
  // mysql2 Date values became ISO strings when JSON.stringify wrote the parts.
  // Re-create the usual mysqldump UTC timestamp spelling expected downstream.
  if (ISO.test(s)) s = s.slice(0, 19).replace("T", " ");
  return `'${escapeSqlString(s)}'`;
}

const files = walk(inputDir);
if (!files.length) throw new Error(`no part_*.json files under ${inputDir}`);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const gzip = zlib.createGzip({ level: 6 });
const out = fs.createWriteStream(outputPath);
gzip.pipe(out);

let tableCount = 0;
let rowCount = 0;
for (const file of files) {
  const obj = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const [table, rows] of Object.entries(obj)) {
    if (!Array.isArray(rows)) continue;
    if (!rows.length) {
      console.log(`${table}: 0 rows (no column metadata in JSON part, skipped)`);
      continue;
    }
    const columns = Object.keys(rows[0]);
    if (!columns.length) continue;

    // offline-build-core only needs the CREATE statement to recover column order.
    gzip.write(`CREATE TABLE \`${table}\` (\n`);
    gzip.write(columns.map((c) => `  \`${c}\` text`).join(",\n"));
    gzip.write("\n);\n");

    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const groups = batch.map((row) => {
        // Preserve first-row column order; missing later properties become NULL.
        return `(${columns.map((c) => literal(row[c])).join(",")})`;
      });
      gzip.write(`INSERT INTO \`${table}\` VALUES ${groups.join(",")};\n`);
      rowCount += batch.length;
    }
    tableCount++;
    console.log(`${table}: ${rows.length} rows / ${columns.length} columns`);
  }
}

gzip.end();
await new Promise((resolve, reject) => {
  out.on("close", resolve);
  out.on("error", reject);
  gzip.on("error", reject);
});
console.log(`wrote ${outputPath}: ${tableCount} tables / ${rowCount} rows`);
