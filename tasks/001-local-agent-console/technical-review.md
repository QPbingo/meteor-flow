# 技术方案独立审查

后续状态说明（2026-10-07）：下文“待人工确认”等表述保留 2026-10-06 审查时的历史状态。用户后续已于 2026-10-06 确认 Node 技术方案 0.2 并明确授权开始实现，详见 [技术方案确认记录](technical-design.md)；实现与验证进度见 [实施记录](implementation-progress.md)。无需重复申请方案或实现授权，最终人工验收仍为 pending。

当前审查对象：**Node 技术方案 0.2**。日期：2026-10-06。状态：独立审查及作者修订复查完成，N01/N02 两项 high 已在方案层关闭，当前无未关闭 findings；具体技术方案待人工确认。0.1 的审查完整保留在下方历史部分，其结论不用于替代本轮 Node 方案审查。

## Node 0.2 审查结论

作者上下文为 `/root`，独立 reviewer 为 `/root/technical_review`；reviewer 未修改作者候选。基线仍为 HEAD `618607de5d6b3b22d44258950236273c37bd8079` 上的 workspace，当前五项作者候选哈希见 [本轮基线](verification-runs/20261006-node-design/reviewer-baseline.json)。首次哈希落盘时作者修订已经发生，因此 reviewer-baseline-round1.json 也属于修订后内容，未声称保存了修订前内容哈希；原始问题由首轮 preview、当时全文读取及 [摘录说明](verification-runs/20261006-node-design/reviewer-source-notes.json) 支撑。

方案已按用户要求统一为 TypeScript/Node。Fastify/TypeBox 共享契约、独立 better-sqlite3 DB worker、Koffi 窄 POSIX 适配和可终止采集子进程的组合可作为待确认技术方案；没有发现必须更改已确认产品需求的冲突。本轮最主要的两个问题是 DB writer 恢复及采集发布缺少退出屏障，已由作者修订并经独立复查关闭。**可提交技术方案人工确认，不表示产品实现或验收通过。**

## Node 0.2 原始发现与关闭依据

### N01 · high · DB 确认丢失后的恢复缺少旧 writer 退出屏障

- 位置：`technical-design.md` §3，首轮行 68—70；类别 bug；首轮 open，复查 fixed（方案层）。
- 首轮方案在 DB worker 异常或确认丢失后要求关闭派发并“持锁重开数据库”，却未区分旧 worker 已退出与仍在执行/等待的情况。主进程持有的数据目录 flock 不能阻止该进程自身建立第二条 worker；旧事务及延迟回复可能在恢复后继续，破坏单 writer 和按持久化事实触发副作用的边界。
- Node 的 `terminate()` 是异步终止请求，其 Promise 在 worker 的 exit 事件发生时完成；请求终止或等待超时不能替代退出证明。来源：[Node 24 worker 生命周期](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html#workerterminate)。
- 作者修订：每条命令/回复关联 storage_generation 与 request ID，确认丢失即使该代失效、停止入队并拒绝迟到回复和后续副作用；只有观察旧 worker exit 后才能创建下一代 writer。无法确认退出则保持暂停，必要时整个服务退出后由新主进程重新取得 OS 锁恢复；重开后查询 operation/intent，不重放 prompt。
- 复查：§3 已明确上述顺序；实现计划 V04/V24 已补 barrier，将旧 worker 分别停在 commit 前及 commit 后回复前且仍存活，断言退出前无第二 writer、无恢复派发、迟到回复无副作用。符合 R02/R06/R12/R13；实际故障测试仍待实现后执行。

### N02 · high · 采集完成消息与归档发布之间缺少写入者退出和代际隔离

- 位置：`technical-design.md` §3、§8、§9，首轮行 70、172—179、185；类别 bug；首轮 open，复查 fixed（方案层）。
- 首轮已限制子进程只能写 staging，但没有说明完成 IPC 与子进程停止写入的关系。子进程发出消息时可能仍持有写 fd；父进程若此时 rename，原 fd 仍可能修改已经发布的归档。父进程崩溃后，遗留子进程及其 staging 也缺少明确的重启归属和失效规则。
- Node 的消息、进程 exit 及 stdio close 是不同事件；退出和通道关闭需分别处理。来源：[Node v24.21.0 子进程文档](https://github.com/nodejs/node/blob/v24.21.0/doc/api/child_process.md#event-close)。本问题是基于生命周期推导的方案缺口，不冒称已复现产品缺陷。
- 作者修订：采集 job 绑定 service generation、不可复用 job ID、attempt、独立 staging、PID/启动时间；先持久化 intent，子进程等待握手，登记进程身份后才允许写入，且不派生写进程。完成消息仅是候选结果；主进程须确认 child exit、stdio/IPC 关闭、成功退出和当前 job/attempt 有效，再复核类型/大小/hash、fsync，才 rename 并登记发布。
- 重启修订：旧 generation 全部失效，旧 staging 不复用、不直接发布；确认遗留进程身份及退出后才清理，身份/退出不明时隔离保留并计入容量。只恢复核验已 rename 的 archive generation，并重新检查业务状态。
- 复查：§3/§8/§9 已形成完整顺序；计划 V09/V24/V25 已补“完成消息后仍持 fd”“父死子活”“取消后迟到完成”等 barrier 用例，断言不提前发布、不复用旧 staging、不边写边清理、不绕过容量。符合 R05/R06/R08/R11/R12/R13；实际集成测试仍待执行。

## Node 0.2 独立能力核对与限制

本上下文重新完整读取当前仓库 AGENTS、workflow、skill-prerequisites、三项项目技能和六类场景；test-master 本轮重读 unit-testing、integration-testing、testing-anti-patterns，e2e/security 引用在此前同一上下文已完整加载且没有变更。未继承作者技能就绪或自审结论。

按本次用户新增约定加载 capture-constraints：仓库指定路径缺失，读取可用来源 `/Users/heybox/.codex/skills/capture-constraints/SKILL.md` 及完整 index/rules。复用 R-002：目标是本机 macOS arm64 的新产品，没有现存线上部署；先核对隔离 Node 及实际 SQLite，再运行探针。R-001 限于小黑盒搜索模块，本次不适用。没有修改规则库或把该个人来源伪称为项目适配。

| 核对项 | 当前 reviewer 的实际动作与结论 |
| --- | --- |
| 项目技能和 OCR | 独立 doctor、OCR version、preview、rule 均退出 0；OCR 固定 v1.12.12。日志、原始 preview/rule 在本轮目录 |
| 目标运行时 | 独立执行隔离 Node 读取版本：v24.21.0，darwin/arm64，ABI 137；随后只读查询内存 SQLite：3.53.4；Koffi 3.3.2、better-sqlite3 13.0.3 |
| 原语探针 | 先读完整 probe.cjs，核对 SHA-256 与作者记录相同，再独立运行，退出 0；证据见 [reviewer-node-capability-probe.json](verification-runs/20261006-node-design/reviewer-node-capability-probe.json) |
| 文件/锁/DB 观察 | openat 普通文件读取、符号链接拒绝、FIFO 非阻塞拒绝、bigint 元数据、进程锁竞争与释放、CLOEXEC 标志、真实 DB worker 中 WAL/FK/FULL 和事务回滚均通过该原语探针 |
| 原生接口可行性 | 阅读已安装 Koffi 对 variadic、errno 和整数转换的说明；openat/fcntl 使用 variadic 签名，固定系统库/符号/flags 的适配范围合理。文件身份用 bigint 再转十进制字符串可避免 JS Number 精度丢失 |
| HTTP 契约 | 核对 [Fastify Type Provider 官方说明](https://fastify.dev/docs/latest/Reference/Type-Providers/)，TypeBox 类型推导与 schema 验证方向相符；方案已另外要求 WS/SSE/结果运行时校验及重复 JSON key 拒绝，未把静态类型当验证 |
| SQLite 事务 | 核对 [better-sqlite3 v13.0.3 API](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/docs/api.md)，同步完整事务留在唯一 DB worker，跨系统操作放在持久化确认之后，避免事务中 await |
| herdr | 重读当前兼容文档；Node net NDJSON/官方终端 CLI 路径没有改变已核对的版本事实。没有连接用户 session，也没有将旧 CLI schema 当成当前服务端或 Node 集成通过 |

该探针没有覆盖目录替换竞争、主进程崩溃及子进程继承、DB 确认丢失，也没有验证 N01/N02 的最终实现。能力探针源码仍在 `/tmp`，仅作为临时能力核实；不把它当产品代码或完整持久验收资产。没有创建产品 package/源码，也没有运行产品 Vitest、Playwright 或 Impeccable。后续编码仍须先固定完整依赖与引入必需技能。

## Node 0.2 需求与六类场景复核

已重新对照已确认需求 0.2 及 V01—V29；实现计划逐项保留全部验收编号并增加 Node 生命周期用例。0.1 的业务规则在新文本中逐项核查，没有仅引用旧“通过”结论。

| 覆盖 | 本版审查结论 |
| --- | --- |
| R01/R03/R04/R05/R07；state-transition | 任务/agent/连接/控制仍分离，投递前 idle/done、非 launch_pending 和身份核验保留；结果、归档与结束证据共同终态，无结果 idle 不成功 |
| R02/R03/R06；idempotency | operation ID、活动唯一索引、完整 DB 事务、单主进程锁与 session 锁保留；N01 补充确认丢失后的单 writer 恢复和旧回复失效 |
| R06/R08/R09；ordering | 取消/成功仍以事务接受顺序仲裁，控制 epoch 和输入冻结保留；N01/N02 新增 DB commit/回复/退出及采集完成/退出/取消的 barrier 次序 |
| R02/R11/R12/R13；recovery | 启动先核对，不重放 prompt/start/interrupt；N01/N02 把线程和子进程的存活纳入恢复前置，未退出保持暂停或容量占用 |
| R04/R05/R08/R11；association | task/attempt/manifest/hash 与终端身份仍明确；N02 新增 service generation/job ID，旧采集结果不进入新执行，归档不在写入者存活时发布 |
| R09/R10/R11/R14；isolation | 数据目录/工作目录/输出根、同会话冲突、固定 argv、认证/CSRF/Origin/Host 和预览边界保留；Node openat、非阻塞特殊文件检查、bigint 和子进程独立 staging 落实原要求 |
| R13/R14；版本与负载 | 限量采集进程、DB worker、终端有界队列与性能目标明确；原生能力失败关闭自动管理。Mac 首批/其余未测、实际 SQLite/Node 与候选锁定状态分开，没有扩张兼容声明 |

六类对产品实现均适用，所有产品运行时验收仍 not-run；当前结论只涉及方案的可实施性和完整性。

## Node 0.2 OCR 范围

本轮独立重新执行 workspace preview/rule：tracked 两项按 HEAD diff 核查，新增候选全文审查。逐条 `(path,status)`、排除原因、处理结果和比例记在 [reviewer-scope.json](verification-runs/20261006-node-design/reviewer-scope.json)；它与本轮原始 reviewer-preview.json 一一对应。作者五项候选为 AGENTS.md、README.md、herdr-compatibility.md、implementation-plan.md、technical-design.md，全部 reviewed。本文属于 reviewer 自身历史/当前报告，明确 skipped，不伪称对自己的报告完成独立审查。

历史 `20261006-implementation-preparation/` 证据只作为 0.1 历史和未变 herdr 静态来源，不用于证明 Node 能力；本轮作者 probe/readiness 已手工核查，reviewer 自己生成的日志、哈希和范围记录按审查证据交代。没有删除或被超大文件规则静默排除的作者候选。原始 Node 首轮 preview/rule 单独保留为 -round1.json，哈希采集时序按上文说明；本轮未回写旧运行目录。

---

# 历史：技术方案 0.1 独立审查

日期：2026-10-06。状态：独立方案审查及修订复查完成，T01/T02 已在方案层关闭；技术方案仍待人工确认。适用：需求 0.2 与技术方案 0.1；本轮只审查方案及实现计划，不是产品验收。

作者上下文：`/root`；独立 reviewer：`/root/technical_review`。reviewer 未编写或修复候选文件。审查基线为 HEAD `618607de5d6b3b22d44258950236273c37bd8079` 上的 workspace 改动，具体候选文件哈希见 [reviewer-baseline.json](verification-runs/20261006-implementation-preparation/reviewer-baseline.json)。本文首次产生于 preview 之后，属于审查产物，不是本轮作者候选文件。

## 1. 结论与边界

首轮发现 **1 项 high、1 项 medium**，均为具体实现约束缺口；作者修订后，两项已在方案层关闭，目前无未关闭的 critical/high/medium/low findings。Python/FastAPI/SQLite、React、官方终端 CLI 桥接的职责划分与已确认范围相符；未发现必须修改 R01—R14 的技术选型冲突。方案可提交人工确认，此结论不表示产品验收就绪。

本轮完成了需求映射、时序与安全方案审查、版本化源码核对，以及一个文件打开原语探针。没有运行产品测试、真实 herdr 会话、浏览器 E2E 或 Impeccable；这些属于后续实现验证，缺少产品代码不是本轮方案问题，也不因此创建虚假的产品 report.json。技术方案人工确认、产品技能准备和最终人工验收仍各自独立。

## 2. 可行动 findings

### T01 · high · 派发前缺少明确的 agent 就绪谓词及准备后的重新核对

- 路径：`tasks/001-local-agent-console/technical-design.md`，首轮行 95—99；类别：bug；处理状态：首轮 open，复查 fixed（方案层，见 §6）。
- 派发步骤明确核验身份、目录、连接与本地占用，却没有明确限制新任务只可交给 `idle/done` 且非启动中的 agent；输入复制后只再次检查本地模式、队列和占用。没有 Meteor Flow 占用不代表 agent 没有在做原生终端启动的工作；复制输入期间就绪状态也可能改变。
- 这不能交给 herdr 自动兜底：v0.9.0 自动化说明明确 `agent.prompt` 能向已 working 的 agent 投递；v0.9.3 `src/app/api/agents.rs:111` 的实现只拒绝 blocked、未识别 agent、launch_pending、前台身份失效等情况，没有拒绝 working。因此按目前步骤直接实现可能在旧任务尚未结束时提交新任务，破坏 R03/R04/R07 的派发前核验规则。
- 建议：在准备完成后、进入最终投递仲裁时重新读取身份和状态，定义唯一的可派发谓词；托管 agent 需完成启动就绪，已有 agent 采用接入确认及对应能力检查，不能统一依赖 interactive_ready。working、blocked、unknown、launch_pending、过期读取均不得派发；准备期间条件变化要丢弃该次派发资格并重新评估。保留现有“最终检查与外部输入仍无跨系统原子保证”的限制。
- 补充用例：无控制台占用但 herdr 为 working；输入复制的 barrier 期间 idle→working；托管启动尚未 ready；已有 agent 没有 interactive_ready 但经合法接入且当前 idle。分别断言前三者产生 0 次 prompt，最后一项不被错误永久阻塞。关联 V02/V05/V07/V15/V24。
- 证据：[版本化源码摘录](verification-runs/20261006-implementation-preparation/reviewer-source-evidence.json)。

### T02 · medium · 特殊文件可能在 fstat 拒绝之前阻塞采集 worker

- 路径：`tasks/001-local-agent-console/technical-design.md`，首轮行 162—163；类别：security；处理状态：首轮 open，复查 fixed（方案层，见 §6）。
- 方案规定逐级 openat/O_NOFOLLOW、打开后 fstat，再拒绝非普通文件。O_NOFOLLOW 只阻止符号链接；无 writer 的 FIFO 在普通只读 open 时已经阻塞，尚未到达 fstat。有限 worker 因此可能被占满；单纯取消 asyncio 等待不会中止已阻塞的线程。
- reviewer 在专用临时目录执行原语探针：`O_RDONLY|O_NOFOLLOW` 打开无 writer FIFO 在 0.3 秒内不返回；增加 O_NONBLOCK 后立即取得描述符，并由 fstat 确认不是普通文件。子进程已终止并回收，临时资源已删除。这只证明操作系统原语风险，不是产品测试。
- 建议：中间目录使用 O_DIRECTORY|O_NOFOLLOW；叶子使用不会因 FIFO 阻塞的打开策略，例如 O_NONBLOCK|O_NOFOLLOW 配合 nofollow 预检查和打开后 fstat，非普通文件立即拒绝，所有失败路径关闭描述符。明确结果声明 `result.json`、输入读取和产物读取共享安全读取约束；不要只保护已解析 artifacts 列表之后的读取。
- 补充用例：无 writer FIFO；预检查后普通文件/目录被替换为 FIFO；结果声明文件本身为符号链接或 FIFO。断言及时拒绝、不读取越界内容，另一个合法采集仍能完成。关联 R11/R13、V22/V25。
- 证据：[文件打开原语探针](verification-runs/20261006-implementation-preparation/reviewer-file-open-probe.json)。

## 3. 需求、验收与六类场景覆盖

以下保留首轮方案审查覆盖及当时的缺口，T01/T02 当前处理结论见 §6；不表示功能测试通过。实现计划逐项列出了 V01—V29，没有缺号；具体执行记录仍为 not-run。

| 需求 | 技术方案落点 | 审查结论 |
| --- | --- | --- |
| R01 | §4—5 分离状态、占用与观测 | 覆盖；终态和释放在同事务，idle 不等于成功 |
| R02 | §3—5 intent、唯一索引、去重、单服务锁 | 覆盖；不承诺跨系统恰好一次，不重放未知 prompt |
| R03 | §5—6 新建/已有实例分流 | T01 待补明确就绪谓词 |
| R04 | §5—6 fingerprint、移动、替换、generation | 组合身份方向符合需求；T01 待补准备后的当前状态核验，真实进程证据仍需实测 |
| R05 | §5、§8 明确结果、归档、结束证据 | 覆盖；短任务观测不足保留结果待确认，人工结论不绕过占用和必要产物 |
| R06 | §5 接受序号、取消、重试与迟到结果 | 覆盖；事务接受次序决定胜出，重试新 attempt |
| R07 | §5 可执行队列筛选 | 队首跳过与失败推进覆盖；T01 待补可派发状态 |
| R08 | §4、§8 DAG、revision、输入副本与固定 hash | 覆盖；成功任务复制不覆写下游引用 |
| R09 | §7 控制 token/connection/generation/epoch | 覆盖；只读不 resize、断线不重放、释放不自动恢复调度；CLI 实际行为待后续验证 |
| R10 | §2、§4、§6、§8 真实目录、独立会话与归属 | 覆盖；没有把目录隔离宣称为安全沙箱 |
| R11 | §8 采集、归档、预览 | 路径/引用/配额/CSP 覆盖；T02 待补安全打开次序 |
| R12 | §6、§9 订阅后快照、generation、恢复扫描 | 覆盖；旧事实不能覆盖新事实，重启先核对 |
| R13 | §3、§9、§11 worker、存储降级、配额和性能目标 | 覆盖；T02 防止特殊文件拖住采集能力，性能目标尚未实测 |
| R14 | §2—3、§6、§9—10 版本、模块、迁移与本地认证 | 覆盖；补充后的 bootstrap 轮换与重新打开流程已读；选型仍为候选 |

| 六类场景 | 已核查的具体时序及预期 | 对应验收 |
| --- | --- | --- |
| state-transition | 无结果 idle、结果先到仍 working、结束后终态、停止不明保留占用 | V08/V09/V10/V12/V15；T01 需补派发入口谓词 |
| idempotency | 两页同操作、不同键争抢同执行、启动/投递响应丢失、第二服务实例 | V03/V04/V06/V26；不同页面独立新建任务不按说明文本误去重 |
| ordering | 取消先/后于成功事务，旧控制输入撤权，依赖变更与输入冻结 | V11/V13/V16/V18/V19；计划采用 barrier 而非固定 sleep |
| recovery | intent 后、外部输入后、归档 rename 后/DB 前崩溃；休眠、断线、满盘 | V04/V05/V06/V24/V25；不盲重放、不暴露 staging |
| association | pane 移动/替换、旧 attempt 迟到、上游源变化、被引用对象归档 | V07/V09/V13/V16/V17/V28；按 attempt/manifest 固定关联 |
| isolation | 工作目录重叠、同会话、授权输出根、跨站 HTTP/WS、路径替换 | V18/V21/V22/V23/V26/V29；T02 需补特殊文件打开原语 |

无环依赖、单用户单选定 session、配合式原生终端管理、无自动回滚/沙箱/插件平台均保持原需求。首批 macOS arm64/Codex/Claude 与候选默认值属于 R14 留给技术方案的确认项，未被误写为获批或实测兼容。

## 4. 当前 reviewer 技能就绪与检查

本上下文显式完整读取 AGENTS.md、skill-prerequisites.md、workflow.md、mandatory-scenarios.md，以及三项项目 SKILL.md。另完整读取 test-master 的 unit-testing、integration-testing、e2e-testing、security-testing、testing-anti-patterns 引用，用于方案测试策略审查；没有继承作者的加载状态，也没有使用个人同名技能替代项目适配。

| 技能 | 来源/触发 | 当前结论 |
| --- | --- | --- |
| meteor-flow-verification | 项目 `.agents/skills/meteor-flow-verification/`；独立方案 review | 已在本上下文显式加载；doctor 退出 0，见 reviewer-doctor.log |
| test-master | 锁定 `1be15d8064f88fc25216442406d40add8fd23b53`；测试策略/覆盖审查 | 上述引用已加载；计划审查就绪，不声明 pytest/产品测试环境已就绪 |
| OCR delegate | 锁定 `182898cf522da3d04157b422752d028417974e19`；确定性文件与规则范围 | v1.12.12；version、preview、rule 均退出 0；当前只委托，不配置外部模型服务 |
| Playwright/Impeccable | 本轮未改网页、未执行浏览器或 UI 评估 | 本轮方案审查不适用；后续产品编码仍必须先接入和实测 |
| brainstorming/forge/Spec Kit | 没有新增或更改已确认产品目标/行为 | 本轮不重做已确认需求；T01/T02 落实既有规则 |

实际执行命令包括 doctor、固定 OCR version、delegate preview/rule、候选 diff/全文读取、版本化源码读取、schema hash/字段核对、独立临时目录文件打开探针，均无用户 agent 副作用。能力探针与静态核对不替代实现验收。

## 5. OCR 范围与逐文件交代

采用 workspace 模式；tracked 文件按 `git diff HEAD -- <path>` 审查，新增候选全文读取。[原始 preview](verification-runs/20261006-implementation-preparation/reviewer-preview.json) 的 schema_version=1、repository 与本仓库一致；[原始 rule](verification-runs/20261006-implementation-preparation/reviewer-rules.json) 对以下六项解析项目规则。初次 preview 另外保留为 reviewer-preview-initial.json；首轮正式范围、规则及哈希分别保留为 reviewer-preview-round1.json、reviewer-rules-round1.json、reviewer-baseline-round1.json；实质修订复查同样留存为对应的 -round2.json。最终作者候选以 reviewer-baseline.json 哈希为准。

首轮 `total_files=18`，其中 reviewable 5、excluded 13，五项作者候选全部审查。实质修订复查 preview 的 `total_files=22`，其中 reviewable 6、excluded 16；导航收尾后的最终 preview 为 `total_files=26`、reviewable 6、excluded 20。最终 `reviewed_files=5`、`skipped_files=1`、`coverage_rate=83.33%`。额外一项是 reviewer 自己新建的本文，已显式交代为审查产物，不宣称对自己的报告完成独立审查。五项作者候选覆盖率仍为 100%；所有 preview 条目均已交代。没有删除/超大候选文件需要补查。

| path | status | outcome | 说明 |
| --- | --- | --- | --- |
| `AGENTS.md` | modified | reviewed | 与本轮已给出的实现授权、独立技术确认及技能前置边界一致 |
| `README.md` | modified | reviewed | 文档入口和当前状态一致；没有声称产品已交付 |
| `tasks/001-local-agent-console/herdr-compatibility.md` | added | reviewed | 核对 0.9.0/0.9.3 源码、终端桥接、protocol/字段差异和本机 schema hash；真实能力仍标未执行 |
| `tasks/001-local-agent-console/implementation-plan.md` | added | reviewed | P0—P6、V01—V29、六类场景完整；已复查 V05/V22 针对 T01/T02 的补充 |
| `tasks/001-local-agent-console/technical-design.md` | added | reviewed | 全文含认证恢复/接口表已读；已复查 §5/§8 修订，T01/T02 在方案层关闭 |
| `tasks/001-local-agent-console/technical-review.md` | added | skipped | 本独立 reviewer 生成的报告，不是作者待审实现；为避免自审冒充独立 review 而从候选审查分母中另行说明，不构成未审产品代码 |

以下所有路径前缀均为 `tasks/001-local-agent-console/verification-runs/20261006-implementation-preparation/`；各项 status 均为 added，preview 的 exclude_reason 均为 user_exclude。证据目录排除是项目规则，不能据此跳过支撑方案判断的证据。

| 文件 | outcome | 排除及核查说明 |
| --- | --- | --- |
| `doctor.log` | reviewed-manually | 作者准备证据；与当前 reviewer 独立 doctor 结果一致 |
| `document-checks.log` | reviewed-manually | 文档链接/编号/diff 格式检查记录，明确不是产品测试，收尾时已读取 |
| `environment-probes.log` | reviewed-manually | 本机 CLI/help/工具版本只读输出；未被当成真实集成 |
| `herdr-0.9.3-schema.json` | reviewed-manually | 导出证据非业务代码；核对 hash、protocol、AgentInfo、process 字段及源码，未因大文件静默忽略 |
| `ocr-version.log` | reviewed-manually | 固定版本日志；reviewer 另行执行验证 |
| `reviewer-baseline-round1.json` | not-applicable | 首轮候选哈希留档，保留原问题对应基线 |
| `reviewer-baseline-round2.json` | not-applicable | 实质修订复查哈希留档，保留 README 导航补充前基线 |
| `reviewer-baseline.json` | not-applicable | reviewer 生成的哈希记录，不是作者候选实现 |
| `reviewer-doctor.log` | not-applicable | reviewer 当前能力检查原始输出 |
| `reviewer-file-open-probe.json` | not-applicable | reviewer 原语探针结果；其观察已用于 T02，非产品测试 |
| `reviewer-ocr-version.log` | not-applicable | reviewer 固定 CLI 能力输出 |
| `reviewer-preview-initial.json` | not-applicable | 初次范围证据，避免覆盖历史 |
| `reviewer-preview-round1.json` | not-applicable | 首轮完整审查范围留档 |
| `reviewer-preview-round2.json` | not-applicable | 实质修订复查范围留档 |
| `reviewer-preview.json` | not-applicable | 本次最终范围原始输出；重定向捕获时自身大小为 0 属正常自引用现象 |
| `reviewer-rules-round1.json` | not-applicable | 首轮项目规则留档 |
| `reviewer-rules-round2.json` | not-applicable | 实质修订复查规则留档 |
| `reviewer-rules.json` | not-applicable | 确定性规则原始输出，已用于五项候选审查 |
| `reviewer-source-evidence.json` | not-applicable | reviewer 版本化源码摘录及哈希；用于事实判断，不是项目实现 |
| `skill-readiness.md` | reviewed-manually | 准备状态与未完成能力如实分开；独立 reviewer 状态以本文为准 |

## 6. 2026-10-06 修订复查

作者在独立上下文收到 findings 后修订 technical-design.md 与 implementation-plan.md；reviewer 重新读取修改段落、验收映射和 tracked diff，重新执行 preview/rule（退出 0），并重新计算作者候选哈希。AGENTS、README、herdr-compatibility 的内容哈希与首轮相同。未覆盖或删除首轮 findings、preview、规则和哈希。

| 问题 | 关闭依据 | 仍需后续验证 |
| --- | --- | --- |
| T01 high | §5 步骤 2 明确 idle/done、launch_pending=false、新鲜身份和托管/已有就绪分流；步骤 5 在输入准备后重新读外部状态，并再由本地命令处理器核验 intent、模式、epoch、占用。条件失效记录尚未发送并暂停。计划 V05 补充 working 前置和准备期间 idle→working 的 barrier 及 0 prompt 断言，V01/V02 保留两类接入 | 产品实现后执行这些用例；最终外部原生竞争间隙仍是已确认限制 |
| T02 medium | §8 明确目录 O_DIRECTORY|O_NOFOLLOW、叶子 nofollow stat 与 O_NONBLOCK|O_NOFOLLOW、打开后身份和普通文件检查；统一覆盖 result.json、恢复和输入源；错误关闭 fd，明确不能用 asyncio 取消冒充底层停止。计划 V22 补充无 writer FIFO、目录替换竞争、及时拒绝和其他采集不受阻塞 | 产品实现后执行真实文件/进程用例；本次原语探针不证明最终采集器通过 |

复查未发现新的可行动问题。两项关闭仅表示实现方案和验证要求已修订；技术选型仍待人工确认，所有产品用例仍未执行。后续实现或约束变化需建立对应新的测试与独立代码审查基线。

收尾核对：README 新增的本文入口路径有效，skill-readiness.md 新增的审查完成事实及 document-checks.log 链接与实际记录一致；仅更新 README 候选哈希和最终 preview/rule，其他四项作者候选哈希保持不变。上一轮证据已保留为 -round2.json，无需重复实质审查或原语探针；结论不变。
