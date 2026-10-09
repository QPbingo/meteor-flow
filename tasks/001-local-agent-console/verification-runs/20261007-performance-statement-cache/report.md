# SQL 语句缓存候选：原场景复验

日期：2026-10-07。执行上下文：`/root/posix`。候选由主 agent 修改，本上下文只执行测试并追加测试层 telemetry 开关。状态：**原 full benchmark 仍失败，不能关闭 RSS 验收缺口。** 未放宽阈值或重跑到绿。

候选仅将 Repository 固定 SQL 的 prepare 改为 Statement Map 复用；具体 source/dist hash 见 [baseline.sha256](baseline.sha256)。测试保持 1000 历史任务、两个终端各 1 MiB/s×30 秒、真实 HTTP 任务创建/取消；不是先前单变量对照模式。新增 `METEOR_FLOW_PERFORMANCE_TELEMETRY=1` 只开启测试 fixture 的主/worker heap 采样，不改变负载或原 1 MiB/s RSS 斜率门槛。

实际命令：

```text
METEOR_FLOW_PERFORMANCE=1 METEOR_FLOW_PERFORMANCE_TELEMETRY=1 METEOR_FLOW_PERFORMANCE_EVIDENCE=tasks/001-local-agent-console/verification-runs/20261007-performance-statement-cache /tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin/node node_modules/vitest/vitest.mjs run tests/integration/performance.test.ts
```

退出 **1**。原始数据 [perf.json](perf.json)，日志 [tests.log](tests.log)。同目标 Node 的全仓 `tsc --noEmit --pretty false` 与测试文件 diff 检查退出 0。服务和子进程正常退出，0 prompt，没有 telemetry/WS 错误。

| 指标 | 缓存候选实测 | 原门槛/对照 |
| --- | --- | --- |
| 分页 API p95 | 1.088 ms | <200 ms，通过 |
| 222 次真实任务操作 p95 | 15.420 ms | <500 ms，通过 |
| 两条终端输出 | 每条准确 31,457,280 bytes | 30 秒×1 MiB/s，通过 |
| RSS 热身后斜率 | **1.0485366 MiB/s** | ≤1，仍失败；旧 combined 为 1.4928 |
| RSS 首尾窗口中位增长 | 17.234 MiB | ≤32，通过 |
| 峰值 RSS | 234.594 MiB | 旧 combined 为 245.609 MiB，仅记录比较 |
| worker used global handles | 29,984→29,696 bytes，9 秒后保持 29,696 | 旧 writes-only 为 39,424→252,736；不再按调用数累积 |
| worker reported physical heap | 31.047→47.016 MiB，约14秒后基本稳定 | 回收压力缓解，但不能独自解释全部 RSS |
| main reported physical heap | 59.672→82.906 MiB | 剩余驻留增长仍明显 |
| main heapUsed | 周期性约24—49 MiB，末样本24.033 MiB | 不呈同样单调 retained heap 增长 |

可确认：Statement 缓存消除了 worker 全局句柄随 DB 调用持续累积的现象；RSS 斜率有所下降。尚不能确认：它已经解决全部内存增长，或剩余增长属于明确的泄漏。当前观察更偏向主线程全量状态回复/快照分配和 V8/allocator 驻留扩展，需要进一步用更长的固定负载窗口或分配/heap 诊断区分。

1.0485 超过门槛虽仅约 4.85%，仍保留失败；没有将其四舍五入成通过、扩大允许值或再次运行碰运气。主 agent 已收到即时结果；后续修订/延长诊断应使用新的独立 evidence 目录，保留本次原 30 秒证据。
