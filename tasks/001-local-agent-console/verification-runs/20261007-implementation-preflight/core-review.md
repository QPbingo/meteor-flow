# 后端核心独立代码审查

状态：2026-10-07，本批独立审查与修订复查完成；C01—C06 已关闭，无未关闭 critical/high。本结论仅覆盖下列核心基线，不是整体验收结论。审查者 `/root/technical_review` 与作者 `/root` 为独立上下文。审查者未修改产品代码或产品测试。

## 范围与前置

本批负责 `apps/server/src/domain/`、`storage/`、`results/`、`adapters/herdr/` 及其测试、`packages/contracts/`、server/root 构建与依赖配置。完整读取已确认 requirements、technical-design 0.2、implementation-plan，按 R01—R14 与 V01—V29 核对本批职责。application/HTTP/terminal/web 仍属另外批次；读取 application 调用方用于判断跨模块关系，不表示已经完成其独立审查。

重新加载 AGENTS、skill-prerequisites、workflow、mandatory-scenarios，以及项目 meteor-flow-verification、test-master、OCR delegate；test-master 读取 unit-testing、integration-testing、security-testing、testing-anti-patterns。capture-constraints 使用 `/Users/heybox/.codex/skills/capture-constraints/SKILL.md` 与 index/rules：R-002 对应本地首发环境 Node 24.21.0/darwin arm64、实际 SQLite；R-001 的小黑盒搜索范围不适用。没有新增产品行为或更换已确认技术。本批不修改浏览器行为，Playwright/Impeccable 完整产品审查留给前端批次。

doctor、固定 OCR `--version`、独立 delegate preview/rule 均成功，见 `core-review-doctor.log`、`core-review-ocr-version.log`、`core-review-preview.json`、`core-review-rules.json`。初始 27 个候选 SHA 为 `core-review-baseline.json`，测试依赖与只读调用方 SHA 为 `core-review-support-baseline.json`。旧报告、自身审查证据及其他批次代码必须在逐文件清单中明确排除，不能借本批声称整个 workspace 已审。

父 agent 报告上一轮遭平台内容检查中断；该历史仅记录为未完成，未据此宣称审查通过。本轮正常工具入口恢复可用。所有实际测试只使用新建临时目录、独立 SQLite、测试 Unix socket；真实 herdr 探针使用新建 XDG 根与随机测试 session，没有访问用户现有 session。

## 首轮 findings

| ID | 严重程度 | 位置（初始候选） | 发现、影响与最小修复要求 | 状态 |
| --- | --- | --- | --- | --- |
| C01 | high | `apps/server/src/results/collector.ts` `collect`，初始 54—59 行 | 只在 `await verify` 之前检查取消/停止/存储健康，之后直接 rename/登记，且未保留 collect 开始时的 storage generation。复核中取消、关闭或 DB writer 失效后恢复，旧工作仍可发布；不符合方案 §8 的失效代不得发布。须在外部发布边界重新校验 job/attempt、最初 generation、取消/停止/deadline；DB 接受也需维护该顺序。用受控复核完成屏障覆盖取消、close、generation 失效，不只验证 child 阶段。 | 作者修订中 |
| C02 | medium | `collector.ts` `verify`、`perform` | child 退出后主线程逐文件同步 safeRead/hash/fsync（单文件允许 50 MiB），`setImmediate` 只在完整文件之后让出；child timer 默认 30 秒且退出即清除，后半段没有单轮 deadline。与方案 Node 采集隔离及已确认 60 秒收集阈值不一致。应让大文件复核也受有界隔离执行/退出屏障约束，统一 60 秒并贯穿完整收集轮次。 | 作者修订中 |
| C03 | medium | `collector.ts` `reconcile`；只读调用方 `application/console.ts` `tick` | 向已核对身份的旧进程发 SIGKILL 后立即复查，若尚未退出则保留 orphaned 是正确的；但正常运行无后续重核入口，稍后真实退出仍占用容量，两个旧 job 可持续阻塞全部新采集直到再次重启/存储恢复。应在新采集前或受控周期重新核对孤儿退出，仍只在 ESRCH 或已证明 PID 身份更换时释放，unknown 继续占用。 | 已交作者 |
| C04 | medium | `apps/server/src/storage/database.ts` `Repository.open` 迁移备份 | backup API 输出文件未固定 0600。独立新建 v0 SQLite 实测 umask 022 时主库 600、备份 644（`core-review-migration-mode.json`），不符合方案私有文件 0600；数据目录 0700 减轻影响但不替代文件要求。备份创建应即限制权限，失败关闭/拒绝迁移，测试断言备份模式与数据完整性。 | 已交作者 |
| C05 | medium | `apps/server/src/storage/store.ts` `open` 的首次 await 边界 | 检查 closed 后 await exited，期间 close 可返回；open 恢复执行仍创建新 writer。独立真实临时 SQLite/worker 探针 `core-review-close-race.json` 显示 close 后 opening resolved 且 healthy=true。须在异步边界后再次拒绝已关闭实例，保留已有 writer 的实际 exit 等待。 | 作者已修，待最终复验 |
| C06 | high | `apps/server/src/adapters/herdr/index.ts` `start` | 真实 Agent 专项发现 `meteor-flow-` 加完整 UUID 的 48 字符名称被 herdr `invalid_agent_name` 拒绝。独立核对 v0.9.0/v0.9.3 `src/app/agents.rs` 均要求小写字母开头、仅小写/数字/`-`/`_`、总长 1—32；改为 `mf-` 加 24 hex，共 27 字符。初始模拟成功响应和空 session 测试未覆盖这一上游业务校验，不将其声称为原已验证。 | 最终修闭，见下 |

没有以候选测试通过否定上述代码发现。修订后保留原发现与关闭依据，不覆盖初始日志/哈希。

## 已执行与实际边界

- Node 24.21.0 运行 server TypeScript build，退出 0；这是编译验证，不是行为验证。
- 同版本 Node 运行 domain/storage/results/herdr 模拟端点六个测试文件，71/71 通过，原日志 `core-review-tests-initial.log`。数据库测试是真 SQLite、worker 测试是真线程、采集测试是真隔离子进程与文件，herdr 管理 API 用隔离 NDJSON socket 模拟器。
- opt-in 真实 herdr 0.9.3 的新建空 session 测试 1/1 通过，`core-review-real-herdr.log`。覆盖握手/版本/空快照/订阅/测试 server 清理；不覆盖真实 Codex/Claude 启动、prompt、产物交付与终端完整用户链路，也不证明 0.9.0 真实运行兼容。
- 备份模式探针在新建临时数据库得到 C04。首次探针从 root 导入未声明于 root 的 better-sqlite3 失败（模块解析、未开始 DB 操作）；改从 server package 的 createRequire 解析后执行成功。未将该准备错误记成产品测试失败。
- 明确未执行：完整真实 Agent E2E、HTTP/终端/前端测试与 V29 负载验收；这些仍需后续批次证据。本批未宣称产品验收就绪。

## 六类场景核对

| 类别 | 需求/验收 | 本批证据与尚存边界 |
| --- | --- | --- |
| 状态迁移 | R04—R06；V08—V12、V15 | domain 真实 reducer 测试：idle 无结果保留占用、结果先到不终结、业务失败释放、人工声明不证明停止。取消接受后迟到结果不翻转终态。取消确认时钟属跨批待补。 |
| 幂等 | R03/R04/R06；V03/V04/V06 | SQLite 同一 operation 同摘要只产生一次操作，异摘要冲突；真实 worker 并发五次同操作只建一个项目；事务 FK 失败回滚状态/事件/操作。未知投递不重放。 |
| 时序 | R06/R08/R09；V11/V13/V18/V19 | reducer 分别覆盖终态先于取消与取消先于结果、旧 attempt 不覆盖新 attempt；herdr 使用受控 gate 验旧读取拒绝；采集完成 IPC 后继续活着不得完成。C01 覆盖缺少的 child 之后时序。V18/V19 终端审批链路另批。 |
| 恢复 | R03/R11/R12/R13；V04/V06/V24/V25 | 实际已提交但不回包的 worker 经故障、exit barrier 后恢复，DB 操作保持一次；migration backup/未来版本拒绝；domain recover 清授权/观测/intent。C03/C04 待修；归档 rename 后 DB 前恢复与更复杂旧进程存活场景需补证据。 |
| 关联 | R04/R05/R08/R11；V07/V09/V13/V16/V17/V28 | 检查终端指纹包含连接代/进程/启动时刻/cwd/session；移动 pane 不改变身份；冲突结果、重复 JSON key、旧 attempt、跨项目依赖/环均拒绝；复制后改原文件不改归档/下游副本。 |
| 隔离 | R09—R11/R14；V21/V22/V26/V29 | collector 真文件测试拒绝越界/符号链接/FIFO/超大/必要产物缺失，不发布部分归档；未知旧 job 和并发预约计入容量。POSIX 原语独立报告另见 `posix-review.md`。V29 大负载未验证，C02 指出主线程隔离缺口。 |

## 调用关系、误报与跨批事项

1. `processIdentity(pid) === null` 不再被本批 collector 当作进程已退出：`definitelyGone` 仅 `kill(pid,0)` 的 ESRCH 证明消失；活着且身份读取失败保持 orphaned。application 人工停止核对也改用 definitelyGone；这里只核对这一关系，不替代应用全审。
2. `Store.fail` 使 generation 失效并拒绝 pending，只有 worker `exit` 事件解除 reopen 屏障；`terminate()` 本身不被当成退出证明。代码方向与批准方案一致。现有响应丢失测试强于仅 mock ACK，但尚未覆盖每个 commit 前/后、迟到回包交错，不能声称这些均已实测。
3. 同一系统用户恶意改写服务私有 archive 不在 R10 的安全承诺内；因此未将私有 manifest 无签名等推测扩展为新需求。依赖中的 `workspace:*` 是本仓库 package 关联，非浮动外部依赖，不机械套用 OCR 禁 `*` 规则。
4. 首轮跨批交作者的取消 15 秒/人工等待 30 分钟计时已补入 domain，并由 application tick 调用；最终测试验证不解除占用和不重复瞬时提醒。正常同进程退出并无替换实例的自动终结路径仍需在应用集成批次确认，现有 domain 只直接使用身份连续的 activity→idle 证据。
5. 代码普遍压缩为长行，状态迁移和副作用边界阅读成本较高；本轮优先报告具体正确性/恢复问题，没有用风格建议扩大修订范围。

## 最终复查与关闭依据

初始 findings 表保留其当时状态，本节为当前结论。`core-review-baseline-round1.json` 固定了含 rename 修订与 C05 的 31 个文件（新增 `results/validate.ts` 与三项测试依赖）。独立 server build 退出 0，随后六个测试文件 **80/80 通过**，原始日志 `core-review-build-round1.log`、`core-review-tests-round1.log`；测试结束后 31 项 SHA 全部匹配，见 `core-review-round1-baseline-check.json`。文件名 round1 表示本审查第二轮采证，并非指作者较早的未完成修订。

其后仅 herdr adapter 的名称生成与对应测试变化。独立读取一行实现与上游两版本约束、模拟成功 start 用例新增名称正则断言；同版本 Node 下该适配测试 **20/20 通过**，`core-review-adapter-final.log`。再次 server build 退出 0，`core-review-build-final.log`。没有重跑未变核心来掩盖历史失败。最终全部 31 项 SHA 在 `core-review-baseline-final.json`，复核无差异见 `core-review-final-baseline-check.json`；首轮与中间证据均保留。

| ID | 当前处理 | 独立关闭依据 |
| --- | --- | --- |
| C01 | fixed | collect 保存初始 storage generation/60 秒绝对期限，child 与完整复核后均检查，rename 返回后再次检查；失效时在任何 DB 登记前把候选移回 `.invalidated` staging。恢复补登记同时核对 archive 目录 ID 与采集时取消标志。6 个受控用例分别在 verify 返回与 rename 返回前注入 cancel/close/storage，均无 archive/DB 发布，取消用例再 reconcile 也不补登记。 |
| C02 | fixed | 新增 validate.ts 仅由受同样 intent、PID/启动时刻、容量与 exit/close 屏障监管的 verify 子进程执行大文件安全读取/摘要/fsync；主进程只预读有界 manifest。默认 60 秒，collect 将剩余期限传递至验证并在最终发布前核对。原真实大文件/特殊文件和进程完成屏障测试复验通过；V29 极限负载仍未宣称执行。 |
| C03 | fixed | reapOrphans 支持持续核对 orphaned，application tick 在 scanResults 前调用；只有 ESRCH 或已证明身份更换才解除容量。新增实际新建子进程退出后回收并能启动下次 prepare 的用例通过；原 unknown 容量保留用例仍通过。 |
| C04 | fixed | 备份名增加随机 UUID，wx/0600 先独占创建，再使用 SQLite backup API，完成后再次 chmod；测试同时确认备份 0600、user_version=0 与原表存在、未来版本拒绝。 |
| C05 | fixed | open 在 await exited 后再次检查 closed，关闭已发生则拒绝创建 worker；新测试执行同一竞态得到关闭错误且 healthy=false。已有真实丢回包恢复/exit 屏障测试仍通过。 |
| C06 | fixed | start 名称现在满足两版 herdr 已知限制，模拟请求在响应成功前独立断言上游正则；20 项适配用例通过。实际模型完整重跑由真实专项负责，不包含在本批通过范围。 |

末次独立 OCR 见 `core-review-preview-final.json` 与 `core-review-rules-final.json`。`core-review-scope-final.json` 对全部 **150 个 reviewable `(path,status)`** 逐项交代：本批 reviewed 30、skipped 120，reviewable 文件覆盖率 20%；另 **145 个 excluded 条目** 均记录理由，pnpm-lock.yaml 手工核对，因此最终精确候选共 31 项。全部条目交代率 100% 不等于整个 workspace 实质审查率或测试覆盖率。新出现的真实 Agent、应用、HTTP、终端、前端测试与实现属于后续批次，不借本批签署。

结论边界：本批发现已关闭，可以继续后续集成审查；真实完整 Agent 链路、同进程退出与无替换实例的终结路径、恢复归档的更多故障注入、V29 负载与浏览器/终端验收仍需对应证据。不能据本报告自行签署人工验收。
