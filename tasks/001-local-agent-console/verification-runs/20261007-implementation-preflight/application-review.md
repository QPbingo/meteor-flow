# 应用、HTTP、终端与 CLI 独立审查

状态：2026-10-07，本批修订复查完成，A01—A09 全部关闭；本批未发现剩余 critical/high。冻结候选及其原测试依赖上独立 112/112 用例通过。性能专项 RSS 增长检查仍失败，收尾期间作者开始修改 `storage/database.ts` 和两项性能测试资产，这些后续修改不在本批通过基线内；不能宣布整体产品验收就绪。审查者 `/root/technical_review` 只报告，没有修改产品实现或测试。

## 本批范围与前置

首轮 14 个文件 SHA 见 `application-review-baseline.json`：application、http（包含新增 files/file-child）、terminal、cli 目录；fake-herdr、terminal-cli、review-server 三个 fixtures；real-agent 集成测试。随后作者请求增量审查 herdr adapter 的 shell 就绪等待逻辑及测试，最终将单列其新基线。上一批 core/POSIX/技能报告不因此失效，也不自动覆盖本批。

重新读取 AGENTS 与 skill-prerequisites，沿用当前独立上下文已完整加载的项目 meteor-flow-verification、test-master、OCR；test-master 已读 unit/integration/security/testing-anti-patterns，本批补读 e2e-testing。capture-constraints R-002 使用同一实际 Node 24.21.0/darwin arm64 与 SQLite 3.53.4，R-001 不属本项目范围。读取 Playwright 项目适配用于识别浏览器验证责任；本批后端/协议代码独立审查和真实本地 HTTP/WS 测试不替代浏览器 E2E、Impeccable UI audit/critique。完整已确认 requirements/technical-design/implementation-plan 已在同一独立上下文加载，本批重点重读 R06—R14、技术方案 §6/7/10/11。

doctor、固定 OCR version、独立 preview/rule 都成功，原始证据为 `application-review-doctor.log`、`application-review-ocr-version.log`、`application-review-preview.json`、`application-review-rules.json`。所有测试只操作本次新建临时资源/数据库和模拟 herdr，不访问用户现有 session。

## 首轮发现（历史；最终关闭依据见末节）

| ID | 严重程度 | 文件/位置 | 具体影响与修订要求 | 当前状态 |
| --- | --- | --- | --- | --- |
| A01 | medium | `cli/main.ts` 默认 directory | 默认值为 `~/.meteor-flow/data`，与已确认 macOS `~/Library/Application Support/Meteor Flow` 不符。统一 serve/open 默认目录，显式 data-dir 不变。 | 作者已修，待复查 |
| A02 | high | `terminal/bridge.ts` socket message handler | 每条 input/resize 未检查 heartbeat 到期，只靠每秒 timer 撤销；超过 15 秒但 timer 尚未执行的窗口仍接受旧控制输入。发送前直接验证 lease 有效期，过期立即 release；受控时钟推进且不执行 interval，断言旧 input/resize 无 stdin 副作用。 | 作者修订中 |
| A03 | high | `application/console.ts` emergencyInterrupt | 入口检查只读故障模式后 await listAgents，调用中断前不重核 store 模式/故障 generation/port/stopped；恢复或连接改变后仍可发送未记账中断。隔离 gate 探针恢复 healthy 后实际得到 1 次模拟 interrupt（`application-review-emergency-race.json`）。固定故障代和端口，最终调用前重新校验仍是同一不可写故障状态与目标身份，失效返回明确未发送。 | 作者修订中 |
| A04 | medium | `http/server.ts` artifact handler；`http/files.ts` | downloads 在 reply.send 后的 finally 立即减计数，慢客户端仍持有至多 50 MiB 的响应 Buffer，4 个名额仅约束读取过程；请求断开也不取消对应读取 child。保留名额直到响应 finish/close，断开/服务关闭终止并回收本请求 reader。验证第 5 请求、慢响应及断开/关闭边界。 | 作者修订中 |
| A05 | medium | `http/server.ts` 路由与事件 | 确认方案 §10 要求 `/api/v1`、独立 attempts/inputs、preview/download、events SSE+Last-Event-ID；首轮只有未版本化 `/api/*`、合并 content 与状态轮询。不能将其报成完整接口已交付；补齐版本边界/承诺接口和事件校准，可保留旧客户端别名。 | 作者修订中 |
| A06 | medium | `terminal/bridge.ts` attach/frames/close | observer 替换后旧 child 的 frame 回调仍查当前 viewers，不核对 current.child===child，SIGTERM 至 close 之间旧缓冲帧会混入新观察画面；旧进程提前离开 map，关闭未等退出。按来源 child 过滤帧，跟踪活跃和退出中进程并有界回收；测试替换后旧帧不得送新页面、关闭后进程退出。 | 作者修订中 |
| A07 | high | `adapters/herdr/index.ts` 新增 waitForShell/start | 单请求 request 会校验自己的 generation，但整个多步 start 不固定连接代；shell 等待的 delay 期间 close/reconnect 后，旧 start 可继续使用新代调用 agent.start。固定整个 start 的 generation，在创建后、每轮等待和最终启动前校验；重连后保留已知 target/不确定结果，不能继续旧副作用流程。 | 已交作者 |
| A08 | medium | `http/auth.ts` WebSocket Origin | boundary 允许无 Origin 的 GET，故有效 Cookie+CSRF 但缺 Origin 的 WS 能升级；未落实方案 WS exact Origin。WS require 显式要求 Origin==本机 origin，测试缺失/null/外站 Origin 均拒绝。必须已有有效凭据才能触发，未声称可绕过 Cookie 认证。 | 已交作者 |
| A09 | high | `adapters/herdr/index.ts` prompt/interrupt 的 target | 真实专项由作者发现管理 API 不接受 terminal ID；独立对照 v0.9.0/v0.9.3 `terminal_targets.rs::resolve_agent_target` 确认为 public pane ID 或 managed name，原模拟误接受了 terminal ID，真实派发/中断因此被拒绝。每次完成快照建立 terminal→pane 映射，同连接代且新鲜才允许同步单次发送；失效/缺失拒绝，不在应用最终 guard 后新增 await；prompt 响应核对 terminal，不确定结果不得重试。 | 作者修订中 |

## 已执行与测试质量

Node 24.21.0 server build 退出 0，见 `application-review-build-initial.log`；初始 application 9 项、HTTP/WS 5 项，独立 **14/14 通过**，见 `application-review-tests-initial.log`。使用真实 SQLite/DB worker/采集 child/HTTP listener/WS 与专用 terminal fixture，仅 herdr 外部边界模拟。原测试有可控 prompt ACK gate、最终派发前读取 gate、存储 fault 事件边界，强于定时 sleep 猜测；但未覆盖上述新发现。

`application-review-emergency-race.json` 是隔离探针：在真实应用+临时 DB、模拟 Herdr 的 listAgents gate 期间将 store.healthy 从故障恢复为 true，观察到未记账中断仍发出。这是针对最终 guard 的可控故障注入，不冒充完整真实 DB 恢复 E2E；临时目录已清理，没有真实终端收到中断。

real-agent.test.ts 仅只读审查：显式 opt-in、随机 session 和临时 XDG/cwd、固定小任务、用户配置写保护/前后哈希、不自动确认信任/登录/审批。父 agent 已告知用户明确授权真实 payload，早期 automatic approval 拒绝及之后 name/busy 失败必须保留在专项日志；本 reviewer 没有重跑或把仍在执行的模型链路记为通过。新 waitForShell 是根据真实 busy 失败增补的行为，须独立核对，不能以原模拟通过作证。

## 中间修订复核（保留原始阶段记录）

独立运行 adapter 23 项与 terminal 22 项，**45/45 通过**，见 `application-review-adapter-terminal.log`；对应四个候选 SHA 在 `application-review-adapter-terminal-baseline.json`，最终冻结仍须再比对。新增 terminal 用可控单调时钟在不执行 interval 时推进到 15 秒，分别断言 input/resize/heartbeat 不会续租或写入；模拟 exit 与 close 分离，断言旧帧隔离、替换等待 close、未退出进程继续占容量、关闭升级 SIGKILL。该单元测试只替代子进程边界，不冒充真实 herdr 终端集成；HTTP 另有真实 CLI fixture。

源码已核实 CLI 默认目录、故障代最终检查、WS exact Origin、同一 start 连接代，以及 terminal 消息版本与控制申请的 generation/session/storage/fingerprint 核验。A04 二次复读发现 child 已结束但慢响应仍未 finish 时也需被服务关闭清理；作者已补下载响应集合，等待慢客户端用例。A05 已补 v1、attempt/inputs、operation 查询和 SSE。首轮完整 `(path,status)` 交代见 `application-review-scope-initial.json`：152 个可审项中本批 14 项 reviewed、138 项 skipped，另 173 项保留 OCR 排除理由；该比例不是业务或测试覆盖率。

作者报告的宿主 `Fatal error: application network permission was revoked` 中断保留为中断事实，不视作任何审查或测试通过。本 reviewer 当前本地只读工具及隔离模拟回归可用；未访问网络、未更改或绕过宿主网络权限。

## 六类场景与跨批边界

| 类别 | 需求/验收 | 初始测试与审查结论 |
| --- | --- | --- |
| 状态迁移 | R03—R07/R09；V01—V06/V11/V12/V18 | 既有 Agent 无托管 ready 仍可明确接入；手动切换后不派发；取消等待 ACK 可接受并保占；终端退出保持暂停。真实托管 Agent 就绪仍属专项，A07 待闭。 |
| 幂等 | R03/R04/R06/R09；V03/V04/V06/V26 | 重复启动仅一个 intent/start，响应丢失后不重发；HTTP 重复创建项目一次；同连接 token 与 epoch、两页抢控制只一方成功。A02 是有效期遗漏。 |
| 时序 | R06/R09；V11/V18/V19 | ACK 等待期间取消一次中断、最终检查前 manual 零 prompt；旧页面/偷 token 输入不写 stdin。A02/A03/A06/A07 覆盖尚缺时序。 |
| 恢复 | R03/R12/R13；V04/V05/V24/V25 | 服务重启保留未知投递/占用且撤销授权；未决启动不再创建；存储在 intent 后失效零 start。紧急中断恢复竞态 A03、进程关闭 A04/A06 待闭。 |
| 关联 | R04/R08/R10/R11；V07/V13/V16/V17/V28 | 检查所有资源 ID 到绑定/session/currentAttempt 的服务端关系；产物 URL 仅 artifact ID，child 按已存 root/file/hash 读取；独立 tasks/attempt/inputs 和事件契约 A05 待齐。 |
| 隔离 | R09—R11/R14；V20—V22/V26/V27/V29 | loopback、Host/external Origin/CSRF/Cookie 拒绝用例通过；工作目录/授权输出与私有目录重叠拒绝；固定 argv 不走 shell。A08 的 WS 缺 Origin、A04 的慢下载界限待补。完整负载和浏览器验收未在本批执行。 |

只读 observer 的 `--cols/--rows` 经 v0.9.3 `server/headless.rs::observe_terminal_client` 核对仅设置观察连接尺寸/渲染基线，未把它误报为直接调整实际 PTY 尺寸。终端接管允许用户显式手动使用，不能把自动调度所需 confirmed 标记擅自扩大为所有手动输入的新增前置要求。R10 不宣称抵御同系统用户恶意进程，本批不添加该权限边界。

## 最终复查与问题关闭

最终认领 **27 个候选文件**，路径与 SHA-256 逐项见 [application-review-baseline-final.json](application-review-baseline-final.json)。范围包含首轮 14 项、新 SSE 与终端测试、adapter 两项、父链 POSIX 三项、性能测试及两个 fixtures、CLI 集成测试、Store 测试与 SQLite_FULL fixture。其余 core 文件只读关联，不冒充重复审查。原始最终 preview/rule 分别为 [application-review-preview-final.json](application-review-preview-final.json)、[application-review-rules-final.json](application-review-rules-final.json)；规则已独立核对，仍为已应用的六组语言/项目规则，无新增规则内容。

[application-review-scope-final.json](application-review-scope-final.json) 对 **424 个 `(path,status)`** 全部给出交代：160 项可审文件中 27 reviewed、133 skipped（本批认领比例 16.875%），另 264 项保留 OCR 排除原因和 reviewer 理由。历史报告、自身审查证据、其他批次与前端均不当作本批产品代码覆盖；所有本批候选均在可审清单中，无静默遗漏。该比例不表示代码正确性、业务或测试覆盖率。

| ID | 最终结论与依据 |
| --- | --- |
| A01 | closed。serve/open 共用 `~/Library/Application Support/Meteor Flow` 默认目录；显式路径仍可选。完整读取最终 CLI。 |
| A02 | closed。每条控制消息在发送前验证 `0 <= monotonic age < 15000`，过期 heartbeat 不能续租；每条输入还核验 connection/token/epoch、存储代、session 和 fingerprint。三种到期边界在不运行 interval 时均无输入副作用。 |
| A03 | closed。紧急中断固定 port 与故障 storage generation，在 await 观测之后、调用前重核仍不可写且未停止，再核对新鲜身份。新测试终止真实 DB worker 后恢复存储，在 gate 内恢复的情况下零模拟 interrupt，关闭原探针复现的缺口。 |
| A04 | closed。下载名额同时等待读取结束和响应 finish/close；断开以 AbortSignal 终止专属 reader，等待 child close；preClose 销毁尚在发送的响应、终止 reader 并等待回收。真实 loopback 50 MiB 文件、4 条暂停响应、第 5 条 429、断开释放以及服务关闭均通过。 |
| A05 | closed。保留 `/api` 兼容别名并提供 `/api/v1`，新增 agents 操作别名、system、operation 回执、attempt/inputs、preview/download、SSE 和 terminals。TypeBox Type Provider 推导新增 handler，错误包含稳定 code、current 与 recoveryActions。SSE 首发快照校准，按持久 seq/Last-Event-ID 回放，有限连接/背压且服务关闭清理；真实接口、404、回执和 SSE 回放测试通过。 |
| A06 | closed。立即隔离旧 observer child 输出，等待旧 close 才替换；活跃及退出中 CLI 共用 8 个进程预算，TERM→KILL、有界等待且未确认 close 不释放容量。pending claim 固定身份/代/session，旧 finally 不清新 claim；所有 state/output/error 含协议版本，坏协议关闭。单元边界与真实 HTTP/CLI fixture 均通过。 |
| A07 | closed。start 在文件检查、新 workspace、shell 等待每轮及最终 agent.start 前固定并核对同一连接代。重连发生在等待期间，旧流程保留已知 target 并拒绝，零 agent.start。 |
| A08 | closed。WS require 强制 exact Origin；带有效 cookie/CSRF 但缺 Origin 或 Origin=null 的实际升级请求均 403，未启动 CLI。 |
| A09 | closed。管理操作同步使用最近完成快照的 terminal→public pane 映射，连接失效清空，缺失/超龄/重连后未刷新均零请求；移动刷新映射后发送正确 pane。prompt 错 terminal ACK 保留 uncertain 并关闭连接，不重试。上游 send_keys 只返回 ok，未声称其 ACK 也验证 terminal。 |

父链兼容增量是唯一同类型 Agent 候选加可证明的后代辅助进程，不能宽泛接受任意多进程。独立核对本机 SDK `sys/proc_info.h`：136 字节 proc_bsdinfo 中 PID/PPID 为 offset 12/16，秒/微秒为 120/128。父链限制 64 层、防循环，核对 ancestor start，逐节点重读 start+PPID；adapter 前后再次核对候选 PID/start。真实临时父子进程允许，进程退出、错误/改变 identity、并列进程、重复 Agent 拒绝。历史 core 报告中“仅一个前台进程”的旧实现由本明确增量取代，没有沿用旧结论掩盖改动。

作者另外定位并修复 CLI 在输出“已启动”后才注册 SIGTERM handler 的窗口；最终源码先登记 handler 再输出。只读核查 [cli-full-regression-fixed.log](cli-full-regression-fixed.log) 的作者 6/6（其中 CLI 1 项、Store 5 项），真实 CLI 验证目录 symlink 别名锁、同 session 不同数据目录锁及退出后重取。CLI 测试创建随机专用 session 锁并清理，未访问现有 session；此项没有计入 reviewer 的独立 112 项。

## 最终测试证据与限制

目标 Node 24.21.0 下 POSIX 与 server TypeScript 构建退出 0。独立回归为 [application-review-process-tests.log](application-review-process-tests.log) **66/66**（POSIX 42、adapter 24）和 [application-review-tests-final.log](application-review-tests-final.log) **46/46**（application 10、HTTP 9、terminal 22、Store 5），合计 **112 个不重复用例**；中间 45/45 不重复计数。SQLite_FULL 使用临时 DB 的 `max_page_count` 限制，验证真实事务失败后故障代更换、拒绝后续写入、重开后没有该 operation/event，不填满机器磁盘。六类场景的首轮缺口分别由以上关闭证据补齐，仍不替代其余产品验收。

每组测试运行前后候选 SHA 均一致；最后 46 项结束后，27 候选和 8 项依赖 SHA 立即核对全部一致。随后生成收尾记录时，作者开始性能诊断修改 `storage/database.ts`；该新版本与保存的测试依赖 SHA 不同，**本批通过仅对应保存的旧依赖基线，不覆盖新 DB 实现**。差异如实写入 [application-review-verification-final.json](application-review-verification-final.json)，后续需单独增量审查及复验，不覆盖历史证据。

性能资产已完整只读审查，未再独立重复压力执行。作者 [performance-report.md](performance-report.md) 与 [perf.json](perf.json) 记录分页/操作延迟与两路 1 MiB/s×30 秒吞吐通过，但 RSS 热身后斜率 **1.4928 MiB/s > 1**，固定增长检查失败；目前不足以归因为确定泄漏，也不能宣布内存稳定。后续 DB 诊断/修订仍待验证。

真实模型测试只读审查，不在 reviewer 执行范围。最新版测试继续使用专用 herdr XDG/session/cwd，现有模型配置只读并前后核对，不自动响应登录/信任/工具许可；pane.read 替代错误的 agent.read terminal 目标，允许采集异步完成后再判终态。作者已单独记录 Codex 成功 [real-agents-collection-settle/real-agent-codex.json](real-agents-collection-settle/real-agent-codex.json)；Claude 本轮仍在专项复测，旧 blocked/失败不改写为成功。更新“可用”提示已不作为必须交互的证据；这不授权自动确认升级。平台审批/宿主中断、原 name/busy/目标解析失败均保留历史。

herdr 0.9.x 的 agent API 缺少 terminal compare-and-send：完成快照到服务端消费 pane 定位之间，外部并发移动仍不具原子核对保证。本实现同步发起单次请求、使用新鲜映射、失配结果保持未知，未额外引入本地异步检查窗口；该上游能力限制须继续展示在兼容记录中。人工验收、最终 UI/浏览器验证、性能增长诊断及后续 DB 变更仍由主流程汇总，本报告不签署整体验收。

收尾的再次 SHA 核对还检测到 `tests/fixtures/performance-server.ts`、`tests/integration/performance.test.ts` 已随性能诊断改变。旧 27 文件基线、原始 preview/rule 和失败性能证据均保留，不把审查时版本替换成尚未读审的新内容；三项待后续增量的旧/新 SHA 见 [application-review-post-freeze-changes.json](application-review-post-freeze-changes.json)。本批其他 25 个候选未变，A01—A09 关闭不涵盖这三项新差异。报告本地链接已核对有效。
