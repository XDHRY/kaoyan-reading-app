/** 前后端共享常量 */

/** Agent 流水线角色 */
export const AGENT_ROLES = [
  { id: "agent_structure", name: "结构分析师", desc: "分析全文行文结构与篇章模式", sopStep: 0 },
  { id: "agent_question", name: "审题官", desc: "读题 3Q：判题型、翻题干、提取定位词", sopStep: 2 },
  { id: "agent_locator", name: "定位官", desc: "题文同序找定位句与最大解题范围", sopStep: 3 },
  { id: "agent_solver", name: "解题官", desc: "选项对比解题，给出答案与理由", sopStep: 4 },
  { id: "agent_reviewer", name: "校验官", desc: "复核方法运用与答案一致性，可打回重跑", sopStep: 5 },
  { id: "agent_crosscheck", name: "交叉验证官", desc: "第二模型独立解题陪审，分歧亮黄旗", sopStep: 5 },
  { id: "agent_generator", name: "命题官", desc: "仿考研风格生成新阅读与题目", sopStep: -1 },
] as const;

export const BINDING_ROLES = [
  { id: "default_chat", name: "全局默认对话", kind: "chat" },
  { id: "default_image", name: "全局默认绘图", kind: "image" },
  ...AGENT_ROLES.map((r) => ({ id: r.id, name: r.name, kind: "chat" as const })),
  { id: "sentence_parser", name: "拆句教练", kind: "chat" },
  { id: "vocab_lookup", name: "查词词典", kind: "chat" },
  { id: "agent_diff", name: "命题研究员", kind: "chat" },
  { id: "agent_analyst", name: "错因分析师", kind: "chat" },
  { id: "agent_advisor", name: "备考参谋", kind: "chat" },
  { id: "essay_outliner", name: "作文提纲师", kind: "chat" },
  { id: "essay_drafter", name: "作文执笔", kind: "chat" },
  { id: "essay_reviewer", name: "作文阅卷官", kind: "chat" },
] as const;

/** 八大题型 */
export const Q_TYPES = [
  { id: "example", name: "例证题", nameEn: "Example" },
  { id: "attitude", name: "态度题", nameEn: "Attitude" },
  { id: "vocab", name: "语义题", nameEn: "Vocabulary" },
  { id: "cause", name: "因果题", nameEn: "Cause" },
  { id: "viewpoint", name: "观点题", nameEn: "Viewpoint" },
  { id: "detail", name: "细节题", nameEn: "Detail" },
  { id: "infer", name: "推断题", nameEn: "Inference" },
  { id: "main", name: "主旨题", nameEn: "Main Idea" },
] as const;

/** 知识卡数据形态（前后端共享） */
export type KnowledgeCardData = {
  nodeId: string;
  kind: "main" | "sub" | "logic" | "option";
  title: string;
  titleEn: string;
  points: { zh: string; en: string }[];
  cautions: { zh: string; en: string }[];
  vocab: { en: string; zh: string }[];
};

/** SOP 六步主流程 */
export const SOP_STEPS = [
  { id: "S1", num: "壹", name: "标段", nameEn: "Mark Paragraphs" },
  { id: "S2", num: "贰", name: "读题 3Q", nameEn: "Read Questions" },
  { id: "S3", num: "叁", name: "五题同定位", nameEn: "Locate" },
  { id: "S4", num: "肆", name: "定解题范围", nameEn: "Scope" },
  { id: "S5", num: "伍", name: "选项对比解题", nameEn: "Compare Options" },
  { id: "S6", num: "陆", name: "无解兜底", nameEn: "Fallback" },
] as const;

/** 错因六分法（诊断室/差异分析共享，前后端单一来源） */
export const ERROR_TYPES = {
  locate:     { zh: "定位错误", sopStep: "五题同定位",  desc: "找错了原文位置，答案区判错" },
  comprehend: { zh: "理解偏差", sopStep: "选项对比解题", desc: "句子含义或逻辑关系理解错了" },
  overinfer:  { zh: "过度推断", sopStep: "选项对比解题", desc: "把合理推断当成了原文事实" },
  detail:     { zh: "细节忽略", sopStep: "定解题范围",   desc: "漏看了关键修饰词或限定条件" },
  mistype:    { zh: "题型误判", sopStep: "读题3Q",       desc: "题型判错，用错了固定解法" },
  vocab:      { zh: "词汇障碍", sopStep: "标段通读",     desc: "关键词词义理解错误" },
} as const;
export type ErrorType = keyof typeof ERROR_TYPES;

/** 艾宾浩斯复习间隔（天）：阶段 0-5 */
export const REVIEW_INTERVALS_DAYS = [1, 2, 4, 7, 15, 30] as const;

/** v5 新增 Agent 角色（差异分析/错因诊断/备考建议/作文三件套） */
export const AGENT_ROLES_V5 = [
  { id: "agent_diff", name: "命题研究员", desc: "AI 答案与官方答案分歧的根源诊断" },
  { id: "agent_analyst", name: "错因分析师", desc: "错题六分法诊断书" },
  { id: "agent_advisor", name: "备考参谋", desc: "基于错题统计的个性化建议" },
  { id: "essay_outliner", name: "作文提纲师", desc: "考研作文三段式提纲" },
  { id: "essay_drafter", name: "作文执笔", desc: "按提纲逐段撰写高分段落" },
  { id: "essay_reviewer", name: "作文阅卷官", desc: "按考研评分标准批改作文" },
] as const;
