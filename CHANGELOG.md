# 更新日志（CHANGELOG）

本项目遵循「纸上功夫·精进」的迭代节奏：每个版本先有方案（`verifier/PLAN_*.md`），再有实现，最后有验收记录（`verifier/runs/`）。本文件汇总各版本的核心变更，细节可回溯到对应方案与验收记录。

版本号规则：`v5.x` 为功能版本，每个功能版本必须全量回归 + 部署模拟通过才算交付。

---

## v5.11 — 2026-08-08（安全加固 · 排序内存修复 · 边界测试 137 项 · 文档体系补全）

对应验收：`verifier/runs/20260808_v511.md`

- **SSRF 防护加固（安全）**：`channelRouter.assertSafeBaseUrl` 拦截 6 类此前可绕过的内网变体——`[::1]`、`[0:0:0:0:0:0:0:1]`、`[::ffff:127.0.0.1]`（及 Node URL 规范化的 hex 映射如 `[::ffff:7f00:1]`）、链路本地 `[fe80::1]`、尾点 `localhost.`；判定逻辑统一为「去方括号 + 去尾点」后再做 IPv6 回环 / `fe[89ab]:` 前缀 / IPv4 映射段（hex 解码）检查。实测 20 种内网变体全拦截、公网（IPv4/IPv6/172.32.0.1）正常放行。
- **analysisList 排序内存修复（缺陷）**：`ORDER BY created_at` 叠加 SELECT 大 JSON `payload` 列触发 MySQL filesort 溢出，19 行数据即 500「Out of sort memory」。修复：`analyses` 表新增复合索引 `idx_analyses_source_ref_created(source, passageId, createdAt)`（迁移 0006，启动幂等应用）。
- **边界测试 137 项**：新增 `verifier/v1/test_boundary_v6.py`，9 大域覆盖——A 认证矩阵（98 私有端点游客 401 + 15 管理端点 401/403）、B zod 边界 81 项、C SSRF 22 变体、D 并发/幂等、E 降级/空列表、F 异常输入、G XSS/注入、H 合法边界、I 数据隔离；不触发真实 LLM。
- **文档体系补全**：新增 `docs/使用手册.md`（使用者功能导览）、`docs/测试指南.md`（套件清单/运行命令/覆盖矩阵/新增断言规范）、`docs/API 概览.md`（全部 tRPC 端点 + 权限等级 + zod 边界表）、`docs/开发指南.md`（环境搭建/构建/迁移/回退 + 编码方法论）；`docs/架构说明.md` 补「安全设计」节；`AGENTS.md` 补「编码方法论（PonyTAIL）」节。
- **编码方法论落地**：引入 PonyTAIL 懒惰阶梯（YAGNI → 复用 → 标准库 → 最小代码），本轮修复均遵循「最短 diff、修根因」原则。
- 验收：门禁三绿（tsc/lint/build）+ 全量回归（test_v5_api 76/76、verify_extra 40/40、roleplay 32/32、quality 92/92、流水线全过、边界 137/137）。

---

## v5.9 — 2026-08-05（解题提速 · 拆句提质 · API 设置一目了然）

对应方案：`verifier/PLAN_v58.md` 用户原话要点；验收记录：`verifier/runs/20260805_v59.md`

- **解题超时根治**：流水线 solve 阶段从「批量 5 题一次调用」改为「逐题调用 + `payload.solveParts[qNo]` 每题落库」，实现断点续跑与阶段内心跳；校验官单次复核不重跑。实测 solve 阶段从 382~459s+ 降至 **143~166s**，全程 343s。
- **拆句教练提质**：`SENTENCE_PARSE_FALLBACK` 重写——新增「意群串联·考场顺读法」（3~5 步顺读流程）+ 7 条拆句铁律（禁标点单独成段、冒号后整句保留、主干=最短完整句等）；前端渲染对应区块；旧缓存按新提示词重拆。
- **API 绑定透查**：探针渠道证明个人绑定全链生效（resolve 9 角色 + 拆句 + 流水线 11/11）；修复 agentRouter.solve 校验官漏传 userId、顶栏 ModelSwitcher 未传 personal 等绑定错乱。
- **API 设置界面改造**：新增 `channel.routeMap`（每角色实际路由+来源徽标：个人覆盖/全站绑定/默认回落）与 `channel.setBindings`（批量保存）；绑定面板改为草稿式编辑 + 「保存绑定配置」+「一键套用到全部对话角色」。
- **跟我练键名兼容**：双拼写兼容 `questionAnalysis/locateResult` 与 `qAnalysis/locate`，修复新流水线归档下「可用但无参照」问题。
- 验收：`v59_verify.py` 11/11、`binding_v59.py` 11/11、`apisettings_v59.py` 8/8、`ui_apisettings_v59.py` 14/14、`roleplay_v59.py` 三角色全过、全量回归绿。

## v5.8 — 2026-08-05（阅读体验修复 + 任务可控 + 生图入 SOP + 提示词提质）

对应方案：`verifier/PLAN_v58.md`；验收记录：`verifier/runs/20260805_v58.md`

- **长难句置顶跳转修复**：废弃固定遮罩弹层，改为**原位内联展开**——点击的句子下方就地插入拆解面板（加载/结果/错误三态），再点其他句自动收起上一个，阅读位置感不丢失（scrollY 实测不变）。
- **解析任务卡死可控**：状态机扩展 `running/paused/done/error/cancelled`（迁移 0005）；新增 `pausePipeline`/`resumePipeline`/`cancelPipeline` 端点；执行器每阶段写库前回读控制信号；`pipelineStatus`/`activeJob` 对僵尸 running 做心跳判定（>10min 静止自动转 error）；前端面板增加「⏸ 暂停 / ■ 停止 / ▶ 继续 / 断点重试」。
- **AI 生图脱离 SOP**：废弃「水墨结构图」，重构为两个独立按钮的可选联想图：**全文景象联想图**（提炼 gist+topic+logicFlow 为具象场景）与**核心词汇连锁图**（关键词节点与关系边，因果/对比/递进/例证）；缓存复用 `analyses` 表。
- **AI 生题历史入口**：HistoryPage 生成题行直达 `/generate/set/:id`，恢复解析。
- **统计分源**：`agent.stats` 增加 `bySource`（exam/generated 各自交卷/判分/正确率/近7天/题型分布）；统计页主模块 + 两个子模块卡；个人中心同款三栏。
- **跨段/全篇定位**：`agent_locator` 输出契约扩展 `paraNos[]`（可跨段）、主旨题支持 `scope="全篇"`；定位句允许两句并列；前端兼容多段渲染。
- **三名师提示词提质**：逻辑派（唐迟式：先复述定位句再比对）、定位派（颉斌斌式：逐词对应、范围宁小勿大）、语境派（何凯文式：上下文窗口 ±1 句）；solver 输入改为「定位句+上下文+题干」，methodRefs 降为可选佐证。
- **工单推断调整**：交卷限速 10→30 次/窗（「操作太频繁」×5 工单）；v5.8 致歉公告上线。
- 验收：160+ 项全绿（含真实 LLM `pipeline_v58` 9/0）。

## v5.7 — 2026-08-03（作文全链路根因修复）

验收记录：`verifier/runs/20260803_v57.md`

- 作文模块 6 个漏洞根因修复：guided 缺 invalidate、末段闸门、进化编辑框同步、auto 同路径、批改加厚、短题目校验。
- 草稿丢弃机制；真人级 UI 测试 22/0 + 边界 26/26 + 五套回归全绿。

## v5.6 — 2026-08-03（双模式写作 + 名师提示词）

验收记录：`verifier/runs/20260803_v56.md`

- 作文「假推进」根因修复（容错提取）+ 同类排查 `extractItems`。
- **双模式写作**：接力引导（分步状态机）/ 一气呵成（自动全篇）+ 按批改意见进化。
- 名师提示词提质；52 过 0 挂三角色 + 全量回归绿。

## v5.5 — 2026-08-03（全站前端大排摸）

验收记录：`verifier/runs/20260803_v55.md`

- **反馈印收编**：全局浮动反馈印组件删除，反馈表单内嵌个人中心「反馈与工单」区；学习页面零浮动件。
- 逐页巡检修复：真题库警示复读去重（按年份仅首卡展示）、移动端页脚遮挡（mb-28）、窄屏印章动画禁用、顶栏 14 项减至 12 项（低频管理项移入用户菜单）。
- 双端 17 路由控制台零报错。

## v5.4 — 2026-08-03（第七期公告 · 全站八路审览）

验收记录：`verifier/runs/20260803_v54.md`

- 首页横幅摘要化（72 字截断 + 「公告榜 →」链接）。
- 游客点横幅默认落「公告榜」页签（不再被签到门挡住）。
- 测试套件自清污染公告；服务重启中断量规任务按生命周期设计自动续跑（92/92）。
- 全站八路审览全绿。

## v5.3 — 2026-08-03（工单与公告中心）

验收记录：`verifier/runs/20260803_v53.md`；标准：`verifier/v5/CRITERIA.md`

- 四张新表（`tickets`/`ticket_replies`/`ticket_attachments`/`announcements`）+ 迁移 0004，幂等应用。
- 浮动反馈印（marker.io/ybug 式）：截图客户端压缩 ≤400KB base64 落库，零文件系统依赖；`statusLog` 追加式「处理路线」；公告历期留档 + 首页横幅同步。
- 零新第三方依赖；FAB 仅登录可见。

## v5.2 — 2026-08-03（三角色全功能遍历 + 使用手册）

验收记录：`verifier/runs/20260803_v52.md`；标准：`verifier/v4/CRITERIA.md`

- 三个虚拟角色（小满/老纪/阿筱）全功能遍历 36 断言全绿。
- 使用手册栏目（`/manual`）上线；92 条质量量规回归 92/92。

## v5.1 — 2026-07-31（定制卷 + 跟我练）

- 定制卷（复用 `generatedSets` 载体，只加不改）与「跟我练」参与式解题模式。
- `test_v51_api` 35 断言（定制卷/跟我练）、`smoke_v51` 15 项。

## v5.0 / v1 — 2026-07-30（初版：六阶段解题流水线）

方案文档：`考研传统阅读助手-方案定稿.md`、`考研传统阅读助手-v3方案.md`、`考研阅读助手-v5顶级方案.md`

- React 19 + Vite + Tailwind（水墨古风）前端；Hono + tRPC 11 + Drizzle ORM + MySQL/TiDB 后端。
- **六阶段解题流水线**（审题/定位/解题/校验/解析/归档），LLM 渠道中台（多模型绑定、密钥仅存服务端）。
- 核心功能：真题库（含官方答案优先判分 `officialOf`）、SOP 条款、错题本、生词本、AI 生题、统计、沉浸模式、深色模式、自动草稿。
- 数据库 29 张表 + 幂等迁移 + 种子语料（`db/final_corpus.json`）。
- v5 顶级方案确立 6 大根因修复框架（判分事实源/任务生命周期/错误不静默/认证矩阵/布局/凭证解耦），后续版本按 S0-S10 顺序实施。

---

## v5.10 — 2026-08-08（GitHub 交付 · 时区/构建门禁/快照还原 18 处缺陷修复）

对应验收：`verifier/runs/20260808_v510.md`（含经验总结与回退指引）

- **时区根治（重大）**：drizzle `planetscale` 模式下 TIMESTAMP 按 UTC 解析，会话时区为 +8 的实例会整体偏大 8 小时，导致**僵尸任务心跳判定失效、永不识别**。修复：mysql2 连接显式 `timezone:"Z"`，并要求 MySQL 实例以 UTC 启动（`docker-compose.yml` 与 `docs/部署指南.md` 同步）。
- **依赖镜像源修复**：`package-lock.json` 258 处失效镜像 `npm.mirrors.msh.team` 全部改回官方 `registry.npmjs.org`（否则 `npm ci` 无限重试）。
- **构建门禁清零**：tsc strict（erasableSyntaxOnly/未用变量/类型收窄）与 eslint（行尾全角空格、未用 `eslint-disable` 指令、`any` 窄化）共 17 项问题修复，`npm run check` / `npm run lint` / `npm run build` 三绿。
- **快照还原加固**：`scripts_restore_dump.mjs` 导入前按 `SHOW COLUMNS` 对齐列，跳过 dump 中废弃列；`vocab_items.image` 由 `text` 改为 `longtext`（TEXT 64KB 存不下 4MB base64 配图）；`.gitignore` 排除 `db/dump_parts/`。
- **文档与 CI**：`docs/部署指南.md` 补充 MySQL 必须 UTC 时区；`.github/workflows/ci.yml` 就位并在 push 全绿。

---

## 已知环境依赖

- 验收测试脚本已入库（`verifier/v1/` 起，`trpc_call.py` + `test_v5_api.py` + `verify_extra.py` 等），本地起服务后可直接运行；LLM 依赖用例（B9-B11/C 组）需在「设置 → API 设置」配置真实渠道密钥。历史运行记录见 `verifier/runs/`。
- 本仓库随附全量数据库快照 `db/dump.tar.gz`（30 张表、2763 行内容数据，渠道 API key 与账号口令已脱敏），用于全新部署还原与回归基线。
