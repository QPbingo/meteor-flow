# 授权后真实调用前独立定向审查

日期：2026-10-08。最终状态：**CP01 high 已修复并独立复查关闭，本批无剩余阻断缺陷，可继续已授权的固定范围 Codex 诊断**。审查者 `/root/technical_review` 未改候选代码、未调用模型；独立运行 14 项无模型 guard 回归通过。用户对 Codex 后续方案的新授权已生效。此结论不表示真实诊断已成功，也不关闭既有产品 E2E 问题。

项目 verification、test-master（单元/集成/安全/反模式引用）及 OCR 已在当前独立上下文加载；本轮重核 prerequisites，doctor 和固定 OCR 1.12.12 的版本检查成功。原始 [preview](reviewer-preview.json)、[rule](reviewer-rules.json)、[5 文件初始 SHA](reviewer-initial-baseline.json)、[初始范围](reviewer-scope-initial.json) 保留。修复后 [preview](reviewer-preview-fixed.json)、[rule](reviewer-rules-fixed.json)、[最终 5 文件 SHA](reviewer-fixed-baseline.json)、[最终范围](reviewer-scope.json) 单独保存：174 个 reviewable 中本批审查 5 个，其余 169 个明确 skipped；全部 1326 个排除项说明理由。临时 standalone 源码与 diagnostic-source.txt 字节相同。本批不扩大成全产品审查。

## 初轮 CP01：检查入队前画面不能阻止实际发送前出现的新提示

严重程度 high；测试/时序。位置：real-agent.test.ts 的 beforeSubmit/saveTask 段，以及临时 codex-standalone.test.ts 同一结构。

当前顺序是读屏通过 → `app.saveTask` 持久化任务 → 后台 `tick` → statfs/冻结文件准备/持久化派发意图/refresh → `port.prompt`。实际发送入口未再读屏；`HerdrClient.prompt` 只校验目标映射和代际，且已知上游会把更新画面报告为 idle/ready。在入队后、实际发送前出现 Update/approval 提示时，任务文本仍可能作为确认输入写入该画面。完成轮询的 `block()` 还先等待 `pane.process_info`，未立即锁闭后台发送，因此无法补上此间隙。

调用方证据：application/console.ts 的 `saveTask` 只写任务，`dispatch` 异步准备并在最后调用 `port.prompt`；两份测试的 `portFactory` 均为直接 HerdrClient。8 个已执行 guard 用例仅验证文本正则，没有覆盖上述入队/派发时序。

最小修复建议：在测试专用实际 `prompt` 包装器中，对本次将发送的同 terminal/pane 做最后读屏；命中 blocker 时先锁闭发送并记录原因，再收附加诊断，保证底层 prompt 未调用。保留入队前检查。补可控 gate 用例：初次画面可用，入队后/实际发送前转为 Update 或 approval，断言底层发送为 0；同步覆盖读屏失败也拒发。上游没有原子 compare-and-send 的最后远端间隙仍须如实保留，本建议不要求修改产品身份规则。结构化发现见 [初始 findings](reviewer-findings-initial.json)。

## 修复复查与关闭依据

两份测试的 app portFactory 现在都对实际 HerdrClient.prompt 安装 `guardAgentInput`，从当前目标的 pane 读取画面后才调用底层发送。读失败或命中提示先同步保存 blockedReason 并记录 blocked；读屏等待期间监控调用 stop，读完成后仍先检查该标志，不能恢复发送。completion 的 block 也先 stop 再收进程诊断。固定目标不符/当前目标不可见时拒绝读取与发送，没有添加自动回答或重试。

新增可控 gate 覆盖 update/approval、等待读屏时收到 stop、读屏失败和普通 ready 恰好发送一次；两个真实 AgentConsole/SQLite/collector + FakeHerdr 用例在 durable intent 已存在后释放提示画面，断言 prompt=0、interrupt=0，执行进入待确认并保持记录。外部模型没有参与这些用例。

独立第一次在受限环境运行：12 通过、2 个集成用例在进入 gate 前因 NOT_READY 失败，原始 [日志](reviewer-guard-tests.log) 保留。FakeHerdr 实际调用 libproc 读取当前测试进程身份，该受限环境无法建立该身份；并非把该失败改写为通过。经授权使用 require_escalated 访问本次自有进程身份后，以固定 Node 独立运行同一文件：**14/14、exit 0、842 ms**，见 [宿主执行日志](reviewer-guard-tests-host.log)。没有改产品门槛，没有模型、用户 session 或性能负载。最终 5 候选执行前后 SHA 未变、诊断源码副本一致，见 [核对](reviewer-tested-baseline-check.json)。[最终 findings](reviewer-findings.json) 将 CP01 标记 fixed；本批 critical/high/medium/low open 均为 0。

## 其余范围与授权核对

helper 对已给出的登录、目录信任、工具审批、更新、sandbox 权限、共享 daemon 错误文本采用停止策略；初轮 8 项 guard 和作者 tsc 日志已读，修复后的独立执行范围见上节。误报导致停止可接受，不能据这些样例声称穷尽所有 CLI 本地化提示。

临时诊断仅 Codex、一个新 XDG/session/cwd 和一个固定任务，start 注入参数与已授权方案一致：`--no-daemon -c check_for_update_on_startup=false --sandbox workspace-write --ask-for-approval on-request`。没有自动确认、升级或修改全局配置命令；取消 outer sandbox 已明确获授权，配置只做前后哈希核验，不能声称仍有外层强制只读保护。后续方案授权状态和诊断范围一致。

诊断没有修改产品 identity 策略，固定文件和 result 的 task/attempt/root/schema 均核对；成功标记 model-output-verified/diagnosticOnly，不能算产品端到端通过。既有 E2E 仍保留严格终态/归档断言，未因本次诊断降低其通过条件。无自动重试或重发旧任务，清理只针对专用服务/socket/目录。

六类场景：状态迁移核对 blocker→停止/文件诊断→非产品通过；幂等核对单 start、单 task、无重发；时序为 CP01 及其 gate 复验；恢复核对失败进入 finally 关闭本次 app/server，配置变化不得记录通过；关联核对 terminal/pane 和 task/attempt/root；隔离核对新 XDG/session/cwd、批准参数与用户配置哈希边界。关联 R02/R03/R04/R09/R10/R12/R13、V03/V05/V07/V19/V21/V24/V26。本批只提出并关闭 CP01，不据此关闭既有真实 Codex 产品兼容问题。
