import { asc } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { methodClauses, type MethodClause } from "@db/schema";

/**
 * 方法论知识引擎：按 Agent 角色 + 题目题型，从笔记条款库精准装配上下文。
 * 条款全部来自用户笔记《考研传统阅读》正文。
 */

/** 各角色需要的条款（域 + refKey 组合；types=true 表示注入题型条款并按 qTypes 过滤） */
const ROLE_NEEDS: Record<string, { domains?: string[]; refKeys?: string[]; types?: boolean }> = {
  agent_structure: { domains: ["structure"] },
  agent_question: { refKeys: ["S1", "S2"], types: true },
  agent_locator: { refKeys: ["S3", "S4", "pronoun", "turn"], types: true },
  agent_solver: { domains: ["option"], refKeys: ["S5", "S6", "pronoun", "turn"], types: true },
  agent_reviewer: { refKeys: ["checkpoints", "correct", "wrong", "turn", "negation", "compare", "pronoun", "cause"] },
  agent_generator: { refKeys: ["pattern", "thesis", "wrong", "correct"], types: true },
  sentence_parser: { domains: ["sentence"], refKeys: ["punct"] },
};

let cache: MethodClause[] | null = null;

async function allClauses(): Promise<MethodClause[]> {
  if (!cache) {
    const db = getDb();
    cache = await db.select().from(methodClauses).orderBy(asc(methodClauses.sortOrder));
  }
  return cache;
}

/** 条款失效（管理员更新条款后调用） */
export function invalidateMethodCache() {
  cache = null;
}

function format(c: MethodClause): string {
  return `〔${c.clauseId} ${c.title}〕${c.content}`;
}

/**
 * 装配某个角色的方法论上下文。
 * @param role Agent 角色（agent_structure 等）
 * @param qTypes 本次涉及的题型（example/attitude/...），用于题型条款精准注入；空则注入全部
 */
export async function buildMethodContext(role: string, qTypes: string[] = []): Promise<string> {
  const needs = ROLE_NEEDS[role];
  const all = await allClauses();
  if (!needs || all.length === 0) return "";

  const typeSet = new Set(qTypes);
  const picked = all.filter((c) => {
    if (c.domain === "type") {
      return needs.types === true && (typeSet.size === 0 || typeSet.has(c.refKey));
    }
    const byDomain = needs.domains?.includes(c.domain);
    const byRef = needs.refKeys?.includes(c.refKey);
    return byDomain || byRef;
  });
  const final = picked;

  if (final.length === 0) return "";
  const lines = final.map(format).join("\n");
  return `\n\n【方法论知识库·来自《考研传统阅读》笔记，必须严格遵循】\n${lines}\n【知识库结束】`;
}

/** 全量条款（供知识库页面展示） */
export async function listMethodClauses(): Promise<MethodClause[]> {
  return allClauses();
}
