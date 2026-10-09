# 真实测试连续就绪前置：独立增量审查

2026-10-08，审查者 `/root/technical_review`。本批仅审 `tests/integration/real-agent.test.ts` 的连续就绪前置；不修改产品/测试，不调用模型。结论：发现的 SR01 medium 已修复，无未关闭 critical/high/medium。最终 SHA 见 [stable-readiness-reviewed-files.json](stable-readiness-reviewed-files.json)，对该测试文件优先于同目录之前两个审查报告的旧 SHA；旧执行证据保持原基线。

固定 herdr v0.9.3 `src/app/agents.rs:10` 定义 `AGENT_START_SETTLE_DELAY = 3 秒`。它可解释选取观察窗口的尺度，但不是“3 秒后再无 unknown”的上游保证。新增逻辑仅要求在测试接入前，重复观察同 full fingerprint 的 idle/done、interactiveReady、非 launchPending，持续满足 3 秒；任何 missing/unknown/不就绪或身份变化重置。总启动等待仍为 35 秒，不重复 start，不修改产品最终派发检查。

## 失败证据和范围界限

- [real-agents-footer](real-agents-footer/real-agent-claude.json)：confirm 后 unknown，automatic 被明确 NOT_READY 拒绝，尚无任务/attempt。此前 10 秒仅重试此内部明确拒绝的有界等待已独立审查。
- [real-agents-final](real-agents-final/real-agent-claude.json)：创建 durable intent 后最终 refresh 为 unknown，产品将 attempt 置为 not_sent/needs_confirmation，seenActivity=false、无 hello/result。约 3.27 秒后恢复 idle，但没有自动投递，90 秒等待失败。该样本说明最终门槛发挥作用，不是待自动重放的任务。
- [real-agents-ready](real-agents-ready/real-agent-claude.json) 是另外的上游 busy 启动拒绝，分析见 [busy-review.md](busy-review.md)，不与上述两次 ready 边界混淆。

新增前置用于创建一个准备充分的独立正常样本；之后若原子性之外的状态仍变化，产品照旧暂停。任何后续成功都不能把上述失败改写为通过，也不能证明产品状态竞态已经消失。

## SR01：medium / fixed

初版只以 Date.now 比较 readySince，没有采样间隙或读屏后的观测年龄检查；一次 RPC/系统暂停跨过 3 秒，第二个同指纹样本即可通过，不能支持“连续新鲜”的表述。[初始发现记录](stable-readiness-review-initial.json) 保留；其保存时作者已并发修订，内含 SHA 实际属于最终源码，不能据此恢复初版 SHA，见 [基线纠正说明](stable-readiness-review-baseline-correction.json)。旧控制流已由当时只读工具输出查证。

作者修订为 performance.now 单调窗口；在读取 screen 后检查 observation 的 wall-clock age 必须处于 `[0,1000)` ms；相邻 ready 样本间隔超过 1000 ms 重置窗口；异常状态同样重置。没有改产品状态或派发规则。

独立直接提取当前源码的 startup readiness 循环，使用本地 TypeScript 转译，替换观察源、屏幕、等待和时钟运行 9 个虚拟时序场景；没有手写另一份决策逻辑，也没有真实 Agent/文件任务。结果见 [stable-readiness-review-probe.json](stable-readiness-review-probe.json)：正常 250 ms 采样需 13 次/3 秒；2 秒采样间隙、读屏导致 1100 ms 陈旧、未来时间、unknown、missing、指纹变化均重新等待；guard 阻断立即停止；一直 unknown 在 35 秒窗口结束。9/9 通过，探针所用源码 SHA 与最终文件一致。[关闭记录](stable-readiness-review-findings.json)。

循环中的 RPC 自身仍受原有请求超时约束；35 秒是循环预算，不能将其描述为会强制中断正在执行的 RPC。采样也不能证明两次采样之间从未发生瞬时外部状态变化，因此产品最终重新核验仍不可省略。

## 执行基线

作者已说明 `real-claude-stable.log` 在最终单调时钟/陈旧/缺口三项修订前启动；该初版 harness 的完整 SHA 未由 reviewer 捕获。当前最终 SHA `3a18fb937eb675217380b7f39676958f6a5c8a1594dee2f78029f07e090a703c` 只证明最终静态/探针基线，不能倒填到该真实调用。应将同产品源码的真实结果与最后测试前置逻辑的本次静态/虚拟计时验证分别说明。此处没有要求再调用模型来覆盖记录差异。

六类场景：状态迁移检查准备/未知重置；幂等检查不追加 start/confirm/任务重试；时序检查新鲜度、采样间隙、指纹连续和单调窗口；恢复检查失效后重新累积而不接续旧窗口；关联检查原 target/full fingerprint/cwd/type；隔离检查新的独立 session/cwd 与固定任务，虚拟探针不触达真实会话。关联 R02/R03/R04/R10/R12、V05/V07/V24；不宣称全部需求验收已完成。

新的 OCR [preview](stable-readiness-review-preview.json)/[rule](stable-readiness-review-rules.json) 和 [逐项范围](stable-readiness-review-scope.json) 已保存：本批 1 文件 reviewed，其余 reviewable 全部明确 skipped，排除项保留。最终整体覆盖与真实验证由后续汇总按各自 SHA、时间和来源核对。
