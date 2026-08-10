import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { createRouter, publicQuery, privateQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { methodClauses, sentenceAnalyses, analyses } from "@db/schema";
import { callChat, callImage, resolveBinding } from "./channelRouter";
import { buildMethodContext } from "./lib/methodKnowledge";
import { loadContent, passageTextOf, chatJson, promptOf } from "./lib/agentCore";

const SENTENCE_PARSE_FALLBACK = `你是考研英语长难句拆解教练，面向零基础学生。你的拆解会被直接展示，学生要靠它在考场上独立拆掉任何长难句——所以每一步都必须可操作、可复现，不许出现"凭感觉"的切分。
严格按"三步拆分法"拆解给定句子：
第一步：标点断开（逗号/分号/冒号/破折号切意群）；
第二步：复合句断开（并列句在并列连词处断；从句从引导词到下一个谓语前）；
第三步：主干与修饰断开（从介词/形容词/非谓语开始到名词结束是修饰，其余是主干）。
输出 JSON：{
  "segments": [{"text": "片段原文", "role": "主干/从句/并列/修饰/插入", "zh": "该片段汉语翻译"}],
  "skeleton": "句子主干原文（只保留主谓宾/主系表核心，全部修饰剔除后的最短完整句）",
  "skeletonZh": "主干汉语翻译",
  "fullZh": "全句通顺汉语翻译（重新组织语序，符合中文表达习惯，不是片段翻译的拼接）",
  "flow": ["意群串联（3~5 步）：按英文原序把句子的意思一层层讲出来，每一步只加一个意群、说明它和前面是什么关系——模拟学生在考场上'顺读'这句话的真实过程"],
  "grammar": [{"point": "语法点（如定语从句/同位语/非谓语）", "explain": "它在本句中修饰谁、起什么作用、为什么放在那里（60字内，必须落到本句的词上，禁止百科式讲语法）"}],
  "steps": ["第一步：本句有哪些标点、在哪里断、断出什么（具体到本句）", "第二步：有没有并列连词/从句引导词、从句从哪到哪、什么从句", "第三步：主干是哪几个词、哪些是修饰、各修饰谁"]
}
铁律：
1. segments 只切有意义的意群，禁止把单个标点（如冒号、逗号）单独列为一个片段；冒号/破折号后若是完整主句，必须整句保留为一个主干片段，不许拆碎；
2. 片段 zh 翻译该片段即可；fullZh 必须重组语序、通顺成文，两者分工不同；
3. skeleton 是"剔除全部修饰后的最短完整句"，只允许一层核心；若主干带宾语从句且缺它意思不完整，可保留宾语从句；
4. steps 必须落到本句具体的词（如"没有 and/but/or/so，也没有 that/which 引导词，所以不做复合句断开"），禁止写套话；
5. flow 是本拆解的灵魂：学生读完 flow 应该能自己把这句话顺下来——每步格式"先看X（什么意思）→ 再看Y（和X的关系/补充什么）"；
6. grammar 只挑本句真正影响理解的 2~4 个点，每个都必须说清"修饰谁"；
7. 所有英文术语必须附中文翻译，如 attributive clause（定语从句）。`;

const kindEnum = z.enum(["exam", "generated"]).default("exam");

export const methodRouter = createRouter({
  /** 方法条款库（SOP 页 / 方法应用卡展示） */
  clauses: publicQuery.query(async () => {
    const db = getDb();
    return db.select().from(methodClauses).orderBy(asc(methodClauses.sortOrder));
  }),

  /** 长难句三步拆解：缓存优先，否则 AI 拆解后落库；真题与 AI 生成题同等待遇 */
  parseSentence: privateQuery
    .input(
      z.object({
        kind: kindEnum,
        refId: z.number(),
        paraNo: z.number().min(1),
        sentIdx: z.number().min(0),
        sentence: z.string().min(4).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const cached = await db.query.sentenceAnalyses.findFirst({
        where: and(
          eq(sentenceAnalyses.source, input.kind),
          eq(sentenceAnalyses.passageId, input.refId),
          eq(sentenceAnalyses.paraNo, input.paraNo),
          eq(sentenceAnalyses.sentIdx, input.sentIdx),
        ),
      });
      if (cached) return { analysis: cached.payload, model: cached.modelUsed, cached: true };

      const resolved = await resolveBinding("sentence_parser", "chat", ctx.user?.id);
      if (!resolved) throw new Error("没有可用的对话渠道，请先在「模型」里配置");
      const system = SENTENCE_PARSE_FALLBACK + (await buildMethodContext("sentence_parser"));
      const result = await callChat(
        resolved.channel,
        resolved.model,
        [
          { role: "system", content: system + "\n\n只输出合法 JSON，不要任何其他文字。" },
          { role: "user", content: input.sentence },
        ],
        { maxTokens: 4096, reasoningEffort: resolved.reasoningEffort },
      );
      const text = result.content.trim().replace(/^```(?:json)?|```$/g, "").trim();
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start === -1 || end === -1) throw new Error("模型未返回 JSON，请重试");
      const payload = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      // 先查后改：兼容 MySQL/SQLite，避免 onDuplicateKeyUpdate（仅 MySQL 方言）
      const keyWhere = and(
        eq(sentenceAnalyses.source, input.kind),
        eq(sentenceAnalyses.passageId, input.refId),
        eq(sentenceAnalyses.paraNo, input.paraNo),
        eq(sentenceAnalyses.sentIdx, input.sentIdx),
      );
      const existing = await db.query.sentenceAnalyses.findFirst({ where: keyWhere });
      if (existing) {
        await db
          .update(sentenceAnalyses)
          .set({ payload, sentence: input.sentence, modelUsed: result.model })
          .where(keyWhere);
      } else {
        await db
          .insert(sentenceAnalyses)
          .values({
            source: input.kind,
            passageId: input.refId,
            paraNo: input.paraNo,
            sentIdx: input.sentIdx,
            sentence: input.sentence,
            payload,
            modelUsed: result.model,
          });
      }
      return { analysis: payload, model: result.model, cached: false };
    }),

  /** SOP 联想图（可选附加，不自动生成）：
   *  scene —— 全文景象联想图：把全文的局面浓缩成一个具象场景，辅助整体记忆与联想；
   *  vocab —— 核心词汇连锁图：把文中最能串联主旨的实词画成带关系标签的网络图。
   *  提示词由文本模型先从原文精确提炼「元素 + 关系」，再交给绘图模型——关系精确优先于风格。
   *  两层缓存：提炼结果（assoc-meta）与成图（assoc-image-{type}）都按篇章缓存。 */
  assocImage: privateQuery
    .input(z.object({ kind: kindEnum, refId: z.number(), type: z.enum(["scene", "vocab"]) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const imgKey = `assoc-image-${input.type}`;
      const cached = await db.query.analyses.findFirst({
        where: and(
          eq(analyses.source, input.kind),
          eq(analyses.passageId, input.refId),
          eq(analyses.modelUsed, imgKey),
        ),
      });
      if (cached) {
        const p = cached.payload as { image?: string; captionZh?: string; links?: unknown };
        if (p.image) return { image: p.image, captionZh: p.captionZh ?? "", links: p.links ?? [], cached: true };
      }
      const content = await loadContent(input.kind, input.refId);
      const text = passageTextOf(content.paragraphs);
      const uid = ctx.user?.id;

      // 第一层：精确提炼视觉素材（元素 + 关系），按篇章缓存
      const meta = await db.query.analyses.findFirst({
        where: and(
          eq(analyses.source, input.kind),
          eq(analyses.passageId, input.refId),
          eq(analyses.modelUsed, "assoc-meta"),
        ),
      });
      let metaPayload = meta?.payload as AssocMeta | undefined;
      if (!metaPayload?.scene || !metaPayload?.vocab) {
        const system = await promptOf("agent_assoc", ASSOC_META_FALLBACK, uid);
        const { data } = await chatJson<AssocMeta>(
          "agent_assoc",
          system,
          `文章标题：${content.title}\n\n${text}`,
          { maxTokens: 4096, userId: uid },
        );
        metaPayload = data;
        await db.insert(analyses).values({
          source: input.kind,
          passageId: input.refId,
          payload: data as unknown as Record<string, unknown>,
          modelUsed: "assoc-meta",
        });
      }

      // 第二层：按类型组装精确提示词（关系优先，不锁风格）
      const scene = metaPayload.scene;
      const vocab = metaPayload.vocab;
      const prompt =
        input.type === "scene"
          ? [
              "One single coherent editorial illustration showing this exact scene:",
              scene.conceptEn,
              `Must-include elements: ${(scene.elementsEn ?? []).join("; ")}.`,
              `The composition MUST visually express these relationships: ${(scene.relationsEn ?? []).join("; ")}.`,
              "Flat modern editorial illustration, clear visual hierarchy, muted warm palette, clean shapes, generous negative space, absolutely no text or letters, no watermark.",
            ].join(" ")
          : [
              "A clean labeled concept-map diagram (mind map) on plain paper-white background.",
              `Nodes (draw each as a small rounded box with this exact English label): ${(vocab.terms ?? []).map((t) => t.en).join("; ")}.`,
              `Edges (draw arrows with these exact relation labels): ${(vocab.links ?? []).map((l) => `${l.from} --${l.relation}--> ${l.to}`).join("; ")}.`,
              "Every node label and every edge label must be rendered as legible short English text. Minimal flat design, black ink lines, one accent color for edge labels, no decoration, no watermark.",
            ].join(" ");

      const resolved = await resolveBinding("default_image", "image", uid);
      if (!resolved) return { image: null, reason: "未配置绘图渠道" };
      try {
        const img = await callImage(resolved.channel, resolved.model, prompt);
        const dataUrl = img.b64 ? `data:image/png;base64,${img.b64}` : img.url ? img.url : null;
        const captionZh = input.type === "scene" ? (scene.captionZh ?? "") : (vocab.captionZh ?? "");
        const links =
          input.type === "vocab"
            ? (vocab.links ?? []).map((l) => ({ from: l.from, to: l.to, relation: l.relation, zh: l.zh }))
            : [];
        if (dataUrl) {
          await db.insert(analyses).values({
            source: input.kind,
            passageId: input.refId,
            payload: { kind: imgKey, image: dataUrl, captionZh, links },
            modelUsed: imgKey,
          });
        }
        return { image: dataUrl, captionZh, links, cached: false };
      } catch (e) {
        return { image: null, reason: e instanceof Error ? e.message.slice(0, 120) : "绘图失败" };
      }
    }),
});

interface AssocMeta {
  scene: { conceptEn: string; elementsEn?: string[]; relationsEn?: string[]; captionZh?: string };
  vocab: {
    terms?: { en: string; zh: string }[];
    links?: { from: string; to: string; relation: string; zh?: string }[];
    captionZh?: string;
  };
}

const ASSOC_META_FALLBACK = `你是考研英语阅读的教学设计师，擅长"以图助记"。给定一篇考研阅读文章，提炼两份视觉联想素材。
输出 JSON：
{
  "scene": {
    "conceptEn": "一个能概括全文局面的具象场景（<=25 个英文单词，必须具体可视：谁、在什么环境、做什么、冲突是什么；禁止抽象口号）",
    "elementsEn": ["3-6 个关键视觉元素，各 <=5 个英文单词"],
    "relationsEn": ["元素之间的相互作用，各 <=10 个英文单词，如 'A drives B'、'A contrasts with B'、'A undermines B'"],
    "captionZh": "这幅图与全文的对应关系（中文，60字内，点明每个元素对应文中什么）"
  },
  "vocab": {
    "terms": [{"en": "文中最能串联主旨的实词/术语（1-3 个英文单词，照抄原文拼写）", "zh": "中文释义"}],
    "links": [{"from": "某 terms.en", "to": "某 terms.en", "relation": "causes / contrasts / supports / exemplifies / undermines / leads to 之一", "zh": "关系中文说明（20字内）"}],
    "captionZh": "词汇连锁图导读（中文，60字内）"
  }
}
硬性规则：
- terms 6-10 个，按对主旨的重要性排序；专有名词/核心概念优先。
- links 5-9 条，from 与 to 必须与某个 terms.en 逐字相同；关系必须忠实于原文论证，禁止编造原文没有的因果。
- 所有英文标签必须短到能画进图里；中文部分面向零基础学习者。`;
