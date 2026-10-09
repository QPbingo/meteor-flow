# 采集恢复疑点与最终范围复核

日期：2026-10-07。状态：独立只读复核完成，0 新增 critical/high/medium/low。审查者 `/root/technical_review`，未修改产品或测试。适用：`Collector.reapOrphans` 启动恢复状态、身份不确定时的隔离/容量，以及前次最终候选摘要比较；历史审查文档新增状态说明由 `/root/ui_technical_review` 单独复查。

## 疑点结论：false-positive

疑点是 `intent/running` 的旧 job 在 PID/启动身份不能确认时，可能未转入 `orphaned`，因后续 tick 只遍历 orphaned 而逃过持续核对或释放容量。当前实现不会发生此路径：

1. `Collector.reconcile()` 首先执行 `reapOrphans(true)`；该参数把 `intent/running` 和 `orphaned` 全部纳入。
2. `exited` 为 false 时，只要原状态不是 orphaned，`if (exited || job.status !== 'orphaned')` 仍执行持久化 job 命令，状态写为 **orphaned**，理由明确身份/退出未确认、保留容量并隔离 staging。不能只读取该条件的前半项而认定没写状态。
3. 后续普通 tick 的 `reapOrphans()` 继续遍历 orphaned。若仍不确定则不重复写同状态，但原持久记录继续存在；`run()` 计算容量时包含 intent/running/orphaned，加上本地 reservations 以 job ID 去重。未知状态没有释放容量，也不允许新 child 绕过上限。
4. `processIdentity(pid) === null` 只是未知；`definitelyGone` 仅 `kill(pid,0)` 的 ESRCH 算确定消失。非 ESRCH（包括 EPERM）不算退出。只有 ESRCH，或当前可读身份与非空已存 processStart 不同，才改为 failed 并解除该 job 的容量占用。SIGKILL 本身不视为退出成功。
5. 向进程发送 SIGKILL 前要求当前 identity 与已存 processStart 完全相同；缺 PID、缺 processStart 或不可读取身份均不会按 PID 盲杀。未知 staging 未被复用、发布或清理。
6. 实际应用启动还会先执行 domain `recover`，将旧 intent/running 写为 orphaned，再执行 collector.init；Store 原地恢复同样在 collector.reconcile 前执行 recover。该额外保护与 Collector 自身分支一致，但本结论不依赖其掩盖 Collector 的直接调用行为。

| 旧记录/当前证据 | reconcile 后 | 后续重核与容量 |
| --- | --- | --- |
| intent/running，无 PID | orphaned | 无退出证明，持续占用 |
| intent/running，有 PID、无已存启动身份，进程未确定消失 | orphaned | 不盲杀，不凭当前可读身份猜测旧身份，持续占用 |
| intent/running，有已存身份、当前身份读不到，kill(0) 非 ESRCH | orphaned | 持续核对、占用 |
| orphaned，仍不确定 | 保持 orphaned | 不重复写记录；容量不变 |
| 有 PID 且 ESRCH，或启动身份明确已更换 | failed | 旧执行已不可能仍持该身份；允许后续新 job，旧 staging 仍不复用 |
| 身份确认相同，已发 SIGKILL 但还存活 | orphaned | 后续核对实际消失后才释放 |

代码证据：`apps/server/src/results/collector.ts:24`、`:35`、`:45`、`:94`；`apps/server/src/application/process.ts:2`；`apps/server/src/application/console.ts:58`、`:247`、`:315`；`apps/server/src/domain/model.ts:111`。关联 R11/R12/R13、V09/V24/V25，以及技术方案 §3/§8/§9。

该疑点没有证实产品缺陷，不修改已正确实现来制造差异。原 collector 测试包含未知 orphan 阻止新 prepare、两个并发 prepare 预约、真实旧 child 退出后回收；本轮完整读取相关用例，但不声称原测试逐一动态覆盖上表所有组合。根作者明确取消追加镜像测试；没有新增/修改/重跑产品测试，原运行日志保持历史基线。

## 准确源码与范围证据

当前 `collector.ts` SHA-256：`a9769ef0a756ad169708c4bfc73cbcad616ec3e1e6c36a601cd0a096e920513c`。

当前 `collector.test.ts` SHA-256：`9183d32b9a38c305b679568680f5c4a4f5273c5bbbdcea5cbccb491916ee0e0c`。

两者均与 `20261007-final/history/final-review-baseline-final.json` 完全相同。`reviewer-baseline-comparison.json` 对该基线全部 **170 项**逐项保存旧/新 SHA，169 项一致；唯一变化是 `tasks/001-local-agent-console/technical-review.md`：`0b121116…` → `c853f1a8…`，新增明确的历史状态注释。产品、测试、依赖、技能和其他文档均未变。已保存的文件类型/可执行位也一致。

重新独立执行 OCR delegate preview/rule：`reviewer-preview.json` 共 **823 项：168 reviewable、655 excluded**；六组规则内容与前次一致。去除 task-local run artifacts 后，前次与本次的 `(path,status)` 清单完全相同，没有新产品文件遗漏。锁文件、Windows cmd 两个非证据排除项仍与已手工审查 SHA 相同，其余 653 项为 run artifacts；所有条目见 `reviewer-scope.json`。

本 reviewer 认领 167/168：Collector 作本次实质复核，其余不变候选沿用准确摘要匹配的前次独立报告；历史技术报告新增注释单列 skipped，交另外独立 reviewer 补齐，避免自身报告作者自审。根综合记录须引用该独立 closure 和新文档 SHA，而不能仅用本报告把 168/168 写为已完成。

## 前置与六类场景

沿用同一独立上下文已加载的项目 verification、test-master 及适用引用、OCR；此次重新读取 prerequisites、verification、AGENTS、需求相关段、实现与调用方。doctor 与 OCR 固定版本检查实际成功，原样结果见 `reviewer-readiness.json`。本轮无代码/脚本开发，不新增 capture-constraints 规则；此前 R-002 环境约束继续适用。没有界面行为变化，不要求重跑浏览器/设计评审。

- 状态迁移：直接核对 intent/running→orphaned→有确证才 failed。
- 幂等：未知 orphan 重查不反复改记录、不新增 job；容量以不可复用 ID 去重。
- 时序：先持久化/恢复隔离，再扫描归档与开放后续采集；请求终止与证明退出分别判断。
- 恢复：服务启动与 Store 恢复都复核旧进程；未知保持占用，不重放旧 job。
- 关联：PID 与启动身份共同核对，staging/job/attempt 关联继续保留；摘要只与准确历史候选比较。
- 隔离：不向不确定身份进程发送信号，不清理仍可能写入的 staging；此次仅只读查证，无运行资源副作用。

本轮没有需要作者修复的产品问题。范围比较不把历史测试改称本轮已执行，人工验收仍 pending。
