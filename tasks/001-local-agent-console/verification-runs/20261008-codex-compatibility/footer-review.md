# 真实 Agent 屏幕 guard 与就绪等待：独立增量复查

日期：2026-10-08。审查者 `/root/technical_review`，只读候选、不修改产品/测试、不调用模型。结论：本批 3 文件通过独立审查，1 个 medium 问题 CF01 已修复；无未关闭 critical/high/medium。本结论只覆盖下述增量，不代替真实 Claude 任务闭环或人工验收。

## 范围和证据

- `tests/integration/helpers/agent-test-screen.ts`：精确被动通知整行豁免及真正更新状态阻断。
- `tests/integration/agent-test-screen.test.ts`：通知正例、同屏其他阻断、实际输入 gate 及未决读取/已排队意图回归。
- `tests/integration/real-agent.test.ts`：任务创建前对明确 NOT_READY 拒绝的 10 秒有界等待。

最终路径/状态/SHA 见 [footer-reviewed-files.json](footer-reviewed-files.json)，执行前后 3/3 一致。本批新 SHA 对上述文件优先于先前 [compatibility-review.md](compatibility-review.md) 中重叠的真实测试旧 SHA；旧报告及其执行证据保留，不倒写新基线。重新执行的 [preview](footer-review-preview-final.json) 和 [rule](footer-review-rules-final.json) 已保存；[逐文件范围](footer-review-scope.json) 将本批 3 项列 reviewed，其余 reviewable 项列 skipped，工具排除项逐项保留。本批继续使用当前已加载的项目 verification/test-master/OCR 规范，没有重新声称全仓库覆盖。

## 被动通知与实际更新

最初 Claude 执行证据 [real-agent-claude.json](real-agents/real-agent-claude.json) 显示任务已 submitted、出现 working 后被更新正则阻断，但只记录屏幕 SHA，不能从该文件恢复原屏幕或把原 blocked 结论改为 passed。

作者随后只读启动探针保存了精确的单行 `Update available! Run: brew upgrade claude-code`：[探针记录](claude-screen-probe/real-agent-claude.json)。独立阅读 [探针源码副本](claude-screen-diagnostic-source.txt) 确认 readiness 后只读屏幕，没有 saveTask 或输入动作，配置哈希未变。记录仅保存匹配行而非完整原屏，因此它证明该通知确实出现，不单独证明原失败屏幕不存在其他阻断。

审查者只读 `/opt/homebrew/Caskroom/claude-code/2.1.195/claude`，其 SHA-256 为 `8b45adad93f336ab95f33e714494b19fd3377a494eb05c122c8677bc895876ad`。内嵌 `Tgc` 的 warning 分支以 JSX 显示上述通知，不附带选择/确认回调；`mdf`（byte 216039913）对 Homebrew 返回 `brew upgrade ${cask??'claude-code'}`。同一组件另外的 `isUpdating` 分支显示 `Updating via homebrew…` 或 `Updating…`。本机 `claude --help` 也将 update/upgrade 列为独立命令。没有调用 update、doctor、登录或模型命令。

候选仅移除 trim 后完全等于已查证通知的整行，之后仍运行全部原阻断规则；不是看到通知就整体放行。附加 `Update now`、不同软件命令、同屏审批/信任和正在更新状态仍触发阻断。未来文案换行、截断或变体保守阻断，不通过宽泛删除更新关键词来追求测试通过。

## CF01：medium / fixed

首次复查发现候选只豁免通知，却仍漏掉本机 Claude 的真实 active 更新分支。独立执行原 helper 和内存 fake port，`Updating via homebrew…`、`Updating…` 均返回 null 且调用一次 fake prompt，与“遇更新停止”不符：[初始复现](footer-review-repro-initial.json)、[初始 finding](footer-review-findings-initial.json)、[初始候选 SHA](footer-review-initial-baseline.json)。没有实际外部输入或模型调用。

作者补充整行 active 更新匹配，覆盖 Unicode 省略号及三个点；新增两个屏幕识别用例及两个实际输入 gate=0 用例。独立复验最终 19/19 通过、exit 0、882 ms：[footer-review-tests.log](footer-review-tests.log)。原通知正例仍允许且只发送一次；真正阻断发生后后续重试也不发送。最终关闭记录见 [footer-review-findings.json](footer-review-findings.json)。

独立执行命令（正常宿主 libproc/临时 UNIX socket 权限，仅自建数据库、模拟 herdr、采集进程）：

```sh
PATH=/tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin:$PATH /tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin/node node_modules/vitest/vitest.mjs run tests/integration/agent-test-screen.test.ts --maxWorkers=1 --reporter=verbose
```

## 任务创建前的 readiness 等待

作者上一轮证据 [real-agents-footer/real-agent-claude.json](real-agents-footer/real-agent-claude.json) 为 confirm 成功后观测 unknown、automatic 明确 NOT_READY，tasks/attempts 均为空。这不是投递不确定或需要重放的任务。

新循环限定为 10 秒、250 ms 间隔，仅重试 `bindingAction(automatic)` 明确的 NOT_READY；相同 operation ID，不重复 confirm。每轮先检查 screen guard、原 confirmed fingerprint 和不存在 attempt。其他错误直接抛出，超时失败；没有屏蔽错误或延长任务执行期限。独立核对 application 的 serial/refresh 与 Repository 事务：NOT_READY 在 reduce 阶段抛出，未登记成功回执或自动模式变更；存储错误/未知提交不进入此重试分支。成功后仅创建一次任务，实际 prompt 边界仍由 guard 再读屏并封闭阻断输入。

六类场景：状态迁移检查通知/真正阻断和就绪前拒绝；幂等检查相同 automatic ID 与一次任务创建；时序检查临近输入重新读屏及停止待决读取；恢复检查失败后 gate 不重新开放、只对明确事务拒绝等待；关联检查 confirmed 指纹及原 target/pane；隔离检查本机源码只读、探针不投递任务、回归使用自建资源。关联 R02/R03/R04/R09/R10 和 V03/V05/V07/V19/V24；此处不声明重跑全部需求验收。

允许作者按已有授权继续固定 Claude 真实测试；真实模型仍由作者执行，先前失败/blocked 记录必须保留。当前 reviewer 没有运行真实模型或变更任何产品身份、权限和启动策略。
