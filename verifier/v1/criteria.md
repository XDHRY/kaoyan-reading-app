# v5.8 验收标准 v1（2026-08-05）
1. 长难句点击后 scrollY 不变、面板原位展开于被点句下方（浏览器实测）
2. 任务控制：暂停/继续/停止/重试/关闭全链路；僵尸 running 自动终结（pipelineStatus+activeJob）
3. 联想图：scene/vocab 两按钮可选生成，提示词含精确元素与关系，缓存二次秒回，失败有降级与重试
4. AI 生题历史：学习档案行直达 /generate/set/:id 并恢复解析
5. stats.bySource 与 practice_records 对账一致；统计页+我的页三模块渲染
6. 定位契约：paraNos 数组 + matchedTerms；主旨题全篇；解题官收到上下文窗口并产出 locateParaphrase/logicChain
7. 全量回归 + 真实 LLM 流水线一篇验证新字段
