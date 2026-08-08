/**
 * 种子数据：SOP 知识库（英汉对照）+ 预置渠道 + 默认绑定
 * 运行：npx tsx db/seed.ts
 */
import "dotenv/config";
import { getDb } from "../api/queries/connection";
import { knowledgeCards, channels, bindings } from "./schema";
import { eq, and, isNull, inArray } from "drizzle-orm";

type Card = {
  nodeId: string;
  kind: "main" | "sub" | "logic" | "option";
  title: string;
  titleEn: string;
  points: { zh: string; en: string }[];
  cautions: { zh: string; en: string }[];
  vocab: { en: string; zh: string }[];
  sortOrder: number;
};

const CARDS: Card[] = [
  {
    nodeId: "S1", kind: "main", title: "标段", titleEn: "Mark Paragraphs", sortOrder: 1,
    points: [
      { zh: "拿到文章先给每个自然段标上序号", en: "Number every paragraph before reading" },
      { zh: "独句段（只有一句话的段落）也算一段", en: "A one-sentence paragraph still counts" },
    ],
    cautions: [{ zh: "题文同序：题目顺序通常与段落顺序一致，标段是后续定位的基础", en: "Questions follow the text order" }],
    vocab: [
      { en: "paragraph", zh: "段落" },
      { en: "one-sentence paragraph", zh: "独句段" },
    ],
  },
  {
    nodeId: "S2", kind: "main", title: "读题 3Q", titleEn: "Read Questions: 3Q", sortOrder: 2,
    points: [
      { zh: "Q1 判题型：根据题干中的题型标志词识别题型", en: "Q1: Identify the question type by its signal words" },
      { zh: "Q2 翻译题干：弄清题目到底问什么", en: "Q2: Translate the stem — what is it really asking" },
      { zh: "Q3 定定位词：用3排除原则确定定位词", en: "Q3: Pick the locator words with the 3-exclusion rule" },
    ],
    cautions: [
      { zh: "3排除原则：排除题型标志词、虚词（冠词/介词/代词/连词）、提问部分", en: "Exclude signal words, function words, and interrogative parts" },
      { zh: "时间、数字、人名、地名、组织名要保留为定位词", en: "Keep time, numbers, names, places, organizations" },
      { zh: "一次性读完全部5个题再回原文", en: "Read all five questions before returning to the text" },
    ],
    vocab: [
      { en: "signal word", zh: "题型标志词" },
      { en: "stem", zh: "题干" },
      { en: "locator word", zh: "定位词" },
      { en: "article/preposition/pronoun/conjunction", zh: "冠词/介词/代词/连词" },
    ],
  },
  {
    nodeId: "S3", kind: "main", title: "五题同定位", titleEn: "Locate All Five", sortOrder: 3,
    points: [
      { zh: "原则：题文同序，五道题按顺序在文中找", en: "Questions follow text order" },
      { zh: "方法：用定位词以句子为单位寻找", en: "Search sentence by sentence with locator words" },
      { zh: "定位词有四种改写形式：同根改写、同义改写、全拼与缩写、同类改写（上下义词）", en: "Four rewrite forms: same-root, synonym, full-abbreviation, category" },
    ],
    cautions: [
      { zh: "定位词首次出现的句子优先成为定位句", en: "The sentence where the locator first appears wins" },
      { zh: "不同定位词分散时，对选项最重要成分（主＞谓＞宾＞状）所在句优先", en: "Prioritize the sentence holding the option's key component" },
    ],
    vocab: [
      { en: "locate", zh: "定位" },
      { en: "synonym", zh: "同义词" },
      { en: "abbreviation", zh: "缩写" },
    ],
  },
  {
    nodeId: "S4", kind: "main", title: "定解题范围", titleEn: "Set the Scope", sortOrder: 4,
    points: [
      { zh: "各题型有固定解题范围：例证题看例子前后句；语义题看定位句；观点题看人物引言；因果题看因果句；主旨题看N+1句", en: "Each type has a fixed scope: examples±1 sentence; quotes; N+1 sentences" },
      { zh: "N+1句 = 每段第一句 + 最后一段最后一句", en: "N+1 = first sentence of each paragraph + the last one" },
      { zh: "一般细节题自行固定：答案不跨段、本句优先", en: "Detail questions: answer stays within one paragraph" },
    ],
    cautions: [
      { zh: "定位句本句有代词，向前看一句；后一句有代词，向后看一句", en: "Pronouns extend the scope one sentence back or forward" },
      { zh: "转折词可界定范围：转折前后主题与题干不同则不看", en: "Contrast markers can cut the scope" },
    ],
    vocab: [
      { en: "scope", zh: "解题范围" },
      { en: "pronoun", zh: "代词" },
      { en: "contrast marker", zh: "转折词" },
    ],
  },
  {
    nodeId: "S5", kind: "main", title: "选项对比解题", titleEn: "Compare Options", sortOrder: 5,
    points: [
      { zh: "先用易错对比点排除：因果、否定、时间、比较级、最高级、方向趋势、情感正负、静动态、人物身份、金钱线索", en: "Check the error-prone points first: cause, negation, time, comparison..." },
      { zh: "再按成分优先级比对：主语＞谓语＞宾语＞修饰", en: "Then compare components: subject > verb > object > modifier" },
      { zh: "正确项优先级：同义改写＞概括总结＞逻辑反向＞中心主旨词保底", en: "Correct answer: paraphrase > summary > reversed logic > theme word" },
    ],
    cautions: [
      { zh: "来自并列关系且均与原文一致的选项，一并排除", en: "Parallel options both matching the text are both wrong" },
      { zh: "不会区分时：名词优先对比，越具体的名词越容易对比", en: "When stuck, compare concrete nouns first" },
    ],
    vocab: [
      { en: "paraphrase", zh: "同义改写" },
      { en: "superlative", zh: "最高级" },
      { en: "comparative", zh: "比较级" },
      { en: "eliminate", zh: "排除" },
    ],
  },
  {
    nodeId: "S6", kind: "main", title: "无解兜底", titleEn: "Fallback", sortOrder: 6,
    points: [
      { zh: "解题范围内找不到答案：先看本段首尾句，再看其他段首尾句", en: "No answer in scope: check paragraph openings and endings" },
      { zh: "定位句分散：定位词越完整的句子越优先", en: "Scattered locators: fullest match wins" },
    ],
    cautions: [{ zh: "兜底是最后手段，不要跳步使用", en: "Fallback is the last resort" }],
    vocab: [{ en: "fallback", zh: "兜底方案" }],
  },
  {
    nodeId: "T-example", kind: "sub", title: "例证题", titleEn: "Example Question", sortOrder: 11,
    points: [
      { zh: "标志词：example/case/instance，或引用词+例子形式+目的三件套", en: "Signals: example/case/instance, or cite+form+purpose" },
      { zh: "找到例子的起止点，优先看例子范围的前一句或后一句", en: "Find the example's boundaries; read the sentence before/after" },
      { zh: "例子本身不是答案，例子证明的观点才是", en: "The answer is the point, not the example" },
    ],
    cautions: [
      { zh: "句内举例（such as/like）：看本句例子以外的部分", en: "In-sentence examples: read the rest of the sentence" },
      { zh: "首段举例：看后一句或当主旨题做", en: "Opening-paragraph example: treat as main-idea" },
      { zh: "他人举例：在例子前后找该人物的观点（双引号/间接引语）", en: "Others' example: find that person's view in quotes" },
    ],
    vocab: [
      { en: "cite/quote/mention/illustrate", zh: "引用/引述/提及/举例说明" },
      { en: "such as", zh: "例如" },
      { en: "indirect speech", zh: "间接引语" },
    ],
  },
  {
    nodeId: "T-attitude", kind: "sub", title: "态度题", titleEn: "Attitude Question", sortOrder: 12,
    points: [
      { zh: "识别：题干含人物+attitude/according to，选项是四个情感态度词", en: "Signals: person + attitude; options are emotion words" },
      { zh: "他人态度用三重定位：定位人物→定位引言→题干其他定位词", en: "Others' attitude: triple location — person, quote, locators" },
      { zh: "在解题范围内确认情感正负", en: "Confirm positive or negative within the scope" },
    ],
    cautions: [
      { zh: "作者态度无法定位时用N+1句", en: "Author's attitude: use N+1 when unlocatable" },
      { zh: "语气绝对的选项（最高级等）往往是错误答案", en: "Absolute-tone options are usually wrong" },
    ],
    vocab: [
      { en: "attitude", zh: "态度" },
      { en: "supportive/critical/objective", zh: "支持的/批评的/客观的" },
      { en: "absolute tone", zh: "绝对语气" },
    ],
  },
  {
    nodeId: "T-vocab", kind: "sub", title: "语义题", titleEn: "Vocabulary Question", sortOrder: 13,
    points: [
      { zh: "标志：mean / 引号词句 + line X, paragraph Y", en: "Signals: mean / quoted words with line reference" },
      { zh: "句子类：精读找改写，结合前后句重点逻辑", en: "Sentence type: close-read for paraphrase" },
      { zh: "词汇类：定位句猜词——标点（冒号/括号/破折号/分号，左右相同原则）、逻辑（并列/转折/指代）、词根词缀、情感正负，多路并行", en: "Word type: punctuation, logic, roots, emotion — use all clues" },
    ],
    cautions: [{ zh: "出现什么线索用什么线索，不要只盯一种", en: "Use whatever clue appears" }],
    vocab: [
      { en: "colon/parenthesis/dash/semicolon", zh: "冒号/括号/破折号/分号" },
      { en: "root and affix", zh: "词根词缀" },
    ],
  },
  {
    nodeId: "T-cause", kind: "sub", title: "因果题", titleEn: "Cause Question", sortOrder: 14,
    points: [
      { zh: "标志词：because / be caused by / in that / due to / reason", en: "Signals: because/due to/reason..." },
      { zh: "用题干实词找定位句，优先看含因果的部分", en: "Locate with content words; focus on causal parts" },
      { zh: "区分显性因果（有标志词）与隐性因果（暗含在逻辑中）", en: "Explicit vs. implicit causation" },
    ],
    cautions: [{ zh: "选项常见陷阱：因果颠倒", en: "Trap: reversed cause and effect" }],
    vocab: [
      { en: "due to / attribute to", zh: "由于/归因于" },
      { en: "implicit", zh: "隐性的" },
    ],
  },
  {
    nodeId: "T-viewpoint", kind: "sub", title: "观点题", titleEn: "Viewpoint Question", sortOrder: 15,
    points: [
      { zh: "标志：人物 + think/consider/believe/hold/argue/according to", en: "Signals: person + think/believe/argue..." },
      { zh: "他人观点：三重定位——人物→引言（双引号与间接引语同等重要）→题干实词", en: "Others' view: person → quote → content words" },
      { zh: "作者观点：定位句中不要混入其他人物的看法", en: "Author's view: no other people's opinions in the sentence" },
    ],
    cautions: [{ zh: "近年趋势：人物观点对比题，分别三重定位再比较异同", en: "Trend: comparing two people's views" }],
    vocab: [
      { en: "hold/argue/maintain", zh: "认为/主张/坚持认为" },
      { en: "quotation", zh: "引言" },
    ],
  },
  {
    nodeId: "T-detail", kind: "sub", title: "细节题", titleEn: "Detail Question", sortOrder: 16,
    points: [
      { zh: "识别：没有题型标志词，只有细节实词", en: "No signal words, only content words" },
      { zh: "答案不跨段（代词指代除外）", en: "Answer stays in one paragraph" },
      { zh: "定位句本句优先：题问什么，对应原文找什么", en: "The locating sentence comes first" },
    ],
    cautions: [{ zh: "注意代词延伸范围（前一句/后一句）", en: "Watch pronoun extensions" }],
    vocab: [{ en: "content word", zh: "实词" }],
  },
  {
    nodeId: "T-infer", kind: "sub", title: "推断题", titleEn: "Inference Question", sortOrder: 17,
    points: [
      { zh: "标志：learn/infer/imply/conclude/suggest，或 true/NOT/EXCEPT", en: "Signals: infer/imply/suggest/NOT/EXCEPT" },
      { zh: "细节推理：定位→同义改写优先→总结概括其次", en: "Detail inference: paraphrase first, summary second" },
      { zh: "段落推断：优先段落首尾句/转折句，逐句比对", en: "Paragraph inference: openings/endings/contrast sentences" },
    ],
    cautions: [{ zh: "推断题答案是推一步，不是脑补十步；无中生有必错", en: "Infer one step, never fabricate" }],
    vocab: [
      { en: "infer/imply", zh: "推断/暗示" },
      { en: "EXCEPT", zh: "除了（选错误的）" },
    ],
  },
  {
    nodeId: "T-main", kind: "sub", title: "主旨题", titleEn: "Main Idea Question", sortOrder: 18,
    points: [
      { zh: "标志：passage/text + title/center/main idea/mainly discuss", en: "Signals: passage + title/main idea" },
      { zh: "PLAN A 寻词确认：浏览N+1句找高频实词，回选项确认", en: "Plan A: find high-frequency words in N+1 sentences" },
      { zh: "PLAN B 分析写作结构定主旨段主旨句；PLAN C 串线法：N+1句主干翻译", en: "Plan B: structure analysis; Plan C: thread N+1" },
    ],
    cautions: [
      { zh: "只涉及一两段的细节信息不选", en: "Options covering only a paragraph or two are wrong" },
      { zh: "注意高频词的改写形式", en: "Watch for paraphrased theme words" },
    ],
    vocab: [
      { en: "mainly discuss", zh: "主要讨论" },
      { en: "high-frequency word", zh: "高频词" },
    ],
  },
  {
    nodeId: "L-logic", kind: "logic", title: "六大逻辑关系", titleEn: "Six Logic Relations", sortOrder: 21,
    points: [
      { zh: "因果、让转、肯否、比较、指代、并列——贯穿所有题型的对比线索", en: "Cause, concession, negation, comparison, reference, coordination" },
      { zh: "转折后出选项，但不一定是正确答案；先看主题是否与题干一致", en: "Post-contrast sentences matter only if the topic matches" },
      { zh: "原文与选项的否定、比较级、时间必须保持一致", en: "Negation/comparison/time must match between text and option" },
    ],
    cautions: [{ zh: "代词注意单复数；题干选项中的代词在题干上还原", en: "Check pronoun number; restore pronouns in the stem" }],
    vocab: [
      { en: "concession", zh: "让步" },
      { en: "negation", zh: "否定" },
      { en: "reference", zh: "指代" },
      { en: "coordination", zh: "并列" },
    ],
  },
  {
    nodeId: "O-options", kind: "option", title: "选项特征库", titleEn: "Option Features", sortOrder: 22,
    points: [
      { zh: "正确项四特征：同义改写＞概括总结＞逻辑反向＞中心词保底", en: "Correct: paraphrase > summary > reversed logic > theme word" },
      { zh: "错误项五类型：正反混淆/偷换概念/答非所问/无中生有/过于绝对", en: "Wrong: contradiction/concept swap/off-topic/fabrication/absolute" },
    ],
    cautions: [
      { zh: "易错对比点九条：因果/否定/时间/比较级/最高级/方向趋势/静动态/人物身份/金钱线索", en: "Nine error-prone checkpoints" },
    ],
    vocab: [
      { en: "contradiction", zh: "正反混淆" },
      { en: "fabrication", zh: "无中生有" },
      { en: "off-topic", zh: "答非所问" },
    ],
  },
];

export async function seedKnowledgeAndChannels() {
  const db = getDb();

  // 知识库：幂等 upsert
  for (const c of CARDS) {
    const existing = await db.query.knowledgeCards.findFirst({ where: eq(knowledgeCards.nodeId, c.nodeId) });
    if (existing) {
      await db.update(knowledgeCards).set(c).where(eq(knowledgeCards.id, existing.id));
    } else {
      await db.insert(knowledgeCards).values(c);
    }
  }
  console.log(`知识库：${CARDS.length} 张知识卡已入库`);

  // 预置渠道（幂等）
  const existing = await db.query.channels.findFirst({ where: eq(channels.baseUrl, "https://code.mmkg.cloud") });
  let chatChannelId: number;
  let imageChannelId: number;
  if (existing) {
    chatChannelId = existing.id;
    const img = await db.query.channels.findFirst({ where: eq(channels.name, "MMKG 中转站·绘图") });
    imageChannelId = img?.id ?? chatChannelId;
    console.log("预置渠道已存在，跳过创建");
  } else {
    const [{ id: cid }] = await db
      .insert(channels)
      .values({
        name: "MMKG 中转站·对话",
        kind: "chat",
        protocol: "openai",
        baseUrl: "https://code.mmkg.cloud",
        apiKey: process.env.MMKG_API_KEY ?? "REPLACE_WITH_YOUR_KEY",
        models: [
          "gpt-5.5", "gpt-5.5-low", "gpt-5.5-medium", "gpt-5.5-high", "gpt-5.5-xhigh",
          "gpt-5.6-luna", "gpt-5.6-luna-low", "gpt-5.6-luna-medium", "gpt-5.6-luna-high", "gpt-5.6-luna-xhigh",
          "gpt-5.6-sol", "gpt-5.6-sol-low", "gpt-5.6-sol-medium", "gpt-5.6-sol-high", "gpt-5.6-sol-xhigh",
          "gpt-5.6-terra", "gpt-5.6-terra-low", "gpt-5.6-terra-medium", "gpt-5.6-terra-high", "gpt-5.6-terra-xhigh",
        ],
        isDefault: true,
      })
      .$returningId();
    chatChannelId = cid;
    const [{ id: iid }] = await db
      .insert(channels)
      .values({
        name: "MMKG 中转站·绘图",
        kind: "image",
        protocol: "openai",
        baseUrl: "https://code.mmkg.cloud",
        apiKey: process.env.MMKG_API_KEY ?? "REPLACE_WITH_YOUR_KEY",
        models: ["gpt-image-1", "gpt-image-1.5", "gpt-image-2"],
        isDefault: true,
      })
      .$returningId();
    imageChannelId = iid;
    console.log("预置渠道已创建");
  }

  // 默认绑定（真幂等：每角色全局仅一条，已存在则更新为当前推荐模型）
  // 模型一律用基础档（gpt-5.6-luna/sol/terra/gpt-5.5）：MMKG 的推理档位变体
  // （-low/-medium/-high/-xhigh）上游长期 503，不可用，绝不绑定。
  const defaultBindings = [
    { role: "default_chat", channelId: chatChannelId, model: "gpt-5.5" },
    { role: "default_image", channelId: imageChannelId, model: "gpt-image-2" },
    { role: "agent_structure", channelId: chatChannelId, model: "gpt-5.6-sol" },
    { role: "agent_question", channelId: chatChannelId, model: "gpt-5.6-luna" },
    { role: "agent_locator", channelId: chatChannelId, model: "gpt-5.6-sol" },
    { role: "agent_solver", channelId: chatChannelId, model: "gpt-5.6-terra" },
    { role: "agent_reviewer", channelId: chatChannelId, model: "gpt-5.6-luna" },
    { role: "agent_generator", channelId: chatChannelId, model: "gpt-5.6-sol" },
    // v5 新角色（差异分析/错因诊断/备考建议/作文三件套）：一律基础档
    { role: "agent_diff", channelId: chatChannelId, model: "gpt-5.6-luna" },
    { role: "agent_analyst", channelId: chatChannelId, model: "gpt-5.6-sol" },
    { role: "agent_advisor", channelId: chatChannelId, model: "gpt-5.6-luna" },
    { role: "essay_outliner", channelId: chatChannelId, model: "gpt-5.6-sol" },
    { role: "essay_drafter", channelId: chatChannelId, model: "gpt-5.6-sol" },
    { role: "essay_reviewer", channelId: chatChannelId, model: "gpt-5.6-luna" },
  ];
  for (const b of defaultBindings) {
    // 该角色全部全局绑定行：旧版本 onDuplicateKeyUpdate 无唯一键，部署一次重复 50 行，
    // 这里顺手自愈——保留一行并更新为推荐模型，其余重复行删除。
    const rows = await db
      .select({ id: bindings.id })
      .from(bindings)
      .where(and(eq(bindings.role, b.role), isNull(bindings.userId)))
      .orderBy(bindings.id);
    if (rows.length > 0) {
      const keep = rows[0].id;
      await db.update(bindings).set({ channelId: b.channelId, model: b.model }).where(eq(bindings.id, keep));
      const dupes = rows.slice(1).map((r) => r.id);
      if (dupes.length > 0) {
        await db.delete(bindings).where(inArray(bindings.id, dupes));
        console.log(`绑定自愈：${b.role} 清理重复行 ${dupes.length} 条`);
      }
    } else {
      await db.insert(bindings).values(b);
    }
  }
  console.log(`默认绑定：${defaultBindings.length} 条已设置（幂等）`);

  console.log("种子数据完成 ✅");
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seedKnowledgeAndChannels()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
