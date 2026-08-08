# AGENTS.md — 项目开发约定

> 本文件是给 AI 编码助手与新人开发者看的项目指南。修改代码前请先读这里,遵循既有约定,保持「纸上功夫」的一致性。

## 项目是什么

考研传统阅读助手(纸上功夫):帮助考研学生用「SOP 六阶段解题法」练习传统阅读(四篇/五篇)的全栈应用。水墨古风 UI,核心价值是**官方答案优先判分** + **六阶段解题流水线** + **错题闭环**。

## 技术栈(版本以 package.json 为准)

- 前端:React 19 + Vite + TailwindCSS 3 + TanStack Query 5
- 后端:Hono + tRPC 11(单进程内嵌静态站点)+ Zod
- 数据库:Drizzle ORM + MySQL 8 / TiDB(连接串经 `DATABASE_URL`)
- LLM:渠道中台(`api/llm/client.ts`),多渠道多模型绑定,密钥只在服务端

## 目录结构(扩充新功能时按此落位)

```
contracts/          前后端共享契约:constants(题型/错因六分法)、types、errors —— 禁止各自硬编码
db/                 schema.ts(全部表定义) + migrations/(幂等应用) + seed 系列 + final_corpus.json(真题语料)
api/                后端(Hono + tRPC)
  router.ts         总路由:每个业务域一个 *Router.ts,新增模块在此注册一行
  middleware.ts     publicQuery / privateQuery / adminQuery 三级守卫(安全关键,新端点必须选对)
  context.ts        请求上下文(session → user)
  lib/              横切能力:bootstrap(自举迁移+种子+僵尸清扫)、rate(限流)、auth、http、pipelineRunner
  llm/client.ts     渠道中台:按绑定选模型,密钥只在服务端(DB/env)
src/                前端
  pages/            一页一文件,App.tsx 注册路由
  components/ink/   设计系统:decor(BrushTitle/PaperCard/InkDivider)、Seal —— 新页面只能用这套
  components/       布局与功能件(ProfileGate、OnboardingTour…)
  components/analysis/  解析视图族(五段式解析/结构图/差异分析/RetroCard)
  hooks/            useUser/useToast/useSound/useShortcuts…
  lib/              errorLog(全局错误捕获)、safeStorage、analysisTypes
public/art|sounds  AI 生成的水墨素材与音效
verifier/           验收标准(v1…vN/CRITERIA.md)+ 运行记录(runs/),追加式,不覆盖
docs/               部署与架构文档(本仓库补充)
```

## 设计红线(历任迭代共识,不可破坏)

1. **只加不改**:新功能复用既有载体(如定制卷复用 `generatedSets`),不动既有判分路径。
2. **判分唯一基准是官方答案**(`officialOf` 单点收口),AI 答案仅作无官方答案时的降级,UI 标注「AI 参考答案」。
3. **认证三级守卫**:凡消耗算力(LLM)或写库的端点一律 `privateQuery`,userId 一律从 session 取(客户端传的一律忽略);浏览类只读端点保持 `public`(游客模式)。
4. **密钥只存服务端**(DB/env),前端只见掩码;密码只存 scrypt 加盐哈希;渠道 baseUrl 校验 `^https://` 且禁内网段(防 SSRF)。
5. **任务生命周期**:启动清扫僵尸 running + 心跳门槛(10 分钟 updatedAt)+ 总 deadline(25 分钟)+ 断点续跑;前端永远看得到出口(暂停/停止/重试)。
6. **错误不静默**:保存失败 → 可见提示 + 一键重试;`.catch(() => void 0)` 是红线。
7. **古风契约**:7 个 CSS 变量、`rounded-[2px]`、无图标库、Seal/BrushTitle/meta-label 微文案;深色模式走 `html[data-theme="dark"]`。
8. **真题语料仅供个人学习**,不做公开分发;`.env` 永不打包进镜像。
9. **验收门禁**:任何改动必须全量回归 + 部署模拟通过才算完成(见 verifier)。

## 编码方法论(PonyTAIL 懒惰阶梯)

项目采用 PonyTAIL 方法论(「最好的代码是没写的代码」)。写代码前按阶梯自问,详见 `docs/开发指南.md` 第四节:

1. 需要存在吗(YAGNI)→ 2. 代码库已有就复用 → 3. 标准库 → 4. 已装依赖 → 5. 一行能写就一行 → 6. 才写最小代码。
- **Bug 修根因**:grep 所有调用者,在共享函数修一次(如 SSRF 校验只在 `assertSafeBaseUrl` 收口)。
- 不建多余抽象、删除优先于添加、最短 diff;有意简化处加 `ponytail:` 注释标注天花板与升级路径。
- 非平凡逻辑留最小可运行自检(verifier/v1 风格,不引框架)。

## 加一个新模块的标准动作(六步)

1. `db/schema.ts` 加表 → `npx drizzle-kit generate --name xxx`(启动时幂等应用,老部署自愈)。
2. `api/xxxRouter.ts` 用三级守卫写接口,`router.ts` 注册一行;共享横切能力放 `api/lib/`。
3. `src/pages/XxxPage.tsx` 用 `components/ink` 设计系统搭页,`App.tsx` + `Layout.tsx` 接路由/导航。
4. 契约(枚举/常量)放 `contracts/`,前后端同源。
5. 测试套件追加断言,全绿后才算完成。
6. `verifier/vN/CRITERIA.md` 写验收标准,`runs/` 记录本轮结果。

## 常用命令

```bash
npm run dev          # 前端 vite 开发服务器
npm run build        # 前端 vite build + 后端 esbuild → dist/boot.js
npm start            # NODE_ENV=production node dist/boot.js(单进程:静态站点+tRPC+自举迁移)
npm run check        # tsc -b 类型检查
npm run lint         # eslint
npm test             # vitest
npm run db:generate  # drizzle-kit generate(改 schema.ts 后)
```

## 数据与迁移

- 首次启动自动:建表(幂等迁移)→ 种子数据(SOP 条款/真题语料/预置渠道)→ 管理员账号(`ADMIN_PASSWORD` 可覆盖,否则打印一次随机密码)。
- `db/migrations/` 追加式,绝不修改已应用的历史迁移;需要新变更就生成新迁移文件。
- 全量数据快照 `db/dump.tar.gz`(脱敏)可用于还原,见 README「完整数据库快照」章节与 `scripts_restore_dump.mjs`。

## 测试与验收

- 验收标准:仓库内 `verifier/vN/CRITERIA.md`(追加式,不覆盖)。
- 执行记录:`verifier/runs/` 每次执行追加带时间戳的记录。
- 套件清单与运行命令:`docs/测试指南.md`(含 v5.11 新增边界套件 `test_boundary_v6.py` 137 项:认证矩阵 98+15、zod 边界 81、SSRF 22 变体、并发/幂等、数据隔离等)。
- 每次交付:全量回归 + 干净树部署模拟(git archive → 构建 → 启动 → 健康检查)。

## 环境依赖

- Node.js ≥ 20(与 Dockerfile 的 `node:20-slim` 一致)。
- MySQL 8+(或 TiDB 兼容 MySQL 协议)。
- LLM 渠道:需配置至少一个渠道(DB 内 `channels` 表或环境变量),见 `.env.example` 与部署文档。
