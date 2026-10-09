# herdr 管理适配实施记录

日期：2026-10-07；执行上下文：独立子任务 herdr。状态：子模块实现与本范围测试通过；等待根任务独立审查、整体复验与人工验收。

## 范围与前置

仅修改 `apps/server/src/adapters/herdr/`。依据需求 0.2 R01/R02/R03/R09/R11/R12、技术方案 0.2 §2/5/6 及 herdr-implementation-brief；原确认与开始授权有效。

本 agent 完整加载全局 capture-constraints 的 SKILL、索引和正文：R-002 生效，目标是本机 macOS arm64，无远程线上部署；R-001 小黑盒搜索规则不适用。实际核对系统 Node 25.8.1，但产品检查使用隔离 `/private/tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin/node`，版本 24.21.0。本机 herdr CLI 0.9.3；服务端版本仍须实际 ping 验证。

完整加载本仓库 meteor-flow-verification、test-master（integration-testing/testing-anti-patterns 引用）、open-code-review-delegate，读取 prerequisites/workflow/mandatory-scenarios。`python3 scripts/workflow/check.py doctor` 退出 0，OCR 1.12.12 版本核对退出 0。技能来源固定于项目 sources.lock.json，通过完整文件读取加载，不宣称原生命令注册。

已在 Node 24.21.0 实际完成 Unix socket 写读探针，输出 ok、退出 0。首次受沙箱监听限制返回 EPERM；经工具审批在专属临时目录执行通过并关闭/清理。后续测试沿用相同隔离策略。浏览器与 UI 由主任务覆盖，本子任务不修改前端/终端 UI；Playwright 与 Impeccable 入口已读取，主任务 Chromium 探针成功不冒充本子任务 E2E。

## 测试策略与六类场景

| 类别 | 需求 | 可控用例与预期 |
| --- | --- | --- |
| 状态迁移 | R01/R02/R12 | 受支持 ping 后可读取；未知版本、协议或损坏报文关闭能力；缺身份进程证据返回只读所需空证据 |
| 幂等 | R03/R06 | prompt、interrupt、start 断线/超时只发一次，不重放；明确记录已知启动 pane |
| 时序 | R03/R12 | 分片 NDJSON；乱序/错 ID 拒绝；订阅 ack 后才读 snapshot；旧 generation 不返回；新读取使旧读取失效 |
| 恢复 | R11/R12 | 断线立即通知；close 后所有未决请求失效；重新 connect 不恢复之前订阅/副作用 |
| 关联 | R02/R11 | pane 移动保持 terminal 身份与进程证据；PID+OS 启动时间、agent_session、cwd、session 变化改变 fingerprint |
| 隔离 | R09/R10 | 独立临时 socket；CLI 固定 argv、清理 herdr 继承目标；启动独立 workspace/shell，拒绝任意会话路径 |

模拟器集成测试只验证适配协议与故障，不等同真实 herdr 版本兼容或 Codex/Claude 任务端到端验收。独立 OCR 由根任务统一安排；最终完整基线/验收报告由根任务汇总。

## 实现与验证结论

入口为 `apps/server/src/adapters/herdr/index.ts`，保持 brief 的 HerdrPort/HerdrClient/AgentObservation/listSessions 接口，额外导出 `HerdrError`（code、uncertain、target）与官方 socket 路径计算函数。没有新增 npm 依赖，使用已选 Node 内建 net 和 posix-fs。

- 管理协议据 v0.9.0/v0.9.3 源码落实：每请求独立 socket，订阅确认之后才接受事件；1 MiB 字节上限、严格 UTF-8、独立请求 ID/deadline、响应判别校验。支持版本白名单 0.9.0/0.9.3 + protocol 22，其他版本关闭能力，不根据 protocol 单独推断能力。
- 订阅使用全局生命周期流及逐 pane 的状态流。新 pane 先 ack 后再快照；移动会建立新状态流并关闭旧流。并发旧读取返回 `stale_read`，上层必须忽略；断线使全代失效并立即通知。上层仍须每 2 秒校准，以弥补事件缺口。
- 观测 seq 来自 state_change_seq，兼容没有 completion_seq 的 0.9.0。fingerprint 包含 session/socket、随机连接代、terminal/type/agent_session/前台 PID/OS 启动证据/真实 cwd，不含 pane 位置。前台必须唯一且名称匹配 agent，进程证据缺失时 pid/processStart 为空，上层只观察；posix-fs 使用 libproc 微秒启动时间与前后身份核对。
- prompt 验证响应 terminal_id；interrupt 为 `agent.send_keys` 的单个 `C-c`，不证明进程停止。副作用响应不明不重发。start 创建不依赖焦点的新 workspace/shell，再调用 agent.start；后段失败保留已知 target，不自动回滚、杀进程或重启。
- 默认读取 deadline 5 秒，prompt/interrupt/workspace 创建 15 秒，agent.start 服务端60秒、客户端65秒。CLI session list 固定 argv，清理冲突继承变量并验证路径符合官方规则。

最终实际命令（Node 路径同前置记录）：

```text
METEOR_FLOW_REAL_HERDR=1 <node24> node_modules/vitest/vitest.mjs run apps/server/src/adapters/herdr --reporter=verbose
<node24> node_modules/typescript/bin/tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck apps/server/src/adapters/herdr/index.ts apps/server/src/adapters/herdr/index.test.ts apps/server/src/adapters/herdr/real-herdr.test.ts
```

两条退出码均为 0。测试 2 文件、21 用例通过，见 `herdr-test-final.log`；类型检查无诊断，见 `herdr-typecheck-final.log`。初次 17 模拟用例已通过；新增目标关联/不完整快照/成功启动、原生进程证据及真实 session 用例后完成上述最终复验，无隐藏 flaky 失败。

| 六类 | 实际结果与证据定位 |
| --- | --- |
| 状态迁移 | 通过：未知版本/协议、错 type/JSON、缺字段关闭能力；缺进程证据只观察 |
| 幂等 | 通过：超时和断线 prompt 仅一次；中断一次；创建后启动仅一次，失败 target 保留 |
| 时序 | 通过：UTF-8 分片正确；错 ID 拒绝；订阅 ack/snapshot 顺序、移动重订阅、并发旧 snapshot 拒绝 |
| 恢复 | 通过：连接关闭使未决读取失效；断线通知一次；重新 connect 的 fingerprint 改变 |
| 关联 | 通过：终端目标不匹配阻断；移动 pane 身份稳定；agent_session 替换和重连身份变化 |
| 隔离 | 通过：全部 net 模拟资源使用本次 mkdtemp socket；CLI 继承目标清理；真实 session 使用独立 XDG_CONFIG_HOME/XDG_STATE_HOME/cwd 与 meteor-flow-test-*，只停止和清理该测试子进程 |

真实测试边界：实际 herdr 0.9.3 服务端 ping 返回 version=0.9.3/protocol=22；空 agent 快照、全局订阅 ack/后续快照成功。未连接或操作用户已有 session。真实 Codex/Claude start/prompt/interrupt、0.9.0 运行时、终端输入尺寸竞争未在本子任务测试；它们仍属于主任务验收，不能据本报告宣布完整产品就绪。

## 终端桥接交接（源码事实）

本子任务未编写终端桥接。已向根任务提供 v0.9.3 `src/client/terminal_sessions.rs` 的事实：固定 argv `herdr --session <name> terminal session observe|control <terminal_id> --cols <N> --rows <N>`；control 不传 takeover。stdout 为 NDJSON `terminal.frame`，字段 seq、encoding=ansi、width、height、full、bytes（标准 base64）；`terminal.closed` 含 reason，EOF 也可能直接正常退出。stdin 只接受 control：terminal.input 的 text 或 bytes 二选一、terminal.resize 的 cols/rows（u16且>0）及可选 cell_width_px/cell_height_px、terminal.release。没有额外控制授权 ack，应等待真实 frame 再开放输入。本机 observe/control --help 均已核对退出 0。
