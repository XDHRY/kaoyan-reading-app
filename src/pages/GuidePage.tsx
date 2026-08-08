import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { BrushTitle, InkReveal, PaperCard, InkDivider } from "@/components/ink/decor";
import { Seal } from "@/components/ink/Seal";

const TOC = [
  { id: "what", t: "这套方法是什么" },
  { id: "s1", t: "第一步 · 标段" },
  { id: "s2", t: "第二步 · 读题 3Q" },
  { id: "s3", t: "第三步 · 五题同定位" },
  { id: "s4", t: "第四步 · 定解题范围" },
  { id: "s5", t: "第五步 · 选项对比解题" },
  { id: "s6", t: "第六步 · 无解兜底" },
  { id: "types", t: "八大题型速查" },
  { id: "logic", t: "六大逻辑关系" },
  { id: "options", t: "选项特征：对错长什么样" },
  { id: "faq", t: "小白常见问题" },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 mb-12">
      <h2 className="text-[24px] font-bold mb-4">
        <BrushTitle>{title}</BrushTitle>
      </h2>
      <div className="space-y-4 text-[16px] leading-[1.95] text-[var(--ink)]">{children}</div>
    </section>
  );
}

function En({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-bold" style={{ fontFamily: "var(--font-en)" }}>
      {children}
    </span>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-[var(--vermilion)] bg-[var(--paper-deep)]/50 px-4 py-3 text-[15px] rounded-r-[2px]">
      {children}
    </div>
  );
}

export default function GuidePage() {
  const { data: cards } = trpc.knowledge.list.useQuery();
  const [activeToc, setActiveToc] = useState("what");
  const typeCards = (cards ?? []).filter((c) => c.kind === "sub");

  return (
    <div className="grid lg:grid-cols-[220px_1fr] gap-10 max-w-[1100px] mx-auto">
      {/* 目录 */}
      <aside className="hidden lg:block">
        <div className="sticky top-24">
          <div className="meta-label mb-3">CONTENTS · 目录</div>
          {TOC.map((x) => (
            <a
              key={x.id}
              href={`#${x.id}`}
              onClick={() => setActiveToc(x.id)}
              className={`block py-1.5 text-[14px] border-l-2 pl-3 transition-colors ${
                activeToc === x.id ? "border-[var(--vermilion)] text-[var(--vermilion)] font-bold" : "border-[var(--line)] text-[var(--ink-2)] hover:text-[var(--ink)]"
              }`}
            >
              {x.t}
            </a>
          ))}
          <div className="mt-8"><Seal size={72} seed="guide" text="方法指南" center="学" /></div>
        </div>
      </aside>

      <div>
        <InkReveal className="mb-10">
          <div className="meta-label mb-2">BEGINNER'S GUIDE · 零基础适用</div>
          <h1 className="text-[34px] font-black">
            <BrushTitle vermilion>传统阅读 · 小白上手全指南</BrushTitle>
          </h1>
          <p className="text-[var(--ink-2)] mt-3 text-[16px]">
            这套方法只做一件事：<b>把"读文章、凭感觉选"变成"按流程找证据"</b>。
            不需要词汇量很大，不需要语感，按步骤执行就能稳定提分。
          </p>
        </InkReveal>

        <Section id="what" title="这套方法是什么">
          <p>
            考研英语一的传统阅读（Text 1–4），每篇 5 道题，本质上考三件事：
            <b>找得到</b>（定位）、<b>看得懂重点</b>（长难句与逻辑）、<b>比得准</b>（选项对比）。
            命题人出的每一道题，答案都明明白白写在原文里——错答案则是按固定套路设计的陷阱。
          </p>
          <p>
            所以这套 SOP 的核心思想是：<b>先读题，再带着定位词回原文找证据，最后在证据范围内对比选项</b>。
            全篇只有六步，六种题型各有分支处理方法，外加一套"错误选项特征库"帮你识破陷阱。
          </p>
          <Tip>
            重要观念：阅读题不是"读懂全文再做题"，而是"用题干找到原文的一两句话，精解这一两句"。
            这叫<En>locate and compare</En>（定位与对比），是本方法的灵魂。
          </Tip>
        </Section>

        <Section id="s1" title="第一步 · 标段">
          <p>
            拿到文章，先花 10 秒钟给每个自然段标上序号 <span className="para-no">[1]</span> <span className="para-no">[2]</span> <span className="para-no">[3]</span>……
            在 APP 里已经自动帮你标好。
          </p>
          <p>为什么要标段？两个原因：</p>
          <p>
            ① <b>题文同序</b>（<En>questions follow text order</En>）：五道题的顺序，基本对应答案在文中出现的先后顺序。
            第 1 题答案通常在前面的段落，第 5 题靠后。标了段号，定位就有了坐标系。
          </p>
          <p>
            ② 很多题干直接写明 <En>according to Paragraph 2</En>（根据第二段），段号就是你的导航。
          </p>
          <Tip>注意：<b>独句段</b>（只有一句话的段落）也是一段，不要漏标。</Tip>
        </Section>

        <Section id="s2" title="第二步 · 读题 3Q">
          <p>
            <b>不要先读文章！</b>先把 5 道题的题干一次性读完（只看题干，先别看选项）。每道题问自己三个问题（3Q）：
          </p>
          <p>
            <b>Q1：这是什么题型？</b>看<En>signal word</En>（题型标志词）。
            比如题干里有 <En>example / mention / illustrate</En>（例子/提及/举例说明），就是例证题；
            有 <En>infer / imply / learn</En>（推断/暗示/得知），就是推断题；
            有 <En>title / mainly discuss</En>（标题/主要讨论），就是主旨题。
            八种题型的完整标志词见下文"八大题型速查"。
          </p>
          <p>
            <b>Q2：题目到底问什么？</b>把题干在心里翻译成中文。翻不明白的题，等于蒙着眼做题。
          </p>
          <p>
            <b>Q3：定位词是哪个？</b>定位词就是待会儿回原文"按图索骥"的词。用<b>3 排除原则</b>来挑：
          </p>
          <Tip>
            排除题型标志词（如 <En>indicate</En> 表明）；排除虚词（<En>article/preposition/pronoun/conjunction</En> 冠词/介词/代词/连词）；
            排除提问部分（如 <En>which of the following</En> 以下哪个）。<br />
            剩下的实词里，<b>时间、数字、人名、地名、组织名永远保留</b>——它们在原文里最显眼。
          </Tip>
        </Section>

        <Section id="s3" title="第三步 · 五题同定位">
          <p>
            带着 5 组定位词回原文，<b>按题文同序、以句子为单位</b>找。找到定位词出现的句子，就是<En>locating sentence</En>（定位句）。
          </p>
          <p>
            原文不会傻傻地用题干原词，它会把定位词<b>改写</b>。四种改写形式：
            ① <b>同根改写</b>（改词性：<En>decide → decision</En> 决定）；
            ② <b>同义改写</b>（<En>big → enormous</En> 大→巨大）；
            ③ <b>全拼与缩写</b>（<En>World Health Organization → WHO</En>）；
            ④ <b>同类改写</b>（上下义词：<En>apple → fruit</En> 苹果→水果）。
          </p>
          <Tip>
            定位句分散时的裁决规则：定位词<b>首次出现</b>的句子优先；
            不同定位词分散在不同句子时，对选项而言<b>最重要成分</b>（主语＞谓语＞宾语＞状语）所在的句子优先。
          </Tip>
        </Section>

        <Section id="s4" title="第四步 · 定解题范围">
          <p>
            找到定位句还不够，要圈定<b>最大解题范围</b>——答案只能从这个范围里出。每种题型有固定规矩：
          </p>
          <p>
            <b>例证题</b>看例子范围的前一句或后一句（观点在例子外）；
            <b>语义题</b>看定位句和线索所在句；
            <b>观点题</b>看那个人物的引言内部（<En>quotation</En> 双引号或间接引语）；
            <b>因果题</b>看因果关系所在的句子；
            <b>代词题</b>答案在定位句的<b>前一句</b>；
            <b>主旨题</b>看 <b>N+1 句</b>。
          </p>
          <p>
            <b>N+1 句 = 每个自然段的第一句 + 最后一段的最后一句</b>。这是全文骨架，主旨题的答案就藏在这几句话里。
          </p>
          <p>
            <b>一般细节题</b>没有固定规矩，自己框：答案不跨段、定位句本句优先。
            但<b>代词会扩展范围</b>：定位句本句有代词，往前多看一句；定位句后一句有代词，往后多看一句
            （<En>pronoun</En> 代词指代的是上一句的内容）。
          </p>
          <Tip>
            <b>转折词界定范围</b>：转折词（<En>but/however/yet</En>）前后，如果主语/主题跟题干不一致，就不用看；
            一致，就继续看。转折后常出选项，但<b>不一定是正确答案</b>。
          </Tip>
        </Section>

        <Section id="s5" title="第五步 · 选项对比解题">
          <p>在解题范围内，把四个选项逐一和原文对比。两道工序：</p>
          <p>
            <b>工序一：易错对比点</b>——九个高频陷阱位置，先查这些：
            因果关系、否定词、时间线索、比较级、最高级（绝对语气）、方向/趋势/情感正负、静态词与动态词、人物/身份、金钱线索。
            原文和选项在这些地方<b>必须一致</b>，不一致就排除。
          </p>
          <p>
            <b>工序二：成分优先级</b>——逐成分比对：<b>主语＞谓语＞宾语＞修饰</b>。
            词组选项看核心词：名词+介词短语，核心词是<b>前面的名词</b>；纯名词词组，核心词是<b>尾词</b>。
            实在不会区分时：优先对比名词，<b>越具体的名词越好比</b>。
          </p>
          <p>
            <b>正确选项长什么样</b>（按优先级）：
            ① <En>paraphrase</En>（同义改写）——原文换个说法，最常见；
            ② <b>概括总结</b>；
            ③ <b>逻辑反向</b>（正话反说）；
            ④ <b>中心主旨词</b>保底。
          </p>
          <Tip>
            秒杀规则：两个选项来自<b>并列关系且都与原文一致</b>，一并排除——答案只有一个，并列的内容要么全对（不可能）要么都不是考点。
          </Tip>
        </Section>

        <Section id="s6" title="第六步 · 无解兜底">
          <p>在最大解题范围内还是选不出来？两级兜底：</p>
          <p>① 看<b>本段的首尾句</b>（段落主旨常在那里）；</p>
          <p>② 看<b>其他段落的首尾句</b>（即退回 N+1 句找中心）。</p>
          <Tip>兜底是最后手段。它救的是"范围定错了"的场，不是让你跳过前五步的捷径。</Tip>
        </Section>

        <Section id="types" title="八大题型速查">
          <p>第二步判完题型，就进对应分支。下面是每张题型卡的核心（完整版见 <a href="/sop" className="text-[var(--vermilion)]">SOP 图谱</a>）：</p>
          <div className="space-y-3 not-prose">
            {typeCards.map((c) => (
              <PaperCard key={c.nodeId} className="p-4">
                <div className="flex items-baseline gap-2 mb-2">
                  <b className="text-[16px]">{c.title}</b>
                  <span className="meta-label">{c.titleEn}</span>
                </div>
                <ul className="space-y-1 text-[14.5px]">
                  {c.points.slice(0, 3).map((p, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-[var(--vermilion)]">◆</span>
                      <span>{p.zh}</span>
                    </li>
                  ))}
                </ul>
                {c.vocab.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.vocab.map((v, i) => (
                      <span key={i} className="text-[12.5px] px-2 py-0.5 border border-[var(--line)] rounded-[2px]">
                        <b style={{ fontFamily: "var(--font-en)" }}>{v.en}</b> {v.zh}
                      </span>
                    ))}
                  </div>
                )}
              </PaperCard>
            ))}
          </div>
        </Section>

        <Section id="logic" title="六大逻辑关系">
          <p>这六种逻辑贯穿所有题型，是选项对比时的"探雷器"：</p>
          <p>
            ① <b>因果</b>（<En>cause</En>）：选项里的因果词要和原文对应，警惕因果颠倒；
            ② <b>让转</b>（<En>concession & contrast</En>）：转折后是语言重点，但要先看主题是否与题干一致；
            ③ <b>肯否</b>（<En>negation</En>）：原文/选项的否定必须一致，多一个 not 意思全反；
            ④ <b>比较</b>（<En>comparison</En>）：比较级、最高级、时间对比必须一致；
            ⑤ <b>指代</b>（<En>reference</En>）：代词还原——题干选项里的代词在题干上还原，注意单复数；
            ⑥ <b>并列</b>（<En>coordination</En>）：并列且均一致的选项一并排除。
          </p>
        </Section>

        <Section id="options" title="选项特征：对错长什么样">
          <p>
            <b>错误选项五类型</b>，看到就能认出来：
          </p>
          <p>
            ① <b>正反混淆</b>（<En>contradiction</En>）：因果颠倒、否定不一致、时间错位、情感相反；
            ② <b>偷换概念</b>：偷换成分、偷换人物/身份、偷换金钱、偷换静态/动态；
            ③ <b>答非所问</b>（<En>off-topic</En>）：内容确实来自原文，但跟题目问的方向无关——最有迷惑性；
            ④ <b>无中生有</b>（<En>fabrication</En>）：原文没提也推不出；
            ⑤ <b>过于绝对</b>（<En>absolute tone</En>）：最高级和绝对说法，往往错。
          </p>
          <Tip>
            记住一句话：<b>正确答案一定在原文里有"证据句"</b>。选了答案却说不出证据在哪一句，这题就不算做完。
          </Tip>
        </Section>

        <Section id="faq" title="小白常见问题">
          <p><b>Q：词汇量很小，能用这套方法吗？</b><br />
          能。方法的核心是"定位 + 对比"，不是全文翻译。定位词通常是名词（最好认），对比时优先比名词。
          APP 解析里的题干、定位句、选项全部配了汉语翻译，正好用来边做题边补词汇。</p>
          <p><b>Q：五个题读完全忘了怎么办？</b><br />
          正常。读题的目的不是背下来，而是让定位词在你脑子里"挂个号"。回原文扫读时，看到这些词会自然停下来。</p>
          <p><b>Q：长难句看不懂怎么办？</b><br />
          三步拆：① 标点符号断开；② 复合句断开（并列连词处断并列句，引导词到下一个谓语前断从句）；
          ③ 主干和修饰断开（从介词/形容词/非谓语开始，到名词结束的是修饰，剩下的就是主干）。先翻主干，再补修饰。</p>
          <p><b>Q：AI 解析和"标准答案"不一致怎么办？</b><br />
          以原文证据为准。APP 里校验官会复核每题的证据句；你可以点开任何一题看它的定位句和逐项分析，
          证据链完整的结论才可信。历年网传"参考答案"本身也是机构版本，偶有分歧。</p>
        </Section>

        <InkDivider className="my-10" />
        <p className="text-center text-[15px] text-[var(--ink-2)]">
          方法已就绪。去 <a href="/library" className="text-[var(--vermilion)] font-bold">真题库</a> 实战，
          或先回 <a href="/sop" className="text-[var(--vermilion)] font-bold">SOP 图谱</a> 把六步过一遍。
        </p>
      </div>
    </div>
  );
}
