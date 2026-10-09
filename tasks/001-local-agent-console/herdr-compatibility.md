# herdr 接口事实与兼容边界

日期：2026-10-07。状态：保留 2026-10-06 准备期事实；0.9.3 独立真实集成已执行，见第 3 节。0.9.0 只有版本化源码与契约验证。适用：技术方案 0.2；不修改需求 0.2 的行为规则或历史确认记录。

## 1. 2026-10-06 准备期观察

| 项目 | 观察 |
| --- | --- |
| 本机 CLI | `herdr --version` 返回 `herdr 0.9.3`，退出码 0 |
| schema | `herdr api schema --json` 退出码 0；schema_version=1、protocol=22 |
| AgentInfo | 包含 terminal_id、agent_session、state_change_seq、completion_seq、revision、cwd、foreground_cwd；部分字段可缺省 |
| 终端 CLI | `terminal session observe/control --help` 退出码 0；两者接收明确 target、cols、rows；control 的 takeover 为可选 |
| 宿主 | Darwin 25.6.0 arm64；Codex CLI 0.160.1；Claude Code 2.1.195 |
| 真实 session | 未检查或控制用户 session；没有启动/投递/中断任何用户 agent |

完整本机 schema 保存在 [准备证据](verification-runs/20261006-implementation-preparation/herdr-0.9.3-schema.json)，SHA-256 为 `9e2af207e9aa8183d4aeca5fde9cc48e7909bb40cdbd7cf21608a6d3ea78075b`。

## 2. 已核对的版本化事实

1. **管理 API 是逐行 JSON。** `ApiClient` 通过 local socket 写请求、按行读响应。来源：[v0.9.3 api/client.rs](https://github.com/herdrdev/herdr/blob/v0.9.3/src/api/client.rs)。Meteor Flow 使用 Node `node:net` 的 Unix socket；这是本项目选型，不代表 herdr 提供了 TypeScript SDK。
2. **终端可直接使用 CLI JSON 流。** `run_terminal_session_observe` 输出 `terminal.frame`，含 seq、ANSI base64 bytes、width/height/full；`run_terminal_session_control` 从 stdin 读取 terminal.input/resize/release 等命令。v0.9.0 与 v0.9.3 都有该流程。来源：[v0.9.0](https://github.com/herdrdev/herdr/blob/v0.9.0/src/client/terminal_sessions.rs)、[v0.9.3](https://github.com/herdrdev/herdr/blob/v0.9.3/src/client/terminal_sessions.rs)。
3. **JSON 管理接口和底层终端协议不同。** 后者采用带长度前缀的 bincode framing，protocol 常量为 22；不能把原始终端 socket 当 NDJSON。官方终端 CLI 负责转换。来源：[v0.9.3 wire.rs](https://github.com/herdrdev/herdr/blob/v0.9.3/src/protocol/wire.rs)。
4. **0.9.0 无 completion_seq，0.9.3 有可选 completion_seq。** 两者均有 state_change_seq，且 protocol 均为 22。因此仅检查 protocol 数值不能证明字段或业务能力相同。来源：[v0.9.0 AgentInfo](https://github.com/herdrdev/herdr/blob/v0.9.0/src/api/schema/agents.rs)、[v0.9.3 AgentInfo](https://github.com/herdrdev/herdr/blob/v0.9.3/src/api/schema/agents.rs)。
5. **prompt 不包含本项目的幂等事务。** 参数为 target/text 和可选 wait；返回输入提交与完成业务验收是两回事。Meteor Flow 须自己持久化 dispatch intent，结果不明停止自动推进。来源：[v0.9.3 参数](https://github.com/herdrdev/herdr/blob/v0.9.3/src/api/schema/agents.rs)、[v0.9.0 自动化说明](https://github.com/herdrdev/herdr/blob/v0.9.0/docs/next/website/src/content/docs/agent-automation.mdx)。
6. **不能固定首次发现的 pane。** 状态订阅使用 pane_id；还存在 pane.created/moved/closed/updated 等订阅。移动后更新定位和订阅，terminal_id 与会话/进程证据用于身份判断。来源：[v0.9.3 events.rs](https://github.com/herdrdev/herdr/blob/v0.9.3/src/api/schema/events.rs)。
7. **显式 session 影响 socket 选择。** `--session` 优先于 socket 环境覆盖；默认环境可能继承调用者 session。适配器须使用一套固定的选定 session 上下文，并剔除冲突继承变量。来源：[v0.9.3 socket_paths.rs](https://github.com/herdrdev/herdr/blob/v0.9.3/src/server/socket_paths.rs)。
8. **CLI 与运行中服务端版本可能不同。** 当前导出的 schema 是安装的 CLI 自带内容；后续连接时仍须检查服务端快照与实际接口能力，不能用 CLI 结果替代服务端确认。

## 3. 2026-10-07 独立真实集成

用户明确授权两种 Agent 的固定小任务。所有测试使用独立 herdr session、XDG 运行目录和工作目录；不向用户现有 Agent 投递，不代点登录、信任或工具权限。只读沿用本机配置的模型服务，关键配置前后哈希一致。

| 能力 | 实际结果与边界 |
| --- | --- |
| 0.9.3 API | 真正启动 headless server，握手、快照、订阅、workspace.create、agent.start、agent.prompt、process_info 均实际调用 |
| Codex 0.160.1 | 固定 hello.txt 小任务成功，观察到本次活动，结果 ID 匹配、内容/哈希校验、持久化归档成功 |
| Claude 2.1.195 | 相同固定任务成功，支持 Agent 持有同前台进程组的 MCP 子进程，父链和启动时间经过 OS 核对 |
| 真实终端流 | 两只读 observer、control 输入生成临时文件；observer 使用不同 cols/rows 后实际 PTY 仍为控制方的 30×100；第二 control 被明确拒绝，释放后 observer 继续存在 |
| 0.9.0 | 契约模拟覆盖缺少 completion_seq；未安装该版本实跑，不宣称完成其真实兼容验收 |
| 故障与竞争 | 故障注入和时序矩阵使用真实本地 DB/FS/进程/HTTP/WS、可控 herdr 边界；不冒充所有异常均在真实模型上逐项运行 |

原始证据：`verification-runs/20261007-implementation-preflight/` 内 `real-agents-collection-settle/real-agent-codex.json`、`real-agents-claude-final/real-agent-claude.json`、`real-terminal-streams-fixed.log`。此前失败、跳过及修复日志原样保留；早期 Claude 使用全新配置触发引导和将更新横幅误认为阻塞，均不能当作最终兼容结论。

## 4. 集成时确认的接口差异

- **agent.* 与 terminal session 的 target 规则不同。** 官方 `resolve_agent_target` 只接受 public pane ID 或 managed name，不接受 terminal ID；终端 observe/control 可接受 terminal ID。适配器在完成同连接代的新鲜快照后建立 terminal→pane 定位，发送前同步核验缓存，不猜测名称、不固定旧 pane。来源：[v0.9.3 terminal_targets.rs](https://github.com/herdrdev/herdr/blob/v0.9.3/src/app/terminal_targets.rs)。
- **缺少原子 compare-and-send。** herdr 0.9.x 没有以稳定 terminal ID 和预期身份为条件原子提交 agent.prompt/send_keys 的接口。Meteor Flow 的最终新鲜核验、连接代和 prompt 响应 terminal 校验缩小边界，但不能排除其他本机输入源在核验后同时移动/替换 pane；出现不确定性保持暂停。send_keys 只返回 ok，不声称它返回了终端身份或证明执行已停止。
- **启动需要新 shell 就绪。** workspace.create 后可能仍在执行 shell 初始化；agent.start name 最多 32 字符。实现生成合规唯一名称，读取等待 shell 前台稳定，只发送一次 agent.start；整个流程绑定连接代，重连后不能继续旧启动。
- **前台列表可以含 MCP/工具子进程。** 不要求列表只有一个 PID；要求恰有一个与 Agent 类型匹配的候选，其他成员都能由 libproc 启动时间与父链证明为它的后代。并列 pipeline、多个 Agent、无法核实或 PID 重用均只观察。
- **竞争拒绝不等于非零 CLI 退出。** 第二 controller 被拒绝时，真实 CLI 输出 `terminal.closed`、reason 含已有 attached client，并可能退出 0；桥接按协议关闭，不能仅靠退出码授予控制。

真实集成仅证明对应版本、机器和固定任务的所测链路。原生终端仍可由用户直接操作，控制台不宣称控制所有输入来源。
