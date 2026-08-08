import mysql from "mysql2/promise";
import fs from "node:fs";
import "dotenv/config";
const c = await mysql.createConnection(process.env.DATABASE_URL);
const [t] = await c.query("SHOW TABLES");
const tables = t.map((x) => Object.values(x)[0]).filter((x) => x !== "__drizzle_migrations");
fs.mkdirSync("db/dump_parts", { recursive: true });
let total = 0;
for (const tb of tables) {
  const [rows] = await c.query(`SELECT * FROM \`${tb}\``);
  const s = JSON.stringify({ [tb]: rows });
  fs.writeFileSync(`db/dump_parts/part_${tb}.json`, s);
  total += rows.length;
  console.log(tb, rows.length, (s.length / 1048576).toFixed(1) + "MB");
}
console.log("total rows:", total);
await c.end(); process.exit(0);
