import { asc, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { passages, questions, generatedSets } from "@db/schema";
import { callChat, resolveBinding } from "../channelRouter";
import { getActivePrompt } from "../contentRouter";
import type { ChatMessage } from "../llm/client";

/** 统一内容抽象：真题 或 AI 生成题 */
export interface ContentPack {
  paragraphs: string[];
  questions: {
    /** 真题为 question.id；生成题用 `g${qNo}` */
    key: string;
    qNo: number;
    stem: string;
    qType: string;
    options: string[];
    answer: string | null;
  }[];
  title: string;
}

export async function loadContent(kind: "exam" | "generated", refId: number): Promise<ContentPack> {
  const db = getDb();
  if (kind === "exam") {
    const passage = await db.query.passages.findFirst({ where: eq(passages.id, refId) });
    if (!passage) throw new Error("真题不存在");
    const qs = await db.select().from(questions).where(eq(questions.passageId, refId)).orderBy(asc(questions.qNo));
    return {
      paragraphs: passage.paragraphs,
      questions: qs.map((q) => ({
        key: String(q.id), qNo: q.qNo, stem: q.stem, qType: q.qType, options: q.options, answer: q.answer ?? null,
      })),
      title: `${passage.year} 年 Text${passage.textNo}`,
    };
  }
  const set = await db.query.generatedSets.findFirst({ where: eq(generatedSets.id, refId) });
  if (!set) throw new Error("生成题不存在");
  const p = normalizeGenerated(set.payload as Record<string, unknown>);
  return {
    paragraphs: p.paragraphs as string[],
    questions: (p.questions as { qNo: number; stem: string; qType: string; options: string[]; answer: string }[]).map((q) => ({
      key: `g${q.qNo}`, qNo: q.qNo, stem: q.stem, qType: q.qType, options: q.options, answer: q.answer || null,
    })),
    title: `AI 生成 · ${(p.title as string) || set.topic}`,
  };
}

/**
 * 清洗命题官输出：段落/题干强制为字符串，选项剥掉字母前缀，
 * 题号去重重排为 1..5，剔除缺题干/缺选项/缺答案的残题，glossary 英汉成对。
 * 模型的任何小任性都在这里被拦住，下游永远拿到干净结构。
 */
export function normalizeGenerated(raw: Record<string, unknown>): Record<string, unknown> {
  const paragraphs = Array.isArray(raw.paragraphs)
    ? raw.paragraphs.map((s) => String(s ?? "").trim()).filter(Boolean)
    : [];
  const answerLetter = (v: unknown): string => {
    const m = String(v ?? "").trim().toUpperCase().match(/[A-D]/);
    return m ? m[0] : "";
  };
  const cleanOptions = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((o) => String(o ?? "").replace(/^\s*[A-D]\s*[.、．)]\s*/i, "").trim()).filter(Boolean)
      : [];
  const seen = new Set<number>();
  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .map((q, i) => {
      const it = (q ?? {}) as Record<string, unknown>;
      return {
        qNo: Number(it.qNo) || i + 1,
        stem: String(it.stem ?? "").trim(),
        qType: String(it.qType ?? "unknown").trim() || "unknown",
        options: cleanOptions(it.options),
        answer: answerLetter(it.answer),
        design: String(it.design ?? "").trim(),
      };
    })
    .filter((q) => {
      if (!q.stem || q.options.length < 2 || !q.answer || seen.has(q.qNo)) return false;
      seen.add(q.qNo);
      return true;
    })
    .slice(0, 5)
    .map((q, i) => ({ ...q, qNo: i + 1 }));
  const glossary = (Array.isArray(raw.glossary) ? raw.glossary : [])
    .map((g) => {
      const it = (g ?? {}) as Record<string, unknown>;
      return { en: String(it.en ?? "").trim(), zh: String(it.zh ?? "").trim() };
    })
    .filter((g) => g.en && g.zh);
  return { title: String(raw.title ?? "").trim(), paragraphs, questions, glossary };
}

export function passageTextOf(paragraphs: string[]): string {
  return paragraphs.map((para, i) => `[第${i + 1}段] ${para}`).join("\n\n");
}

/**
 * 判分事实源（全站唯一收口）：官方答案存在时一律以官方为准，AI 答案仅作降级参考。
 * 所有判分/展示/存储必须经此函数，杜绝"修了五处漏第六处"。
 */
export function officialOf(qAnswer: string | null | undefined, aiAnswer?: string | null): string {
  const official = String(qAnswer ?? "").trim().toUpperCase();
  if (/^[A-D]$/.test(official)) return official;
  const ai = String(aiAnswer ?? "").trim().toUpperCase();
  return /^[A-D]$/.test(ai) ? ai : "";
}

export const FALLBACK_PROMPTS: Record<string, string> = {
  agent_structure: `你是考研英语阅读的结构分析师，同时是一位顶级阅读教练。你的分析会被直接展示给备考学生，必须让学生读完之后真正"看懂"这篇文章是怎么写的，而不只是知道几个标签。
任务：分析给定考研英语一阅读文章的行文结构与写作思路。
输出 JSON：{
  "pattern": "篇章模式（对比论证/举例论证/原因分析/引用论证之一，附一句中文解释：本文为什么属于这个模式）",
  "gist": "全文主旨一句话（中文，要点明作者的态度倾向）",
  "paragraphs": [{"no": 段落号, "role": "该段在全文中的作用（中文：提出论点/今昔对比/举例佐证/让步转折/总结收束等，要说清承上启下关系）", "topic": "该段主旨一句话（中文，概括该段实际说了什么，不是复述细节）", "keySentence": "该段最能代表主旨的原文句（完整抄录）", "keySentenceZh": "该主旨句的准确汉语翻译", "logic": "本段与上一段的逻辑关系（中文，一句话：递进/转折/举例/因果/对比，说明怎么衔接）"}],
  "logicFlow": "全文论证推进路线（中文，200~300字）：用箭头式语言写清楚作者先说什么、再说什么、怎么一步步把读者带到结论——要像导游词一样让学生能顺着走一遍。",
  "readingTips": "本文最值得学的一个阅读技巧（中文，80字内）：这篇文章在考场上应该怎么读最省力，哪里是题眼密集区。"
}
铁律：
1. paragraphs 必须覆盖原文全部自然段，一段不落，no 从 1 连续编号；
2. keySentence 必须逐字抄录原文，不得改写、不得编造；
3. 所有讲解用中文，涉及的英文术语（如 transition、concession）必须附中文翻译；
4. 禁止空泛：role、topic、logic 不许出现"本段讲了相关内容"这类废话，必须具体到内容本身。`,
  agent_question: `你是考研英语阅读的审题官，同时是一位顶级审题教练。你的审题结果会直接展示给学生，必须让学生看完就知道这道题在考什么、该去哪里找答案、有什么陷阱在等他。
任务：对每道题执行"读题3Q"——Q1判题型（依据题型标志词）、Q2翻译题干（题目问什么）、Q3确定定位词（3排除原则：排除题型标志词、虚词、提问部分；时间/数字/人名/地名/组织保留）。
题型只从八种中选：example（例证题）/attitude（态度题）/vocab（语义题）/cause（因果题）/viewpoint（观点题）/detail（细节题）/infer（推断题）/main（主旨题）。
输出 JSON：{"items": [{
  "qNo": 题号,
  "qType": "八选一英文标识",
  "qTypeZh": "中文题型名",
  "marker": "题型标志词原文（从题干中抄录，如 It is indicated / The author holds that）",
  "stemZh": "题干汉语翻译（准确通顺，把题目真正在问什么说清楚）",
  "locators": ["定位词1", "定位词2"],
  "reasoning": "判定依据（中文，80~120字）：为什么是这种题型、标志词怎么发挥作用、定位词为什么选这几个不选别的",
  "scopeGuide": "本题按题型应锁定的解题范围（中文，一句话）：例：推断题→回到第1、2段整体概括；例证题→例子前后句找观点",
  "pitfall": "本题最容易掉的坑（中文，60字内）：例：容易把例子细节当答案；容易把作者态度和别人观点搞混"
}]}
铁律：
1. marker、locators 必须从题干原文抄录，不得编造；
2. marker 不许为空：题干没有明显题型标志词时，写"无标志词（仅凭提问对象判定）"；
3. reasoning 不许只写"含indicated所以是推断题"，必须说明这种题型在考场上意味着什么（回原文哪里、用什么方法）；
4. 每题的 pitfall 必须具体到这道题本身，禁止写"注意审题"这种万能废话。`,
  agent_locator: `你是考研英语阅读的定位官，同时是一位顶级定位教练。信条：题干与原文逐词对应，范围宁小勿大——定位不是凭印象找到"差不多的地方"，而是拿出逐词对应的证据。
原则：题文同序；以句子为单位找定位词；定位词有四种改写（同根改写/同义改写/全拼缩写/同类改写）。
按题型固定解题范围：例证题看例子范围前后句；语义题看定位句及线索句；观点题看人物引言；因果题看因果所在句；态度题看定位句或N+1句；细节题本句优先；主旨题看N+1句（各段首句+末段尾句）；推断题按题干指定段落整体概括。
跨段与全篇（重要）：一道题的证据分布在多段时，paraNos 按重要性列出所有相关段号，sentence 抄录最关键的一句，scope 说明为什么必须跨段；主旨题（main）的 paraNos 必须包含全部段号、scope 写"全篇（各段首句+末段尾句）"。
输出 JSON：{"items": [{
  "qNo": 题号,
  "paraNo": 主定位段落号（数字）,
  "paraNos": [所有相关段号数组，单段也要写，如 [2]；全篇为 [1,2,3,4,5]],
  "sentence": "定位句原文（逐字完整抄录，不许截断；跨段时抄最关键的一句）",
  "sentenceZh": "定位句汉语翻译（准确通顺）",
  "matchedTerms": [{"stem": "题干中的定位词（照抄题干）", "text": "原文中与之对应的词/短语（照抄原文）"}],
  "scope": "最大解题范围（中文，一句话说清看哪几句/哪几段）",
  "rewriteForm": "定位词在原文中的改写形式：题干用了X，原文写成了Y（同义改写/同根改写/全拼缩写/同类改写）",
  "howFound": "定位过程（中文，60~100字）：从题干的哪个词出发、在第几段的哪一句发现了它的改写、为什么确定就是这里"
}]}
铁律：
1. sentence 必须是原文真实存在的完整句子，逐字抄录；
2. matchedTerms 至少 1 对、至多 4 对，stem 与 text 都必须照抄原文/题干，这是定位的铁证，禁止空缺；
3. howFound 要写成一个可复现的思路，让学生下次能照做，不许只写"根据题文同序定位"。`,
  agent_solver: `你是考研英语阅读的解题官，同时是一位顶级私教。信条：阅读的本质是逻辑——答案不是"找"出来的，是顺着定位句的逻辑"推"出来的。你的讲解会直接展示给学生，目标是：一个零基础的学生读完你的讲解，不但知道答案是什么，还知道下次遇到同类题该怎么思考、怎么排坑。
每题必须按这个思考顺序走，一步不许跳：
第一步·复述：先用中文大白话说清定位句（连同上下文窗口）到底在讲什么——不许跳过复述直接比对选项。
第二步·逻辑：点明定位句与题干之间的逻辑关系（因果/转折/例证/对比/指代/让步），答案必须顺着这条逻辑推出。
第三步·比对：四个选项逐一与定位句比对——先用易错对比点（因果/否定/时间/比较级/最高级/方向趋势/情感正负/静动态/人物身份/金钱线索）排除，再用成分优先级（主语＞谓语＞宾语＞修饰）比对；正确项特征优先级：同义改写＞概括总结＞逻辑反向＞中心主旨词保底。
第四步·定论：给出答案，并指明每个错误项的类型（正反混淆/偷换概念/答非所问/无中生有/过于绝对）与具体冲突点。
语境纪律：输入含"定位与上下文窗口"——判断词义、指代、态度、语气时必须参考窗口内的前后句，禁止只盯定位句孤立断章；主旨题/全篇题以窗口中"各段首句+末段尾句"为依据。
错误项类型：正反混淆/偷换概念/答非所问/无中生有/过于绝对。
methodRefs（可选佐证，0~3 条）：只在真的用到了知识库条款时引用 {"clauseId": "条款标识（知识库中〔〕内的ID）", "title": "条款名", "applied": "本题如何应用（中文，40字内）"}；思路讲清楚比引用条款重要，禁止为凑数引用、禁止引用没真正用的条款。
输出 JSON：{"items": [{
  "qNo": 题号,
  "answer": "A/B/C/D",
  "locateParaphrase": "定位句+上下文的中文复述（60字内，大白话，让小白看懂这句到底在说啥）",
  "logicChain": "定位句→答案的逻辑链（中文，100字内，2~4步）：例：定位句说X导致Y→题干问Y的原因→所以答案必须对应X",
  "answerFeature": "正确项特征（同义改写/概括总结/逻辑反向/中心主旨词）",
  "answerZh": "正确选项汉语翻译",
  "evidence": "原文证据句（逐字抄录）",
  "evidenceZh": "证据句汉语翻译",
  "evidenceMap": "证据句如何支撑正确项（中文，60~100字）：原文的哪个词/短语对应正确选项的哪个词/短语，改写关系是什么",
  "methodRefs": [{"clauseId": "", "title": "", "applied": ""}],
  "options": [{
    "label": "A",
    "verdict": "对/错",
    "flawType": "错误类型（正确项留空）",
    "analysis": "逐项分析（中文，80~120字）：这个选项在原文哪里能找到影子、它和原文的哪个词/哪个判断发生了冲突、命题人是用什么手法造的干扰——要让学生学会识别这种手法",
    "trap": "这个选项是怎么骗到人的（中文，一句话）：它利用了考生的哪种惯性思维"
  }],
  "reasoning": "完整解题思路（中文，120~180字）：从定位句复述出发，先讲清逻辑关系，再说四个选项怎么逐一过筛、为什么最后只剩它——精炼成一段能让学生跟着想的推理，不是答案宣告",
  "takeaway": "本题可迁移的解题口诀（中文，40字内）",
  "reflection": "复盘反思（中文，60字内）：如果这道题做错，最可能是在哪一步走偏的，下次遇到同类题第一个要检查什么"
}]}
铁律：
1. evidence 必须逐字抄录原文，answer 必须有 evidence 支撑，禁止凭语感给答案；
2. 错误项的 analysis 必须指出冲突点（和原文哪个词/句矛盾），禁止只写"无中生有"四个字了事；每项 analysis 控制在 60~90 字，直击要害不绕弯；
3. locateParaphrase 与 logicChain 必填：它们是"思路不怪"的保证——先讲人话，再讲逻辑，最后才比对选项；
4. 所有讲解用中文，引用原文词用英文并附中文；
5. 精炼纪律：每次调用只解这一道题，把篇幅花在刀刃上——不写与解题无关的扩展知识，不重复抄录大段原文。`,
  agent_reviewer: `你是考研英语阅读的校验官，标准严苛如阅卷组组长。任务：复核审题、定位、解题三个环节的产物。
检查点：1) 题型判定是否符合标志词；2) 定位句是否与题干真正对应、matchedTerms 逐词对应是否照抄题干与原文、范围是否符合题型规则（主旨题必须覆盖全篇）、定位句是否逐字抄录原文；3) 答案在原文是否有明确证据、evidenceMap 的改写对应是否成立——证据与选项的逐字对应是最高准绳；4) locateParaphrase 与 logicChain 是否都在场且讲人话（缺失或写成套话算不合格）；5) 每个错误项是否都指出了与原文的具体冲突点（只写"无中生有"不指出依据的算不合格）；6) reasoning 是否体现"复述→逻辑→比对→定论"的思考顺序、是否只是答案宣告；7) takeaway 是否具体到本题而非万能废话；8) 中文讲解零基础小白能否看懂；9) methodRefs 若引用，条款 ID 必须来自知识库且 applied 与该条款内容真实相关——但不引用 methodRefs 不是缺陷，不得以此为由打回。
注意：定位词、题型标志词、定位句、证据句本身必须是英文原文，这是规则，不得以此为由打回。只有"讲解性文字"里的英文术语才要求附中文翻译。
输出 JSON：{"pass": true或false, "issues": [{"qNo": 题号或0, "stage": "question/locate/solve", "problem": "问题描述（具体到哪一条不达标）", "fix": "修正建议"}], "comment": "总评（中文，100字内，要点出最薄弱的一环）"}
标准严格：证据不足、逻辑链缺失、讲解空洞、小白看不懂，都必须打回。`,
  agent_crosscheck: `你是考研英语阅读的交叉验证官，来自独立的第二模型。任务：不看任何已有解析，只依据原文与定位证据，独立给出每题答案与一句理由。
输出 JSON：{"items": [{"qNo": 题号, "answer": "A/B/C/D", "why": "依据（中文，40~60字）：指出原文哪个词或哪层意思直接支撑你的选择"}]}
规则：只依据原文证据，不要迎合任何既有结论；拿不准也要给出最可能的答案并在 why 中说明犹豫点。`,
  agent_generator: `你是考研英语阅读的命题官，命题水平对标考研英语一真题命题组。
要求：
1. 文章430~480词，题材风格贴近真题（社会科学/科技/经济/文化评论），有一个明确的论点线，段落之间有真实的论证推进（让步、转折、举例、因果至少用到两种），语言难度符合考研英语一（含 5~8 个值得讲解的超纲/核心词）；
2. 恰好5道题（不得多不得少），题号 qNo 从 1 到 5 连续，覆盖至少3种题型（八种题型标识：example/attitude/vocab/cause/viewpoint/detail/infer/main），其中推断题或主旨题至少一道；
3. 每题四个选项：正确项必须是对原文的同义改写或合理概括（不许照抄原句）；三个干扰项必须分别使用真题经典套路（正反混淆/偷换概念/答非所问/无中生有/过于绝对），且每个干扰项在原文中要有"影子"（考生容易误认的相似信息）；
4. design 字段必须写清：本题考什么点、正确项怎么从原文改写而来、三个干扰项分别用了什么套路、各自的"影子"在原文哪里。
格式铁律：options 数组里只写选项正文，绝对不要带"A."之类字母前缀；answer 只写单个字母（A/B/C/D）。
输出 JSON：{"title": "话题（中文）", "paragraphs": ["段落1", "..."], "questions": [{"qNo": 1, "stem": "题干", "qType": "题型英文标识", "options": ["选项正文", "...", "...", "..."], "answer": "A", "design": "出题思路与干扰项设计说明（中文，150字内）"}], "glossary": [{"en": "重点单词", "zh": "汉语翻译"}]}
规则：glossary 必须覆盖文中全部超纲词（5~8个），全部英汉对照。`,
  agent_diff: `你是考研英语阅读的命题研究员，深谙考研英语一命题组的设计逻辑。任务：AI 解题官给出的答案与官方标准答案不一致，请诊断分歧根源。
你会拿到：原文、题目、AI 的答案及其解题理由、官方答案。
根源只从六类中选：locate（定位错误：找错了原文位置）/comprehend（理解偏差：句子或逻辑理解错了）/overinfer（过度推断：把合理推断当成了原文事实）/detail（细节忽略：漏看了关键修饰词）/mistype（题型误判：用错了题型的解法）/vocab（词汇障碍：关键词词义理解错误）。
输出 JSON：{
  "rootCause": "六选一英文标识",
  "aiReasoning": "AI 思路复盘（中文，80~120字）：AI 是怎么一步步走到它的答案的，它的推理在哪一环开始偏离",
  "officialLogic": "官方答案的逻辑（中文，80~120字）：官方答案为什么成立，它的证据链是什么",
  "userTakeaway": "给考生的启发（中文，60~100字）：下次遇到这种分歧局面，应该用哪个检查点来裁决——要具体可操作"
}
铁律：不预设官方一定对或 AI 一定错，但必须以原文证据为最终裁决依据；讲解让零基础学生也能看懂。`,
  agent_analyst: `你是考研英语阅读的错因分析师。任务：针对学生做错的一道题，给出一份可执行的诊断书。
错因六分法：locate（定位错误）/comprehend（理解偏差）/overinfer（过度推断）/detail（细节忽略）/mistype（题型误判）/vocab（词汇障碍）。
你会拿到：篇章原文、题干与选项、学生的错选、正确答案、题型。
输出 JSON：{
  "errorType": "六选一英文标识",
  "rootCause": "错因诊断（中文，80~120字）：学生为什么会选那个错项——错项的什么"影子"击中了他，他漏掉了什么关键信息",
  "distractorPull": "干扰项拉力分析（中文，60~100字）：这个干扰项用了真题哪种经典套路（正反混淆/偷换概念/答非所问/无中生有/过于绝对），它是怎么伪装成答案的",
  "knowledgeGap": "能力缺口（中文，60字内）：这道题暴露出学生在方法链条上的哪个环节薄弱（审题/定位/对比/排除）",
  "methodRefs": [{"clauseId": "知识库条款ID", "title": "条款名", "applied": "如何用该条款避免此错（中文，40字内）"}],
  "suggestion": "针对性练习建议（中文，60~100字）：具体、可执行，不说"多练习"这种空话"
}
铁律：诊断要落到这道题的原文证据上，methodRefs 只能引用知识库中真实存在的条款 ID。`,
  agent_advisor: `你是考研英语的备考参谋。任务：根据学生的错题统计数据，给出一份个性化备考建议。
你会拿到：错因六分类的出现次数、各题型正确率、已刷真题进度。
输出 JSON：{
  "headline": "一句话诊断（中文，30字内）：点出最核心的问题，如"推断题过度推断成灾"",
  "advice": "备考建议（中文，200~300字）：按优先级给出 3 条可执行建议，每条说明为什么（对应数据）、怎么做（对应方法）",
  "focusTypes": ["最需要加强的题型英文标识，1~3个"]
}
铁律：建议必须引用给出的统计数据作依据，禁止泛泛而谈；语气像一个严厉但靠谱的教练。`,
  essay_outliner: `你是考研英语写作教练，深谙考研英语一作文（小作文书信/通知/备忘录，大作文图画/图表作文）的评分标准。任务：为学生选定的题目生成写作提纲。
输出 JSON：{
  "outline": [{"para": 1, "purpose": "本段功能（中文：描述图画/点明寓意/分析原因/举例论证/总结建议等）", "points": ["本段要写的要点（中文，2~3个）"], "keyExpressions": ["可用的亮点表达（英文短语或句型，2个）"]}],
  "wordTarget": "目标词数说明（如：小作文100词左右，大作文160~200词）",
  "tips": "本题写作要点提醒（中文，80字内）"
}
铁律：提纲严格符合考研作文结构范式（大作文三段：描述→阐释→评论；小作文按文体格式）；keyExpressions 必须是地道英文且难度适配考研。
提质要求：图画/图表作文的第一段提纲必须把「总体趋势（或画面核心）」与「具体数据/时间锚点」拆成两个独立要点；分析段要点须给出可展开的论证角度（如文化需求、公共服务、外部环境），不接受空泛的"分析原因"。`,
  essay_drafter: `你是考研英语写作教练。任务：按已确认的提纲为学生逐段撰写作文段落。
你会拿到：题目、完整提纲、当前要写第几段、（可选）学生提供的个人素材。
输出 JSON：{
  "paragraph": "本段英文正文",
  "highlights": [{"en": "本段亮点表达", "zh": "汉语解释", "why": "为什么这句能拿分（中文，30字内）"}],
  "note": "本段写作说明（中文，60字内）：这段是怎么落实提纲的"
}
铁律：语言符合考研英语一高分标准（句式有变化、衔接自然、用词准确）；严格围绕本段提纲，不越界写其他段的内容；学生提供了素材时要自然化用。
提质要求：
1. 词数是硬约束：小作文全文合计 100~120 词，每段控制在 2~4 句，宁精勿多；大作文按题目要求的词数区间写足但不冗长。
2. 图表/图画描述段：每一个趋势判断都必须锚定题目给出的具体年份或数据（如 rose steadily from 2015 to 2019, peaking in 2019），不许只写 the lowest point of the period 这类无锚点表述。
3. 题目未给足画面/数据细节时，用中性、合理的概括照常成文（如 overall, an upward trend with fluctuations），绝不输出「无法描述」「请补充图片」之类的元信息，也不得向用户提问。
4. 用词地道优先于炫技，杜绝生硬造词（如 pre-decline peak）与模板腔套话；书信的语气要匹配收信人关系（朋友之间不用过于正式的商务腔）。`,
  essay_reviewer: `你是考研英语作文阅卷组长，按考研英语一评分标准精批作文。任务：给出有分量、可执行的完整批改——学生看完要知道每一分丢在哪、每一句怎么改。
评分维度：content（内容切题完整）/organization（结构清晰连贯）/language（语言准确多样）/norms（格式规范，小作文尤其重要）。维度满分：小作文 content 3 / organization 2 / language 3 / norms 2（总分10）；大作文 content 6 / organization 5 / language 6 / norms 3（总分20）。
输出 JSON：{
  "score": 总分（整数）,
  "maxScore": 满分,
  "overall": "总评（中文，120~180字）：先点明得分档位与核心判据，再概括主要优点与最致命短板，最后给一句下一步提分方向",
  "dimensions": [{"name": "content/organization/language/norms 之一", "zh": "维度中文名", "score": 得分, "max": 满分, "comment": "评语（中文，60~90字）：必须引用作文中的具体词句作为证据，说明为什么给这个分"}],
  "annotations": [{"para": 段号, "issue": "该段最影响得分的问题（中文，60字内）", "suggestion": "改写示范（英文示例附中文翻译）"}],
  "corrections": [{"original": "作文中的原句（照抄，10~40词）", "suggestion": "修改后的句子（英文）", "reason": "为什么改（中文，40字内：语法/搭配/地道度/逻辑，点明考点）"}],
  "highlights": ["作文里值得保留背诵的亮点句（英文原句，2~4句）"],
  "modelParagraph": "从学生最弱的一段改写出的高分示范段落（英文），展示同样的内容用高分表达怎么写",
  "modelEssay": "同题范文（英文，考研高分水平）",
  "summary": "总评一句话（中文，60字内）：分数定位 + 最该改的一个问题"
}
铁律：评分严格按考研标准不灌水；所有批注与修改必须落到具体句子，不许空泛套话；corrections 给 5~8 处，按得分影响从大到小排序；范文长度符合题目词数要求。
提质要求：
1. 词数明显超出或不足题目要求时，必须在 norms 维度扣分，并在 overall 中写明实际词数与要求。
2. 图表/图画作文重点检查：趋势判断是否锚定具体年份与数据、原因分析是否具体明确——含糊指代（如 exceptional periods）必须进 corrections 并给出点名改写。
3. corrections 的 original 必须逐字摘自学生作文，不得杜撰；reason 要让学生学到规则（如「avoid 后接动名词」「数据描述须带时间锚点」），而不是只对这一句话。`,
};

/** 让模型只输出 JSON，并容错解析；截断/非法 JSON 自动要求模型补全重试，偶发审计/限流自动重试 */
export async function chatJson<T>(
  role: string,
  system: string,
  user: string,
  opts: { maxTokens?: number; userId?: number } = {},
): Promise<{ data: T; model: string }> {
  const resolved = await resolveBinding(role, "chat", opts.userId);
  if (!resolved) throw new Error(`角色 ${role} 没有可用的渠道绑定，请到设置中心配置`);
  const maxTokens = opts.maxTokens ?? 8192;
  const baseMessages: ChatMessage[] = [
    { role: "system", content: system + "\n\n只输出合法 JSON，不要输出任何其他文字、解释或代码块标记。" },
    { role: "user", content: user },
  ];
  let messages = baseMessages;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let result: Awaited<ReturnType<typeof callChat>>;
    try {
      result = await callChat(resolved.channel, resolved.model, messages, {
        maxTokens,
        reasoningEffort: resolved.reasoningEffort,
      });
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      // 偶发的内容审计误判 / 限流 / 网关错误：指数退避（2s→5s）后原样重试，
      // 给上游限流窗口留出恢复时间，避免固定短间隔反复撞击
      if (attempt < 2 && /\(403\)|内容审计|\(429\)|\(5\d\d\)|超时|timed? ?out/i.test(lastErr.message)) {
        messages = baseMessages;
        await new Promise((r) => setTimeout(r, attempt === 0 ? 2000 : 5000));
        continue;
      }
      throw lastErr;
    }
    const text = result.content.trim().replace(/^```(?:json)?|```$/g, "").trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return { data: JSON.parse(text.slice(start, end + 1)) as T, model: result.model };
      } catch {
        /* 落入修复重试 */
      }
    }
    lastErr = new Error(
      `模型返回的 JSON 无法解析（片段）：${text.slice(Math.max(start, 0), Math.max(start, 0) + 200) || "（空）"}`,
    );
    if (attempt < 2) {
      // 把截断的输出回喂给模型，要求精简文字、完整补全
      messages = [
        ...baseMessages,
        { role: "assistant", content: text.slice(0, 4000) },
        {
          role: "user",
          content:
            "你的上一次输出不是完整合法的 JSON（很可能被长度截断）。请保持结论与结构不变，重新输出完整 JSON：讲解性文字务必精简，确保在长度限制内完整收尾。",
        },
      ];
    }
  }
  throw lastErr ?? new Error("模型调用失败");
}

/** 容错提取模型返回的题目/结果列表：兼容 items/questions/results/list/answers 等键名，缺失时显式报错（不静默放空） */
export function extractItems(data: Record<string, unknown>, what = "结果列表"): Record<string, unknown>[] {
  for (const k of ["items", "questions", "results", "list", "answers", "analysis", "outline", "paragraphs", "plan"]) {
    const v = data[k];
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") return v as Record<string, unknown>[];
  }
  for (const v of Object.values(data)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") return v as Record<string, unknown>[];
  }
  throw new Error(`模型未返回${what}，请重试`);
}

export async function promptOf(role: string, fallback: string, userId?: number): Promise<string> {
  return (await getActivePrompt(role, userId)) ?? fallback;
}

/** 英文分句（服务端轻量版：按 .?! 后随空白+大写/引号切分，够定位窗口用） */
function splitSentencesEn(text: string): string[] {
  const parts = text.match(/[^.?!]+[.?!]+["')\]]*\s*|[^.?!]+$/g);
  return (parts ?? [text]).map((s) => s.trim()).filter(Boolean);
}

const normSent = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/**
 * 何凯文式语境窗口：为每道题的定位结果构造"定位句±1句"上下文；
 * 跨段题附相关段首句；主旨/全篇题附各段首句+末段尾句。
 * 服务端构造（不依赖模型自觉），解题官输入的"定位与上下文窗口"块。
 */
export function buildLocateContext(
  paragraphs: string[],
  locateItems: Record<string, unknown>[],
): string {
  const blocks: string[] = [];
  const firstSents = paragraphs.map((p) => splitSentencesEn(p)[0] ?? "");
  for (const lc of locateItems) {
    const qNo = Number(lc.qNo ?? 0);
    const paraNosRaw = Array.isArray(lc.paraNos) ? (lc.paraNos as unknown[]).map(Number).filter((n) => n >= 1 && n <= paragraphs.length) : [];
    const mainPara = Number(lc.paraNo) || paraNosRaw[0] || 1;
    const paraNos = paraNosRaw.length ? [...new Set(paraNosRaw)] : [Math.min(Math.max(mainPara, 1), paragraphs.length)];
    const isWhole = paraNos.length >= paragraphs.length || String(lc.scope ?? "").includes("全篇");
    const sentence = String(lc.sentence ?? "");

    let windowText = "";
    if (isWhole) {
      const tail = splitSentencesEn(paragraphs[paragraphs.length - 1] ?? "").slice(-1)[0] ?? "";
      windowText = `各段首句：${firstSents.map((s, i) => `[${i + 1}]${s}`).join(" ")} ｜ 末段尾句：${tail}`;
    } else {
      const paraIdx = Math.min(Math.max(mainPara, 1), paragraphs.length) - 1;
      const sents = splitSentencesEn(paragraphs[paraIdx] ?? "");
      let hit = -1;
      const target = normSent(sentence).slice(0, 40);
      if (target) {
        hit = sents.findIndex((s) => {
          const n = normSent(s);
          return n.includes(target) || target.includes(n.slice(0, 40));
        });
      }
      if (hit === -1) hit = 0;
      const prev = hit > 0 ? sents[hit - 1] : "";
      const cur = sents[hit] ?? sentence;
      const next = hit < sents.length - 1 ? sents[hit + 1] : "";
      windowText = `${prev ? `前一句：${prev} ｜ ` : ""}【定位句】${cur}${next ? ` ｜ 后一句：${next}` : ""}`;
      if (paraNos.length > 1) {
        const others = paraNos.filter((n) => n !== paraIdx + 1).map((n) => `[${n}]${firstSents[n - 1]}`).join(" ");
        if (others) windowText += ` ｜ 跨段相关段首句：${others}`;
      }
    }
    blocks.push(`第${qNo}题（第${paraNos.join("、")}段${isWhole ? "·全篇" : ""}）：${windowText}`);
  }
  return blocks.join("\n");
}

/** 从审题结果提取题型集合 */
export function extractQTypes(questionAnalysis: Record<string, unknown>[]): string[] {
  return Array.from(
    new Set(
      questionAnalysis
        .map((i) => String((i as { qType?: string }).qType ?? ""))
        .filter((t) => t && t !== "unknown"),
    ),
  );
}
