# 实现与验证状态

日期：2026-10-08。适用：需求 0.2、技术方案 0.2、Node 24.21.0 / macOS arm64。确认状态：实现已获授权；人工验收 **pending**。当前复审修复的命令、结果、独立审查和准确基线见 [本轮验证报告](verification-runs/20261008-delivery/report.json) 与 [执行说明](verification-runs/20261008-delivery/summary.md)。2026-10-07 的 [执行报告](verification-runs/20261007-final/report.json) 及 [文档收尾](verification-runs/20261007-review-delivery/summary.md) 保留为历史证据，不覆盖本轮修改。

## 当前结论

本轮 Codex 与 Claude 均完成固定文件任务、结构化结果校验和持久归档，关键配置前后哈希一致。Codex 的独立启动和首次会话标识补全已修复并独立复查；Claude 测试的被动更新通知误判、正在更新漏检、启动准备条件已修正。没有未关闭的审查发现，仍由人进行最终验收。

真实测试并非每次都成功：历史共享 daemon/外层沙箱失败、Claude 通知误报、瞬时 unknown 导致的 NOT_READY/not_sent，以及一次 agent_pane_busy 拒绝均保留。本轮成功证明所测正常链路可用，不证明启动状态永不变化；产品继续在最终身份/就绪校验失败时暂停，不自动重发。授权范围与执行保护见 [Codex 后续方案](codex-integration-followup.md)。

## 已实现

项目与已有 Agent 接入、新 Agent 启动、指定 Agent 队列和简单依赖；一次派发意图、未知投递保守恢复、取消/重试/人工补录；冻结输入、严格结果协议与不可变归档；只读终端、独占人工控制、控制失效后暂停；本机认证、CSRF/Origin/Host 防护、版本化 API/SSE/WS；中文响应式界面、历史执行与安全产物预览。产品使用 Node/TypeScript；Python 仅用于已有开发工作流。

## V01—V29 的验证映射

以下为整体测试映射；当前命令执行情况以本轮报告为准。新增恢复回归对应 V03/V04/V06/V07/V09/V12/V13/V16/V24/V26，浏览器恢复回归同时检查 HTTP、SQLite、占用和操作副作用。

表内的“实际”限定为指定层级。模拟 herdr 的集成测试不能证明真实模型的每一种异常；同一条验收场景通常由多层证据共同支撑。

| 场景 | 主要用例和证据来源 | 实际边界 |
| --- | --- | --- |
| V01 网页启动并完成文件任务 | application、web-server E2E、real-agent | 网页真实 HTTP/DB/collector，herdr 边界模拟；本轮两 Agent 的真实适配器/应用/结果/归档链路分别通过；网页流程另由浏览器与模拟 herdr 验证，不合称真实模型浏览器 E2E |
| V02 接入已有 Agent | application confirmed existing agent、web-server | 实际 DB/HTTP/浏览器；无需托管 readiness 标记的边界模拟 |
| V03 重复操作 | database/store 并发幂等、application cancel/start、UI 丢响应后刷新 | 实际 SQLite 和浏览器，同页签刷新保留 operation ID |
| V04 提交后响应丢失 | store dropped reply、application lost prompt/restart | 实际 worker/持久化恢复；外部投递响应丢失注入 |
| V05 部分发送/超时 | application lost acknowledgement、adapter RPC 错误用例 | 不自动重发或清空；传输异常模拟 |
| V06 启动未知 | application durable startup intent、adapter shell/start generation | 持久化未知状态、迟到/换代响应模拟；人工核对解除要求 fresh/无可见匹配/明确证据，真实正常启动另测 |
| V07 实例/窗格变化 | model replacement、adapter movement/process identity | 模拟会话/窗格变化；进程 PID/start/父子关系另有真实进程验证 |
| V08 空闲无结果 | model idle without result | 纯状态用例；2026-10-07 真实 Codex 短暂空闲的后续采集有历史时间线 |
| V09 半写/错 ID/未停止 | protocol、collector、model holds occupancy | 真实临时文件/采集子进程，协议和停止状态故障注入；冲突持久化跨空闲观测和重启保持 |
| V10 无文件结果 | protocol empty artifacts、model result holding | 严格协议/状态测试；未向真实模型额外派发无文件任务 |
| V11 成功/取消竞争 | model 两种持久化顺序、application pending acknowledgement | 可控边界覆盖两种顺序，不用 sleep 猜测竞争 |
| V12 未停止保留占用 | model cancel deadline/manual declaration、application cancel | 中断和保留占用由状态时钟/模拟适配验证；真实官方终端输入另测，未向真实模型发送 Ctrl-C |
| V13 旧执行结果 | model late result、UI attempt history | 状态及浏览器关联；不隐含工作目录回滚 |
| V14 阻塞不饿死独立任务 | application independent task、model dependency | 实际 DB/collector 与模拟 Agent |
| V15 业务失败/投递未知 | model business failure vs delivery uncertainty | 状态规则分别验证，不把异常当业务失败 |
| V16 循环/冻结修改 | database cycle rollback、model cross-project/frozen revision | 实际事务回滚与状态用例 |
| V17 冻结输入不变 | collector archive/freeze、Markdown frozen IDs | 实际复制/hash，浏览器拒绝错 ID/哈希/归属 |
| V18 控制权/旧输入 | terminal lease/token/epoch/generation、web terminal | 真实 WS + 受控 CLI、浏览器；真实 herdr 双控制竞争另测 |
| V19 过期审批画面 | terminal freshness/protocol、web malformed/late epoch | 不解析画面自动审批，不自动输入；模拟旧画面/旧代消息 |
| V20 页面断开 | terminal close/release、web disconnect | 真实浏览器/WS 生命周期；终端默认 observe |
| V21 重叠目录/同会话 | POSIX canonical overlap、application data isolation、CLI locks | 真实目录别名和锁；Agent 目录冲突状态验证 |
| V22 越界/特殊文件/超限 | POSIX 42 项、protocol limits、collector | 真实 symlink/hardlink/FIFO/目录替换/文件变化，故障写入注入 |
| V23 脚本/远程资源 | HTTP preview、web Markdown/HTML/MIME | 真实归档 PNG 解码、CSP、无远程请求、安全主动外链；其他栅格格式未逐一解码 |
| V24 重启/丢事件/休眠 | store/app recovery、adapter reconnect、SSE replay | 实际 DB/服务恢复及可控事件断线；没有物理休眠整机实测 |
| V25 存储故障/输出暴增 | real SQLITE_FULL、只读 cwd、performance | 真实 SQLite 满页/权限拒绝；2×1 MiB/s 双流 30 秒，herdr 边界模拟 |
| V26 多服务/多页面 | CLI duplicate owners、flock crash、HTTP/browser writes | 实际独立进程/锁/DB；单数据目录/单 session 所有权 |
| V27 未知协议/能力 | adapter whitelist、protocol/schema、web unknown version | 已支持 0.9.0/0.9.3 合约；0.9.3 真实集成，0.9.0 未运行实体版本 |
| V28 保留引用 | DB FK/事务、collector immutable snapshot、API 路由核查 | 无删除任务/归档接口；已有引用保留，不声明人工磁盘删文件可恢复 |
| V29 外站与任意文件 | HTTP auth/CSRF/Origin/Host/WS、dev proxy、POSIX | 真实本地请求/浏览器/文件；开发代理同样校验来源 |

## 独立审查与遗留边界

技能、POSIX、核心、应用、UI 分批独立审查报告存于 [preflight](verification-runs/20261007-implementation-preflight/)。A/B 界面审查、刷新幂等、终端协议、焦点/触控和 Markdown 范围发现均已修复复查；最终增量和全量清单在最终报告中关联，不把分批审查范围扩写为整个新基线通过。

默认 30 秒压力用例初次发现 RSS 增长指标不达标；固定 SQL 缓存和 DB Worker 年轻代限制后，原指标在 [young16 运行](verification-runs/20261007-performance-worker-young16/report.md) 通过。历史失败、单变量诊断和 90 秒观测保留。2026-10-08 默认测试再次出现 RSS 斜率超标，保留首次失败。已将 worker 正常回执改为提交增量；语义回归与对照结果见当前报告，不再只依赖 young16 的历史通过。有限负载窗口不证明长时间运行永不增长；p95 与 RSS 原始数据见各运行目录，不以复验覆盖原失败。

herdr 上游没有原子“校验身份并发送”接口；本实现使用新鲜同代快照和 pane 映射，跨进程最后间隙仍受上游能力限制。实际平台仅 macOS arm64；0.9.0 仅合约验证。真实模型仅固定小任务，未穷举所有模型/插件/审批状态。窄屏与触摸为 Chromium 模拟，未做物理手机和完整屏幕阅读器认证。人仍负责登录、目录信任、权限审批、结果质量判断与最终验收。
