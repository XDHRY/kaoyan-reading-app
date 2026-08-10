/**
 * SQLite 离线版 schema：与 db/schema.ts（mysql-core）一一对应的 30 张表。
 * 用途：Capacitor WebView 内 sql.js + drizzle-orm/sql-js 的运行时库结构；
 * 构建期由 scripts/offline-build-core.ts 依此元信息生成 DDL 灌入 public/offline.db。
 *
 * 转换规则（mysql → sqlite）：
 * - serial / bigint unsigned 主键 → integer().primaryKey({ autoIncrement: true })
 * - json → text({ mode: "json" })
 * - mysqlEnum → text({ enum: [...] })
 * - timestamp → integer({ mode: "timestamp_ms" })（保持 Date 语义，业务侧
 *   `Date.now() - job.updatedAt.getTime()` 等比较继续可用）
 * - timestamp defaultNow → default(sql`(unixepoch() * 1000)`)
 * - timestamp ... onUpdateNow → SQLite 无 ON UPDATE，改由写入方显式更新
 *   updatedAt（清单见构建报告；当前迁移边界外，仅声明列结构）
 * - longtext / mediumtext → text
 * - boolean → integer({ mode: "boolean" })
 *
 * 导出名/表名与 mysql 版完全一致，后续 router 迁移到 sqlite 时按名引用即可。
 */
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const now = () => sql`(unixepoch() * 1000)`;

/** 用户（昵称 + 密码 + 密保找回） */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name", { length: 32 }).notNull().unique(),
  /** scrypt 哈希（hex），永不明文 */
  passwordHash: text("password_hash", { length: 128 }).notNull().default(""),
  salt: text("salt", { length: 64 }).notNull().default(""),
  /** 密保提示词（用户自定义问题） */
  recoveryQuestion: text("recovery_question", { length: 128 }).notNull().default(""),
  /** 密保答案哈希 */
  recoveryHash: text("recovery_hash", { length: 128 }).notNull().default(""),
  /** 密保专用盐（与密码 salt 解耦：改密码不再使密保失效；空=沿用旧 salt 的存量行） */
  recoverySalt: text("recovery_salt", { length: 64 }).notNull().default(""),
  /** 头像字（一个汉字，默认昵称首字） */
  avatarChar: text("avatar_char", { length: 4 }).notNull().default(""),
  /** 角色：admin 拥有最高权限 */
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
});
export type User = typeof users.$inferSelect;

/** 站点开关（管理员控制） */
export const siteSettings = sqliteTable("site_settings", {
  k: text("k", { length: 64 }).primaryKey(),
  v: text("v").notNull(),
});
export type SiteSetting = typeof siteSettings.$inferSelect;

/** 解析流水线任务（后台执行，前端轮询，断点可续跑） */
export const pipelineJobs = sqliteTable(
  "pipeline_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id"),
    /** 真题 / AI 生成题 */
    kind: text("kind", { enum: ["exam", "generated"] }).notNull().default("exam"),
    /** 真题 passageId 或生成题 generatedSetId */
    refId: integer("ref_id").notNull(),
    status: text("status", { enum: ["running", "paused", "done", "error", "cancelled"] })
      .notNull()
      .default("running"),
    /** 当前阶段：structure/question/locate/solve/crosscheck/done */
    stage: text("stage", { length: 20 }).notNull().default(""),
    /** 各阶段记录 [{stage,status,elapsedMs,error?}] */
    stages: text("stages", { mode: "json" }).$type<
      { stage: string; status: "pending" | "running" | "ok" | "error"; startedAt?: number; elapsedMs?: number; error?: string }[]
    >().notNull(),
    /** 累积产物：structure/qAnalysis/locate/solved/review/verdicts/crosscheck/trace */
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    /** 用户作答 {questionId|qNo: "A"} */
    answers: text("answers", { mode: "json" }).$type<Record<string, string>>(),
    errorMsg: text("error_msg", { length: 512 }).notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now()),
  },
  (t) => [index("idx_jobs_user_content").on(t.userId, t.kind, t.refId, t.status)],
);
export type PipelineJob = typeof pipelineJobs.$inferSelect;

/** 会话（30 天有效） */
export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    token: text("token", { length: 80 }).notNull().unique(),
    userId: integer("user_id").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
  },
  (t) => [index("idx_sessions_expires").on(t.expiresAt), index("idx_sessions_user").on(t.userId)],
);
export type Session = typeof sessions.$inferSelect;

/** 方法论条款库（笔记正文结构化，驱动 Agent 的知识引擎） */
export const methodClauses = sqliteTable("method_clauses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** 条款标识，如 S5-compare-01 / T-attitude-02 / L-pronoun-01 */
  clauseId: text("clause_id", { length: 40 }).notNull().unique(),
  /** 域：structure篇章 / step六步 / type八题型 / logic六逻辑 / option选项 / sentence长难句 */
  domain: text("domain", { enum: ["structure", "step", "type", "logic", "option", "sentence"] }).notNull(),
  /** 关联键：题型id / 步骤id(S1-S6) / 逻辑id，便于精准装配 */
  refKey: text("ref_key", { length: 32 }).notNull().default(""),
  title: text("title", { length: 64 }).notNull(),
  /** 笔记原文（含英文术语） */
  content: text("content").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});
export type MethodClause = typeof methodClauses.$inferSelect;

/** 长难句拆解缓存（按篇章+句索引） */
export const sentenceAnalyses = sqliteTable(
  "sentence_analyses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 真题 / AI 生成题 */
    source: text("source", { enum: ["exam", "generated"] }).notNull().default("exam"),
    passageId: integer("passage_id").notNull(),
    paraNo: integer("para_no").notNull(),
    sentIdx: integer("sent_idx").notNull(),
    sentence: text("sentence").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    modelUsed: text("model_used", { length: 128 }).notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
  },
  (t) => [uniqueIndex("uq_sent").on(t.source, t.passageId, t.paraNo, t.sentIdx)],
);
export type SentenceAnalysis = typeof sentenceAnalyses.$inferSelect;

/** 真题阅读篇章（2010-2026 英语一 text1-4） */
export const passages = sqliteTable("passages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  year: integer("year").notNull(),
  textNo: integer("text_no").notNull(),
  /** 按自然段切分的全文 */
  paragraphs: text("paragraphs", { mode: "json" }).$type<string[]>().notNull(),
  /** 语料来源标记 */
  sourceTag: text("source_tag", { length: 64 }).notNull().default(""),
  /** 校验状态：双源一致 / 单源 / 存疑 */
  verifyStatus: text("verify_status", { enum: ["verified", "single_source", "flagged"] })
    .notNull()
    .default("single_source"),
  verifyNote: text("verify_note", { length: 512 }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
});
export type Passage = typeof passages.$inferSelect;

/** 题目（每篇 5 题） */
export const questions = sqliteTable("questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  passageId: integer("passage_id").notNull(),
  qNo: integer("q_no").notNull(),
  stem: text("stem").notNull(),
  /** 题型标签：example/attitude/vocab/cause/viewpoint/detail/infer/main/unknown */
  qType: text("q_type", { length: 32 }).notNull().default("unknown"),
  options: text("options", { mode: "json" }).$type<string[]>().notNull(),
  /** 标准答案（A-D），无可靠来源时为空 */
  answer: text("answer", { length: 1 }),
  locatorHint: text("locator_hint", { length: 255 }),
});
export type Question = typeof questions.$inferSelect;

/** SOP 知识卡（方法论知识库，英汉对照） */
export const knowledgeCards = sqliteTable("knowledge_cards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** 节点标识，如 S1 / T-example / L-cause */
  nodeId: text("node_id", { length: 32 }).notNull().unique(),
  kind: text("kind", { enum: ["main", "sub", "logic", "option"] }).notNull(),
  title: text("title", { length: 128 }).notNull(),
  titleEn: text("title_en", { length: 128 }).notNull().default(""),
  /** 要点 [{zh, en}] */
  points: text("points", { mode: "json" }).$type<{ zh: string; en: string }[]>().notNull(),
  /** 注意事项 [{zh, en}] */
  cautions: text("cautions", { mode: "json" }).$type<{ zh: string; en: string }[]>().notNull(),
  /** 术语表 [{en, zh}] 英语单词必须附汉语翻译 */
  vocab: text("vocab", { mode: "json" }).$type<{ en: string; zh: string }[]>().notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});
export type KnowledgeCard = typeof knowledgeCards.$inferSelect;

/** 渠道（聚合站式 API 渠道，OpenAI/Anthropic 双协议） */
export const channels = sqliteTable("channels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name", { length: 64 }).notNull(),
  kind: text("kind", { enum: ["chat", "image"] }).notNull(),
  protocol: text("protocol", { enum: ["openai", "anthropic"] }).notNull(),
  baseUrl: text("base_url", { length: 255 }).notNull(),
  apiKey: text("api_key").notNull(),
  models: text("models", { mode: "json" }).$type<string[]>().notNull(),
  /** 思考强度默认值：none/low/medium/high/xhigh/max，空=不发送 */
  reasoningEffort: text("reasoning_effort", { length: 16 }),
  /** 高级配置：温度/最大token/超时/重试/自定义透传参数 */
  config: text("config", { mode: "json" }).$type<ChannelConfig>(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  /** 归属用户：空=全站节点（仅管理员可管），否则为该用户的个人节点 */
  userId: integer("user_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
});
export type Channel = typeof channels.$inferSelect;

/** 渠道高级配置 */
export interface ChannelConfig {
  temperature?: number;
  maxTokens?: number;
  timeoutSec?: number;
  retries?: number;
  /** 原样合并进请求体的自定义参数 */
  extraParams?: Record<string, unknown>;
}

/** Agent/全局 → 渠道+模型 绑定（userId 为空 = 全站绑定，否则为用户个人覆盖） */
export const bindings = sqliteTable("bindings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  /** default_chat / default_image / agent_structure / agent_question /
   *  agent_locator / agent_solver / agent_reviewer / agent_generator / vocab_lookup */
  role: text("role", { length: 40 }).notNull(),
  channelId: integer("channel_id").notNull(),
  model: text("model", { length: 64 }).notNull(),
  /** 思考强度覆盖值，空=跟随渠道默认 */
  reasoningEffort: text("reasoning_effort", { length: 16 }),
});
export type Binding = typeof bindings.$inferSelect;

/** 提示词资产（userId 为空 = 系统预设，否则为用户个人版本） */
export const prompts = sqliteTable("prompts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  agentRole: text("agent_role", { length: 40 }).notNull(),
  name: text("name", { length: 64 }).notNull(),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now()),
});
export type Prompt = typeof prompts.$inferSelect;

/** 做题记录 */
export const practiceRecords = sqliteTable(
  "practice_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 归属用户，空=早期未归属数据 */
    userId: integer("user_id"),
    /** 来源：真题 / AI 生成题 */
    source: text("source", { enum: ["exam", "generated"] }).notNull().default("exam"),
    /** 真题 passageId 或生成题 generatedSetId（按 source 解释） */
    passageId: integer("passage_id").notNull(),
    /** {questionId: "A"|"B"|"C"|"D"} */
    answers: text("answers", { mode: "json" }).$type<Record<string, string>>().notNull(),
    /** AI 判定后的各题对错 {questionId: true/false}，未解析时为空 */
    verdicts: text("verdicts", { mode: "json" }).$type<Record<string, boolean>>(),
    durationSec: integer("duration_sec"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
  },
  (t) => [index("idx_records_user").on(t.userId)],
);
export type PracticeRecord = typeof practiceRecords.$inferSelect;

/** AI 解析产物（实时生成后入库，可复看） */
export const analyses = sqliteTable(
  "analyses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** 真题 / AI 生成题 */
    source: text("source", { enum: ["exam", "generated"] }).notNull().default("exam"),
    passageId: integer("passage_id").notNull(),
    /** A1 结构分析 → A5 校验后的完整产物 */
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    modelUsed: text("model_used", { length: 128 }).notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
  },
  (t) => [index("idx_analyses_source_ref_created").on(t.source, t.passageId, t.createdAt)],
);
export type Analysis = typeof analyses.$inferSelect;

/** AI 生成的新题 */
export const generatedSets = sqliteTable("generated_sets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  topic: text("topic", { length: 128 }).notNull(),
  difficulty: text("difficulty", { length: 16 }).notNull().default("medium"),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  modelUsed: text("model_used", { length: 128 }).notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
});
export type GeneratedSet = typeof generatedSets.$inferSelect;

/** 错题本（练习错题自动入册，重练做对后标记掌握） */
export const wrongItems = sqliteTable(
  "wrong_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    source: text("source", { enum: ["exam", "generated"] }).notNull().default("exam"),
    /** 真题 passageId 或生成题 generatedSetId */
    refId: integer("ref_id").notNull(),
    /** 真题题目 id（source=exam 时） */
    questionId: integer("question_id"),
    qNo: integer("q_no").notNull(),
    qType: text("q_type", { length: 32 }).notNull().default("unknown"),
    stem: text("stem").notNull(),
    options: text("options", { mode: "json" }).$type<string[]>().notNull(),
    correctAnswer: text("correct_answer", { length: 1 }).notNull(),
    myAnswer: text("my_answer", { length: 1 }).notNull(),
    mastered: integer("mastered", { mode: "boolean" }).notNull().default(false),
    attempts: integer("attempts").notNull().default(0),
    /** 错因六分法：locate/comprehend/overinfer/detail/mistype/vocab，空=未诊断 */
    errorType: text("error_type", { length: 24 }).notNull().default(""),
    /** 是否已生成 AI 诊断书 */
    hasAnalysis: integer("has_analysis", { mode: "boolean" }).notNull().default(false),
    /** 感悟状态：none/attention/understood */
    insightStatus: text("insight_status", { length: 16 }).notNull().default("none"),
    /** 艾宾浩斯复习阶段 0-5（对应 [1,2,4,7,15,30] 天） */
    reviewStage: integer("review_stage").notNull().default(0),
    reviewCount: integer("review_count").notNull().default(0),
    nextReviewAt: integer("next_review_at", { mode: "timestamp_ms" }),
    lastReviewedAt: integer("last_reviewed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now()),
  },
  (t) => [index("idx_wrong_user").on(t.userId)],
);
export type WrongItem = typeof wrongItems.$inferSelect;

/** 生词本（阅读原文点词收入） */
export const vocabItems = sqliteTable(
  "vocab_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    word: text("word", { length: 64 }).notNull(),
    /** 汉语释义（AI 给出） */
    zh: text("zh", { length: 255 }).notNull().default(""),
    /** 出处原句 */
    context: text("context"),
    passageId: integer("passage_id"),
    /** 熟悉度：0 生 / 1 熟 / 2 会了 */
    familiarity: integer("familiarity").notNull().default(0),
    /** AI 记忆配图（dataURL，缓存；base64 可能达数 MB，用 TEXT 存储） */
    image: text("image"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
  },
  (t) => [uniqueIndex("uq_vocab_user_word").on(t.userId, t.word)],
);
export type VocabItem = typeof vocabItems.$inferSelect;

/** AI 答案 vs 官方答案差异分析（懒生成，唯一键缓存） */
export const answerDiffs = sqliteTable(
  "answer_diffs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source", { enum: ["exam", "generated"] }).notNull().default("exam"),
    passageId: integer("passage_id").notNull(),
    qNo: integer("q_no").notNull(),
    aiAnswer: text("ai_answer", { length: 1 }).notNull(),
    officialAnswer: text("official_answer", { length: 1 }).notNull(),
    /** 根源六分类：locate/comprehend/overinfer/detail/mistype/vocab */
    rootCause: text("root_cause", { length: 32 }).notNull().default(""),
    aiReasoning: text("ai_reasoning"),
    officialLogic: text("official_logic"),
    userTakeaway: text("user_takeaway"),
    modelUsed: text("model_used", { length: 128 }).notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
  },
  (t) => [uniqueIndex("uq_diff").on(t.source, t.passageId, t.qNo, t.aiAnswer, t.officialAnswer)],
);
export type AnswerDiff = typeof answerDiffs.$inferSelect;

/** 错题 AI 诊断书（1:1 wrongId） */
export const wrongItemAnalyses = sqliteTable("wrong_item_analyses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  wrongId: integer("wrong_id").notNull().unique(),
  errorType: text("error_type", { length: 24 }).notNull().default(""),
  rootCause: text("root_cause"),
  distractorPull: text("distractor_pull"),
  knowledgeGap: text("knowledge_gap"),
  methodRefs: text("method_refs", { mode: "json" }).$type<{ clauseId: string; title: string; applied: string }[]>(),
  suggestion: text("suggestion"),
  modelUsed: text("model_used", { length: 128 }).notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
});
export type WrongItemAnalysis = typeof wrongItemAnalyses.$inferSelect;

/** 错题感悟笔记（1:N wrongId；wrongId 空=按错误类型的通用感悟） */
export const wrongInsights = sqliteTable(
  "wrong_insights",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    wrongId: integer("wrong_id"),
    errorType: text("error_type", { length: 24 }).notNull().default(""),
    content: text("content").notNull(),
    status: text("status", { length: 16 }).notNull().default("attention"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now()),
  },
  (t) => [index("idx_insights_user").on(t.userId)],
);
export type WrongInsight = typeof wrongInsights.$inferSelect;

/** AI 备考建议缓存（每用户 1 条） */
export const wrongRecommendations = sqliteTable("wrong_recommendations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().unique(),
  headline: text("headline", { length: 128 }).notNull().default(""),
  advice: text("advice"),
  focusTypes: text("focus_types", { mode: "json" }).$type<string[]>().notNull(),
  modelUsed: text("model_used", { length: 128 }).notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now()),
});
export type WrongRecommendation = typeof wrongRecommendations.$inferSelect;

/** 作文（正式成稿 + AI 批改结果） */
export const essays = sqliteTable(
  "essays",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    title: text("title", { length: 128 }).notNull().default(""),
    /** 小作文：letter/notice/memo；大作文：picture/chart */
    essayType: text("essay_type", { length: 24 }).notNull().default("picture"),
    prompt: text("prompt").notNull(),
    // TiDB 兼容：TEXT 列不允许 DEFAULT，默认空串由写入方保证（essayRouter 全部显式给值）
    content: text("content").notNull(),
    review: text("review", { mode: "json" }).$type<Record<string, unknown>>(),
    score: integer("score"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now()),
  },
  (t) => [index("idx_essays_user").on(t.userId)],
);
export type Essay = typeof essays.$inferSelect;

/** 引导式写作会话（交互式状态机，state JSON 存完整进度） */
export const essayDrafts = sqliteTable(
  "essay_drafts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    title: text("title", { length: 128 }).notNull().default(""),
    essayType: text("essay_type", { length: 24 }).notNull().default("picture"),
    prompt: text("prompt").notNull(),
    /** 状态机：{step, outline, paragraphs[], currentPara, useMaterials} */
    state: text("state", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    essayId: integer("essay_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now()),
  },
  (t) => [index("idx_drafts_user").on(t.userId)],
);
export type EssayDraft = typeof essayDrafts.$inferSelect;

/** 用户素材库（模板/好句/笔记/范文/词汇） */
export const userMaterials = sqliteTable(
  "user_materials",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    kind: text("kind", { length: 24 }).notNull().default("note"),
    title: text("title", { length: 128 }).notNull().default(""),
    content: text("content").notNull(),
    usedCount: integer("used_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
  },
  (t) => [index("idx_materials_user").on(t.userId)],
);
export type UserMaterial = typeof userMaterials.$inferSelect;

/** 复盘定制卷（交卷后由"错因+AI诊断+自评"三件套定制的仿真题） */
export const retroSets = sqliteTable(
  "retro_sets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    /** 来源练习记录 */
    recordId: integer("record_id").notNull(),
    /** 自评内容哈希（自评变了允许再生成一次） */
    noteHash: text("note_hash", { length: 32 }).notNull().default(""),
    /** 学生自评原文（可空） */
    selfNote: text("self_note"),
    /** 生成时聚合的错因上下文快照（可复查生成依据） */
    context: text("context", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    /** 产出的 generatedSet id */
    generatedId: integer("generated_id").notNull(),
    modelUsed: text("model_used", { length: 128 }).notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
  },
  (t) => [index("idx_retro_user").on(t.userId, t.recordId)],
);
export type RetroSet = typeof retroSets.$inferSelect;

/** 参与式解题（跟我练）成果记录 */
export const interactiveRecords = sqliteTable(
  "interactive_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    kind: text("kind", { enum: ["exam", "generated"] }).notNull().default("exam"),
    refId: integer("ref_id").notNull(),
    qNo: integer("q_no").notNull(),
    /** 学生判的题型 */
    myQType: text("my_q_type", { length: 32 }).notNull().default(""),
    /** 学生选的定位段落（可空=没选） */
    myParaNo: integer("my_para_no"),
    myAnswer: text("my_answer", { length: 1 }).notNull(),
    myReflection: text("my_reflection"),
    /** 最终对错（以官方答案为准） */
    correct: integer("correct", { mode: "boolean" }).notNull(),
    /** 逐步得分 {question, locate, solve} */
    stepScore: text("step_score", { mode: "json" })
      .$type<{ question: boolean; locate: boolean; solve: boolean }>()
      .notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
  },
  (t) => [index("idx_interactive_user").on(t.userId, t.kind, t.refId)],
);
export type InteractiveRecord = typeof interactiveRecords.$inferSelect;

/** 用户工单（全站浮动反馈印的落点：截图/报错/位置自动归档） */
export const tickets = sqliteTable(
  "tickets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    /** 分类：bug 报错 / suggest 建议 / question 疑问 / other 其他 */
    kind: text("kind", { enum: ["bug", "suggest", "question", "other"] }).notNull().default("bug"),
    title: text("title", { length: 128 }).notNull(),
    content: text("content").notNull(),
    /** 自动捕获：提交时所在页面路径 */
    pageUrl: text("page_url", { length: 255 }).notNull().default(""),
    /** 用户补充的具体位置（可选） */
    locationText: text("location_text", { length: 255 }).notNull().default(""),
    /** 用户粘贴的报错内容（可选） */
    errorText: text("error_text"),
    /** 自动捕获：最近的前端控制台错误（最多 5 条） */
    consoleErrors: text("console_errors", { mode: "json" }).$type<{ msg: string; at: string }[]>(),
    userAgent: text("user_agent", { length: 255 }).notNull().default(""),
    viewport: text("viewport", { length: 32 }).notNull().default(""),
    appVersion: text("app_version", { length: 32 }).notNull().default(""),
    /** 状态流转：open 待处理 → processing 处理中 → resolved 已解决 → closed 已关闭 */
    status: text("status", { enum: ["open", "processing", "resolved", "closed"] }).notNull().default("open"),
    /** 状态流转时间线（处理路线，用户可见） */
    statusLog: text("status_log", { mode: "json" }).$type<{ status: string; at: string; note?: string }[]>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(now()),
  },
  (t) => [index("idx_ticket_user").on(t.userId, t.status)],
);
export type Ticket = typeof tickets.$inferSelect;

/** 工单对话（用户追问 + 管理员回复，按时间排列） */
export const ticketReplies = sqliteTable(
  "ticket_replies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ticketId: integer("ticket_id").notNull(),
    authorId: integer("author_id").notNull(),
    authorRole: text("author_role", { enum: ["user", "admin"] }).notNull(),
    authorName: text("author_name", { length: 64 }).notNull().default(""),
    content: text("content").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
  },
  (t) => [index("idx_ticket_reply").on(t.ticketId)],
);
export type TicketReply = typeof ticketReplies.$inferSelect;

/** 工单截图附件（客户端压缩为 ≤400KB JPEG 后以 base64 落库，免文件系统依赖） */
export const ticketAttachments = sqliteTable(
  "ticket_attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ticketId: integer("ticket_id").notNull(),
    name: text("name", { length: 128 }).notNull().default(""),
    mime: text("mime", { length: 32 }).notNull().default("image/jpeg"),
    size: integer("size").notNull().default(0),
    dataBase64: text("data_base64").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
  },
  (t) => [index("idx_ticket_attach").on(t.ticketId)],
);
export type TicketAttachment = typeof ticketAttachments.$inferSelect;

/** 公告（每一期都留档，公告中心按期查看；发布时同步首页横幅设置） */
export const announcements = sqliteTable("announcements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title", { length: 128 }).notNull(),
  // 一句话简介：首页横幅与公告榜摘要位；发布时可不填，服务端自动从正文提取
  digest: text("digest"),
  content: text("content").notNull(),
  authorName: text("author_name", { length: 64 }).notNull().default("掌门"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(now()),
});
export type Announcement = typeof announcements.$inferSelect;
