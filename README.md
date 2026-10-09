# Meteor Flow

基于 herdr 的本地 Web 多 Agent 控制台。使用 Node.js 24、TypeScript、Fastify、SQLite 和 React，支持项目、指定 Agent 的任务队列、简单依赖、人工终端接管和结果归档。

首版面向 macOS arm64；herdr 兼容范围为 0.9.0 / 0.9.3（协议 22）。需求和技术方案已确认，用户已授权实现。主要能力已实现，并完成多轮独立审查与修复。本轮 Codex、Claude 固定任务真实链路均已验证，兼容修复与测试保护已完成独立审查；人工验收 pending。实际分层结果与覆盖边界见[验证状态](tasks/001-local-agent-console/verification-status.md)。

## 本机运行

准备 Node **24.21.0**（见 `.node-version`）、pnpm **11.9.0**，以及已启动的 herdr 会话。在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm build
herdr session list --json
pnpm start -- serve --session <会话名>
```

打开启动终端打印的本机链接。再次打开可执行 `pnpm start -- open`。服务仅监听 `127.0.0.1`，默认端口 `4317`，数据保存在 `~/Library/Application Support/Meteor Flow`。使用自定义数据目录时，`serve` 和 `open` 都传入相同的 `--data-dir`。

详细步骤、结果文件协议、故障恢复和真实测试开关见[使用与开发说明](tasks/001-local-agent-console/usage.md)。

## 文档入口

- [已确认需求与 V01—V29 验收场景](tasks/001-local-agent-console/requirements.md)
- [需求 review](tasks/001-local-agent-console/review.md)
- [已确认 Node 技术方案](tasks/001-local-agent-console/technical-design.md)
- [技术方案独立审查](tasks/001-local-agent-console/technical-review.md)
- [实现计划与验收映射](tasks/001-local-agent-console/implementation-plan.md)
- [实现进度](tasks/001-local-agent-console/implementation-progress.md)
- [herdr 接口事实和兼容边界](tasks/001-local-agent-console/herdr-compatibility.md)
- [界面设计约定](tasks/001-local-agent-console/DESIGN.md)
- [开发工作流](tasks/002-development-workflow/workflow.md)
- [Skills 前置条件](tasks/002-development-workflow/skill-prerequisites.md)
- [六类强制场景](tasks/002-development-workflow/mandatory-scenarios.md)

需求、方案、决策和验证证据统一放在 `tasks/`；协作规则见 [AGENTS.md](AGENTS.md)。
