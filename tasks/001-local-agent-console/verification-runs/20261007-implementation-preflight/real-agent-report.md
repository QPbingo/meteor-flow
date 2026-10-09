# 真实 Agent 链路专项

状态：blocked，未执行真实模型任务。日期：2026-10-07。适用：本机 herdr 0.9.3、Codex CLI 0.160.1、Claude Code 2.1.195。不得将本记录记为真实 Codex/Claude 集成通过。

## 准备与范围

沿用本会话已加载的 capture-constraints、meteor-flow-verification、test-master（集成测试引用）、OCR 委托。R-002 核对目标 Node 24.21.0、Vitest 3.2.7；只读命令核对 herdr/Codex/Claude 版本。认证检查仅保留 Codex 已有认证、Claude OAuth loggedIn=true；不记录认证值或用户账户信息。没有复制认证文件或更改用户设置。

已新增 `tests/integration/real-agent.test.ts`，默认不执行，只有显式设置 `METEOR_FLOW_REAL_AGENTS=1` 才会运行。每种 agent 使用专属临时 XDG、herdr session 和 cwd；Claude 使用新 CLAUDE_CONFIG_DIR，原 Codex/Claude 配置文件被只读沙箱保护并在运行前后比对哈希。该测试不会输入信任、登录、权限、更新确认，遇到这些步骤记录 blocked。

脚本首先验证真实 herdr 启动、版本/协议、agent 类型、cwd、交互准备和唯一进程身份；准备完成后使用真实 AgentConsole、SQLite、collector 派发单一小任务：仅在专用 cwd 创建内容为 `meteor-flow-real-agent-ok` 的 hello.txt 并交付结构化结果。成功断言覆盖 task/attempt 关联、只创建一次 attempt、工作状态证据、释放占用、归档内容与哈希。任务不需要浏览网页、发消息或访问用户现有项目。

六类场景：状态迁移与时序检查从真实启动/工作到结果归档；幂等检查只有一个 attempt，全面竞态由核心测试覆盖；恢复在本专项不主动杀断模型会话（核心恢复测试单独执行）；关联验证 task/attempt 和归档；隔离验证专用目录、session、受保护配置与清理。没有将这些预定断言写为已执行。

## 当前证据与阻塞

- `pnpm typecheck` 退出 0。
- 未设置 opt-in 时，Vitest 正常加载文件，2 个真实用例均 skipped，退出 0；这只验证开关，不是集成通过。
- 实际 opt-in 执行申请在创建进程前被 automatic approval review 拒绝，完整拒绝摘要见 `real-agents-approval.log`。没有运行替代命令绕过拒绝，没有发送模型任务。

审批系统指出真实认证模型调用可能向外部服务发送提示词/元数据并产生费用，认为当前一般实施授权不足以覆盖本次外部调用和目的地。已通知根 agent；需要用户明确授权后再按同一测试路径运行。准备给模型的实际任务内容已固定在测试文件，可审阅。没有新增需求或修改用户权限设置。

真实 herdr 空 session 的 ping、list、subscribe 已在先前 herdr 专项通过，见 `herdr-test-final.log`；这不证明真实模型启动、prompt、结果交付或终端交互通过。新测试尚待独立审查，不能宣布验收就绪。
