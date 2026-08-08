# API 概览（纸上功夫 · tRPC 端点清单）

本文档面向**开发者与集成方**：列出全部 tRPC 端点、权限等级、输入约束（zod 边界），以及错误码约定。数据来源：`api/*.ts` 源码 + `verifier/v1/test_boundary_v6.py` 的认证矩阵与边界断言（v5.11 实测通过）。

## 一、调用方式

- 协议：HTTP POST → `/trpc/<router>.<procedure>?input=<json>`（标准 tRPC HTTP 调用，`verifier/v1/trpc_call.py` 有参考实现）。
- 认证：`Authorization: Bearer <jwt>`；登录/注册返回 `{ token }`。
- 权限分三级：`public`（游客可访问）/ `private`（需登录，userId 一律从 session 取，忽略客户端传值）/ `admin`（需管理员）。
- 错误：HTTP 400（zod 校验失败）、401（未登录）、403（无权限）、404/500（业务/服务器错误）；业务错误消息为中文，可直接展示。

## 二、权限矩阵总览

| 等级 | 数量 | 说明 |
|------|------|------|
| public（游客可用） | 14 | 浏览类只读 + 注册登录（见下） |
| private（需登录） | 98 | 写库/消耗算力/个人数据（完整清单见下） |
| admin（需管理员） | 15 | 用户管理/全站渠道/公告/SOP 编辑 |

边界测试已固化：**98 个私有端点游客访问 → 全部 401；15 个管理端点游客 → 401、普通用户 → 全部 403**（`test_boundary_v6.py` A 组）。

## 三、公开端点（public，14 个）

| 端点 | 类型 | 说明 |
|------|------|------|
| `ping` | query | 健康检查 |
| `auth.register` | mutation | 注册（name/password/recoveryQuestion/recoveryAnswer） |
| `auth.login` | mutation | 登录（name/password） |
| `auth.me` | query | 当前用户（未登录返回 null） |
| `auth.siteInfo` | query | 站点信息/公告 |
| `auth.logout` | mutation | 登出 |
| `knowledge.list` | query | 知识卡片列表 |
| `knowledge.byNode` | query | 按节点查知识卡片 |
| `passage.list` | query | 真题列表 |
| `passage.detail` | query | 真题详情（含题目） |
| `user.list` | query | 用户列表（仅安全字段） |
| `ticket.notices` | query | 公告列表 |
| `method.clauses` | query | SOP 条款 |
| `agent.analysisList` | query | 解析档案列表（带 kind/passageId 输入；登录后含个人数据） |

## 四、私有端点（private，98 个）

> 一律要求登录；以下按业务域分组。标记 `*` 的为常见高频端点。

### auth（账号）
`auth.changePassword`(m)、`auth.changeRecovery`(m)、`auth.updateProfile`(m)、`auth.exportData`(q)、`auth.deleteAccount`(m)

### channel（渠道中台）
`channel.list`(q)、`channel.create`(m)、`channel.update`(m)、`channel.remove`(m)、`channel.fetchModels`(m)、`channel.addModel`(m)、`channel.test`(m)、`channel.selfCheck`(m)、`channel.listBindings`(q)、`channel.setBinding`(m)、`channel.removeBinding`(m)、`channel.setBindings`(m)、`channel.routeMap`(q)、`channel.resolve`(q)

### prompt（提示词）
`prompt.list`(q)

### agent（解题官/流水线）
`agent.startPipeline`(m)、`agent.pipelineStatus`(q)、`agent.activeJob`(q)、`agent.getPref`(q)、`agent.setPref`(m)、`agent.history`(q)、`agent.retryPipeline`(m)、`agent.pausePipeline`(m)、`agent.resumePipeline`(m)、`agent.cancelPipeline`(m)、`agent.analyzeStructure`(m)、`agent.analyzeQuestions`(m)、`agent.locate`(m)、`agent.solve`(m)、`agent.saveResult`(m)、`agent.stats`(q)、`agent.recordsByPassage`(q)、`agent.generate`(m)、`agent.generatedPractice`(m)、`agent.generatedList`(q)、`agent.generatedDetail`(q)、`agent.revealOfficialAnswers`(q)、`agent.diffStatus`(q)、`agent.diffAnalysis`(m)

### essay（作文工坊）
`essay.list`(q)、`essay.detail`(q)、`essay.save`(m)、`essay.remove`(m)、`essay.startDraft`(m)、`essay.confirmOutline`(m)、`essay.generateParagraph`(m)、`essay.reviseOutline`(m)、`essay.generateAll`(m)、`essay.reviseParagraph`(m)、`essay.confirmParagraph`(m)、`essay.finishDraft`(m)、`essay.draftStatus`(q)、`essay.removeDraft`(m)、`essay.draftList`(q)、`essay.review`(m)、`essay.materialList`(q)、`essay.materialSave`(m)、`essay.materialRemove`(m)

### export（备份恢复）
`export.fullBackup`(q)、`export.importBackup`(m)

### insight（错题洞察）
`insight.getAnalysis`(q)、`insight.analyze`(m)、`insight.analyzeBatch`(m)、`insight.saveAnalysis`(m)、`insight.errorTypeStats`(q)、`insight.recommend`(m)、`insight.getRecommendation`(q)、`insight.practiceProblems`(q)、`insight.insightList`(q)、`insight.insightSave`(m)

### interactive（跟我练）
`interactive.availability`(q)、`interactive.history`(q)、`interactive.stepQuestion`(q)、`interactive.stepLocate`(q)、`interactive.stepSolve`(q)、`interactive.finish`(m)

### vocab（生词本）
`vocab.list`(q)、`vocab.lookup`(m)、`vocab.setFamiliarity`(m)、`vocab.image`(m)、`vocab.remove`(m)

### wrong（错题本）
`wrong.list`(q)、`wrong.retry`(m)、`wrong.unmaster`(m)、`wrong.remove`(m)

### retro（复盘定制卷）
`retro.forRecord`(q)、`retro.create`(m)

### ticket（工单）
`ticket.create`(m)、`ticket.myList`(q)、`ticket.detail`(q)、`ticket.reply`(m)、`ticket.close`(m)

### method（拆句/联想图）
`method.parseSentence`(m)、`method.assocImage`(m)

## 五、管理端点（admin，15 个）

| 端点 | 类型 | 说明 |
|------|------|------|
| `admin.overview` | query | 管理台总览 |
| `admin.listUsers` | query | 用户列表 |
| `admin.updateUser` | mutation | 修改用户（role/avatarChar/name 等） |
| `admin.resetUserPassword` | mutation | 重置用户密码 |
| `admin.resetUserRecovery` | mutation | 重置用户密保 |
| `admin.viewUserData` | query | 查看用户数据 |
| `admin.clearUserData` | mutation | 清空用户数据 |
| `admin.deleteUser` | mutation | 删除用户 |
| `admin.getSettings` | query | 全局设置读取 |
| `admin.setSetting` | mutation | 全局设置写入 |
| `admin.updateClause` | mutation | 编辑 SOP 条款 |
| `ticket.adminList` | query | 工单列表（管理员） |
| `ticket.adminReply` | mutation | 工单回复 + 改状态 |
| `ticket.publishNotice` | mutation | 发布公告 |
| `ticket.removeNotice` | mutation | 下架公告 |

## 六、zod 输入边界表（v5.11 实测）

> 命中即 HTTP 400；「合法边界通过」项说明恰好在 min/max 上可以成功（防过严误杀）。

| 字段 | 约束 | 实测用例 |
|------|------|---------|
| 昵称 name | 1~32 字 | B1 33 字→400；B2 空→400；B11 33 字→400 |
| 密码 password | 6~64 位 | B3 5 位→400；B4 65 位→400 |
| 密保问题 recoveryQuestion | ≥2 字 | B5 1 字→400 |
| avatarChar | ≤4 字 | B6/B12 5 字→400 |
| 渠道 name | ≤64 字 | B13 65 字→400 |
| 渠道 kind | 枚举 `chat` / `image` | B14 `foo`→400 |
| 渠道 protocol | 枚举 `openai` / `anthropic` | B15 `foo`→400 |
| 渠道 baseUrl | 合法 URL + `https://` + 非内网 | B16 `notaurl`→400；C 组 22 变体 |
| temperature | 0~2 | B17 2.1→400；B18 -0.1→400 |
| maxTokens | 正整数 | B19 0→400 |
| timeoutSec | 1~600 | B20 601→400 |
| retries | 0~5 | B21 6→400 |
| reasoningEffort | 枚举 | B22 `foo`→400 |
| 全站渠道 | 仅管理员 | B23 普通用户建→业务拒绝 |
| 渠道 model | 1~128 字 | B24 空→400；B25 129 字→400 |
| 工单 title | 2~128 字 | B27 1 字→400；B28 129 字→400 |
| 工单 content | 2~4000 字 | B29 1 字→400；B30 4001 字→400 |
| 工单 kind | 枚举 `bug`/`suggest`/`question`/`other` | B31 `foo`→400 |
| 工单 attachments | ≤3 个 | B32 4 个→400 |
| 附件 dataBase64 | ≤600KB | B33 600001 字符→400 |
| 工单 consoleErrors | ≤5 条 | B34 6 条→400 |
| 工单回复 content | ≥1 字 | B35 空→400 |
| 生词 word | 1~64 字 | B36 空→400；B37 65 字→400 |
| familiarity | 0~2 | B38 -1→400；B39 3→400 |
| 作文 prompt | 1~4000 字 | B41 空→400；B42 4001 字→400 |
| 作文 essayType | 枚举 | B43 `foo`→400 |
| 作文 title | ≤128 字 | B44 129 字→400 |
| 作文 startDraft prompt | ≥10 字 | B45 9 字→400 |
| 作文素材 content | ≤10000 字 | B46 10001 字→400 |
| 作文素材 kind | 枚举 `template`/`sentence`/`note`/`model`/`vocab` | B47 `foo`→400 |
| 洞察 content | ≤10000 字 | B48 10001 字→400 |
| 洞察 errorType | ≤24 字 | B49 25 字→400 |
| 洞察 status | 枚举 | B50 `foo`→400 |
| analyzeBatch wrongIds | 1~50 个 | B51 空数组→400；B52 51 个→400 |
| practiceProblems limit | 1~20 | B53 0→400；B54 21→400 |
| 跟我练 myAnswer | A~D | B55 `E`→400 |
| 跟我练 myReflection | ≤500 字 | B56 501 字→400 |
| 跟我练 kind | 枚举 `exam`/`generated` | B57 `foo`→400 |
| 生题 topic | ≥1 字 | B58 空→400 |
| 生题 difficulty | 枚举 | B59 `foo`→400 |
| getPref key | ≤64 字 | B60 65 字→400 |
| setPref value | ≤255 字 | B61 256 字→400 |
| diffAnalysis 答案 | A~D | B62/B63 `E`→400 |
| 复盘 kind | 枚举 `exam`/`generated` | B64 `foo`→400 |
| 复盘 selfNote | ≤2000 字 | B65 2001 字→400 |
| importBackup strategy | 枚举 | B66 `foo`→400 |
| importBackup backup | 对象 | B67 字符串→400 |
| admin.updateUser role | 枚举 | B68 `foo`→400 |
| admin.updateUser avatarChar | ≤4 字 | B69 5 字→400 |
| admin.updateUser name | ≤32 字 | B70 33 字→400 |
| admin.setSetting k | 1~64 字 | B71 空→400；B72 65 字→400 |
| admin.setSetting v | ≤2000 字 | B73 2001 字→400 |
| admin.updateClause title | ≤64 字 | B74 65 字→400 |
| adminReply status | 枚举 | B75 `foo`→400 |
| 公告 title | ≥2 字 | B76 1 字→400 |
| 公告 content | ≥2 字 | B77 1 字→400 |

## 七、越权与隔离（实测）

- 越权拦截：改他人渠道→「无权修改该渠道」；评/删他人作文→拒绝（B78/B79）；渠道个人绑定只对自己可见。
- 数据隔离（I 组）：用户 B 无法读/改用户 A 的 essay/ticket/vocab/wrong/personal 渠道。
- SSRF（C 组）：内网/回环 20 变体（IPv4 点分/十进制/hex、IPv6 回环/链路本地、映射地址、尾点、大小写）全拦截；公网 IPv4/IPv6 正常放行；`channel.update` 改 baseUrl 同样校验。
