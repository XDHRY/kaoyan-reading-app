# 贡献指南（Contributing）

欢迎参与「考研传统阅读助手」的贡献！任何改进——修 bug、加功能、补文档、写测试——都欢迎。

## 快速开始

```bash
git clone https://github.com/XDHRY/kaoyan-reading-app.git
cd kaoyan-reading-app
cp .env.example .env   # 填 DATABASE_URL、APP_ID、APP_SECRET、ADMIN_PASSWORD
npm ci
npm run build
NODE_ENV=production node dist/boot.js   # http://localhost:3000
```

## 提 Pull Request 前

1. **先讨论再写码**：较大改动先开 issue 说明动机与方案，避免白干。
2. **遵循项目约定**：见 [AGENTS.md](AGENTS.md)（设计红线、目录结构）与 [docs/开发指南.md](docs/开发指南.md)（PonyTAIL 方法论、提交规范）。
3. **通过门禁**：`npm run check`（tsc）+ `npm run lint`（eslint）+ `npm run build` 三绿；涉及行为变更需追加测试（见 [docs/测试指南.md](docs/测试指南.md)）。
4. **提交信息**：`类型(scope): 短语`，如 `fix(scripts): 修复 lint 错误`、`feat(api): 新增导出接口`。
5. **只加不改**：复用既有载体，不动既有判分路径（设计红线第一条）。

## Issue 规范

- Bug 请附：复现步骤、预期/实际行为、环境（Node 版本、系统）、相关日志。
- 功能建议请说明：场景、期望、可接受的取舍。
- 敏感信息（密钥、账号）请走 [SECURITY.md](SECURITY.md) 的私有通道，不要贴进 issue。

## 行为准则

请保持友善、就事论事。本项目使用 [Contributor Covenant](https://www.contributor-covenant.org/) 精神准则：包容、尊重、无骚扰。
