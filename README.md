# 考研传统阅读助手（纸上功夫）

帮助考研学生用「SOP 六阶段解题法」练习传统阅读的全栈应用：官方答案优先判分、六阶段解题流水线、错题闭环、AI 生题与作文工坊。水墨古风界面，单进程一键部署。

<div align="center">

[![CI](https://github.com/XDHRY/kaoyan-reading-app/actions/workflows/ci.yml/badge.svg)](https://github.com/XDHRY/kaoyan-reading-app/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/XDHRY/kaoyan-reading-app)](LICENSE)
[![Release](https://img.shields.io/github/v/release/XDHRY/kaoyan-reading-app)](https://github.com/XDHRY/kaoyan-reading-app/releases)
[![Languages](https://img.shields.io/github/languages/top/XDHRY/kaoyan-reading-app)](package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

- 版本：v5.12.5（见 [CHANGELOG.md](CHANGELOG.md)）
- 技术栈：React 19 + Vite + Tailwind（前端）· Hono + tRPC 11 + Drizzle ORM + MySQL/TiDB（后端）
- 交付形态：Web 全栈服务 · Android 离线 APK · Windows 桌面版（Electron）

## 界面预览

| 启动页 · 水墨古风 | 真题精读 · 长难句 | 作文工坊 · 逐段进化 | AI 生题 · 定制卷 |
|---|---|---|---|
| ![启动页](docs/screenshots/02-home.png) | ![真题精读](docs/screenshots/05-reading.png) | ![作文工坊](docs/screenshots/10-essay.png) | ![AI 生题](docs/screenshots/13-ai-proposition.png) |

> 截图来自 Android 模拟器实测（v5.12.5）。**每个功能的完整顺序截图见 [docs/功能导览.md](docs/功能导览.md)**。

## 三种使用方式（先选一种）

本项目**一份核心代码，三种交付形态**。三端共享全部功能（真题 / 六阶段解析 / 错题 / 生词 / 作文 / AI 出题 / 统计），区别只在**运行环境**与**数据存储**：

| 形态 | 适合谁 | 数据存储 | 怎么启动 |
|---|---|---|---|
| **Web 服务** | 开发者 / 自建服务器 | 外部 MySQL（或 TiDB） | `npm run build && node dist/boot.js` |
| **Windows 桌面版（EXE）** | 普通电脑用户 | 内置 MySQL（自动拉起，零配置） | 下载 EXE 双击即用 |
| **Android 离线版（APK）** | 手机用户 | 内置 SQLite 离线库（免服务器） | 安装 APK 即用 |

> **AI 功能说明**：三端都支持 AI（解析 / 作文 / 出题 / 配图），需要配置 API 渠道。公共版在「设置 → 模型」自行填写；私有版已内置作者渠道（仅本地分发）。

### 方式一：Web 服务（前后端一体，适合自部署）

```bash
# 前置：Node.js ≥ 20、MySQL 8+（须 UTC 时区启动）
cp .env.example .env   # 填 DATABASE_URL、APP_ID、APP_SECRET、ADMIN_PASSWORD
npm ci
npm run build          # 前端 vite build + 后端 esbuild → dist/boot.js
NODE_ENV=production node dist/boot.js   # 单进程：静态站点 + tRPC + 自举迁移
```

打开 `http://localhost:3000` 即用。首次启动自动：建表（幂等迁移）→ 种子数据（SOP 条款/真题语料）→ 管理员账号（`ADMIN_PASSWORD` 可覆盖，否则打印随机密码）。

> 数据库与时区细节见 [docs/部署指南.md](docs/部署指南.md)。

### 方式二：Windows 桌面版（EXE）

从 [Releases](https://github.com/XDHRY/kaoyan-reading-app/releases) 下载 `kaoyan-5.12.5-win.exe`（便携版）或 `kaoyan-5.12.5-setup.exe`（安装版）：

1. 双击运行——首次启动会自动拉起**内置 MySQL**（需本机已装 MySQL 8，或设置 `KYSOP_MYSQL_BIN` 指向 mysqld.exe）
2. 浏览器自动打开本地服务页面，功能与 Web 版一致
3. AI 功能在「设置 → 模型」配置渠道（公共版需自填）

> 桌面版打包细节见 [docs/开发指南.md](docs/开发指南.md)。

### 方式三：Android 离线版（APK）

从 [Releases](https://github.com/XDHRY/kaoyan-reading-app/releases) 下载 `kaoyan-5.12.5-android.apk` 安装到手机：

1. 安装即用，**无需服务器、无需网络**（内置 SQLite 离线库与全部真题）
2. 全部本地功能可用；AI 功能需联网并在「设置 → 模型」配置渠道（公共版自填）
3. 完整功能界面见 [docs/功能导览.md](docs/功能导览.md)（APK 实测截图）

---

## 交付物与隐私（重要）

本项目提供**公共版**与**私有版**两种交付物，二者在密钥处理上严格分离：

| 交付物 | 是否内置密钥 | 使用方式 |
|---|---|---|
| 公共版 APK / EXE | **不含任何密钥** | 任何人可下载使用；AI 功能需在应用内「模型管理」自行填写 API 渠道（名称 / Base URL / Key / 模型） |
| 私有版 APK / EXE | 内置作者渠道密钥 | 仅通过本地/私密渠道直接交付，**绝不上传 GitHub** |

**隐私红线**：GitHub Releases 只发布公共版；任何包含真实 API 密钥的构建产物（私有版）都不会出现在公开仓库或 Release 中。公共版无密钥也可使用全部本地功能（真题 / 错题 / 生词 / 统计 / 跟我练），仅 AI 生成类功能需先配置渠道。

## 功能总览

| 模块 | 说明 |
|------|------|
| 真题练习 | 真题库逐篇作答，官方答案优先判分（无官方答案时 AI 降级并标注） |
| 六阶段解析 | 审题 → 定位 → 解题 → 校验 → 解析 → 归档，全程可暂停/继续/停止/断点重试，25 分钟总时限 + 僵尸任务自动识别 |
| 长难句拆解 | 点击句子原位展开「主干 + 意群串联·考场顺读法」拆解面板，不丢阅读位置 |
| 联想图 | 可选生成全文景象联想图 / 核心词汇连锁图（与判分解耦） |
| 跟我练 | 逐题参与式解题（先定位、再解题、逐题对答案） |
| 错题本 | 错因六分法 + AI 诊断洞察 + 练习建议 + 重练/标记掌握 |
| 生词本 | 阅读点选加词、释义、熟悉度分级、词汇配图 |
| AI 生题 | 按主题/难度生成模拟阅读，历史留存，可编复盘定制卷 |
| 作文工坊 | 接力引导 / 一气呵成双模式 + 按批改意见逐段进化 + 个人素材库 |
| 统计 | 练习量/正确率/近 7 天/题型分布，真题与 AI 生题分源统计 |
| 渠道中台 | 多渠道多模型绑定（个人覆盖 > 全站绑定 > 默认回落）、路由地图透查、连通自检 |
| 沉浸/深色 | `⛶` 沉浸模式快捷键、深色模式一键切换 |
| 工单反馈 | 全站反馈印（截图 + 附带前端报错）→ 工单全流程 → 公告中心 |
| 管理台 | 用户管理、全站渠道、全局设置、SOP 条款、工单回复、公告发布 |
| 数据出口 | 一键导出全量 JSON 备份，可导入恢复 |

完整操作说明见 [docs/使用手册.md](docs/使用手册.md)，功能截图见 [docs/功能导览.md](docs/功能导览.md)。

## 文档索引

| 文档 | 面向 | 内容 |
|------|------|------|
| [docs/使用手册.md](docs/使用手册.md) | 使用者 | 注册登录 → 真题练习 → 六阶段解析 → 错题/生词/AI 生题/作文/统计 → 设置与常见问题 |
| [docs/功能导览.md](docs/功能导览.md) | 所有人 | **每个功能的顺序截图**（APK 实测，图文版上手导览） |
| [docs/API 概览.md](docs/API 概览.md) | 开发者/集成 | 全部 tRPC 端点（公开 14 / 私有 98 / 管理 15）+ zod 边界表 + 越权与隔离 |
| [docs/架构说明.md](docs/架构说明.md) | 开发者 | 请求链路/数据库/流水线/渠道中台/安全设计 |
| [docs/开发指南.md](docs/开发指南.md) | 开发者 | 环境搭建、构建迁移、编码方法论（PonyTAIL）、提交规范、版本回退 |
| [docs/测试指南.md](docs/测试指南.md) | 开发者 | 套件清单、运行命令、覆盖矩阵、新增断言规范、限流踩坑 |
| [docs/部署指南.md](docs/部署指南.md) | 运维 | 生产部署（Docker/进程/时区/环境变量） |
| [AGENTS.md](AGENTS.md) | AI/新人 | 项目约定速查（红线/目录/方法论） |
| [CHANGELOG.md](CHANGELOG.md) | 所有人 | 版本历史（每版对应 `verifier/runs/` 验收记录） |

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
docs/               本文档体系
```

## 加一个新模块的标准动作（六步）

1. `db/schema.ts` 加表 → `npx drizzle-kit generate --name xxx`（启动时幂等应用，老部署自愈）
2. `api/xxxRouter.ts` 用三级守卫写接口，`router.ts` 注册一行；共享横切能力放 `api/lib/`
3. `src/pages/XxxPage.tsx` 用 `components/ink` 设计系统搭页，`App.tsx` + `Layout.tsx` 接路由/导航
4. 契约（枚举/常量）放 `contracts/`，前后端同源，禁止各自硬编码
5. 测试套件追加断言（见 [docs/测试指南.md](docs/测试指南.md)），全绿后才算完成
6. `verifier/vN/CRITERIA.md` 写验收标准，`runs/` 记录本轮结果

## 设计红线（历任迭代的共识）

- **只加不改**：新功能复用既有载体（如定制卷复用 generatedSets），不动既有判分路径
- 判分唯一基准是官方答案（`officialOf`），AI 答案仅降级参考
- 密钥只存服务端（DB/env），前端只见掩码；密码只存 scrypt 加盐哈希；渠道 baseUrl 强制 https 且禁内网（防 SSRF，22 变体实测）
- 认证三级守卫：写库/算力一律 private，userId 从 session 取（防 IDOR）
- 真题语料仅供个人学习，不做公开分发；`.env` 永不打包
- 任务生命周期：僵尸清扫 + 心跳 + 25 分钟总时限 + 断点续跑
- 古风契约：7 个 CSS 变量、rounded-[2px]、无图标库、Seal/BrushTitle/meta-label 微文案
- **编码方法论**：PonyTAIL 懒惰阶梯（YAGNI → 复用 → 标准库 → 最小代码），详见 [docs/开发指南.md](docs/开发指南.md)

## 测试

套件脚本已入库（`verifier/v1/`），对本地 3000 端口服务直接运行；边界套件不触发真实 LLM，可随时全量跑：

```bash
cd verifier/v1
PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python test_v5_api.py       # 核心 API 回归 76 项
PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python test_boundary_v6.py  # 边界冲刺 137 项（认证矩阵/zod/SSRF/并发/隔离）
PYTHONUTF8=1 PYTHONIOENCODING=utf-8 python verify_extra.py      # 补充验收 40 项
```

门禁：`npm run check`（tsc）+ `npm run lint`（eslint）+ `npm run build` 三绿。LLM 依赖用例需先配置真实渠道密钥；前端冒烟（`smoke_v5.py`）需 Playwright。完整说明见 [docs/测试指南.md](docs/测试指南.md)，历史验收记录见 `verifier/runs/`。

## 完整数据库快照

`db/dump.tar.gz` 是本仓库配套的全量数据库快照（30 张表、2763 行全部内容数据，含 AI 生成配图；`__drizzle_migrations` 由自举迁移自身管理，不在快照内）。渠道 API key 与账号口令已脱敏（`sk-REDACTED-*` 占位），在自己环境重新配置即可。

```bash
cp .env.example .env           # 填好 DATABASE_URL（空库）
npm ci && npm run build
NODE_ENV=production node dist/boot.js   # 首次启动自动建表（迁移幂等，起服务后 Ctrl+C 亦可）
tar -xzf db/dump.tar.gz                 # 解出 db/dump_parts/ 分片
node scripts_restore_dump.mjs           # 导入全量数据（追加模式，只对空库执行；ISO 时间自动转 MySQL 格式）
```

## 版本与回退

- 版本历史：CHANGELOG.md；每个版本对应 `verifier/runs/` 验收记录。
- 回退：`git checkout v5.10.0`（或任意 commit SHA），详见 [docs/开发指南.md](docs/开发指南.md) 第六节。

## 数据与版权声明

- **真题语料**：本仓库内置的真题与题库数据**仅供个人学习研究使用**，禁止任何形式的商业使用与再分发；真题版权归原始版权方所有。
- **数据库快照**（`db/dump.tar.gz`）：含脱敏后的示例数据（账号口令已脱敏，渠道密钥为 `sk-REDACTED-*` 占位），仅用于功能演示与开发测试，**不包含任何真实用户隐私**。
- **渠道密钥**：API 密钥不会随代码、镜像或标准版 APK 发布；部署后请在「设置 → 渠道管理」自行配置。
- 仓库代码以 [LICENSE](LICENSE)（MIT）授权；**数据与语料不随代码许可分发**，用途以上述条款为准。
