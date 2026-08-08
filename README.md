# 考研传统阅读助手（纸上功夫）

React 19 + Vite + Tailwind（水墨古风）前端，Hono + tRPC 11 + Drizzle ORM + MySQL/TiDB 后端，LLM 渠道中台 + 六阶段解题流水线。

## 快速上手

```bash
cp .env.example .env   # 填 DATABASE_URL 等
npm install
npm run build          # 前端 vite build + 后端 esbuild → dist/boot.js
NODE_ENV=production node dist/boot.js   # 单进程：静态站点 + tRPC + 自举迁移
```

首次启动自动：建表（幂等迁移）→ 种子数据（SOP 条款/真题语料/预置渠道）→ 管理员账号（`ADMIN_PASSWORD` 可覆盖，否则打印一次随机密码）。

## 项目结构（扩充时按此落位）

```
contracts/          前后端共享契约：constants(题型/错因六分法)、types、errors
db/                 schema.ts（全部表定义）→ drizzle-kit generate → migrations/（幂等应用）
api/                后端（Hono + tRPC）
  router.ts         总路由：每个业务域一个 *Router.ts，新增模块在此注册一行
  middleware.ts     publicQuery / privateQuery / adminQuery 三级守卫
  context.ts        请求上下文（session → user）
  lib/              横切能力：bootstrap(自举迁移+种子)、rate(限流)、auth、http、pipelineRunner
  llm/client.ts     渠道中台：按绑定选模型，密钥只在服务端（DB/env）
src/                前端
  pages/            一页一文件，App.tsx 注册路由
  components/ink/   设计系统：decor(BrushTitle/PaperCard/InkDivider)、Seal——新页面只能用这套
  components/       布局与功能件（FeedbackFab 全站反馈印、ProfileGate、OnboardingTour…）
  components/analysis/  解析视图族（五段式解析/结构图/差异分析/RetroCard）
  hooks/            useUser/useToast/useSound/useShortcuts…
  lib/              errorLog(全局错误捕获→工单随单)、safeStorage、analysisTypes
public/art|sounds  AI 生成的水墨素材与音效
verifier/           验收标准（v1…vN/CRITERIA.md）+ 运行记录（runs/），追加式，不覆盖
```

## 加一个新模块的标准动作（六步）

1. `db/schema.ts` 加表 → `npx drizzle-kit generate --name xxx`（启动时幂等应用，老部署自愈）
2. `api/xxxRouter.ts` 用三级守卫写接口，`router.ts` 注册一行；共享横切能力放 `api/lib/`
3. `src/pages/XxxPage.tsx` 用 `components/ink` 设计系统搭页，`App.tsx` + `Layout.tsx` 接路由/导航
4. 契约（枚举/常量）放 `contracts/`，前后端同源，禁止各自硬编码
5. 测试套件追加断言（见下），全绿后才算完成
6. `verifier/vN/CRITERIA.md` 写验收标准，`runs/` 记录本轮结果

## 设计红线（历任迭代的共识）

- **只加不改**：新功能复用既有载体（如定制卷复用 generatedSets），不动既有判分路径
- 判分唯一基准是官方答案（`officialOf`），AI 答案仅降级参考
- 密钥只存服务端（DB/env），前端只见掩码；密码只存 scrypt 加盐哈希
- 真题语料仅供个人学习，不做公开分发；`.env` 永不打包
- 任务生命周期：僵尸清扫 + 心跳 + 25 分钟总时限 + 断点续跑
- 古风契约：7 个 CSS 变量、rounded-[2px]、无图标库、Seal/BrushTitle/meta-label 微文案

## 测试

测试脚本已入库(`verifier/v1/` 起):`trpc_call.py`(tRPC HTTP 调用器)是全部套件的底座,`test_v5_api.py`(认证/判分/任务生命周期/SSRF)与 `verify_extra.py`(渠道/导出/工单/生词/管理台等 40 项)可直接对本地 3000 端口服务运行;`smoke_v5.py`(Playwright 前端冒烟)需浏览器环境。LLM 依赖用例(B9-B11/C 组)需先在「设置 → API 设置」配置真实渠道密钥。历史验收标准与运行记录见 `verifier/CRITERIA.md` 与 `verifier/runs/`。

```bash
cd verifier/v1
PYTHONUTF8=1 python test_v5_api.py    # 需 3000 端口服务在跑
PYTHONUTF8=1 python verify_extra.py   # 补充验收 40 项
```

每次交付:全量回归 + 干净树部署模拟(构建 → 启动 → 健康检查)。

## 完整数据库快照
`db/dump.tar.gz` 是本仓库配套的全量数据库快照（30 张表、2763 行全部内容数据，含 AI 生成配图；`__drizzle_migrations` 由自举迁移自身管理，不在快照内）。渠道 API key 与账号口令已脱敏（`sk-REDACTED-*` 占位），在自己环境重新配置即可。
全新部署还原步骤：

```bash
cp .env.example .env           # 填好 DATABASE_URL（空库）
npm ci && npm run build
NODE_ENV=production node dist/boot.js   # 首次启动自动建表（迁移幂等，起服务后 Ctrl+C 亦可）
tar -xzf db/dump.tar.gz                 # 解出 db/dump_parts/ 分片
node scripts_restore_dump.mjs           # 导入全量数据（追加模式，只对空库执行；ISO 时间自动转 MySQL 格式）
```
