import { useState } from "react";
import { Link } from "react-router";
import { BrushTitle, InkReveal, PaperCard, InkDivider } from "@/components/ink/decor";
import { Seal } from "@/components/ink/Seal";

/**
 * 使用手册：不是方法论（那在「指南」），是这座书斋本身的使用说明。
 * 内容由三位真实使用方向的遍历者沉淀——
 *   小满（零基础扫盲）/ 老纪（二战·错题闭环）/ 阿筱（冲刺·效率与资产）。
 */

type Route = "xiaoman" | "laoji" | "axiao";

const PERSONAS: {
  key: Route;
  name: string;
  tag: string;
  seal: string;
  oneLiner: string;
  path: string[];
}[] = [
  {
    key: "xiaoman",
    name: "小满路线",
    tag: "零基础 · 先学方法再做题",
    seal: "学",
    oneLiner: "词汇量小、没语感都没关系。方法的核心是「定位 + 对比」，不是全文翻译。",
    path: ["SOP 图谱", "指南", "跟我练", "真题交卷", "点词查词", "生词本"],
  },
  {
    key: "laoji",
    name: "老纪路线",
    tag: "二战 · 一切围绕错题转",
    seal: "改",
    oneLiner: "错题不过夜：诊断→感悟→复习排期→定制卷→再练，循环到没有错题为止。",
    path: ["交卷留错", "深度诊断", "写感悟", "复习打卡", "复盘定制卷", "定制卷再练"],
  },
  {
    key: "axiao",
    name: "阿筱路线",
    tag: "冲刺 · 批量产出与数据资产",
    seal: "冲",
    oneLiner: "每天一套 AI 题保持题感，作文逐段打磨，每周备份一次全部数据。",
    path: ["AI 出题", "作文工坊", "素材库", "统计", "档案", "全量备份"],
  },
];

/** 功能地图：每个栏目是什么、什么时候去 */
const MAP: { to: string; name: string; desc: string; when: string }[] = [
  { to: "/sop", name: "SOP 图谱", desc: "六步解题法的完整条款库，配题型卡", when: "第一次来、做题卡壳时" },
  { to: "/guide", name: "指南", desc: "小白上手全指南：从标段到选项对比", when: "正式做题前通读一遍" },
  { to: "/library", name: "真题库", desc: "历年真题语料，五题一篇", when: "每天的主战场" },
  { to: "/generate", name: "AI 出题", desc: "按话题/难度/题型生成仿真卷；定制卷也落在这里", when: "真题刷完、想保持题感时" },
  { to: "/wrong", name: "错题本", desc: "做错的题自动入册，重练做对盖「已掌握」印", when: "交卷之后必去" },
  { to: "/insight", name: "顿悟室", desc: "错因六分法统计、AI 备考参谋、感悟、艾宾浩斯复习打卡", when: "攒了几道错题之后" },
  { to: "/vocab", name: "生词本", desc: "点词查词收进来的词，按熟谙度五档管理", when: "早晚各翻一次" },
  { to: "/essay", name: "作文工坊", desc: "双模式写作：接力引导逐段打磨 / 一气呵成 AI 全写再按意见进化；素材库供弹", when: "每周至少两篇" },
  { to: "/stats", name: "统计", desc: "练习量、正确率、时长曲线；真题 / AI 生题分源评估三模块", when: "每周复盘时" },
  { to: "/history", name: "档案", desc: "全部交卷记录（真题 + AI 生题），一键回到该篇恢复完整解析", when: "想重温某篇时" },
  { to: "/tickets", name: "工单", desc: "反馈问题/提建议，追踪掌门的处理路线；公告每一期留档", when: "遇到问题、想看公告时" },
  { to: "/settings", name: "设置", desc: "字号、深色、音效、数据备份与恢复", when: "第一周到站先调顺" },
];

const STEPS: Record<Route, { title: string; body: React.ReactNode }[]> = {
  xiaoman: [
    {
      title: "第 1 站 · 不登录也能先学",
      body: (
        <>
          <b>SOP 图谱</b>和<b>指南</b>对游客开放。先把六步过一遍：标段 → 读题 3Q → 五题同定位 →
          定解题范围 → 选项对比 → 无解兜底。记住一句话：正确答案一定在原文里有证据句。
        </>
      ),
    },
    {
      title: "第 2 站 · 用「跟我练」上第一课",
      body: (
        <>
          进任意一篇真题，点页头的<b>「跟我练 · 逐题走步」</b>。审题、定位、解题、复盘四步，
          <b>每一步都你先来</b>，提交后才揭示 AI 参照——参照来自这篇已落库的深度解析，
          所以是零等待、不烧模型。走完一道题，你就完整体验了一遍六步法。
        </>
      ),
    },
    {
      title: "第 3 站 · 正式交卷",
      body: (
        <>
          回真题页自己作答、交卷。五段式 AI 解析会逐题展开：审题、定位证据（含逐词对应铁证）、
          解题逻辑链（先复述、再讲逻辑、后比对）、交叉验证、差异分析。<b>解析任务归入你的账号</b>，
          所以先签到再交卷。任务进行中随时可<b>暂停 / 停止</b>，之后从断点继续，进度不丢。
        </>
      ),
    },
    {
      title: "第 4 站 · 点词查词 + 长难句原地拆",
      body: (
        <>
          阅读中点任何生词即查，顺手「存入生词本」。开<b>长难句模式</b>后点任何句子，
          拆解面板<b>在句子正下方原地展开</b>（三步拆解 → 片段切分 → 主干 → 通译），
          再点一下同一句收起——读到哪里拆到哪里，不打断阅读流。
        </>
      ),
    },
  ],
  laoji: [
    {
      title: "第 1 站 · 交卷即入册",
      body: (
        <>
          做错的题<b>自动进错题本</b>，不用手抄。错题本可按题型、错因筛选，
          也可以「只看今日新增」——每天清当天的账，错题不过夜。
        </>
      ),
    },
    {
      title: "第 2 站 · 深度诊断拿三件套",
      body: (
        <>
          每道错题点<b>「⚑ 深度诊断」</b>，拿到：错因（六分法）、干扰项拉力分析、纠正建议。
          这三件套是后面定制卷的原料之一。
        </>
      ),
    },
    {
      title: "第 3 站 · 写感悟要诚实",
      body: (
        <>
          感悟分「待消化」和「已吃透」两档。写「待消化」不丢人——顿悟室的复习打卡
          按艾宾浩斯曲线排期，诚实的标记换来恰好的复习时机。
        </>
      ),
    },
    {
      title: "第 4 站 · 复盘定制卷（核心闭环）",
      body: (
        <>
          任何一套交过卷的题（真题或 AI 题），结果区会出现<b>「为这 N 道错题定制新卷」</b>。
          它把三样东西喂给命题官：这套卷的错题数据、AI 的诊断结论、你的自评
          （<b>可填可不填</b>——写了更准）。生成的 5 题卷落进 AI 出题历史，随时再练；
          再错，就再入册、再定制。同一份记录同样的自评一小时内重复点不会重复烧模型。
        </>
      ),
    },
  ],
  axiao: [
    {
      title: "晨 · AI 出题一套",
      body: (
        <>
          按话题 + 难度 + 重点题型生成仿真卷，交卷后与真题同等待遇：五段式解析、
          错题入册、差异分析一样不少。历史卷随时回看：「档案」载入回味直达那套题、
          左侧「已生成」列表点哪套练哪套。冲刺期一天一套，保持题感。
        </>
      ),
    },
    {
      title: "午 · 作文工坊一段",
      body: (
        <>
          作文不是一次性憋出来的。两种写法任选：<b>接力引导</b>——AI 起草一段、你改一段，
          也可以整段自己写；<b>一气呵成</b>——AI 一次走完全文，你在提纲和每一段上留参考意见，
          「按意见进化」逐轮打磨。素材库里收藏的好句，开题时勾选「引用素材」就会被编织进参考。
        </>
      ),
    },
    {
      title: "晚 · 统计页看曲线",
      body: (
        <>
          统计页主模块看综合曲线，两个子模块<b>分开评估真题与 AI 生题</b>：各自的交卷次数、
          判分题数、正确率、近 7 天走势和题型分布——AI 题练得再好也骗不了真题的正确率。
          顿悟室的「错因六分法」告诉你哪类错在减少、哪类还顽固。
        </>
      ),
    },
    {
      title: "周日 · 全量备份",
      body: (
        <>
          设置页一键导出全量备份：错题、生词、素材、感悟、练习记录全在里面。
          换设备、重装都不怕；恢复也在同一页。数据是你的，随时拿走。
        </>
      ),
    },
  ],
};

const FAQ: { q: string; a: string }[] = [
  {
    q: "为什么定制按钮点了没反应 / 报错？",
    a: "三种常见情况：① 这套卷还没交卷判分——先交卷；② 这套卷全对——没有弱点可定制，去错题本挑陈年错题复习；③ 一小时内同记录同自评已生成过——会直接复用旧卷，这是省模型的幂等设计，不是故障。",
  },
  {
    q: "自评必须写吗？写什么最有用？",
    a: "可填可不填。写的时候别写「我太粗心了」，写具体模式：「我看到原词复现就选，忽略同义改写」「我总把比较级方向读反」。命题官会针对这些模式设计干扰项。",
  },
  {
    q: "「跟我练」和直接交卷看解析有什么区别？",
    a: "交卷是考后复盘，「跟我练」是把你的思考过程放进每一步：你先判题型、选段落、作答，AI 参照才揭示。它不额外调用模型（参照全部来自已落库解析），所以随点随有。建议新题先「跟我练」，错题回炉用交卷解析。",
  },
  {
    q: "解析任务跑到一半失败/中断/不想等了怎么办？",
    a: "任务全程可控：进行中可「⏸ 暂停」（产物保留，随时「▶ 继续」断点续跑）、可「■ 停止」（之后仍可断点重试或「关闭」回到交卷前）；失败了点「断点重试」只补没跑的阶段，不从头烧模型。即使遇到上游卡死，超过 10 分钟没有心跳的任务会被自动终结并给出重试入口——永远不会有停不下来的任务。",
  },
  {
    q: "结构分析里的「联想图」是什么？要钱吗？",
    a: "它是 SOP 的可选助记附件，不点不生、点了才调绘图模型（按篇章缓存，之后秒回）。两种：「全文景象联想图」把全文局面浓缩成一幅具象场景，合上书能想起画面就记住了主旨；「核心词汇连锁图」把串联主旨的关键词画成带因果/对比/例证标签的关系网，并附文字版连锁关系与图互证。提示词由文本模型先从原文精确提炼元素与关系，不是随便画张画。",
  },
  {
    q: "AI 生题的历史解析在哪里看？",
    a: "两个入口：「档案」页每条 AI 生题记录点「载入回味」直达那套题，作答、判分、五段式解析原样恢复；「AI 出题」左侧的已生成列表也能随时点回任何一套。真题与 AI 题同等待遇。",
  },
  {
    q: "AI 答案和官方答案不一致，信谁？",
    a: "判分永远以官方答案为准；不一致时结果区会展开「差异分析」，逐条对比两路推理的证据句。以原文证据为准做你自己的裁断——这正是本方法教的核心能力。",
  },
  {
    q: "作文工坊的「接力引导」和「一气呵成」怎么选？",
    a: "想把每句话练到自己手里，选接力引导：AI 起草一段、你改一段，也可以点「我自己写本段」整段自写，AI 的草稿随时可拿来对照。时间紧或想先看完整成文，选一气呵成：确认提纲后 AI 一次写完，你再在提纲和每一段上留参考意见（如「更正式一点」「原因用衔接词分开」），点「按意见进化」逐轮改到满意。两条线都收进同一个稿子，随时切换不冲突。",
  },
  {
    q: "点「AI 起草」会不会扣了额度却没反应？",
    a: "不会了。每一次调用只有两种结局：段落真实落进稿子，或明确报错并提示重试——绝不会静默吞掉。一气呵成是逐段落墨的，中途失败时已写完的段落自动保留，重试只补没写的段，不重复烧模型。",
  },
  {
    q: "每天的时间怎么分配？",
    a: "参考三条路线：新手期（小满路线）一天一篇「跟我练」+ 一篇交卷；错题期（老纪路线）上午刷新题、下午清错题账、晚上定制卷回炉；冲刺期（阿筱路线）晨题、午文、晚统计、周日备份。",
  },
  {
    q: "发现网站有问题，怎么报？",
    a: "个人中心的「反馈与工单」区，写清问题和位置就能递单：截图直接贴（自动压缩），页面路径和报错现场会随单自动附上——不用自己抄报错。递完去「工单中心」追踪处理路线，掌门的每条回复都在对话流里。好反馈三要素：你在做什么、期望什么、实际发生了什么。",
  },
  {
    q: "公告在哪看？会错过吗？",
    a: "最新一期公告会挂在首页横幅；「工单中心 · 公告榜」里每一期都留档，可逐期回看。本站迭代节奏：每月一次大更新，每周一次小修改，都以公告为准。",
  },
];

export default function ManualPage() {
  const [route, setRoute] = useState<Route>("xiaoman");
  const persona = PERSONAS.find((p) => p.key === route)!;

  return (
    <div className="max-w-[1000px] mx-auto">
      <InkReveal className="mb-8">
        <div className="meta-label mb-2">FIELD MANUAL · 由三位真实使用者沉淀</div>
        <h1 className="text-[34px] font-black">
          <BrushTitle vermilion>使用手册</BrushTitle>
        </h1>
        <p className="text-[var(--ink-2)] mt-2 text-[15px] max-w-[720px]">
          「指南」教你解题方法，这里教你<b>用好这座书斋本身</b>。
          三位不同方向的考生走完了全站每个功能，他们的路线、踩过的坑、省时间的诀窍都在下面。
        </p>
      </InkReveal>

      {/* 三条路线选择 */}
      <div className="grid md:grid-cols-3 gap-4 mb-10 ink-stagger">
        {PERSONAS.map((p) => (
          <button
            key={p.key}
            onClick={() => setRoute(p.key)}
            className={`text-left transition-all ${
              route === p.key ? "ring-1 ring-[var(--vermilion)]" : "hover:-translate-y-0.5"
            }`}
          >
            <PaperCard frame={route === p.key} className="p-5 h-full">
              <div className="flex items-start justify-between">
                <div>
                  <b className="text-[17px]">{p.name}</b>
                  <p className="meta-label mt-1">{p.tag}</p>
                </div>
                <Seal size={44} seed={`manual-${p.key}`} center={p.seal} animate={route === p.key} />
              </div>
              <p className="text-[13.5px] text-[var(--ink-2)] mt-3 leading-relaxed">{p.oneLiner}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {p.path.map((s, i) => (
                  <span key={s} className="text-[11.5px] px-1.5 py-0.5 border border-[var(--line)] rounded-[2px] text-[var(--ink-3)]">
                    {i + 1}.{s}
                  </span>
                ))}
              </div>
            </PaperCard>
          </button>
        ))}
      </div>

      {/* 选中路线的详细步骤 */}
      <InkReveal key={route} className="mb-12">
        <div className="meta-label mb-2">{persona.tag}</div>
        <h2 className="text-[24px] font-bold mb-5">
          <BrushTitle>{persona.name} · 逐站走</BrushTitle>
        </h2>
        <div className="space-y-4">
          {STEPS[route].map((s) => (
            <PaperCard key={s.title} className="p-5">
              <b className="text-[15px] text-[var(--vermilion)]">{s.title}</b>
              <p className="text-[14.5px] leading-[1.9] text-[var(--ink)] mt-2">{s.body}</p>
            </PaperCard>
          ))}
        </div>
      </InkReveal>

      <InkDivider className="my-10" />

      {/* 功能地图 */}
      <div className="mb-12">
        <div className="meta-label mb-2">SITE MAP · 一栏目一句话</div>
        <h2 className="text-[24px] font-bold mb-5">
          <BrushTitle>功能地图</BrushTitle>
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {MAP.map((m) => (
            <Link key={m.to} to={m.to} className="group">
              <PaperCard className="p-4 h-full group-hover:border-[var(--ink-2)] transition-colors">
                <div className="flex items-baseline justify-between">
                  <b className="text-[15px] group-hover:text-[var(--vermilion)] transition-colors">{m.name}</b>
                  <span className="meta-label">{m.when}</span>
                </div>
                <p className="text-[13.5px] text-[var(--ink-2)] mt-1.5">{m.desc}</p>
              </PaperCard>
            </Link>
          ))}
        </div>
      </div>

      <InkDivider className="my-10" />

      {/* 避坑问答 */}
      <div className="mb-12">
        <div className="meta-label mb-2">PITFALLS · 三位遍历者踩过的坑</div>
        <h2 className="text-[24px] font-bold mb-5">
          <BrushTitle>常见疑问与避坑</BrushTitle>
        </h2>
        <div className="space-y-4">
          {FAQ.map((f) => (
            <PaperCard key={f.q} className="p-5">
              <b className="text-[15px]">{f.q}</b>
              <p className="text-[14px] leading-[1.9] text-[var(--ink-2)] mt-2 border-l-2 border-[var(--bamboo)] pl-3">
                {f.a}
              </p>
            </PaperCard>
          ))}
        </div>
      </div>

      <PaperCard frame className="p-8 text-center">
        <Seal size={64} seed="manual-end" text="学以致用" center="行" />
        <p className="text-[15px] text-[var(--ink-2)] mt-4">
          手册读得再熟，不如上手一篇。选好你的路线，去<Link to="/library" className="text-[var(--vermilion)] font-bold">真题库</Link>开卷。
        </p>
      </PaperCard>
    </div>
  );
}
