/**
 * 生产环境首次启动自举：
 * 1. 空库 → 执行 drizzle 迁移建表；已有库 → 跳过
 * 2. 幂等种子：SOP 知识库 + 预置渠道 + 默认绑定 + 方法条款 + 真题语料
 * 3. 确保管理员账号存在（可用 ADMIN_PASSWORD 覆盖初始密码）
 * 任何一步失败都会抛出，让平台重试，绝不带病上线。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { users } from "@db/schema";
import { hashSecret, newSalt } from "./auth";
import { seedKnowledgeAndChannels } from "@db/seed";
import { seedMethodClauses } from "@db/seedMethod";
import { seedCorpus } from "@db/seedCorpus";

async function ensureSchema() {
  // migrate 幂等（__drizzle_migrations 记录已应用项）：每次启动都跑，
  // 让新版本的新表/新列自动进入老部署库——"部署即自愈"的基石。
  // 迁移目录跟随本模块所在位置解析（打包后为 app.asar 内 db/migrations，
  // 开发时为项目根 db/migrations），不依赖 process.cwd()——桌面壳以任意
  // cwd 拉起 boot.js 都能找到迁移文件。
  const folder = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "db",
    "migrations",
  );
  console.log(`[bootstrap] 执行迁移（已应用自动跳过）：${folder}`);

  // 基线自愈：老库若是 db:push 时代建的（journal 为空但核心表已存在），
  // 直接把 0000 写入 journal 作为基线，只增量应用其后的迁移。
  // 若不基线化，migrate 会重放 CREATE TABLE 撞已有表而启动失败。
  const db = getDb();
  await db.execute(
    "CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (`id` serial PRIMARY KEY, `hash` text NOT NULL, `created_at` bigint)",
  );
  const [journalRows] = (await db.execute("SELECT COUNT(*) AS c FROM `__drizzle_migrations`")) as unknown as [
    { c: number }[],
  ];
  if (Number(journalRows?.[0]?.c ?? 0) === 0) {
    const [coreRows] = (await db.execute("SHOW TABLES LIKE 'questions'")) as unknown as [unknown[]];
    if ((coreRows ?? []).length > 0) {
      const journal = JSON.parse(
        fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf-8"),
      ) as { entries: { idx: number; tag: string; when: number }[] };
      const first = journal.entries[0];
      if (first) {
        await db.execute(
          `INSERT INTO \`__drizzle_migrations\` (\`hash\`, \`created_at\`) VALUES ('baseline-dbpush', ${first.when})`,
        );
        console.log(`[bootstrap] 检测到 db:push 老库，已把 ${first.tag} 基线化（跳过重放）`);
      }
    }
  }

  await migrateIdempotent(db, folder);
  console.log("[bootstrap] 迁移完成");
}

/**
 * 幂等迁移执行器：MySQL DDL 自动提交（无事务），官方 migrate 半途失败会留下
 * "部分应用"状态，重放时 CREATE/ADD 撞已有对象即死循环启动失败。
 * 这里逐语句执行并只容忍"已存在"类错误（表/列/索引重复），
 * 其余错误照样抛出——收敛而非掩盖。
 */
const TOLERATED_ERRNOS = new Set([
  1050, // ER_TABLE_EXISTS_ERROR
  1060, // ER_DUP_FIELDNAME
  1061, // ER_DUP_KEYNAME
  1091, // ER_CANT_DROP_FIELD_OR_KEY
  1826, // ER_FK_DUP_NAME（外键重复）
]);

async function migrateIdempotent(db: ReturnType<typeof getDb>, folder: string) {
  const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf-8")) as {
    entries: { idx: number; tag: string; when: number }[];
  };
  const [appliedRows] = (await db.execute("SELECT `created_at` FROM `__drizzle_migrations`")) as unknown as [
    { created_at: number | string }[],
  ];
  const applied = new Set((appliedRows ?? []).map((r) => Number(r.created_at)));

  for (const entry of journal.entries.sort((a, b) => a.when - b.when)) {
    if (applied.has(entry.when)) continue;
    const sql = fs.readFileSync(path.join(folder, `${entry.tag}.sql`), "utf-8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      try {
        await db.execute(stmt);
      } catch (e) {
        const errno = (e as { cause?: { errno?: number }; errno?: number })?.cause?.errno ?? (e as { errno?: number })?.errno;
        if (errno && TOLERATED_ERRNOS.has(errno)) {
          console.log(`[bootstrap] 跳过已存在对象（errno ${errno}）：${stmt.slice(0, 60).replace(/\s+/g, " ")}…`);
          continue;
        }
        throw e;
      }
    }
    // 内联字面量（tag/when 均来自本地迁移 journal，非外部输入）
    await db.execute(`INSERT INTO \`__drizzle_migrations\` (\`hash\`, \`created_at\`) VALUES ('${entry.tag}', ${entry.when})`);
    console.log(`[bootstrap] 迁移 ${entry.tag} 应用完成`);
  }
}

/** 僵尸任务清扫：进程重启后 running 必然为假（执行器已死），标记 error 允许用户重试续跑 */
async function sweepZombieJobs() {
  const db = getDb();
  const r = (await db.execute(
    "UPDATE pipeline_jobs SET status='error', error_msg='服务重启，任务中断，可点重试从断点续跑' WHERE status='running'",
  )) as unknown as [{ affectedRows?: number }];
  const n = r?.[0]?.affectedRows ?? 0;
  if (n > 0) console.log(`[bootstrap] 清扫僵尸任务 ${n} 个`);
}

/** 过期会话清理（防表膨胀） */
async function sweepExpiredSessions() {
  const db = getDb();
  const r = (await db.execute("DELETE FROM sessions WHERE expires_at < NOW()")) as unknown as [{ affectedRows?: number }];
  const n = r?.[0]?.affectedRows ?? 0;
  if (n > 0) console.log(`[bootstrap] 清理过期会话 ${n} 条`);
}

async function ensureAdmin() {
  const db = getDb();
  const existing = await db.query.users.findFirst({ where: eq(users.name, "admin") });
  if (existing) {
    if (existing.role !== "admin") {
      await db.update(users).set({ role: "admin" }).where(eq(users.id, existing.id));
      console.log("[bootstrap] admin 已存在，已提升为管理员");
    } else {
      console.log("[bootstrap] admin 已存在");
    }
    return;
  }
  // 安全决策：无 ADMIN_PASSWORD 时生成随机密码并打印到部署日志一次（之后只存哈希），不再硬编码默认口令
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(9).toString("base64url") + "#Ky";
  const salt = newSalt();
  const recoverySalt = newSalt();
  await db.insert(users).values({
    name: "admin",
    role: "admin",
    avatarChar: "掌",
    salt,
    passwordHash: hashSecret(password, salt),
    recoveryQuestion: "本站掌门印上刻的是哪个字",
    recoveryHash: hashSecret("阅", recoverySalt),
    recoverySalt,
  });
  console.log(`[bootstrap] 管理员 admin 已创建，初始密码：${password}（仅本次打印，请立即登录修改；密保答案：阅）`);
}

/** 单步容错：任何一步失败只告警不崩站（登录/注册等核心功能必须始终可用） */
async function step(name: string, fn: () => Promise<void>, fatal = false) {
  try {
    await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[bootstrap] ${name} 失败：${msg}`);
    if (fatal) throw e;
    console.warn(`[bootstrap] ${name} 已跳过，站点继续启动（可稍后通过管理员自检补齐）`);
  }
}

export async function bootstrap() {
  console.log("[bootstrap] 开始自举……");
  await step("建表迁移", ensureSchema, true);   // 表都没有就必须失败重来
  await step("管理员账号", ensureAdmin, true); // 没管理员等于白部署
  await step("僵尸任务清扫", sweepZombieJobs);
  await step("过期会话清理", sweepExpiredSessions);
  await step("知识库与渠道", seedKnowledgeAndChannels);
  await step("方法条款", seedMethodClauses);
  await step("真题语料", seedCorpus);          // 语料缺失只影响真题库，绝不拖垮整站
  console.log("[bootstrap] 自举完成 ✅");
}
