# 实体测试诊断与修订记录

日期：2026-10-08。状态：诊断已证实、测试修订已完成，最终执行结果以各 JSON 为准。适用：独立 herdr 0.9.3 / Codex 0.160.1 / Claude 2.1.195 测试，不扩大产品自动操作权限。

## 原始失败保留

- `tests.log`：普通测试首次缺少 Chromium 路径，227 pass / 1 fail / 5 skip；设置项目已安装浏览器路径后 `tests-runtime.log` 230 pass / 5 opt-in skip。无产品修复用于这次环境失败。
- `e2e.log`：裸 Playwright 入口误扫描 Vitest 文件。修复 package.json 的 test:e2e 入口为 `playwright test tests/e2e --workers=1` 后，`e2e-runtime.log` 14/14。此前汇总报告所写裸 Playwright 命令不准确，不以历史日志证明该裸命令通过。
- `real-agents.log`：Codex 产品真实链路通过；Claude 在投递后被宽泛更新正则拦截。Vitest exit 0 包含 skipped，不能写成两 Agent 通过。
- `claude-screen-probe.log` 与 `claude-screen-probe/real-agent-claude.json`：在独立会话只启动 Claude、读取屏幕，不创建任务或发送按键。捕获确切被动通知 `Update available! Run: brew upgrade claude-code`。证据仅保留通知相关行和屏幕哈希，不声称保留完整屏幕。临时诊断源码存为 txt，执行文件已删除。
- helper 只排除 trim 后完全相同的被动通知整行，仍检查附近更新菜单/审批/信任。独立 reviewer 通过本机 CLI 内嵌组件核对其纯文本语义，并发现 Claude 的 `Updating via homebrew…` / `Updating…` 正在更新分支原先未拦截；已补整行阻断与实际 prompt=0 回归，原失败证据保留。
- `real-claude-footer.log`：confirm 后出现 `agent.observed=unknown`，automatic 明确 NOT_READY 拒绝；没有 task、attempt 或模型输入，配置哈希一致。产品拒绝是正确的；真实测试此前假设初次 idle 会一直持续。
- 测试现于创建任务前最多等待 10 秒；每轮核对原确认身份和无 attempt、检查屏幕，仅重试明确 NOT_READY 的事务拒绝，复用同 operation ID。其他错误立即停止，不重复 confirm，不重试 prompt。此等待并不改变产品规则或自动批准外部提示。

## 场景与技能

复用 capture-constraints R-002：已确认本任务只有本机目标，无线上部署；运行时版本以本轮真实 JSON 与构建日志为准。R-001 小黑盒搜索不适用。项目 verification、test-master、OCR 均已完整加载与运行；沿用本会话已加载 Playwright/Impeccable，浏览器14项实跑，UI源码不变。新改动限测试 harness，不触发新需求或技术选型审批。

六类场景：状态迁移（通知/正在更新/就绪拒绝）；幂等（相同 automatic operation ID、prompt不重试）；时序（实际发送边界再查屏，挂起读取时 stop 保持关闭）；恢复（读取失败和阻断后保持封闭，不自动解除）；关联（同 target/pane、原 confirmed fingerprint、无已有 attempt）；隔离（独立 session/cwd/DB，仅清理自建资源，配置哈希核对）。回归关联 R03/R04/R10/R12、V01/V06/V07/V19/V24；屏幕解析只约束已授权测试，不添加产品自动审批能力。

## 新 shell 的瞬间状态变化

`real-claude-ready.log` / `real-agents-ready/real-agent-claude.json` 保存单次 agent.start 收到 agent_pane_busy；调用尚未进入任务阶段，没有 tasks/attempts，finally 清理本次会话，配置哈希未变。禁止把这一原始失败改写为成功。

本机锁定 v0.9.3 源码 `/tmp/meteor-flow-upstream-20261006/herdr-v0.9.3/src/platform/mod.rs` 的 available_pane_shell_from_job 与应用 waitForShell 要求一致：前台组为 shell PID、唯一前台成员是 shell、名称支持。`src/app/agents.rs` 在发送输入之前重新检查 available_shell_name，忙时返回 agent_pane_busy。跨进程查询和输入不是原子操作，已有等待不能保证下一瞬间依然空闲；此证据不证明具体是哪一启动子进程导致拒绝。适配器继续保留 uncertain + 已知 target，不自动重发或重建 workspace，正常业务有既定人工核对出口。此为已确认不确定启动与上游原子性边界，不通过改变身份校验、自动重试启动或将其吞掉来换取绿灯。

另一个全新隔离会话仅验证正常小任务路径；它通过也不消除这一真实拒绝记录或证明每次启动必然成功。

## 连续就绪 gate

`real-claude-final.log` / `real-agents-final/real-agent-claude.json`：接入成功、创建意图后最终 refresh 再次观测 unknown，产品正确将 dispatch 标记 not_sent、保留待确认，约3秒后恢复 idle。任务没有发送、没有结果或归档；90秒期限后测试失败。未重试该任务、未修改产品投递规则。

真实测试此前在第一次 idle 就认定启动结束。现增加测试准备条件：同一 full fingerprint、interactiveReady、非 launchPending、idle/done 连续观察3秒；unknown/缺观测/身份变化即重置，保持35秒总启动期限，持续检查屏幕阻断。3秒取自锁定 herdr v0.9.3 的 AGENT_START_SETTLE_DELAY；这是更保守的测试准备门槛，不能证明未来永不变忙，也不能替代实际投递前最终核对。没有增加固定盲等、自动确认权限或产品启动/派发重试。
