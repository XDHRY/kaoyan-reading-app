/**
 * 方法论条款种子：把《考研传统阅读》笔记正文结构化为知识引擎条款
 * 每个条款 = 笔记中的一个可执行知识点，供各 Agent 精准装配注入
 * 运行：npx tsx db/seedMethod.ts
 */
import "dotenv/config";
import { getDb } from "../api/queries/connection";
import { methodClauses } from "./schema";
import { eq } from "drizzle-orm";

export type Clause = {
  clauseId: string;
  domain: "structure" | "step" | "type" | "logic" | "option" | "sentence";
  refKey: string;
  title: string;
  content: string;
  sortOrder: number;
};

export const CLAUSES: Clause[] = [
  // ============ structure 篇章结构 ============
  { clauseId: "ST-bone", domain: "structure", refKey: "bone", title: "文章骨骼三层", sortOrder: 1,
    content: "文章骨骼：①主旨所在——文章首尾段；②段落主旨——段落首尾句；③补充提示——特殊标点。代词指代是上一句的延续。" },
  { clauseId: "ST-punct-dash1", domain: "structure", refKey: "punct", title: "单破折号=解释", sortOrder: 2,
    content: "1 个破折号（—）：解释说明，破折号后的内容是对前文的解释，常为考点。" },
  { clauseId: "ST-punct-dash2", domain: "structure", refKey: "punct", title: "双破折号=跳过", sortOrder: 3,
    content: "2 个破折号（=2 个逗号）：中间内容是插入语，阅读时跳过不看。" },
  { clauseId: "ST-punct-semi", domain: "structure", refKey: "punct", title: "分号=并列/解释", sortOrder: 4,
    content: "分号（;）：表示并列或解释说明，前后两部分地位相当、语义相通。" },
  { clauseId: "ST-punct-quote", domain: "structure", refKey: "punct", title: "双引号=他人观点", sortOrder: 5,
    content: "双引号：引言，标志他人观点。观点题/态度题的核心定位区。" },
  { clauseId: "ST-punct-paren", domain: "structure", refKey: "punct", title: "括号=解释", sortOrder: 6,
    content: "括号：解释说明，补充前文。" },
  { clauseId: "ST-punct-italic", domain: "structure", refKey: "punct", title: "大写斜体=作品名", sortOrder: 7,
    content: "大写斜体：作品名称（书名、报道名等），只是专有名词，不必深究。" },
  { clauseId: "ST-punct-colon", domain: "structure", refKey: "punct", title: "冒号=解释/总结", sortOrder: 8,
    content: "冒号（:）：解释说明或总结概括，常是论点标志处。" },
  { clauseId: "ST-punct-question", domain: "structure", refKey: "punct", title: "问号=怀疑", sortOrder: 9,
    content: "问号（?）：不确定/怀疑，暗示作者态度；设问句则设问+答案=论点。" },
  { clauseId: "ST-arg-evidence", domain: "structure", refKey: "argue", title: "论据三类型", sortOrder: 10,
    content: "论证演绎-论据三类型：①人物事例；②时间/数字；③客观研究结果。识别论据可知其服务的观点在附近（通常是前一句）。" },
  { clauseId: "ST-arg-logic", domain: "structure", refKey: "argue", title: "逻辑说服两法", sortOrder: 11,
    content: "论证演绎-逻辑说服：①因果论证；②对比论证。分析“核心观点是什么、各段如何证明它”。" },
  { clauseId: "ST-thesis-lead", domain: "structure", refKey: "thesis", title: "论点形式·总领句", sortOrder: 12,
    content: "论点形式·总领句：①简单句/独句段的主干即为论点；②设问句：设问+答案=论点。" },
  { clauseId: "ST-thesis-summary", domain: "structure", refKey: "thesis", title: "论点形式·总结处", sortOrder: 13,
    content: "论点形式·总结处：总结性词语（all in all; above all; put another way; in brief; briefly）之后，或冒号/单破折号之后，常为论点。" },
  { clauseId: "ST-thesis-turn", domain: "structure", refKey: "thesis", title: "论点形式·转折", sortOrder: 14,
    content: "论点形式·转折逻辑：转折之后常是作者真正主张。" },
  { clauseId: "ST-thesis-repeat", domain: "structure", refKey: "thesis", title: "论点形式·中心词复现", sortOrder: 15,
    content: "论点形式·中心词复现：高频词/中心词组合反复出现处指向主旨。注意高频词会以改写形式复现。" },
  { clauseId: "ST-thesis-contrast", domain: "structure", refKey: "thesis", title: "论点形式·对比", sortOrder: 16,
    content: "论点形式·对比手法：古今对比等对比结构中，作者立场通常落在“今”或转折后一方。" },
  { clauseId: "ST-pattern-contrast", domain: "structure", refKey: "pattern", title: "篇章模式·对比论证", sortOrder: 17,
    content: "篇章结构模式·对比论证：古今对比/优缺点对比，主旨看作者倾向的一方。" },
  { clauseId: "ST-pattern-example", domain: "structure", refKey: "pattern", title: "篇章模式·举例论证", sortOrder: 18,
    content: "篇章结构模式·举例论证：观点-论证模式，观点句在例子之前（或首段例子之后）。" },
  { clauseId: "ST-pattern-cause", domain: "structure", refKey: "pattern", title: "篇章模式·原因分析", sortOrder: 19,
    content: "篇章结构模式·原因分析：现象分析模式——现象/问题→原因→影响/措施。" },
  { clauseId: "ST-pattern-quote", domain: "structure", refKey: "pattern", title: "篇章模式·引用论证", sortOrder: 20,
    content: "篇章结构模式·引用论证：主张-反主张模式，注意区分作者主张与引用的他人主张。" },

  // ============ step 六步 ============
  { clauseId: "S1-mark", domain: "step", refKey: "S1", title: "STEP1 标段", sortOrder: 101,
    content: "阅读第一步：给每个自然段标序号。独句段也算一段。标段是题文同序定位的基础。" },
  { clauseId: "S2-3q", domain: "step", refKey: "S2", title: "STEP2 读题3Q", sortOrder: 102,
    content: "阅读第二步：一次性读完 5 个题，逐题执行“读题 3Q”——Q1 题型是什么（按定位方向+题型标志词分类：细节类/段落类/主旨类）；Q2 题目问什么（翻译题干）；Q3 定位词是哪个。" },
  { clauseId: "S2-locator-3ex", domain: "step", refKey: "S2", title: "定位词 3 排除原则", sortOrder: 103,
    content: "确定定位词的 3 排除原则：排除题型标志词；排除虚词（冠词/介词/代词/连词）；排除提问部分（the following statements / suggest·illustrate·indicate·show 等“表明”词 / 助动词 / author·passage 等）。保留：时间、数字（百分比）、人名、地名、组织。" },
  { clauseId: "S3-locate", domain: "step", refKey: "S3", title: "STEP3 五题同定位", sortOrder: 104,
    content: "阅读第三步：同时完成 5 题定位。原则：题文同序。方法：用题干定位词以句子为单位寻找。定位词出现形式四种：①原词；②同根改写（改词性）；③同义改写；④全拼&缩写；⑤同类改写（上下词义）。" },
  { clauseId: "S4-scope-fixed", domain: "step", refKey: "S4", title: "STEP4 题型固定范围", sortOrder: 105,
    content: "阅读第四步：以定位句为中心确定最大解题范围。题型固定范围：例证题=例子范围前后句；语义题=定位句/线索所在句；观点题=人物引言内（他人）+定位词所在句（作者）；因果题=因果关系所在句；代词题=前一句；态度题=定位句或N+1（作者）、人物引言内（他人）；段落推断题=段落首尾句/选项对应句；主旨题=N+1。" },
  { clauseId: "S4-scope-detail", domain: "step", refKey: "S4", title: "STEP4 细节题范围五条", sortOrder: 106,
    content: "一般细节题自行固定范围：①答案不跨段（代词指代会跨段）；②定位句本句优先，问什么找什么；③定位句后一句有代词→定位句+右一；④转折词界定范围；⑤定位句+左一的情形：例证题/定位句为段落尾句/定位句关键位置有代词。" },
  { clauseId: "S5-solve", domain: "step", refKey: "S5", title: "STEP5 范围内对比", sortOrder: 107,
    content: "阅读第五步：在最大解题范围内解题。先用“选项·易错对比点”判断是否一致；无对比线索时：选项是句子按 主语＞谓语＞宾语＞修饰 比对；选项是词组按 核心词＞修饰词（名词+介词短语核心在前名词；纯名词词组核心在尾词）。不会区分时选认识的词对比：名词不易替换优先比，越具体的名词越好比。" },
  { clauseId: "S6-fallback", domain: "step", refKey: "S6", title: "STEP6 无解兜底", sortOrder: 108,
    content: "阅读第六步：范围内无解——①看本段落首尾句；②看其他段落首尾句。兜底是最后手段。" },
  { clauseId: "S-scatter", domain: "step", refKey: "S3", title: "定位句分散处理", sortOrder: 109,
    content: "定位句分散：数量差异时，定位词越完整的句子越优先；数量相同时，相同定位词分散→首次出现句优先；不同定位词分散→对选项而言最重要成分（主＞谓＞宾＞状）所在句优先。" },

  // ============ type 八题型 ============
  { clauseId: "T-example-id", domain: "type", refKey: "example", title: "例证题·识别", sortOrder: 201,
    content: "例证题识别：①标志词 example/case/instance；②或三要素同时具备：引用词（cite/quote/use/with/mention/note/refer to/illustrate）+例子具体形式（人名/地名/时间数字/事件/研究）+询问目的（to…/because）。" },
  { clauseId: "T-example-solve", domain: "type", refKey: "example", title: "例证题·解法", sortOrder: 202,
    content: "例证题解法：读题干找“例子”定位词→在原文找例子起止点（起点=定位词首次出现句，截止=定位词/代词结束句）→优先看例子范围的前一句或后一句解题。例子本身不是答案，例子证明的观点才是。" },
  { clauseId: "T-example-special", domain: "type", refKey: "example", title: "例证题·特殊情况", sortOrder: 203,
    content: "例证题特殊情况：①句内举例（such as/as/like）：看本句中举例词以外的部分；②首段/首句举例：看例子后一句（第一段第二句/第二段第一句），或当主旨题用 N+1 句做；③他人举例（大写人名+例证标志词）：定位例子起止，在例子前后句找该人物观点（双引号/间接引语）。" },
  { clauseId: "T-attitude-id", domain: "type", refKey: "attitude", title: "态度题·识别", sortOrder: 204,
    content: "态度题识别：题干同时含①人物（作者 author/writer；他人=大写人名/人物身份）②态度词（attitude/according to）；选项是 4 个情感态度类词汇（support/oppose/objective…）。" },
  { clauseId: "T-attitude-solve", domain: "type", refKey: "attitude", title: "态度题·解法", sortOrder: 205,
    content: "态度题解法：先排除干扰项→看“人物”定范围：他人态度用三重定位（定位人物→定位引言处→题干其他定位词）；作者态度用定位词找定位句，无法定位用 N+1→在范围内确认情感正负。" },
  { clauseId: "T-attitude-else", domain: "type", refKey: "attitude", title: "态度色彩迁移", sortOrder: 206,
    content: "态度词在其他题型中的应用：不是态度题但题干/选项有“态度色彩”时，可运用情感正负解题。绝对色彩：选项中“语气绝对”的说法（最高级、其他绝对说法）往往是错误答案。" },
  { clauseId: "T-vocab-id", domain: "type", refKey: "vocab", title: "语义题·识别", sortOrder: 207,
    content: "语义题识别：题型标志词 mean / “XXX”（line A, paragraph B）。" },
  { clauseId: "T-vocab-solve", domain: "type", refKey: "vocab", title: "语义题·解法", sortOrder: 208,
    content: "语义题解法：句子类——①精读找改写；②结合前后句重点逻辑。词汇类——定位句猜词，多种思路并行：a.标点符号（左右相同原则：冒号/括号/单破折号/分号）；b.语言逻辑（并列 and·or·as well as·too·also·instead / 转折 / 指代：本句有代词向前一句找，后句有代词向后一句找 / 从句 / 论据 / 相同语言结构占位解释）；c.情感正负；②词根词缀。出现什么用什么。" },
  { clauseId: "T-cause-id", domain: "type", refKey: "cause", title: "因果题·识别与解法", sortOrder: 209,
    content: "因果题识别：题干出现 because / be caused by / in that / due to / reason (why) 等。解法：用题干实词找定位句→优先看含“因果”的部分，区分显性因果（有标志词）与隐性因果（暗含于句间逻辑）。" },
  { clauseId: "T-viewpoint-id", domain: "type", refKey: "viewpoint", title: "观点题·识别", sortOrder: 210,
    content: "观点题识别：①人物——他人（大写人名/称谓）、作者（author/writer）；②观点词 think/consider/believe/hold/argue/according to/agree…。" },
  { clauseId: "T-viewpoint-solve", domain: "type", refKey: "viewpoint", title: "观点题·解法", sortOrder: 211,
    content: "观点题解法：他人观点——①用人物定位大致位置；②定位该人物引言（双引号与间接引语同等重要）；③在引言中定位题干其他实词。作者观点——用题干实词找定位句，定位句中不要有“其他人物的看法”。" },
  { clauseId: "T-viewpoint-compare", domain: "type", refKey: "viewpoint", title: "观点题·人物对比", sortOrder: 212,
    content: "人物观点对比（近年趋势）：step1 分别用三重定位（人物-引言-题干定位词）找到两个人物的观点；step2 总结不同人物观点的异同点。" },
  { clauseId: "T-detail-solve", domain: "type", refKey: "detail", title: "一般细节题", sortOrder: 213,
    content: "一般细节题：识别——没有题型标志词，只有细节实词。解法【找到解题范围，对比答案】：①答案不跨段（代词指代会跨段）；②定位句本句优先，题问什么对应找什么；③代词延伸：定位句本句有代词看前一句，后一句有代词看后一句。" },
  { clauseId: "T-infer-id", domain: "type", refKey: "infer", title: "推断题·识别", sortOrder: 214,
    content: "推断题识别：①learn/infer/imply/conclude/suggest“表明”（推断）；②true / NOT=EXCEPT（对不对）。" },
  { clauseId: "T-infer-detail", domain: "type", refKey: "infer", title: "推断题·细节推理", sortOrder: 215,
    content: "细节推理（标志词+细节实词）：step1 用细节实词找具体定位句；step2 同义改写优先；step3 总结概括其次（逻辑反向/中心相关）。" },
  { clauseId: "T-infer-para", domain: "type", refKey: "infer", title: "推断题·段落推断", sortOrder: 216,
    content: "段落推断（定位词只有 paragraph）：step1.1 优先段落首尾句/重点逻辑句（转折句）；step1.2 可让选项返回段落对应句子（选项含大写/相同词组）；step2 逐句比对，同义改写优先，总结概括其次。" },
  { clauseId: "T-main-id", domain: "type", refKey: "main", title: "主旨题·识别", sortOrder: 217,
    content: "主旨题识别：题干出现“文章+主旨”——文章：passage/text/article；主旨：title/center/subject/main idea/mainly discuss…。" },
  { clauseId: "T-main-planA", domain: "type", refKey: "main", title: "主旨题·PLAN A 寻词确认", sortOrder: 218,
    content: "PLAN A 寻词确认：①浏览 N+1 句，找到高频实词（≥2 次，覆盖过半段落数）；②返回 N+1 确认选项的核心词汇。注意高频词改写；只涉及某一段/两段的细节信息不选。" },
  { clauseId: "T-main-planBC", domain: "type", refKey: "main", title: "主旨题·PLAN B/C", sortOrder: 219,
    content: "PLAN B 分析写作结构：①浏览各段首句间逻辑，确定主旨段；②浏览主旨段各句间逻辑（论点论据），确定主旨句。PLAN C 串线法：N+1 句（每段第一句+最后一段最后一句）主干翻译，串出主线。" },

  // ============ logic 六大逻辑 ============
  { clauseId: "L-cause", domain: "logic", refKey: "cause", title: "因果逻辑", sortOrder: 301,
    content: "因果逻辑：①因果题直接设题；②选项优先对比处——原文/选项中出现因果关系词，因果方向须保持一致，谨防因果颠倒。" },
  { clauseId: "L-turn", domain: "logic", refKey: "turn", title: "让转逻辑", sortOrder: 302,
    content: "让转逻辑【在原文中找语言重点】：①转折后出选项，但不一定是正确答案；②转折界定解题范围——转折词前后主语/主题与题干不同则不看，相同则继续看。" },
  { clauseId: "L-negation", domain: "logic", refKey: "negation", title: "肯否逻辑", sortOrder: 303,
    content: "肯否逻辑【出现在题干/选项中，用于对比选项，所有阅读题适用】：①否定题——题干中出现否定；②选项优先对比处——原文/选项中出现否定词，肯否须保持一致。" },
  { clauseId: "L-compare", domain: "logic", refKey: "compare", title: "比较逻辑", sortOrder: 304,
    content: "比较逻辑【出现在题干/选项中，用于找定位句/做选项对比】：①原文/选项中出现比较级/最高级（绝对语气）须保持一致；②时间对比——原文/题干/选项中出现时间状语，重点关注时间关系一致性。" },
  { clauseId: "L-pronoun", domain: "logic", refKey: "pronoun", title: "指代逻辑", sortOrder: 305,
    content: "指代逻辑：①题干/选项中的代词在题干上还原；②代词拓展解题范围——定位句本句有代词看前一句，后一句有代词看后一句；③代词题（题干直接问指代）——答案在定位句的前一句；④注意代词单复数。代词形态：this/these/those/that/it；the+n. / such+n.。" },
  { clauseId: "L-parallel", domain: "logic", refKey: "parallel", title: "并列逻辑", sortOrder: 306,
    content: "并列逻辑：来自并列关系且均与原文一致的选项，一并排除。" },

  // ============ option 选项 ============
  { clauseId: "O-correct", domain: "option", refKey: "correct", title: "正确选项四优先", sortOrder: 401,
    content: "正确选项特征优先级：①“同义改写”优先；②“概括总结”其次；③“逻辑反向”次之；④“中心主旨词”保底。" },
  { clauseId: "O-wrong-reverse", domain: "option", refKey: "wrong", title: "错误项·正反混淆", sortOrder: 402,
    content: "错误选项·正反混淆（矛盾）六形态：①因果颠倒；②否定不一致；③比较级不一致；④时间（古今）不一致；⑤情感正负相反；⑥方向/趋势不一致。" },
  { clauseId: "O-wrong-concept", domain: "option", refKey: "wrong", title: "错误项·偷换概念", sortOrder: 403,
    content: "错误选项·偷换概念四形态：①偷换成分；②偷换“人物/身份”；③偷换“金钱”信息；④偷换“静态/动态”关系。" },
  { clauseId: "O-wrong-irrelevant", domain: "option", refKey: "wrong", title: "错误项·答非所问", sortOrder: 404,
    content: "错误选项·答非所问：选项内容来自原文，但跟提问方向无关。" },
  { clauseId: "O-wrong-fabricate", domain: "option", refKey: "wrong", title: "错误项·无中生有", sortOrder: 405,
    content: "错误选项·无中生有：出现原文没有提到或推导不出的信息。" },
  { clauseId: "O-wrong-absolute", domain: "option", refKey: "wrong", title: "错误项·过于绝对", sortOrder: 406,
    content: "错误选项·过于绝对：选项存在“语气绝对”的说法（最高级、绝对词），往往是错误答案。" },
  { clauseId: "O-checkpoints", domain: "option", refKey: "checkpoints", title: "选项·易错对比点", sortOrder: 407,
    content: "选项·易错对比点九条：①因果关系词；②否定关系词；③时间线索词；④比较级一致性；⑤最高级“绝对语气”；⑥方向/趋势/情感正负；⑦静态词VS动态词；⑧“人物/身份”；⑨“金钱线索”。" },

  // ============ sentence 长难句 ============
  { clauseId: "SE-step1", domain: "sentence", refKey: "parse", title: "长难句·标点断开", sortOrder: 501,
    content: "长难句拆分第一步：标点符号断开——按逗号、分号、冒号、破折号先把句子切成意群。" },
  { clauseId: "SE-step2", domain: "sentence", refKey: "parse", title: "长难句·复合句断开", sortOrder: 502,
    content: "长难句拆分第二步：复合句断开——①并列句：在并列连词（and/but/or/so 等）处断开；②从句：从引导词（that/which/who/when/because 等）开始，到下一个谓语前结束。" },
  { clauseId: "SE-step3", domain: "sentence", refKey: "parse", title: "长难句·主干修饰断开", sortOrder: 503,
    content: "长难句拆分第三步：主干和修饰断开（短语层面）——从介词/形容词/非谓语（doing/done/to do）开始，到名词结束的部分是修饰，剩下的是主干。先译主干，再回填修饰。" },
];

export async function seedMethodClauses() {
  const db = getDb();
  let inserted = 0;
  let updated = 0;
  for (const c of CLAUSES) {
    const existing = await db.query.methodClauses.findFirst({
      where: eq(methodClauses.clauseId, c.clauseId),
    });
    if (existing) {
      await db.update(methodClauses).set(c).where(eq(methodClauses.id, existing.id));
      updated++;
    } else {
      await db.insert(methodClauses).values(c);
      inserted++;
    }
  }
  console.log(`方法条款：新增 ${inserted}，更新 ${updated}，共 ${CLAUSES.length} 条 ✅`);
}

if (process.argv[1]?.endsWith("seedMethod.ts")) {
  seedMethodClauses()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
