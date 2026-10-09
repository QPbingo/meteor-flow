# RSS 性能诊断：单变量对照

日期：2026-10-07。作者上下文：`/root/posix`。状态：诊断对照已执行，尚未修复；由主 agent 编写候选并复跑原基准。完整读取 `$diagnose`，沿用已复现的 30 秒原始反馈循环，不将对照组通过误写为原场景通过。

## 假设与可证伪预测

主 agent 已先向用户展示以下三项假设，本上下文按它们执行测量：

1. Repository 每次 execute 重新 prepare，导致 statement wrapper / 原生句柄回收压力。预测：去除终端仍会增长；worker 全局句柄随 DB 调用累积。缓存 SQL 语句后相同负载应减少句柄增长，并改善原基准 RSS。
2. 终端 Buffer / WebSocket 积压。预测：保留双终端而取消任务写入仍应有相近增长；去除终端后显著减轻。
3. history / operation 正常持久状态增长或全量快照复制引起分配。预测：无任务写入时减轻，任务写入时仍出现；仅做 prepare 缓存若不改变状态复制，其效果可以帮助继续区分。

原场景已失败：2×1 MiB/s、222 次 HTTP 创建/取消，RSS 热身后斜率 1.4928 MiB/s。此次没有放宽任何原门槛。

## 仅测试层的仪器和单变量

编码前实际检查目标 Node v24.21.0 的 `Worker.prototype.getHeapStatistics`，结果为 function；类型检查通过。`performance-server.ts` 只在明确诊断模式下，从实际 store 的 worker 引用读取 V8 heap statistics，并与主线程 `process.memoryUsage()`、V8 statistics、task/operation 数量一起每秒记录。未改 Store、Repository 或终端业务逻辑。

记录 `rssOutsideReportedHeapAndExternal` 作为粗略残差，扣除了主/worker reported heapTotal 和 external；这个值还受页驻留、栈、代码与映射影响，**不是精确的原生内存测量**，不能据此证明 SQLite 原生内存没有问题。

诊断模式只接受 `writes-only` / `terminals-only`，并强制提供独立 evidence 目录，避免覆盖原 `preflight/perf.json`。默认 benchmark 仍保留两个终端、任务写入、200 ms/500 ms/1 MiB/s/30 秒目标和原内存阈值。

两组都保留正常每 500 ms 业务 tick（含 observe/check-timeouts DB 命令）；“无任务写入”仅移除 HTTP task create/cancel，不宣称 DB 完全无调用。对照顺序为 writes-only 然后 terminals-only，未同时施压；两组 product source/dist hash 一致，见各自 baseline.sha256。主 agent 已通知等对照完成才修改候选。

## 命令与结果

第一组实际命令（退出 1）：

```text
METEOR_FLOW_PERFORMANCE=1 METEOR_FLOW_PERFORMANCE_DIAGNOSTIC=writes-only METEOR_FLOW_PERFORMANCE_EVIDENCE=tasks/001-local-agent-console/verification-runs/20261007-performance-writes-only /tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin/node node_modules/vitest/vitest.mjs run tests/integration/performance.test.ts
```

第二组将 DIAGNOSTIC/EVIDENCE 改为 `terminals-only` / `20261007-performance-terminals-only`（退出 0）。两组均在已允许的本机进程/loopback 环境执行，无模型或外网；全部 telemetry 无 sample-error，服务正常 shutdown、0 prompt。每组原始 `perf.json` 和 `tests.log` 留存，未覆盖首轮失败。

| 实测项 | 原 combined | writes-only | terminals-only |
| --- | --- | --- | --- |
| HTTP 任务操作数 | 222 | 222 | 0 |
| 每条终端字节 | 30 MiB | 0 | 30 MiB |
| 分页 p95 | 1.177 ms | 1.068 ms | 0.985 ms |
| 任务操作 p95 | 15.222 ms | 15.611 ms | 不适用 |
| RSS 热身后斜率 | 1.4928 MiB/s | **1.9584 MiB/s** | **0.2320 MiB/s** |
| RSS 首尾窗口中位增长 | 19.016 MiB | 28.922 MiB | 2.328 MiB |
| 原内存检查 | fail | **fail** | **pass** |
| worker used global handles 首→末 | 未采样 | 39,424→252,736 bytes | 37,728→111,968 bytes |
| worker heapTotal 首→末 | 未采样 | 32,325,632→53,035,008 bytes | 32,325,632→33,898,496 bytes |
| worker heapUsed 首→末 | 未采样 | 17,527,112→28,564,912 bytes | 19,284,248→21,059,912 bytes |
| RSS 粗略残差首→末 | 未采样 | 74,723,443→73,837,605 bytes | 59,082,193→50,954,566 bytes |
| task / operation 末样本 | 未采样 | 1110 / 220（最后一对操作随后完成） | 1000 / 0 |

## 可确认的推断与未确认项

- 终端输出不是 RSS 增长失败的必要条件：没有终端仍在同样任务节拍下复现。双终端单独输出达到精确吞吐，RSS 检查通过。这削弱假设 2，尚不构成所有终端负载都永无泄漏的证明。
- 问题重点转向写入路径。worker global handles 在两组都上升，HTTP 写入组增量更大，与后台和业务调用数相关；这与反复 prepare 的 wrapper/句柄压力相符，但句柄曲线不能独自证明它是 RSS 唯一根因。
- 主线程与 worker heapTotal 的扩张解释了大部分 RSS 变化，粗略残差未呈同规模增长，因此目前不能把现象简单命名为“明确的 SQLite 原生泄漏”。假设 1 和假设 3 仍需通过缓存候选及原 workload 复验进一步区分。
- 结果已即时回报主 agent；由主 agent 修改 database 候选，再执行原 combined 场景及相同操作数/状态增长，判定是否真的修复。对照组通过不关闭原内存验收失败。

诊断代码保留为受环境开关保护、明确标注 `[DEBUG-perf-20261007]` 的测试仪器，不进入产品代码；候选诊断完成后由主流程决定保留为诊断资产或移除。独立 reviewer 和人工验收仍待主流程完成。
