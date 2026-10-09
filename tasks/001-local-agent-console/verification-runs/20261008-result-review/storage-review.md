# SQLite 提交增量与当前状态文档独立复审

日期：2026-10-08。审查者：独立上下文 `/root/technical_review`，只读产品与测试代码。范围：5 个 storage 实现/测试文件及 4 份当前状态文档；不覆盖或改写此前冻结的 [后端复审](backend-review.md)。本批产品变更未发现新的 critical/high/medium/low 问题；独立实际执行 44 项定向回归通过。整体仍 **not-ready**：真实 Codex 的默认启动、首次会话身份补全与测试环境权限问题尚未关闭，人工验收 pending。

## 前置与准确范围

已按当前 agent 的项目前置要求加载 verification、test-master、OCR 项目适配及适用测试引用；capture-constraints 的 R-002 运行环境核对适用，R-001 Heybox 搜索不适用。继续使用 Node 24.21.0、固定 OCR 1.12.12；实际 [doctor](storage-review-doctor.log)、[版本检查](storage-review-version.log)、[末次 preview](storage-review-preview-final.json)、[规则](storage-review-rules-final.json) 已留存。原始首轮 preview/rule 不覆盖。没有发起模型任务，没有访问用户已有 session。

逐文件 SHA、来源及 `(path,status)` 范围见 [当前候选](storage-reviewed-files.json) 与 [范围清单](storage-review-coverage.json)。本批重新审查 database.ts、worker.ts、store.ts、state-patch.ts、store.test.ts；另读 domain、application、collector、terminal/HTTP 调用方的数据使用，以及现有数据库/worker 故障测试。四份文档为 technical-design.md、verification-status.md、implementation-progress.md 和新增 codex-integration-followup.md。末次 preview 有 171 个 reviewable：9 个本批重新审查、159 个准确 SHA 继承、3 个留给独立 UI 审查，合计 168/171 reviewed，全部逐项交代；911 个排除项含 2 个准确 SHA 继承的手工审查项，其余为执行证据。覆盖率不是测试充分性或整体通过率。证据截止本次 preview，后续报告编排只增加验证目录证据，不自动扩展本批结论。

## 存储实现判断

1. `Repository.execute` 在同一个 immediate 事务内读状态、校验 operation、归约、写入各表及 settings，并收集实际变化行。只有事务函数成功返回后，worker 才发出 patch；任一约束、SQL 或提交失败不发布该 patch。已有 SQL/schema/checksum、唯一占用索引和 FK 未变。相同 operation 返回原结果与空 patch；冲突 operation 仍拒绝，不重复事件或记录。
2. 初始/重开 worker 发送完整快照，正常回执仅发送 upsert 与变化的 settings。单 worker 的同步命令处理和同一个 MessagePort 保持提交与回执顺序。Store 仍核对 generation、request ID、healthy 与 pending；超时使整代失效，旧 worker 的 exit 屏障后才能重开并读取磁盘完整状态。不存在成功处理后续消息却默默丢弃某个合法 patch 的正常分支；传输异常、超时或 worker 退出进入故障恢复，而非持续使用部分旧状态。
3. `applyStatePatch` 创建新顶层对象和受影响表数组，按字符串 ID/事件 seq 替换已有行并追加新行；未变表/行结构共享。当前主进程调用方只读这些记录，未发现借共享引用修改旧快照的路径。测试明确保存旧快照并核对后续命令未改变它。表关联在一次消息内合并后才通知调用方，事件、operations、settings 不单独提前发布。
4. v1 只有追加/更新，无删除或重新排序语义；数组 patch 不是全表替换。已核对 reducer、数据库写入及当前 API 范围。文档和代码已声明未来引入删除必须扩展该协议。该限制是当前已确认保留引用规则的实现边界，不是本轮新增删除能力。
5. worker 仍每次读取并序列化完整持久状态做差异判断。本次改善的是跨线程复制与主进程历史对象分配；它不证明任意规模历史下的 CPU/存储成本恒定，也不构成长时间内存无增长证明。

## 六类场景与实际证据

| 场景 | 本批核对与用例 | 需求/验收关联 |
| --- | --- | --- |
| 状态迁移 | 实际 worker 创建/更新任务、取消、settings；application 与 collector 的执行/归档状态在新 patch 路径下运行 | R01、R05、R06、R07；V09、V11、V12 |
| 幂等 | 相同 ID/内容重放、不同内容冲突、并发重复；事件与 operation 不增加，空 patch 不丢先前提交 | R02；V03、V04 |
| 时序 | 同端口提交顺序、先合并再通知、generation/request 核对；并发命令及取消/归档失效边界 | R02、R04、R06、R07；V05、V11、V24 |
| 恢复 | 真实提交后丢确认、fault/recover、SQLITE_FULL、磁盘完整状态与重开一致；关闭/启动竞争 | R02、R12、R13；V04、V24、V25、V26 |
| 关联 | 全部 v1 表、ID/seq 键、FK/占用唯一索引、operation/event/settings 同事务；循环失败回滚 | R08、R10、R11；V16、V17、V28 |
| 隔离 | 新建临时目录和数据库、专用 worker 与测试子进程；结构共享不改旧快照，旧代失效不混入新代 | R10、R12、R14；V21、V24、V26 |

独立命令使用固定 Node 的 Vitest，执行 database.test.ts、store.test.ts、application/console.test.ts、results/collector.test.ts，`--maxWorkers=1 --reporter=verbose`。结果 **4 文件、44/44 通过，11.84 秒**；原始输出见 [测试日志](storage-review-tests.log)。测试前后 storage 源码/测试及构建产物共 14 个 SHA 全部相同，见 [执行前基线](storage-review-test-baseline.json) 与 [执行后核对](storage-review-test-check.json)。只使用测试自己新建的目录、DB 和子进程；未运行模型、已有用户 session 或性能负载。Domain 拒绝、SQL 回滚、提交确认丢失、exit 恢复并非仅对 patch 实现做镜像断言。

## 性能证据与边界

下表为本审查者读取并提取作者原始 JSON 的事实，非本审查者重新执行压力测试。原文路径和 SHA 见 [性能证据清单](storage-performance-evidence.json)。均为 1000 历史任务、并发操作及 2×1 MiB/s 双流持续 30 秒；验收窗口 10–30 秒，原阈值 slope ≤1 MiB/s、retained ≤32 MiB 未放宽。

| 基线/模式 | 结果 | slope MiB/s | retained MiB | peak MiB |
| --- | --- | ---: | ---: | ---: |
| 原实现、默认无 telemetry | failed | 1.394349 | 18.390625 | 224.578125 |
| 原实现、telemetry 对照 | passed | 0.560209 | 7.218750 | 224.265625 |
| 提交增量、telemetry 对照 | passed | 0.090057 | 1.406250 | 194.921875 |
| 提交增量、最终默认无 telemetry | passed | 0.073901 | 1.156250 | 187.593750 |

最终默认运行分页 p95 1.048 ms、操作 p95 30.393 ms，双流各 31,457,280 字节。原实现 telemetry 重跑通过不能替代首次失败；本轮有明确实现变更、独立语义回归和相同默认阈值复验支撑有限范围结论。负载使用 FakeHerdr，不能冒充真实模型压力或无限时长泄漏证明。

## 文档复核及未完成项

技术方案对 full snapshot/patch、单 writer、恢复屏障和无删除范围的描述与代码一致；实施记录明确区分 2026-10-07 历史通过和本轮修复。验证状态及 Codex 后续方案明确当前未就绪：共享 daemon 启动冲突、首次 session ID 补全触发保守身份暂停、独立启动测试的嵌套沙箱拒绝仍需处理。`--no-daemon` 对照消除某条错误不等于完整固定任务通过，也未被直接写成产品修复。

后续方案清楚交代待授权操作会取消额外的外层 `sandbox-exec` 强制只读保护，仍保留 Codex 自身 workspace-write/on-request；执行前后哈希核验不等于继续强制只读。该方案尚未获授权，也不允许测试跳过身份核验或重发旧任务。官方 [配置参考](https://learn.chatgpt.com/docs/config-file/config-reference) 核对 `check_for_update_on_startup` 是可配置布尔项；本次参数关闭不等于升级或更改全局配置。真实执行兼容性仍由后续获授权测试证明。

发现 SD01（low，documentation，**fixed**）：V01/V08 的真实 Codex 证据单元格缺少历史日期，容易把历史成功误读为本轮成功。作者已为这两处标明 2026-10-07，并明确本轮 Claude 通过、Codex 仍阻塞；独立复读行 21/28 与页首未关闭项一致，关闭依据和准确 SHA 见 [findings](storage-review-findings.json)。三份当前状态文档入口已切至 `20261008-review-handoff`；[收尾核对](storage-review-closeout.json) 确认产品源码与执行前基线一致。本批没有提出产品或测试代码改动，未为纯文档修订重跑产品测试。

结论只覆盖上述准确源码与文档范围；当前整体验收门槛仍因真实 Codex 阻塞而未满足，不能由本批审查替用户签署人工验收。
