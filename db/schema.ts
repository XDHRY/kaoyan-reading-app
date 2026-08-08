import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  int,
  bigint,
  boolean,
  json,
  uniqueIndex,
  mediumtext,
  longtext,
  index,
} from "drizzle-orm/mysql-core";

/** 用户（昵称 + 密码 + 密保找回） */
export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 32 }).notNull().unique(),
  /** scrypt 哈希（hex），永不明文 */
  passwordHash: varchar("password_hash", { length: 128 }).notNull().default(""),
  salt: varchar("salt", { length: 64 }).notNull().default(""),
  /** 密保提示词（用户自定义问题） */
  recoveryQuestion: varchar("recovery_question", { length: 128 }).notNull().default(""),
  /** 密保答案哈希 */
  recoveryHash: varchar("recovery_hash", { length: 128 }).notNull().default(""),
  /** 密保专用盐（与密码 salt 解耦：改密码不再使密保失效；空=沿用旧 salt 的存量行） */
  recoverySalt: varchar("recovery_salt", { length: 64 }).notNull().default(""),
  /** 头像字（一个汉字，默认昵称首字） */
  avatarChar: varchar("avatar_char", { length: 4 }).notNull().default(""),
  /** 角色：admin 拥有最高权限 */
  role: mysqlEnum("role", ["user", "admin"]).notNull().default("user"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type User = typeof users.$inferSelect;

/** 站点开关（管理员控制） */
export const siteSettings = mysqlTable("site_settings", {
  k: varchar("k", { length: 64 }).primaryKey(),
  v: text("v").notNull(),
});
export type SiteSetting = typeof siteSettings.$inferSelect;

/** 解析流水线任务（后台执行，前端轮询，断点可续跑） */
export const pipelineJobs = mysqlTable("pipeline_jobs", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }),
  /** 真题 / AI 生成题 */
  kind: mysqlEnum("kind", ["exam", "generated"]).notNull().default("exam"),
  /** 真题 passageId 或生成题 generatedSetId */
  refId: bigint("ref_id", { mode: "number", unsigned: true }).notNull(),
  status: mysqlEnum("status", ["running", "paused", "done", "error", "cancelled"]).notNull().default("running"),
  /** 当前阶段：structure/question/locate/solve/crosscheck/done */
  stage: varchar("stage", { length: 20 }).notNull().default(""),
  /** 各阶段记录 [{stage,status,elapsedMs,error?}] */
  stages: json("stages").$type<
    { stage: string; status: "pending" | "running" | "ok" | "error"; startedAt?: number; elapsedMs?: number; error?: string }[]
  >().notNull(),
  /** 累积产物：structure/qAnalysis/locate/solved/review/verdicts/crosscheck/trace */
  payload: json("payload").$type<Record<string, unknown>>().notNull(),
  /** 用户作答 {questionId|qNo: "A"} */
  answers: json("answers").$type<Record<string, string>>(),
  errorMsg: varchar("error_msg", { length: 512 }).notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => [index("idx_jobs_user_content").on(t.userId, t.kind, t.refId, t.status)]);
export type PipelineJob = typeof pipelineJobs.$inferSelect;

/** 会话（30 天有效） */
export const sessions = mysqlTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    token: varchar("token", { length: 80 }).notNull().unique(),
    userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_sessions_expires").on(t.expiresAt), index("idx_sessions_user").on(t.userId)],
);
export type Session = typeof sessions.$inferSelect;

/** 方法论条款库（笔记正文结构化，驱动 Agent 的知识引擎） */
export const methodClauses = mysqlTable("method_clauses", {
  id: serial("id").primaryKey(),
  /** 条款标识，如 S5-compare-01 / T-attitude-02 / L-pronoun-01 */
  clauseId: varchar("clause_id", { length: 40 }).notNull().unique(),
  /** 域：structure篇章 / step六步 / type八题型 / logic六逻辑 / option选项 / sentence长难句 */
  domain: mysqlEnum("domain", ["structure", "step", "type", "logic", "option", "sentence"]).notNull(),
  /** 关联键：题型id / 步骤id(S1-S6) / 逻辑id，便于精准装配 */
  refKey: varchar("ref_key", { length: 32 }).notNull().default(""),
  title: varchar("title", { length: 64 }).notNull(),
  /** 笔记原文（含英文术语） */
  content: text("content").notNull(),
  sortOrder: int("sort_order").notNull().default(0),
});
export type MethodClause = typeof methodClauses.$inferSelect;

/** 长难句拆解缓存（按篇章+句索引） */
export const sentenceAnalyses = mysqlTable(
  "sentence_analyses",
  {
    id: serial("id").primaryKey(),
    /** 真题 / AI 生成题 */
    source: mysqlEnum("source", ["exam", "generated"]).notNull().default("exam"),
    passageId: bigint("passage_id", { mode: "number", unsigned: true }).notNull(),
    paraNo: int("para_no").notNull(),
    sentIdx: int("sent_idx").notNull(),
    sentence: text("sentence").notNull(),
    payload: json("payload").$type<Record<string, unknown>>().notNull(),
    modelUsed: varchar("model_used", { length: 128 }).notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_sent").on(t.source, t.passageId, t.paraNo, t.sentIdx)],
);
export type SentenceAnalysis = typeof sentenceAnalyses.$inferSelect;

/** 真题阅读篇章（2010-2026 英语一 text1-4） */
export const passages = mysqlTable("passages", {
  id: serial("id").primaryKey(),
  year: int("year").notNull(),
  textNo: int("text_no").notNull(),
  /** 按自然段切分的全文 */
  paragraphs: json("paragraphs").$type<string[]>().notNull(),
  /** 语料来源标记 */
  sourceTag: varchar("source_tag", { length: 64 }).notNull().default(""),
  /** 校验状态：双源一致 / 单源 / 存疑 */
  verifyStatus: mysqlEnum("verify_status", ["verified", "single_source", "flagged"])
    .notNull()
    .default("single_source"),
  verifyNote: varchar("verify_note", { length: 512 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Passage = typeof passages.$inferSelect;

/** 题目（每篇 5 题） */
export const questions = mysqlTable("questions", {
  id: serial("id").primaryKey(),
  passageId: bigint("passage_id", { mode: "number", unsigned: true }).notNull(),
  qNo: int("q_no").notNull(),
  stem: text("stem").notNull(),
  /** 题型标签：example/attitude/vocab/cause/viewpoint/detail/infer/main/unknown */
  qType: varchar("q_type", { length: 32 }).notNull().default("unknown"),
  options: json("options").$type<string[]>().notNull(),
  /** 标准答案（A-D），无可靠来源时为空 */
  answer: varchar("answer", { length: 1 }),
  locatorHint: varchar("locator_hint", { length: 255 }),
});
export type Question = typeof questions.$inferSelect;

/** SOP 知识卡（方法论知识库，英汉对照） */
export const knowledgeCards = mysqlTable("knowledge_cards", {
  id: serial("id").primaryKey(),
  /** 节点标识，如 S1 / T-example / L-cause */
  nodeId: varchar("node_id", { length: 32 }).notNull().unique(),
  kind: mysqlEnum("kind", ["main", "sub", "logic", "option"]).notNull(),
  title: varchar("title", { length: 128 }).notNull(),
  titleEn: varchar("title_en", { length: 128 }).notNull().default(""),
  /** 要点 [{zh, en}] */
  points: json("points").$type<{ zh: string; en: string }[]>().notNull(),
  /** 注意事项 [{zh, en}] */
  cautions: json("cautions").$type<{ zh: string; en: string }[]>().notNull(),
  /** 术语表 [{en, zh}] 英语单词必须附汉语翻译 */
  vocab: json("vocab").$type<{ en: string; zh: string }[]>().notNull(),
  sortOrder: int("sort_order").notNull().default(0),
});
export type KnowledgeCard = typeof knowledgeCards.$inferSelect;

/** 渠道（聚合站式 API 渠道，OpenAI/Anthropic 双协议） */
export const channels = mysqlTable("channels", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  kind: mysqlEnum("kind", ["chat", "image"]).notNull(),
  protocol: mysqlEnum("protocol", ["openai", "anthropic"]).notNull(),
  baseUrl: varchar("base_url", { length: 255 }).notNull(),
  apiKey: text("api_key").notNull(),
  models: json("models").$type<string[]>().notNull(),
  /** 思考强度默认值：none/low/medium/high/xhigh/max，空=不发送 */
  reasoningEffort: varchar("reasoning_effort", { length: 16 }),
  /** 高级配置：温度/最大token/超时/重试/自定义透传参数 */
  config: json("config").$type<ChannelConfig>(),
  enabled: boolean("enabled").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  /** 归属用户：空=全站节点（仅管理员可管），否则为该用户的个人节点 */
  userId: bigint("user_id", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
export const bindings = mysqlTable("bindings", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }),
  /** default_chat / default_image / agent_structure / agent_question /
   *  agent_locator / agent_solver / agent_reviewer / agent_generator / vocab_lookup */
  role: varchar("role", { length: 40 }).notNull(),
  channelId: bigint("channel_id", { mode: "number", unsigned: true }).notNull(),
  model: varchar("model", { length: 64 }).notNull(),
  /** 思考强度覆盖值，空=跟随渠道默认 */
  reasoningEffort: varchar("reasoning_effort", { length: 16 }),
});
export type Binding = typeof bindings.$inferSelect;

/** 提示词资产（userId 为空 = 系统预设，否则为用户个人版本） */
export const prompts = mysqlTable("prompts", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }),
  agentRole: varchar("agent_role", { length: 40 }).notNull(),
  name: varchar("name", { length: 64 }).notNull(),
  content: text("content").notNull(),
  version: int("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});
export type Prompt = typeof prompts.$inferSelect;

/** 做题记录 */
export const practiceRecords = mysqlTable("practice_records", {
  id: serial("id").primaryKey(),
  /** 归属用户，空=早期未归属数据 */
  userId: bigint("user_id", { mode: "number", unsigned: true }),
  /** 来源：真题 / AI 生成题 */
  source: mysqlEnum("source", ["exam", "generated"]).notNull().default("exam"),
  /** 真题 passageId 或生成题 generatedSetId（按 source 解释） */
  passageId: bigint("passage_id", { mode: "number", unsigned: true }).notNull(),
  /** {questionId: "A"|"B"|"C"|"D"} */
  answers: json("answers").$type<Record<string, string>>().notNull(),
  /** AI 判定后的各题对错 {questionId: true/false}，未解析时为空 */
  verdicts: json("verdicts").$type<Record<string, boolean>>(),
  durationSec: int("duration_sec"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("idx_records_user").on(t.userId)]);
export type PracticeRecord = typeof practiceRecords.$inferSelect;

/** AI 解析产物（实时生成后入库，可复看） */
export const analyses = mysqlTable("analyses", {
  id: serial("id").primaryKey(),
  /** 真题 / AI 生成题 */
  source: mysqlEnum("source", ["exam", "generated"]).notNull().default("exam"),
  passageId: bigint("passage_id", { mode: "number", unsigned: true }).notNull(),
  /** A1 结构分析 → A5 校验后的完整产物 */
  payload: json("payload").$type<Record<string, unknown>>().notNull(),
  modelUsed: varchar("model_used", { length: 128 }).notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Analysis = typeof analyses.$inferSelect;

/** AI 生成的新题 */
export const generatedSets = mysqlTable("generated_sets", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }),
  topic: varchar("topic", { length: 128 }).notNull(),
  difficulty: varchar("difficulty", { length: 16 }).notNull().default("medium"),
  payload: json("payload").$type<Record<string, unknown>>().notNull(),
  modelUsed: varchar("model_used", { length: 128 }).notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type GeneratedSet = typeof generatedSets.$inferSelect;

/** 错题本（练习错题自动入册，重练做对后标记掌握） */
export const wrongItems = mysqlTable("wrong_items", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  source: mysqlEnum("source", ["exam", "generated"]).notNull().default("exam"),
  /** 真题 passageId 或生成题 generatedSetId */
  refId: bigint("ref_id", { mode: "number", unsigned: true }).notNull(),
  /** 真题题目 id（source=exam 时） */
  questionId: bigint("question_id", { mode: "number", unsigned: true }),
  qNo: int("q_no").notNull(),
  qType: varchar("q_type", { length: 32 }).notNull().default("unknown"),
  stem: text("stem").notNull(),
  options: json("options").$type<string[]>().notNull(),
  correctAnswer: varchar("correct_answer", { length: 1 }).notNull(),
  myAnswer: varchar("my_answer", { length: 1 }).notNull(),
  mastered: boolean("mastered").notNull().default(false),
  attempts: int("attempts").notNull().default(0),
  /** 错因六分法：locate/comprehend/overinfer/detail/mistype/vocab，空=未诊断 */
  errorType: varchar("error_type", { length: 24 }).notNull().default(""),
  /** 是否已生成 AI 诊断书 */
  hasAnalysis: boolean("has_analysis").notNull().default(false),
  /** 感悟状态：none/attention/understood */
  insightStatus: varchar("insight_status", { length: 16 }).notNull().default("none"),
  /** 艾宾浩斯复习阶段 0-5（对应 [1,2,4,7,15,30] 天） */
  reviewStage: int("review_stage").notNull().default(0),
  reviewCount: int("review_count").notNull().default(0),
  nextReviewAt: timestamp("next_review_at"),
  lastReviewedAt: timestamp("last_reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => [index("idx_wrong_user").on(t.userId)]);
export type WrongItem = typeof wrongItems.$inferSelect;

/** 生词本（阅读原文点词收入） */
export const vocabItems = mysqlTable(
  "vocab_items",
  {
    id: serial("id").primaryKey(),
    userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
    word: varchar("word", { length: 64 }).notNull(),
    /** 汉语释义（AI 给出） */
    zh: varchar("zh", { length: 255 }).notNull().default(""),
    /** 出处原句 */
    context: text("context"),
    passageId: bigint("passage_id", { mode: "number", unsigned: true }),
    /** 熟悉度：0 生 / 1 熟 / 2 会了 */
    familiarity: int("familiarity").notNull().default(0),
    /** AI 记忆配图（dataURL，缓存；base64 可能达数 MB，用 LONGTEXT 存储） */
    image: longtext("image"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_vocab_user_word").on(t.userId, t.word)],
);
export type VocabItem = typeof vocabItems.$inferSelect;

/** AI 答案 vs 官方答案差异分析（懒生成，唯一键缓存） */
export const answerDiffs = mysqlTable(
  "answer_diffs",
  {
    id: serial("id").primaryKey(),
    source: mysqlEnum("source", ["exam", "generated"]).notNull().default("exam"),
    passageId: bigint("passage_id", { mode: "number", unsigned: true }).notNull(),
    qNo: int("q_no").notNull(),
    aiAnswer: varchar("ai_answer", { length: 1 }).notNull(),
    officialAnswer: varchar("official_answer", { length: 1 }).notNull(),
    /** 根源六分类：locate/comprehend/overinfer/detail/mistype/vocab */
    rootCause: varchar("root_cause", { length: 32 }).notNull().default(""),
    aiReasoning: text("ai_reasoning"),
    officialLogic: text("official_logic"),
    userTakeaway: text("user_takeaway"),
    modelUsed: varchar("model_used", { length: 128 }).notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_diff").on(t.source, t.passageId, t.qNo, t.aiAnswer, t.officialAnswer)],
);
export type AnswerDiff = typeof answerDiffs.$inferSelect;

/** 错题 AI 诊断书（1:1 wrongId） */
export const wrongItemAnalyses = mysqlTable("wrong_item_analyses", {
  id: serial("id").primaryKey(),
  wrongId: bigint("wrong_id", { mode: "number", unsigned: true }).notNull().unique(),
  errorType: varchar("error_type", { length: 24 }).notNull().default(""),
  rootCause: text("root_cause"),
  distractorPull: text("distractor_pull"),
  knowledgeGap: text("knowledge_gap"),
  methodRefs: json("method_refs").$type<{ clauseId: string; title: string; applied: string }[]>(),
  suggestion: text("suggestion"),
  modelUsed: varchar("model_used", { length: 128 }).notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type WrongItemAnalysis = typeof wrongItemAnalyses.$inferSelect;

/** 错题感悟笔记（1:N wrongId；wrongId 空=按错误类型的通用感悟） */
export const wrongInsights = mysqlTable("wrong_insights", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  wrongId: bigint("wrong_id", { mode: "number", unsigned: true }),
  errorType: varchar("error_type", { length: 24 }).notNull().default(""),
  content: text("content").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("attention"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => [index("idx_insights_user").on(t.userId)]);
export type WrongInsight = typeof wrongInsights.$inferSelect;

/** AI 备考建议缓存（每用户 1 条） */
export const wrongRecommendations = mysqlTable("wrong_recommendations", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull().unique(),
  headline: varchar("headline", { length: 128 }).notNull().default(""),
  advice: text("advice"),
  focusTypes: json("focus_types").$type<string[]>().notNull(),
  modelUsed: varchar("model_used", { length: 128 }).notNull().default(""),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});
export type WrongRecommendation = typeof wrongRecommendations.$inferSelect;

/** 作文（正式成稿 + AI 批改结果） */
export const essays = mysqlTable("essays", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 128 }).notNull().default(""),
  /** 小作文：letter/notice/memo；大作文：picture/chart */
  essayType: varchar("essay_type", { length: 24 }).notNull().default("picture"),
  prompt: text("prompt").notNull(),
  // TiDB 兼容：TEXT 列不允许 DEFAULT，默认空串由写入方保证（essayRouter 全部显式给值）
  content: text("content").notNull(),
  review: json("review").$type<Record<string, unknown>>(),
  score: int("score"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => [index("idx_essays_user").on(t.userId)]);
export type Essay = typeof essays.$inferSelect;

/** 引导式写作会话（交互式状态机，state JSON 存完整进度） */
export const essayDrafts = mysqlTable("essay_drafts", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  title: varchar("title", { length: 128 }).notNull().default(""),
  essayType: varchar("essay_type", { length: 24 }).notNull().default("picture"),
  prompt: text("prompt").notNull(),
  /** 状态机：{step, outline, paragraphs[], currentPara, useMaterials} */
  state: json("state").$type<Record<string, unknown>>().notNull(),
  essayId: bigint("essay_id", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => [index("idx_drafts_user").on(t.userId)]);
export type EssayDraft = typeof essayDrafts.$inferSelect;

/** 用户素材库（模板/好句/笔记/范文/词汇） */
export const userMaterials = mysqlTable("user_materials", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  kind: varchar("kind", { length: 24 }).notNull().default("note"),
  title: varchar("title", { length: 128 }).notNull().default(""),
  content: text("content").notNull(),
  usedCount: int("used_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("idx_materials_user").on(t.userId)]);
export type UserMaterial = typeof userMaterials.$inferSelect;

/** 复盘定制卷（交卷后由"错因+AI诊断+自评"三件套定制的仿真题） */
export const retroSets = mysqlTable("retro_sets", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  /** 来源练习记录 */
  recordId: bigint("record_id", { mode: "number", unsigned: true }).notNull(),
  /** 自评内容哈希（自评变了允许再生成一次） */
  noteHash: varchar("note_hash", { length: 32 }).notNull().default(""),
  /** 学生自评原文（可空） */
  selfNote: text("self_note"),
  /** 生成时聚合的错因上下文快照（可复查生成依据） */
  context: json("context").$type<Record<string, unknown>>().notNull(),
  /** 产出的 generatedSet id */
  generatedId: bigint("generated_id", { mode: "number", unsigned: true }).notNull(),
  modelUsed: varchar("model_used", { length: 128 }).notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("idx_retro_user").on(t.userId, t.recordId)]);
export type RetroSet = typeof retroSets.$inferSelect;

/** 参与式解题（跟我练）成果记录 */
export const interactiveRecords = mysqlTable("interactive_records", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  kind: mysqlEnum("kind", ["exam", "generated"]).notNull().default("exam"),
  refId: bigint("ref_id", { mode: "number", unsigned: true }).notNull(),
  qNo: int("q_no").notNull(),
  /** 学生判的题型 */
  myQType: varchar("my_q_type", { length: 32 }).notNull().default(""),
  /** 学生选的定位段落（可空=没选） */
  myParaNo: int("my_para_no"),
  myAnswer: varchar("my_answer", { length: 1 }).notNull(),
  myReflection: text("my_reflection"),
  /** 最终对错（以官方答案为准） */
  correct: boolean("correct").notNull(),
  /** 逐步得分 {question, locate, solve} */
  stepScore: json("step_score").$type<{ question: boolean; locate: boolean; solve: boolean }>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("idx_interactive_user").on(t.userId, t.kind, t.refId)]);
export type InteractiveRecord = typeof interactiveRecords.$inferSelect;

/** 用户工单（全站浮动反馈印的落点：截图/报错/位置自动归档） */
export const tickets = mysqlTable("tickets", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  /** 分类：bug 报错 / suggest 建议 / question 疑问 / other 其他 */
  kind: mysqlEnum("kind", ["bug", "suggest", "question", "other"]).notNull().default("bug"),
  title: varchar("title", { length: 128 }).notNull(),
  content: text("content").notNull(),
  /** 自动捕获：提交时所在页面路径 */
  pageUrl: varchar("page_url", { length: 255 }).notNull().default(""),
  /** 用户补充的具体位置（可选） */
  locationText: varchar("location_text", { length: 255 }).notNull().default(""),
  /** 用户粘贴的报错内容（可选） */
  errorText: text("error_text"),
  /** 自动捕获：最近的前端控制台错误（最多 5 条） */
  consoleErrors: json("console_errors").$type<{ msg: string; at: string }[]>(),
  userAgent: varchar("user_agent", { length: 255 }).notNull().default(""),
  viewport: varchar("viewport", { length: 32 }).notNull().default(""),
  appVersion: varchar("app_version", { length: 32 }).notNull().default(""),
  /** 状态流转：open 待处理 → processing 处理中 → resolved 已解决 → closed 已关闭 */
  status: mysqlEnum("status", ["open", "processing", "resolved", "closed"]).notNull().default("open"),
  /** 状态流转时间线（处理路线，用户可见） */
  statusLog: json("status_log").$type<{ status: string; at: string; note?: string }[]>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => [index("idx_ticket_user").on(t.userId, t.status)]);
export type Ticket = typeof tickets.$inferSelect;

/** 工单对话（用户追问 + 管理员回复，按时间排列） */
export const ticketReplies = mysqlTable("ticket_replies", {
  id: serial("id").primaryKey(),
  ticketId: bigint("ticket_id", { mode: "number", unsigned: true }).notNull(),
  authorId: bigint("author_id", { mode: "number", unsigned: true }).notNull(),
  authorRole: mysqlEnum("author_role", ["user", "admin"]).notNull(),
  authorName: varchar("author_name", { length: 64 }).notNull().default(""),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("idx_ticket_reply").on(t.ticketId)]);
export type TicketReply = typeof ticketReplies.$inferSelect;

/** 工单截图附件（客户端压缩为 ≤400KB JPEG 后以 base64 落库，免文件系统依赖） */
export const ticketAttachments = mysqlTable("ticket_attachments", {
  id: serial("id").primaryKey(),
  ticketId: bigint("ticket_id", { mode: "number", unsigned: true }).notNull(),
  name: varchar("name", { length: 128 }).notNull().default(""),
  mime: varchar("mime", { length: 32 }).notNull().default("image/jpeg"),
  size: int("size").notNull().default(0),
  dataBase64: mediumtext("data_base64").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("idx_ticket_attach").on(t.ticketId)]);
export type TicketAttachment = typeof ticketAttachments.$inferSelect;

/** 公告（每一期都留档，公告中心按期查看；发布时同步首页横幅设置） */
export const announcements = mysqlTable("announcements", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 128 }).notNull(),
  // 一句话简介：首页横幅与公告榜摘要位；发布时可不填，服务端自动从正文提取
  digest: text("digest"),
  content: text("content").notNull(),
  authorName: varchar("author_name", { length: 64 }).notNull().default("掌门"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Announcement = typeof announcements.$inferSelect;
