# 连续 90 秒性能诊断结果

- 状态：诊断预测部分获支持；原 30 秒 RSS 验收失败保持打开，不宣称内存问题已关闭。
- 日期：2026-10-07。
- 范围：测试/fixture；真实独立 SQLite worker、HTTP、WebSocket、CLI 输出，FakeHerdr，不调用模型。
- 候选：主 agent 的固定 SQL Statement Map 缓存；执行前后业务源码和 dist 摘要相同，见 `baseline.sha256`。

## 结果与限制

按执行前的 `probe-plan.md`，持续运行完整 90 秒负载。最后 30 秒符合预声明的数值预测，worker handles 已稳定且 heapUsed 有明显回落；但完整第 10–90 秒两项 RSS 指标超标，RSS 后段仍增长，不能从有限窗口证明不存在持续保留。原始 30 秒 full benchmark 和 Statement Map 候选 30 秒 benchmark 的失败均保留，未改默认时长或任何原数值阈值。

| 预声明窗口 | 样本数 | RSS slope，MiB/s | 首尾各 5 样本 RSS 中位差，MiB | 原数值上限比较 |
|---|---:|---:|---:|---|
| 10–90 秒 | 80 | 1.044126 | 68.90625 | slope > 1，增长 > 32 |
| 60–90 秒 | 30 | 0.832319 | 19.484375 | slope <= 1，增长 <= 32 |

`perf.json` 的 `status: passed` 和 Vitest 1 passed 仅指本次明确声明的“最后 30 秒诊断预测”断言通过，不能作为原 30 秒验收通过的证据。报告同时保存完整窗口的超标结果。

## 负载与响应

- 1000 条初始历史任务，100 次真实分页请求，p95 **1.025958 ms**，目标 < 200 ms。
- 640 次真实任务操作（320 次创建、320 次取消），p95 **24.725333 ms**，目标 < 500 ms；每轮完成后间隔 250 ms。
- 每条终端精确接收 **94,371,840 bytes = 90 MiB**，两条 CLI 分别持续 **90,001.810 ms / 90,002.299 ms**；没有先停止输出再等待的尾段。
- WebSocket 错误和采样错误均为空；shutdown 确認 1320 条任务、0 次 prompt。
- RSS 范围约 **185.125–310.188 MiB**。第 60.653 秒为 285.234 MiB，第 89.694 秒为 307.906 MiB；后段不是完全平台。
- 第 10.575 秒样本为 1039 条任务/78 条 operations，第 89.694 秒为 1319/638；最终任务数 1320。最终 640 次操作均有 HTTP 成功响应，最终 shutdown 未额外采样 operations，不能将最后采样 638 标成最终持久计数。

## 可证伪假设评估

1. **重复 prepare 产生持续 handles 压力**：Statement Map 候选下，worker `used_global_handles_size` 首样本 29,952 bytes，第 9 秒后固定 **29,696 bytes**；第 10–90 秒无增长，`total_global_handles_size` 全程 32,768 bytes。此前无缓存 writes-only 诊断的 handles 增长现象已消失；这项修复方向获支持，但它不足以解释并关闭剩余 RSS 指标。
2. **终端 Buffer/WS 积压**：此前 terminals-only 探针不复现原 RSS slope 失败；本次完整收到两条 90 MiB 输出且无协议/采样错误。没有发现只靠终端即可复现增长的证据，不能把本次 RSS 全部归因于 WS。
3. **V8 容量扩张、快照分配与持久状态增长**：本次存在明确回收。主线程 heapUsed 在第 72.670→73.672 秒从 55.930→26.560 MiB，worker 在 86.693→87.693 秒从 28.580→12.040 MiB。最后 30 秒主线程 heapUsed 范围约 24.996–59.226 MiB，worker 12.035–37.614 MiB，均非单调保留。与此同时主线程 heapTotal 从约 30 秒的 91.828 MiB 扩至 60 秒的 156.328 MiB，worker 从 46.578 MiB 扩至 78.578 MiB；后段 heapTotal 基本稳定，但物理页/RSS 仍增长，任务/operations 也持续增加。因此“V8 容量扩张影响短窗”有证据支持，“只要运行更久 RSS 就完全稳定”尚未得到证实。

`rssOutsideReportedHeapAndExternal` 仅是排除所报告堆容量/external 的粗略残差，不是 native allocator 精确测量；堆容量、实际驻留页、代码、栈、映射和采样时刻会影响它。不能把残差直接解释成确定的 native 泄漏或已排除 native 泄漏。

## 测试与证据

使用 Node **v24.21.0**，Vitest **3.2.7**；完整测试用时约 91.24 秒。执行命令：

```sh
METEOR_FLOW_PERFORMANCE=1 METEOR_FLOW_PERFORMANCE_DURATION_MS=90000 METEOR_FLOW_PERFORMANCE_TELEMETRY=1 METEOR_FLOW_PERFORMANCE_EVIDENCE=tasks/001-local-agent-console/verification-runs/20261007-performance-continuous-90s /tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin/node node_modules/vitest/vitest.mjs run tests/integration/performance.test.ts
```

- `probe-plan.md`：执行前预测与窗口声明。
- `perf.json`：完整原始 RSS/堆/handles/任务/operation/吞吐时间序列、两个窗口、响应样本和 shutdown。
- `tests.log`：实际运行输出；一次执行，无失败重跑。
- `baseline.sha256`：执行前源码、dist 和测试资产摘要；执行后逐项验证均一致。
- Node 24 全量 `tsc --noEmit` 通过；限定测试/fixture 的 `git diff --check` 通过。

测试时间对齐使用两进程 `performance.timeOrigin + performance.now()` 基准，窗口实际首尾样本为 10.575–89.694 秒和 60.653–89.694 秒。默认 30 秒仍不变；90 秒必须显式 opt-in 并指定独立证据目录。

未进一步重跑或改业务。下一步由主 agent 决定是否通过快照分配/持久状态增长的独立变量探针继续定位；本报告不自行关闭审查或人工验收。
