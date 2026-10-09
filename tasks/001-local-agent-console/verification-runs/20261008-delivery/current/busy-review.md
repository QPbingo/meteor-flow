# agent_pane_busy：独立只读判断

2026-10-08，审查者 `/root/technical_review`。结论：当前证据未证明 `waitForShell` 的实现缺陷。保持一次启动请求、保留未知启动及目标、交人工核对，符合已确认的保守流程；本轮不建议为测试变绿引入自动重复 start。没有修改代码、调用模型或重跑测试。

本次实测 [real-agent-claude.json](real-agents-ready/real-agent-claude.json) 在任务创建前失败，错误为 `agent target pane w1:p1 is not an available shell`，无观察时间线，配置哈希未变。该记录不含失败瞬间 shell 的完整进程快照及结构化错误字段，因此不能断言具体是哪一个 shell 初始化子进程或其出现时间。不能把“存在合法竞态解释”写成已经捕获确切原因。

独立查证实际使用的固定版本 `/tmp/meteor-flow-upstream-20261006/herdr-v0.9.3`，没有使用未发布的 `/tmp/herdr-analysis-20261005` 来证明运行行为：

- `src/app/api/panes.rs:519` 的 process_info 从 runtime child PID 重新读取 foreground_job。
- `src/platform/macos.rs:416` 的 available_pane_shell 也重新读取 foreground_job；`src/platform/mod.rs:367` 要求进程组为 shell PID、没有其他前台成员、存在该 shell 且名字合法。
- Meteor Flow `index.ts:341` 的 waitForShell 检查目标 terminal、不已有 Agent、shell/前台组相同、唯一 shell 进程及合法 shell 名。这符合当前 macOS shell 的必要条件，并非只凭 pane 创建成功就认定可启动。但它和后续 agent.start 是不同 RPC，不构成原子保留窗格/进程状态。
- 上游 `src/app/agents.rs:194` 在重新核对 Agent 占用或 available_shell_name 失败时返回 TargetBusy；错误映射见第 260 行。它发生在 begin_managed_agent 与 try_send_bytes 之前，所以该明确拒绝没有注入此请求的 Agent 启动命令。之前 workspace 创建已经产生副作用，Meteor Flow 将异常保留为 uncertain + 已知 target；不会自动重发或删除窗格。
- 上游 `src/cli/agent.rs:360` 的 busy 重试限定明确错误、合法超时、terminal 未变、仍处在 shell 初始化条件，并有总期限。该版本化事实不等于要求 Meteor Flow 自动重复 start。项目 [兼容约定](../../herdr-compatibility.md) 已明确仅发送一次 agent.start，R03 要求失败待处理、再次启动先核对真实对象。

上述源码、当前适配器和失败证据的 SHA 见 [busy-review-evidence.json](busy-review-evidence.json)。已有模拟测试覆盖 shell 初始化等待、一次 start、失败时保留 target、重连拒绝旧启动；本轮没有以这些模拟断言证明这一次真实拒绝的瞬间原因。

允许在已清理的隔离资源之外，建立新的独立 session/cwd 做一次正常路径验证；这是独立样本，不是对失败请求的自动重试。保留本次 failed 记录以及正常样本各自版本、基线和结果；后者若通过，只能证明正常路径可用，不能宣称此竞态消失或已被修复。如以后重复出现而影响可用性，应另行捕获最后一次 process_info、busy 的 code/target/uncertain 和随后只读快照，再判断是否需要改变准备策略，不能直接放宽守门条件。
