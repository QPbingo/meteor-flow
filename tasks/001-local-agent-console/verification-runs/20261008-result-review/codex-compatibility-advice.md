# Codex daemon 与首次会话身份补全：独立建议

日期：2026-10-08。状态：诊断建议，不是产品修复通过结论。审查者 `/root/technical_review` 未修改产品或诊断测试、未新增模型调用。临时 `tests/integration/codex-diagnostic.test.ts` 仅用于作者本次诊断，不纳入永久源码审查覆盖。

## 查证事实

- 本 reviewer 实际运行本机 `codex --version` / `codex --help`：版本 0.160.1，正式 `--no-daemon` 描述为不使用共享后台服务，即使该服务已经运行。此选项独立于 sandbox/approval 参数。help 退出 0；沙箱内 PATH aliases 初始化提示不影响 help 内容，但不能由此宣称交互运行能力通过。
- 版本化 herdr 0.9.0 / 0.9.3 的 `src/api/schema/agents.rs` 均包含 AgentStartParams.args；0.9.3 `src/app/agents.rs:197` 将 args 追加到固定 Agent 可执行文件的 argv，再由平台统一编码为终端启动命令。
- [原始最终运行](../20261008-review-final2/real-agents/real-agent-codex.json) 失败；[诊断材料](codex-diagnostic/real-agent-codex.json) 明确记录共享后台服务要求 api_key_model_discovery 配置不兼容，配置保护检查未变。
- [no-daemon 单变量诊断](codex-no-daemon/real-agent-codex.json) 已消除该错误，进程仍可见；但 90 秒内无 hello.txt/result/archive，业务仍 needs_confirmation。此前 null 的 agentSession 后来出现，PID/启动时间/cwd 的已记录前后值相同。初始 timeline 和最终采样不能证明整个间隔完全无连接/身份变化。

## 启动建议

若后续正常链路取得完整成功证据，优先为托管 Codex 增加受能力门槛约束的固定 `--no-daemon`，以落实 R03 的正常网页启动；手动在原生 herdr 使用此参数后 attach 可作为后备步骤。只写文档不足以将本机托管入口的失败判为通过。

不改用户全局配置，不重启共享 daemon，不添加 sandbox/approval 绕过参数；该选项解决托管运行与共享后台配置的兼容问题，不将其表述为安全沙箱。R10 承诺目录及会话隔离，本身没有要求完全独立的 OS 后台服务。

探测应在副作用前、使用有界 timeout/maxBuffer 的正式 CLI help 或精确已验证版本能力；确认支持才加入固定参数，旧版不支持保留原路径。不要依据启动后错误文本自动重启。herdr 最终在其 shell 中解析裸 `codex`，服务进程 PATH 中探测到的 CLI 不一定与用户 shell 的解析相同；需记录实际测试版本/限制，不能宣称一台机器探测等于任意 shell 全部受支持。任何启动结果不明仍走现有 unknown 核对流程。

目前 no-daemon 诊断尚未完整成功，因此不建议立即将 flag 变更标为已验证修复。

## null → 会话 ID 的判断

现有完整 fingerprint 包含 agentSession，值变化会暂停；当前保守结果符合现规则，不能在实体测试中直接改 binding/attempt 指纹来绕过检查。

R04 使用“可获得的 agent 会话”，R10 也未要求新进程在第一次 turn 前即有会话 ID。因此可以提出一次受约束的身份补全转换：在同一 herdr session/socket/连接代/terminal/type/PID+启动时间/真实 cwd 下，旧会话确为 null，新会话首次可用且与其他已确认/活动绑定不冲突时记录它。须有独立的基础身份连续证据（包含连接代），不能仅通过 PID/cwd 相同猜测连接连续；现有全身份 fingerprint 不能整体删除 agentSession。

该转换须同步保留 binding 与当前 attempt 的身份关系和审计，不授予新的自动模式，不改变输入或派发次数。非空 A→B、非空→null、重连/休眠重新连接、terminal/PID/start/cwd/type 变化仍暂停；服务重启不借补全恢复旧授权。需覆盖首次补全正例、重复观察幂等、后续改变、缺失进程身份、连接代改变、同会话跨绑定冲突、活动执行/恢复等反例，再独立审查正常产品路径。

本地暂停不会停止已经提交的 Agent，所以“90 秒无文件”不能仅归因于指纹补全；还需保留末屏和后续活动事实区分模型/外部服务进展。延长同一已授权固定任务的诊断窗口不能替代产品成功证据，也不应改变审批/信任规则。
