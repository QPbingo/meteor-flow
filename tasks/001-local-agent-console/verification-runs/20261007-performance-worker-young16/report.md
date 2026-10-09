# Worker young generation 16 MiB 候选复验

- 状态：**本轮原默认 30 秒 combined benchmark 指标通过**。历史失败全部保留，不等同于已证明长期无内存泄漏或完成独立审查/人工验收。
- 日期：2026-10-07。
- 业务变更作者：主 agent；本执行上下文 `/root/posix` 只运行测试并记录证据，没有修改业务或测试代码。
- 候选：保留固定 SQL Statement Map，仅增加 `Store.open()` Worker options 的 `resourceLimits.maxYoungGenerationSizeMb = 16`。源码和已构建 dist 均包含该设置。

## 本轮原指标

本轮未指定 duration，实际使用默认 **30,000 ms**；没有改变 **1 MiB/s 每终端、1 MiB/s RSS slope、32 MiB RSS 中位增长**等阈值。真实隔离 SQLite、HTTP、WebSocket 和 CLI 输出，仅 herdr 使用 FakeHerdr，不调用模型。

| 指标 | 实测 | 原要求 |
|---|---:|---:|
| 1000 条历史任务分页，100 次请求 p95 | 0.978 ms | < 200 ms |
| 218 次真实创建/取消操作 p95 | 20.584625 ms | < 500 ms |
| 操作最大时延 | 25.398459 ms | 记录，不替代 p95 |
| 两条终端输出 | 每条 31,457,280 bytes = 30 MiB | 各 1 MiB/s × 30 秒 |
| CLI 持续时长 | 30,002.189 / 30,005.438 ms | 持续完整负载 |
| 第 10–30 秒 RSS slope | **0.729615 MiB/s** | <= 1 MiB/s |
| 首尾各 5 样本 RSS 中位增长 | **11.59375 MiB** | <= 32 MiB |
| 峰值 RSS | 212.421875 MiB | 记录 |

真实操作为 109 次创建、109 次取消；最后常规采样 1108 条任务/216 条 operations，shutdown 确认 1109 条任务、0 次 prompt。最终 operations 没有单独 shutdown 采样，218 次操作均有 HTTP 成功响应。WebSocket 错误、采样错误均为空，隔离服务正常退出。

## Worker 与主线程分配的区分

| 采样指标 | 仅 Statement Map 的前轮 30 秒候选 | 本轮 Statement Map + young16 |
|---|---:|---:|
| worker heapTotal，首→末 | 31.328→46.828 MiB | **30.828→31.328 MiB** |
| worker reported physical heap，首→末 | 31.047→47.016 MiB | **29.844→31.516 MiB** |
| worker heapUsed，最小–最大 | 11.877–24.590 MiB | **13.384–19.536 MiB** |
| worker used global handles | 29,984→29,696 bytes | **全程固定 29,984 bytes** |
| main heapTotal，首→末 | 61.828→92.328 MiB | **61.328→91.828 MiB** |
| main reported physical heap，首→末 | 59.672→82.906 MiB | **59.172→81.469 MiB** |
| main heapUsed，首→末 | 37.137→24.033 MiB | **37.566→25.632 MiB** |

本轮 worker 堆容量扩展显著小于前轮，符合限制 writer young generation 的预测；主线程仍按原路径分配，容量扩展与前轮接近。剩余 RSS 斜率不能全部归因于 writer，也不能把稳定 handles 当成没有任何内存增长。本轮 main heapUsed 约 22.440–48.430 MiB 周期性回落，worker heapUsed 也回落，有限窗口未观察到同等速度的单调对象保留。

这不是多轮统计显著性证明。前轮与本轮操作数分别 222/218；周期均为操作完成后等待 250 ms，差异来自真实执行耗时。本轮使用已在 90 秒诊断中修正的精确跨进程时间对齐，10–30 秒实际样本范围为约 **10.583–29.622 秒**，阈值/窗口定义不变；前轮缓存候选使用上一秒采样近似起点。不能将两次差值全部精确归因于 Worker 参数，更不能以本轮通过抹去前轮失败。

## 执行与证据

执行前计划见 `probe-plan.md`。实际命令：

```sh
METEOR_FLOW_PERFORMANCE=1 METEOR_FLOW_PERFORMANCE_TELEMETRY=1 METEOR_FLOW_PERFORMANCE_EVIDENCE=tasks/001-local-agent-console/verification-runs/20261007-performance-worker-young16 /tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin/node node_modules/vitest/vitest.mjs run tests/integration/performance.test.ts
```

- Node **v24.21.0**，Vitest **3.2.7**；退出码 **0**，1 test passed，实际测试约 **31.11 秒**。
- `perf.json`：完整响应、吞吐、RSS、主/worker heap、handles、持久状态数量采样和 shutdown 原始数据。
- `tests.log`：本次唯一运行原始输出；没有盲目重跑。
- `baseline.sha256`：执行前记录 9 项业务源码、dist、测试/fixture 摘要；执行后校验全部一致。
- 沿用主 agent 已完成的 server build；本轮未改源码，没有重新构建或执行与本候选无关的测试。

原初始 combined 30 秒、仅 Statement Map 30 秒的 RSS 失败，以及 90 秒诊断完整窗口超标证据均保持原样。本报告仅移交本轮测量，由独立 reviewer 复核候选及测试，不自行签署验收。
