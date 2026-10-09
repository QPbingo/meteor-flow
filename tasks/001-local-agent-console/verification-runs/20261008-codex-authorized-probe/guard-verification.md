# 输入关卡修复验证

日期：2026-10-08。状态：14 项本地回归通过，真实模型诊断尚未执行。

独立审查 CP01 指出入队前检查不能覆盖等待冻结输入/DB intent 的间隔。测试专用 guard 已移至实际 HerdrClient.prompt 前，匹配当前 target/pane；阻断或读取失败同步关闭后续输入，monitor stop 也能阻止进行中的读屏随后发送。保持产品身份策略。

首轮新增用例有 fixture 未建 data 目录、零参数 stub 的类型签名问题，分别见 guard-gate-tests.log 与 guard-gate-typecheck.log；均已修正。随后默认宿主沙箱内12通过/2 NOT_READY，见 guard-gate-retest.log。未放松产品门槛：同样调用 processIdentity(process.pid)，沙箱内返回 null，正常宿主权限下返回非 null；与既有本机进程核验前提一致。

相同源码在已授权本机执行环境下 14/14 通过（guard-gate-runtime.log），tsc exit0（guard-gate-typecheck-retest.log）。两个真实 AgentConsole/SQLite/collector 用例在 durable intent 已保存、发送前的可控 gate 置入更新/审批屏幕，最终 external prompt=0、interrupt=0，执行保留待确认。其余覆盖读失败、monitor stop 与待定读屏、正常仅发送一次。无模型调用，无用户会话操作。
