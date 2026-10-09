# 本地 Agent 控制台技术方案

| 项目 | 内容 |
| --- | --- |
| 方案版本 | 0.2 |
| 日期 | 2026-10-06 |
| 状态 | 用户于 2026-10-06 确认本版技术方案，并明确要求开始实现；实现和验收尚在进行 |
| 适用范围 | 已确认需求 0.2，R01—R14、V01—V29 |
| 实现授权 | 用户本轮明确要求实现 task 001；保留该授权，技术方案确认后无需再次询问是否开始 |
| 关联 | [需求](requirements.md)、[需求 review](review.md)、[实现计划与验收映射](implementation-plan.md)、[接口事实](herdr-compatibility.md)、[技术 review](technical-review.md)、[本轮准备记录](verification-runs/20261006-node-design/skill-readiness.md) |

本方案不改变已确认产品行为。用户于 2026-10-06 回复“我觉得没问题，请开始实现”，确认下列技术、默认值、兼容目标及实现逻辑。产品编码在适用技能实际就绪后开始；确认方案不代表运行时能力已经验证。

0.2 修订依据：用户明确要求“尽量使用 node 系进行开发”。产品前后端、CLI 和测试统一使用 TypeScript/Node；SQLite 与 POSIX 能力通过 npm 原生模块接入。已有 Python 工作流脚本继续作为开发工具。0.1 的投递、归档、隔离和恢复要求继续有效；旧版技术审查不自动证明新选型可行。

## 1. 建议选型与取舍

| 部分 | 建议 | 选择理由与代价 |
| --- | --- | --- |
| 本地服务 | Node.js 24 LTS、TypeScript、Fastify 5，单一调度主进程 | node:net 管理 Unix socket，child_process 管理 CLI 流；禁止 cluster/多实例各自启动调度器。采集子进程和 DB worker 没有调度权 |
| 持久化 | better-sqlite3，独立 DB worker；WAL、foreign_keys=ON、synchronous=FULL，显式 SQL 迁移 | npm 原生模块提供 SQLite，无需额外数据库服务。同步 SQL 不阻塞主事件循环；文件归档与 DB 仍须实现恢复协调 |
| 前端 | React 19、TypeScript、Vite，普通 CSS tokens | 列表、详情、终端及多页面状态有明确边界；不需要 SSR，前后端统一语言与工具链 |
| 接口契约 | TypeBox、Fastify Type Provider、@fastify/swagger；共享 packages/contracts | 同一 JSON Schema 推导 TypeScript 类型并执行运行时校验；HTTP、WS/SSE、结果文件都不能只靠静态类型 |
| OS 能力 | Koffi npm 原生 FFI 模块，封装固定 POSIX openat/flock/fcntl 调用 | Node 标准 fs 没有完整目录描述符相对打开与 flock 接口；使用一个窄 TypeScript 适配包，不另建 Python/Rust 服务或自写 C 扩展 |
| 页面路由与数据 | React Router、TanStack Query | 明确详情 URL 与刷新恢复；缓存不参与调度决策，写操作关闭自动重试 |
| 界面组件 | 原生表单/表格；Radix Dialog、AlertDialog、Tabs；Lucide 图标 | 复用焦点管理和键盘行为；仅引入实际使用的组件，不安装完整后台模板 |
| 网页终端 | @xterm/xterm、@xterm/addon-fit | 展示 ANSI 流和产生用户输入；控制方才发送尺寸变化，只读方仅调整自己的显示区域 |
| herdr 管理接口 | Unix socket 上的逐行 JSON API；终端通过固定路径 herdr CLI 的 observe/control JSON 流 | API 适合持久订阅与显式请求；CLI 已处理二进制终端协议，避免自行复制其编码器。CLI 与服务端需匹配受支持版本 |
| 预览 | Markdown 解析关闭 raw HTML，DOMPurify 白名单净化；JSON/文本转义；图片只预览 PNG/JPEG/WebP/GIF | 不执行 HTML/SVG，不自动加载远程图片、字体、嵌入内容；其他文件走下载 |
| 测试 | Vitest、Fastify inject、真实 HTTP/WS；Playwright Test；Impeccable audit/critique；OCR 委托 | 分别验证业务、真实本地资源、浏览器及独立审查；inject 不替代真实端口/连接测试 |
| 工具管理 | pnpm workspace、单一 pnpm-lock.yaml；Node 24 LTS | 前后端和 CLI 共用依赖管理；固定 packageManager、Node 版本及允许构建的原生包。系统 Node 25 不作为兼容验证依据 |

Fastify 提供独立常驻服务和明确的 schema/插件边界，适合本项目 socket、终端流及调度；首版无需 NestJS 的额外模块框架或 Next.js 的服务端渲染。第一版不引入 Redis、任务队列服务、容器、ORM、插件体系或桌面壳。

原生适配只接收经过验证的目录描述符、单个路径组件和固定操作，不接受用户指定的动态库、符号、指针或 flags。原生模块加载或平台能力检查失败时关闭自动管理，不降级为 realpath 检查后直接按路径读取。Koffi 是增加的安装/ABI 成本，必须在目标 macOS arm64、固定 Node 版本下实测；Linux 仍为待验证目标。

组件的具体稳定补丁版本在方案确认后的依赖准备步骤核验、锁定并记录；补丁选择不能改变本方案能力边界，重大替换需另行说明。

## 2. 兼容与部署范围

- 首批交付目标为本机 macOS arm64；Linux x86_64 为后续待实测目标，Windows 不在第一批交付承诺内。
- herdr 0.9.0 是需求接口基线；当前本机 CLI 0.9.3/protocol 22 是首轮真实验证目标。0.9.0 保留契约测试，但在实际运行测试完成前不声称已通过兼容验收。
- 首批 agent 为 Codex CLI、Claude Code；逐一测试托管启动、已有实例接入、结果提交、人工介入。其余类型只开放已验证的观察/手动能力。
- 准备期核验 CLI 和静态 schema；2026-10-07 已在独立 0.9.3 session 完成 Codex/Claude 固定任务及官方终端流测试，具体证据与限制见 herdr-compatibility.md。CLI 版本不等于运行中 herdr 服务端版本。
- 服务只绑定 `127.0.0.1`，默认端口 4317；单进程同时提供构建后的前端与 `/api/v1`。关闭浏览器不停止服务。
- 默认数据目录 macOS 为 `~/Library/Application Support/Meteor Flow`，支持显式 `--data-dir`。目录 0700、私有文件 0600；数据目录与所有 agent 工作目录/授权输出目录不得重叠。
- 构建后 `pnpm start -- serve --session <已选择会话>` 启动服务，`pnpm start -- open` 重新打开入口；`pnpm dev` 为开发服务与 Vite 代理入口，使用步骤和所测边界见 usage.md。
- 不安装系统常驻服务，不自动启动、停止、升级用户已有 herdr。用户可单独保持 Meteor Flow 进程运行。

## 3. 模块边界

```text
apps/web/                  页面、共享契约调用、xterm 终端组件、浏览器 e2e
apps/server/src/
  api/                     HTTP/WS 鉴权、参数校验、错误响应
  domain/                  状态、命令、依赖图、不变量；不导入 Fastify/herdr/SQLite
  application/             串行命令处理、调度、启动恢复、超时处理
  adapters/herdr/           JSON RPC、事件订阅、身份与能力判断
  terminal/                observe/control 子进程、控制权与有界帧队列
  results/                 结果协议、文件采集、归档发布、恢复扫描
  storage/                 SQLite 仓储、迁移、备份、OS 进程锁
  cli/                     serve/open、本地配置与固定参数解析
packages/contracts/        TypeBox schema、协议类型、运行时验证入口
packages/posix-fs/          窄 POSIX 适配、平台能力检查；只供服务端使用
tests/                     单元、隔离集成、真实 herdr 与故障测试
```

业务命令都进入一个服务端命令处理器，按接受顺序提交数据库。单一 `worker_threads` DB worker 独占 better-sqlite3 连接；主进程向它发送完整事务命令，而非可交错的 begin/SQL/commit 消息。事务函数同步执行，事务中不等待 herdr、浏览器、IPC 或大文件。跨系统副作用必须先登记 intent 并收到持久化确认，离开事务后调用，响应再作为新命令回到处理器。

DB worker 的每条命令/回复绑定 `storage_generation` 与 request ID，operation ID 仍用于持久化幂等。异常或确认丢失时立即关闭派发入口、标记存储状态未知并使该代失效；拒绝该代所有迟到回复及其后续副作用，不凭 Promise 超时重发外部命令。先停止入队并请求终止旧 worker，只有观察到其 `exit` 后才能建立下一代唯一 writer；调用 terminate 或等待超时都不算退出。不能确认退出时保持暂停，必要时退出整个服务，由新主进程重新取得 OS 锁后恢复。即使主进程仍持有 flock，也不得绕过该退出屏障重开 writer。恢复后按 operation/intent 查询已提交事实，并执行第 9 节核对流程。

文件复制与散列由数量受限的 Node 子进程执行，主进程负责 deadline、取消、终止和回收；子进程只能写指定 staging，不派生其他写进程、不访问业务 DB、不投递 prompt、不发布归档。采集 job 绑定 service generation、不可复用 job ID、attempt、独立 staging 与进程 PID/启动时间；先记录 job intent，子进程等待启动握手，主进程持久化进程身份后才许可写入。IPC 断开时子进程主动退出，但不能假设此回调能打断阻塞中的原生调用。IPC 完成消息只是候选结果，必须满足第 8 节退出屏障才可发布。CLI 输出异步读取且有界，采集或终端背压不能堵塞主调度。

## 4. 存储、不变量与幂等

主要表：

| 表 | 关键内容 |
| --- | --- |
| projects | id、名称、工作根目录、归档标记 |
| sessions | 选定会话、明确 socket 路径、实际版本/能力、连接 generation |
| agent_bindings | 项目、身份 fingerprint、工作目录、会话证据、观察/自动/手动模式、暂停原因 |
| tasks | 指定 binding、说明、产物要求、revision、创建顺序、当前 attempt、归档标记 |
| dependencies | 同项目 task 边、所需上游产物选择；禁止自环和有向环 |
| attempts | 不可复用的 UUID、编号、阶段、冻结输入、投递/取消 intent、活动占用、终态来源 |
| input_snapshots | 上游 task/成功 attempt/artifact/hash 与本次输入副本路径 |
| results / artifacts | 原始声明、协议版本、收集状态、不可变 manifest、文件散列和来源 |
| operations / events | 幂等键、请求摘要、结果；单调递增接受序号、状态变更、人工证据、观测缺口 |
| schema_migrations | 版本、校验值、时间；未知高版本拒绝写入 |

约束：

1. `attempts` 对 `task_id`、`binding_id` 分别建立 `WHERE occupies_agent=1` 唯一索引，活动执行包括投递中、待确认、取消中及结果已收到但未停止者。
2. 接受创建/重试/取消/接管等操作时，用客户端生成的 `operation_id` 和规范化请求摘要去重。相同键相同请求返回原结果，不同请求返回 409。不同页面即使使用不同键，也不能绕过活动执行唯一约束。
3. 独立的新建任务允许内容相同；同一创建动作在重发时必须保留同一个 operation_id，不能按说明文本去重。
4. 修改未开始任务需携带 revision。首次尝试进入投递前冻结说明、指派、依赖与必要产物；曾开始过的任务修改说明使用复制。重试新建 attempt，保留任务说明及旧记录。
5. 建边与验环、所属项目校验在同一写事务内；运行中不更换输入引用。归档只设标记，不级联删除。
6. 同一 realpath 数据目录由主进程经 Koffi 调用 `flock(LOCK_EX|LOCK_NB)`，持有全生命周期的文件描述符。第二实例失败退出；锁文件不删除或替换 inode，不用心跳超时抢锁。描述符设置 close-on-exec，不传给采集/CLI 子进程；主进程退出后锁必须可重新获取，子进程不能延长锁生命周期。
7. 对本服务管理的选定 herdr session 再持有用户级 session 锁，避免不同数据目录的两个 Meteor Flow 实例同时接管同一 session；无法约束其他 API 客户端或原生输入。

## 5. 状态与命令时序

任务展示由当前 attempt 阶段及独立等待原因组合：`queued / dispatching / running / collecting / cancelling / needs_confirmation / succeeded / failed / cancelled`。另存 `herdr_status`、`connection_freshness`、`management_mode`、`input_controller`，不把它们折叠成一个状态值。

### 派发

1. 从指定 agent 队列中按数据库创建序号选择最早可执行任务，跳过等待依赖的任务；检查并发额度、暂停、控制权、连接新鲜度。
2. 读取当前 agent/process/cwd 信息，核验 binding fingerprint 和真实目录。允许派发的观测谓词为：连接新鲜、身份连续、agent_status 为 idle/done、launch_pending=false；托管启动还须完成就绪流程，已有 agent 使用独立的人工接入确认及能力验证，不强制 interactive_ready。working/blocked/unknown 均不派发，即使本地没有当前占用。
3. 准备新的 attempt 目录、输入副本与 prompt。所有上游成功 attempt 和 manifest 固定；准备中失败不调用 prompt。
4. 在事务内再次检查本地模式、队列版本和占用，持久化冻结输入、`dispatching`、dispatch intent、额度占用。只有该 intent 的当前创建者在本进程可调用一次 `agent.prompt`。
5. 在实际外部调用前再次读取身份、agent 状态与启动状态，并核对步骤 2 的全部谓词；输入准备期间旧读取失效，不能直接复用。回到命令处理器核对 dispatch intent、模式、控制 epoch 和占用仍匹配后才投递。若状态已变或读取失败，明确记录该 intent 尚未发送并暂停核对，不调用 prompt。此检查仍不能消除外部原生输入的检查/写入间隙。提交成功只登记 submitted，尚未看到本次活动时不宣称 running。记录最终投递前 `state_change_seq`，后续身份连续且观测到本次 working/blocked 才建立执行开始证据。
6. 部分写入、异常断开、超时或崩溃后遗留 dispatch intent 一律进入待确认，不将 outbox 重放当作重试策略。能够证明未发生输入的拒绝也保留明确原因，由新的显式操作重新评估。

调度器的检查和 herdr 输入不是跨系统原子操作。进入手动/接管与派发在本地串行仲裁；若投递已越过外部调用边界，界面显示当前执行仍占用，不能声称暂停撤销了已投递内容。

### 结束、失败、取消与人工处理

- 自动终态需要：匹配 attempt 的有效结果 + 全部声明产物完整归档 + 本次执行已结束的可靠观测。没有结果的 idle/退出进入待确认；结果先到且仍 working 保留占用。
- 正常结束证据为：身份连续、本次活动已观测，随后新鲜快照为 idle/done；或已确定同一执行进程退出、没有替换实例且结果有效。不能只比较 seq 变大，不能用其他任务活动证明本次结束。
- 若无法观测短任务的开始/结束，保留结果并待人工确认；`completion_seq` 只作可选诊断，不是跨版本业务依赖。
- 确认终态和释放占用在同一事务完成；结束但实例不可用时，不让绑定自动接收下一项。明确业务失败且实例确认可用，后方独立任务可推进。
- 取消与终态提交按服务端写事务的接受序号排序。取消先落库则先设 cancelling，再发送一次适配器中断命令；之后的结果只作迟到信息。终态先落库则取消是无副作用的历史操作。
- 待派发任务取消可直接 cancelled。活动任务中断不保证停止后台进程；停止不能确认则 needs_confirmation 且保持占用。重试只在旧占用解除后创建新 attempt，不自动改派、不清空输入、不回滚目录。
- 人工结论包含成功/失败/取消、原因、证据引用和来源 manual；结论与占用解除分别校验。人工确认停止需展示实时进程/身份/连接事实，无法证明时只记录声明并维持暂停；必要产物缺失仍不能满足下游。
- `collecting` 失败允许 retry-collection，只重新处理文件；等待不会追加 prompt。暂停只影响新投递，释放终端控制也不自动恢复调度。

2026-10-08 复审修正（落实既有恢复规则）：已归档任务不直接重试，只能复制；人工补录允许先保存未确认停止的声明。原终端已替换时，人工解除仍须核验旧 PID/启动时间，确定旧进程不存在或 PID 已复用；无法读取进程身份不算停止，新实例也不继承旧授权。

## 6. herdr 适配与身份连续性

管理 API 使用 `node:net` 连接服务端选定 session 的 Unix socket 并处理 NDJSON，不通过浏览器传入任意 socket/CLI 参数，不依赖当前焦点。逐请求使用 ID、大小限制和独立 deadline，未知方法/报文/必需字段失败时关闭相关能力。

身份依据包括 session/socket 归属、本次连接 generation、terminal_id、agent 类型、可获得的 agent_session、shell/前台进程 PID、由操作系统读取的进程启动时间和真实 cwd。公开 pane_id 只是可变化的位置。PID 单独不能防复用；证据不足时只观察。进程启动时间通过固定参数的只读系统调用/命令取得，不构造 shell 字符串。

移动窗格：以 terminal_id 和会话/进程证据更新 pane 定位，重订阅该 pane。替换 agent：撤销旧绑定调度授权和控制权，不把旧 attempt 分配给新 occupant。herdr 重启或无法证明断线前后连续性：增加 generation、待确认，不用名称恢复授权。

新建 agent 流程登记 start intent，创建独立 cwd 和可用 shell pane，再 `agent.start`；登录、授权、blocked、超时都进入可处理状态。创建窗格/启动的响应丢失时保留未知操作并核对实际对象，不盲目重复创建。已有 agent 先观察，逐项确认无未完成工作、目录/会话独立、结果交付能力；不以 interactive_ready 一刀切。

2026-10-08 启动恢复细化：启动意图在命令队列接受时绑定当时的 session port 与存储代；排在会话切换之后的启动使用新会话。`POST /api/v1/starts/:id/resolve` 只处理 unknown，要求原启动调用已结束、fresh 枚举成功且目标/重叠 cwd 无可见实例，以及人工证据和明确停止声明。记录转为 dismissed，并保留 manual 来源、时间和证据；解除未决保护不触发启动/关闭/中断。操作回执重放先于重新观测。此为人工核对路径，空列表本身不证明原进程停止。

事件连接先订阅并收到确认，再读快照；事件只触发重新读取，不直接覆盖业务状态。读请求携带本地 generation 与读取序号，旧连接/旧读取响应失效。对状态和身份变化使用新鲜读取校准，对移动/新增 pane 更新订阅；定时完整扫描弥补漏事件。这样不依赖 herdr 未承诺的全局事件游标。

## 7. 终端控制

- 服务端以 argv 启动 `herdr --session <name> terminal session observe <terminal_id>`，按需为被查看的终端共享观察进程；不使用 shell，不使用默认焦点。
- 浏览器接管先持久化暂停，竞争本地唯一控制权，再启动 `terminal session control`，不传 `--takeover`。外部控制冲突时拒绝并显示原因。
- 控制权包含随机 token、WebSocket connection ID、binding identity generation、lease epoch；每条 input/resize 检查四项、活动连接与有效期。token 不记日志，不放 URL。
- 确认控制连接有效并收到实时画面后才启用输入。CLI 失败/退出、terminal.closed、身份变化、心跳过期、浏览器关闭立即撤销 token；旧队列和旧连接的输入作废。浏览器不缓存断线按键。
- 控制 CLI stdin 使用明确 JSON command，支持 text/base64 bytes、resize、release；只有用户实际输入才写入。审批通过当前终端进行，不自动识别批准按钮。
- 只读连接没有可写 stdin；resize handler 只处理当前控制者。xterm 本地 fit 不调用后端 resize。控制失效后保留暂停原因，恢复自动需要显式按钮并重新检查事实。
- 服务重启不恢复控制 token；即使用户页面仍开着也重新只读。关闭观察页面不修改调度。
- 每个浏览器帧缓冲有上限；溢出时断开该观察流并重新取得 full redraw，不任意丢增量 ANSI 后继续渲染。终端流与业务事件通道分离，限制帧、队列、scrollback、同时观察数。
- OSC 剪贴板写入、自动打开 URL、图片协议和自动响应终端查询默认禁用；只读终端不会因 xterm 解析响应而向 agent 发送内容。

## 8. 结果协议与归档

每次 attempt 的输入与结果 inbox 位于绑定工作目录的 `.meteor-flow/runs/<attempt-id>/`，下游获得的是独立副本；归档放在服务私有数据目录。创建时检查该内部路径无符号链接、无已有冲突，不覆盖用户内容。prompt 明示绝对提交路径和协议。

候选协议 `meteor-flow.result/v1`，最终文件 `result.json`：

```json
{
  "protocol": "meteor-flow.result/v1",
  "task_id": "task-uuid",
  "attempt_id": "attempt-uuid",
  "outcome": "succeeded",
  "summary": "完成了约定工作。",
  "artifacts": [{"root_id": "workdir", "path": "reports/result.md", "label": "报告"}]
}
```

`outcome` 只接受 succeeded/failed，summary 必填，artifacts 可以为空。`root_id` 指向冻结的工作目录或用户为本任务明确授权的输出根，path 只接受相对路径。必需产物要求在任务中用逻辑名称/相对路径声明，下游可选择指定产物或全部声明产物；纯摘要依赖允许空列表。未知协议、字段类型错误、重复 JSON key、ID 不匹配都不能完成当前任务。

agent 写临时文件后同目录 rename 发布；服务发现后保存字节摘要和声明，不以 mtime 决定接受顺序。服务不会执行结果内命令。相同 attempt 相同声明幂等；冲突声明保留证据并暂停，已发布终态不翻转。旧 attempt 的文件始终归旧 attempt，不复用 inbox。2026-10-08 修正：冲突以持久化 `resultConflict` 标记和事件保留，新鲜 idle/服务重启/原结果文件还原均不能自动解除未完成执行；必须走人工结论或已验证的取消停止流程。已发布终态保持不变，冲突事件仍暂停绑定。该可选 JSON 字段及启动记录的 manual resolution 对旧数据兼容，未修改 SQL 表结构。

采集步骤：

1. Node 采集子进程通过 Koffi 封装按固定根目录描述符逐级 `openat`；父目录使用 O_DIRECTORY|O_NOFOLLOW 并固定身份。叶子先 nofollow stat 拒绝已知特殊对象，再以 O_RDONLY|O_NONBLOCK|O_NOFOLLOW 打开，立即 `fs.fstatSync(fd, {bigint: true})` 校验仍是同一普通文件，再开始读取；禁止先阻塞 open FIFO 再检查类型。拒绝 NUL、绝对路径、`..`、符号链接组件、非普通文件。根自身与工作目录/其他输出根进行 realpath、inode、父子包含检查。首版拒绝硬链接文件，避免来源归属歧义。
2. 打开后先 fstat，再按有限块读取到私有 staging，计算 SHA-256。复制后再次检查原文件描述符及路径的 dev、inode、size、mtimeNs、ctimeNs；变化、移走、删除、超限一律收集异常。相关值使用 bigint，进入 JSON/manifest 时转换为十进制字符串，不能用 Number 舍入身份信息。不得先读后补范围校验。
3. 子进程完成全部文件、manifest 和 fsync 后关闭描述符并退出。主进程收到候选完成消息后，必须等待 child `exit` 和 stdio/IPC `close`，核对退出成功、job/service generation/attempt 仍有效，重新验证 staging 文件与 manifest 的类型、大小、hash，并 fsync 文件及目录，才可在同一文件系统原子 rename 到不可变 archive generation；最后 DB 事务登记发布。完成消息不证明写入者已关闭，超时、取消或失效代的消息一律不能发布。恢复只补登记已经 rename 的完整 archive generation，仍须核对有效结果、manifest 及当前业务状态；未发布 staging 不对下游可见。
4. 下游派发前从已发布归档复制并校验 hash，再冻结关联；不链接回工作文件，不使用可变的 latest 路径。下载只接受 artifact ID，由服务端定位已登记归档文件。

该采集策略防止常见越界和复制期间变化，但不宣称可防御同一系统用户的恶意进程；符合 R10 的隔离边界。人工补录结果经过同一收集校验。

同样的安全打开与大小限制用于 result.json、恢复扫描和输入副本源文件，不能只保护 artifacts。所有错误路径关闭描述符；取消采集使用有限块、deadline 与可终止的子进程，不把 Promise 超时或 AbortSignal 当作原生调用已停止。超时先终止并回收子进程，未能确认退出时不补充无限新 worker，保持容量上限和收集异常。无 writer FIFO、目录组件被替换为 FIFO/符号链接的竞争用例必须及时失败，不能耗尽采集进程。

服务重启使旧 generation 的所有采集 job 失效，使用新的 staging 路径；旧 staging 不复用、不直接发布。根据已登记 PID/进程启动时间核对遗留采集者，能确认身份时才请求终止，并确认该进程已经退出后才清理其 staging；身份或退出无法确认时隔离保留、显示待处理，不能按 PID 盲杀或边写边清理。未确认退出的旧 job/启动 intent 计入采集容量，达到上限即暂停新采集，不能通过重启绕过容量限制。该检查在恢复新采集入口前完成。

预览只读已归档内容。Markdown 图片全部经 artifact ID 映射，外链只显示可点击文本且需用户主动打开；下载使用 attachment、nosniff；HTML/SVG 仅下载。预览容器设置 CSP，禁脚本、网络、表单与嵌入；不开放任意文件路径 API。

## 9. 恢复、存储异常与迁移

服务启动顺序：获得数据/session 锁 → 检查/备份/迁移数据库 → 标记连接与控制权失效 → 核对并隔离旧采集 job/遗留进程 → 订阅和快照校准 → 扫描活动及历史 attempt 的待处理结果和已发布 archive generation → 核对占用 → 仅开放可确定的调度。DB worker 原地恢复须先满足第 3 节旧 writer 退出屏障；新服务实例不接收旧 job 回复、不复用其 staging。不会自动重放 prompt/start/interrupt。

连接断开立即过期。心跳/循环延迟检测到休眠或明显时间跳变时关闭派发入口、重建观测；超时以单调时钟度量，休眠恢复先核对，不以经历时间直接失败。无法确认历史时记录观测缺口与待确认原因。

数据库不可写、磁盘不足时不接受无法持久化的新任务/派发/成功发布。已连接终端保持只读观察；提供明确标记为“未持久化”的人工紧急中断路径，要求用户主动操作并重新核验身份，不重试、不释放数据库占用。恢复可写后补记降级期间的已知操作，不能伪造完整审计。

迁移只在独占锁且调度停止时进行：SQLite backup API 生成一致备份，登记版本与校验值，事务迁移，失败保留原备份并拒绝调度。拒绝自动降级。恢复备份同时核对归档 manifest，保留新数据副本；恢复旧 DB 不等于恢复 agent，必须再次做启动核对。首版不提供自动清理历史或被引用产物的任务。

## 10. 本地服务访问控制

服务启动生成一次性 bootstrap secret，输出带 URL fragment 的本机入口。前端用一次 POST 换取 HttpOnly、SameSite=Strict 的随机会话 Cookie 后清除 fragment；secret 不写请求日志、不进 referrer。限制 bootstrap 请求 Origin、Host 与 JSON Content-Type，成功后立即失效。

所有 API、产物读取和 WebSocket 校验会话；写请求额外校验 exact Origin 和 CSRF token，拒绝 null/外站 Origin。Host 只允许本次监听地址/端口，防 DNS rebinding；不启用宽泛 CORS，不以 loopback 来源替代认证。WebSocket 校验 Origin，控制 token 在已认证连接内交换。静态资源不包含凭据，设置 CSP、frame-ancestors none、nosniff、no-referrer。

一次性 secret 同时保存在数据目录的 0600 启动入口文件，每次兑换后原子轮换下一枚 secret；拟提供 `meteor-flow open` 读取当前入口并打开浏览器，解决 Cookie 过期或更换浏览器后的再次访问。会话 Cookie 默认 7 天有效，服务重启即失效；只读页面关闭后重新打开可沿用尚有效 Cookie。控制 token 与登录 Cookie 生命周期分离，登录有效不表示仍持有终端控制权。启动入口文件和 Cookie 都绑定本次服务实例随机 ID。

用户选择的是服务端枚举的本机 session；所有执行目标、项目/任务关联由后端验证。子进程使用固定可执行文件路径与 argv，不将任务说明、路径或 agent 名拼进 shell。授权输出目录在任务开始前冻结，不提供自由目录浏览接口。

### HTTP 与实时接口边界

所有路由使用 `/api/v1`。操作 POST 携带 operation_id；资源修改携带 expected_revision。错误包含稳定 code、可展示说明、当前状态与可用恢复动作，不返回服务器任意路径/凭据。异步动作返回已持久化的 operation/资源标识；客户端掉线后查询操作，不能据 HTTP timeout 判断没有执行。

| 路由组 | 操作与限制 |
| --- | --- |
| `/auth/bootstrap`、`/auth/session` | 兑换一次性入口、读取认证/CSRF 状态；唯一不要求已有 Cookie 的动作是受 secret/Origin 保护的 bootstrap |
| `/system`、`/sessions` | 版本、能力、存储健康、并发配置、全局暂停；列出本地 session 与选择。切换 session 须无活动占用/未决 intent，关闭旧连接并重新核对，不携带旧绑定授权 |
| `/projects` | 创建、读取、归档；有任务引用不硬删除；工作目录校验由服务端执行 |
| `/agents`、`/agents/{id}/actions` | 发现、观察接入、启动、归属确认、手动/自动、暂停/恢复；启动 intent 和绑定分别记录 |
| `/tasks`、`/tasks/{id}` | 创建、分页查询、修改未开始任务；详情含阶段、等待原因、可用动作、revision |
| `/tasks/{id}/actions` | cancel、retry、copy、archive、record-conclusion、retry-collection；逐动作校验状态和占用 |
| `/attempts/{id}`、`/attempts/{id}/inputs` | 读取历史尝试、冻结说明、依赖输入与来源；只读 |
| `/artifacts/{id}/preview`、`/artifacts/{id}/download` | 仅从归档 ID 读取，验证归属和发布状态；不接收 path 参数 |
| `/events`（SSE） | 持久化业务事件含本地接受序号；支持 Last-Event-ID 校准，重连先取资源快照；不混入 ANSI 帧 |
| `/terminals/{binding_id}`（WS） | 认证后默认 observe；接管/释放/输入/尺寸均带 connection 与 epoch 验证；浏览器不能指定任意终端目标 |

共享 TypeBox schema 作为 HTTP 验证及 OpenAPI 契约来源，由 Fastify Type Provider 推导处理器类型；前端只依赖共享契约，不导入服务端实现。WS/SSE 消息另有 protocol/version 与判别字段，入站消息和结果文件都做运行时校验；结果解析额外拒绝重复 JSON key，不能仅靠 JSON.parse 后的 schema 验证。未知版本关闭对应连接并提示升级。HTTP 路由不会透传任意 herdr 方法。

## 11. 默认值与性能验收目标（已确认；执行证据见 verification-status.md）

| 参数 | 建议值 | 到限后的行为 |
| --- | --- | --- |
| 并发任务 | 2，可配置 1—8 | 降低不终止已有占用；等待名额原因可见 |
| 启动等待 | 60 秒 | 核对启动事实，待处理；不重启 |
| prompt 响应 | 15 秒 | 投递不明、暂停；不重发 |
| 投递后活动观测 | 30 秒 | 未观测到本次活动则待确认 |
| 等待人工提醒 | 30 分钟 | 仅提醒，不失败、不取消 |
| 收集单轮 | 60 秒 | 收集异常，可单独重试 |
| 取消确认 | 15 秒 | 待确认并保留占用 |
| 快照校准/健康检查 | 2 秒 / 5 秒请求 deadline | 读取失败或连接中断立即过期，派发前再读 |
| 控制心跳 | 5 秒；15 秒失效 | 失权并保持暂停；重连不继承 token |
| 结果文件 | 1 MiB；摘要最多 32 KiB | 拒绝协议处理并说明 |
| 产物配额 | 100 文件、单文件 50 MiB、总计 200 MiB | 收集异常，不发布部分归档 |
| 预览 | 文本 1 MiB、图片 20 MiB | 显示大小及下载入口，不完整渲染 |
| 磁盘可用空间 | 新派发前至少 1 GiB，采集前预留配额 | 停止新派发；写入实际失败仍单独处理 |
| 终端 | 4 个同时观察目标；每浏览器 1 MiB 队列；5000 行 scrollback | 慢客户端断开重建快照，主调度不等待 |

性能目标以本机环境记录为准：1000 个历史任务下列表分页 API p95 < 200ms；状态落库到 UI 可见 p95 < 1 秒；2 个终端各 1 MiB/s 输出持续 30 秒时，任务操作 p95 < 500ms、内存无持续无界增长。跨进程、磁盘和 agent 延迟另列，不把模型响应时间归因于控制台。实际测试的样本、指标、通过/失败和有限窗口边界见 [验证状态](verification-status.md) 及所链接原始日志。

## 12. 页面结构与用户操作

- 项目/会话选择在固定侧栏，顶部显示连接新鲜度、全局暂停和并行额度。首次进入按会话 → 项目 → agent → 任务引导，缺少配置时展示真实空状态。
- 主区域为任务列表，明确阶段、等待原因、指定 agent、依赖；筛选与详情 URL 可恢复。独立 agent 列表展示模式、目录、身份核验、占用和限制。
- 任务详情分为概览/冻结输入/终端/结果产物/时间线；执行历史按 attempt 展示。任务状态与 agent 状态使用不同标签。
- 新建/编辑使用有标签的表单；依赖选择只显示同项目合法候选，服务端仍验环。重试明确提示沿用当前文件状态；成功任务提供复制按钮。
- 待确认页面展示发生了什么、哪些事实缺失及等待/补录/取消/重试入口，动作可用性由后端返回；禁用按钮说明原因。
- 终端默认只读，接管与释放、恢复调度分别为明确操作。连接过期时禁输入并显示画面时间，不把旧画面当作可批准的请求。
- 风格为工作台：清晰表格、克制色彩、状态不只靠颜色；键盘可完成主流程、焦点可见、200% 缩放可用。窄屏叠放面板；首批验收桌面 Chromium，不宣称移动触控终端完整兼容。

## 13. 确认项

用户已确认具体组合：Node 24/TypeScript/Fastify + better-sqlite3/Koffi + React/Vite、官方 herdr CLI JSON 终端桥接、首批 macOS/Codex/Claude 范围、协议 v1 和上述默认值。按实现计划推进全部 R01—R14，并完成对应测试与独立审查；不把阶段性样例或模拟通过作为完整交付。确认依据为 2026-10-06 用户回复“我觉得没问题，请开始实现”。

官方参考：[Fastify Type Provider](https://fastify.dev/docs/latest/Reference/Type-Providers/)、[better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)、[SQLite 事务](https://www.sqlite.org/lang_transaction.html)、[Node 24 文件操作](https://nodejs.org/docs/latest-v24.x/api/fs.html)、[Koffi 函数调用](https://koffi.dev/load)、[React 版本](https://react.dev/versions)、[Vite](https://vite.dev/guide/)、[xterm](https://xtermjs.org/docs/)。具体依赖锁定后按对应版本再次核对，不将滚动文档当作产品验证。herdr 的版本化来源和实测边界单列在 [接口事实](herdr-compatibility.md)。

## 2026-10-08 复审记录

确认状态：既有需求范围内的修复；人工验收 pending。创建项目的重复 operation 先查询持久化回执，再做目录校验；原目录移动不改变已接受操作的返回。HTTP 监听成功后若入口凭据落盘失败，先关闭监听再传播错误，CLI 可正常退出并释放锁。复审发现、失败复现与关闭证据见 [本轮验证](verification-runs/20261008-review-blocked/report.json)，历史验证不替代本轮结论。

2026-10-08 内存复验修正：SQLite worker 启动/重开仍发送完整状态，正常提交仅发送事务内已落盘的各表 upsert 与变化的 settings；主进程保持未变历史行并按 ID/seq 更新。顺序仍由单 writer 的 MessagePort 和命令回执保证，超时/退出屏障不变。v1 无删除语义；未来引入删除必须同步扩展此内部协议。默认负载失败及相同阈值对照保留在本轮报告，有限窗口不证明长期内存恒定。

### 2026-10-08 Codex 启动与首次会话标识补全

状态：已授权修复范围内实现与复验中，尚未宣告真实全链路通过。对应 R03/R04 的正常托管启动与“可获得的 agent 会话”、R10 身份隔离；不新增自动批准、任务重发或恢复旧授权行为。

在任何托管启动副作用前，有界读取本机 Codex CLI help；支持正式 --no-daemon / --config 时，本次启动追加 --no-daemon 与 -c check_for_update_on_startup=false，避免共享后台配置冲突及启动更新界面被 herdr 误判为任务输入就绪。不改全局配置或用户 sandbox/approval 设置。旧版本无该能力时保留原入口；探测失败不猜测、不先创建窗格。herdr 在其 shell 中解析 codex，服务 PATH 探测不保证所有自定义 shell 的解析相同，失败仍按 unknown 核对，不自动重启。

Observation 增加可选 instanceFingerprint，包含 herdr session/socket、连接代、terminal/type、PID+启动时间和真实 cwd；完整 fingerprint 仍包含 agentSession。旧数据缺此字段时不允许补全。仅已确认绑定、连续且新鲜的前后观测、完整旧指纹匹配、前述基础身份连续且显式进程字段一致、序号不回退、旧会话确为 null、新会话首次非空且无跨绑定/活动执行/当前整批观测冲突时，一次补全 binding 与当前占用 attempt 的会话及完整指纹并记审计。保留原 mode/paused/dispatch/活动证据，不授予新的控制或调度权限。

非空变更/消失、连接代变化、旧观测缺失或过期、进程替换、服务恢复后已撤销确认均继续暂停。重复观察不重复审计；历史终态 attempt 不重写。终端控制权仍依现有完整指纹验证，补全不自动续授旧租约。新增字段为 JSON 可选字段，不改变 SQLite 表结构；删除/旧数据回退不据此恢复授权。

连续性缺口使用持久化 sessionIdentificationBlocked 记录：missing/disconnect/recover 或前后观测过期都会失效，之后相同 null 身份重新出现不会自动恢复补全资格；只有明确人工 confirm 才重置。跨绑定会话保留集合取本批修改前快照，并与完整新观测同时检查，不依赖绑定迭代顺序。
