import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "../api/db/schema-sqlite";
import "../src/offline/patch-sqljs";
import { setOfflineDb } from "../src/offline/connection";
import { createOfflineCaller } from "../src/offline/caller";

const ROOT = process.cwd();
const SQL = await initSqlJs({
  locateFile: (f) => path.join(ROOT, "node_modules", "sql.js", "dist", f),
});
const db = new SQL.Database(fs.readFileSync(path.join(ROOT, "public", "offline.db")));
setOfflineDb(drizzle(db, { schema }));
const caller = createOfflineCaller();
try {
  const me = await caller.auth.me();
  console.log("auth.me =>", JSON.stringify(me));
} catch (e) {
  console.error("auth.me ERROR:", e instanceof Error ? e.stack : e);
}
try {
  const siteInfo = await caller.auth.siteInfo();
  console.log("siteInfo =>", JSON.stringify(siteInfo));
} catch (e) {
  console.error("siteInfo ERROR:", e instanceof Error ? e.message : e);
}
try {
  const detail = await caller.passage.detail({ id: 1 });
  const q0 = detail.questions[0];
  console.log("passage.detail q0 =>", JSON.stringify({ stem: q0.stem, optionsType: typeof q0.options, options: q0.options }).slice(0, 200));
} catch (e) {
  console.error("detail ERROR:", e instanceof Error ? e.message : e);
}
try {
  const content = await (await import("../api/lib/agentCore")).loadContent("exam", 1);
  console.log("loadContent q0 optionsType:", typeof content.questions[0].options);
} catch (e) {
  console.error("loadContent ERROR:", e instanceof Error ? e.message : e);
}
db.close();
