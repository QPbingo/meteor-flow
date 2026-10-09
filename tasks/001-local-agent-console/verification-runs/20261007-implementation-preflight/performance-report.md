# 隔离性能实测

日期：2026-10-07。作者上下文：`/root/posix`。状态：**延迟/吞吐通过，RSS 增长检查失败；不可宣布性能验收通过。** 原始数据 [perf.json](perf.json)，命令日志 [performance-tests.log](performance-tests.log)。

本任务仅新增 `tests/integration/performance.test.ts`、`tests/fixtures/terminal-flood.mjs`、`tests/fixtures/performance-server.ts`。未因指标失败修改业务实现、放宽阈值、删断言或重跑至绿。性能测试明确 opt-in：普通 suite 不执行 30 秒压测。

## 环境、范围和准备

沿用本上下文已加载的 capture-constraints R-002、项目 verification/test-master/OCR；此次为终端修复后新增验证范围，已读技术方案 §11 的性能目标。此前本轮实际核对 Node v24.21.0、doctor/OCR 可用、Playwright Chrome 交互就绪；不更换产品运行时、数据库或工具版本。

目标环境是本机 macOS arm64，Node 24.21.0。真实隔离 SQLite（Repository 建表、WAL/外键/迁移校验）、真实服务进程、loopback HTTP、WebSocket、两条独立 CLI stdout 流。只有 herdr 边界使用 FakeHerdr；没有外网、模型请求或用户会话。服务进程独立于 Vitest/HTTP/WS 客户端，RSS 含 DB worker，但不含 CLI 和测试客户端。

先由 Repository 建 schema 和父级 project/binding 记录，关闭 repository 后以一次事务写入 1000 条历史取消任务，再启动唯一服务 DB worker。新任务通过真实 HTTP 创建并取消，绑定保留 observe、全局暂停，最终零 prompt。

## 固定测试方法

- 1000 历史任务下分页读取 100 次，每页 50 条，检查实际 total=1000 及每页长度。
- 等两个真实 WebSocket 都收到各自 CLI 的 ready 帧后，用专用启动文件同时触发；每条 CLI 以 64 KiB 帧匀速输出，按 monotonic deadline 调节节拍，并遵守 stdout drain。30 秒期间每条目标为 1 MiB/s。
- 负载期间以 250 ms 业务操作节拍，通过 HTTP 真正创建任务并取消，检查 queued/cancelled 和 HTTP 成功。这个间隔只定义负载，不用于猜测竞争结果；结束由真实 CLI DONE 帧确认。
- 服务每秒采集 RSS/heapUsed/external/arrayBuffers，客户端另记每秒接收字节。预先固定 10 秒热身后的 RSS 回归斜率不超过 1 MiB/s，首尾 5 样本中位数增长不超过 32 MiB。这是有限观察下的增长警报，不宣称有限时段可证明数学上的“永远有界”。
- teardown 关闭 socket 后请求真实服务 shutdown，等待 bridge 关闭 CLI、DB worker 退出以及服务 exit；专用临时目录最后清理。

## 命令与结果

```text
METEOR_FLOW_PERFORMANCE=1 /tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin/node node_modules/vitest/vitest.mjs run tests/integration/performance.test.ts
```

实际执行获允许本机进程、loopback 端口的环境，退出 **1**。不是网络权限失败；失败点为内存斜率断言。目标 Node 的 `tsc --noEmit --pretty false` 与改动范围 `git diff --check` 均退出 0。

| 项目 | 实测 | 门槛 | 结论 |
| --- | --- | --- | --- |
| 100 次分页 API p95 | 1.177 ms，最大 2.647 ms | < 200 ms | pass |
| 222 次任务创建/取消 p95 | 15.222 ms，最大 24.577 ms | < 500 ms | pass |
| 终端 1 | 31,457,280 bytes / 30,001.774 ms | 30 MiB / 30 秒 | pass |
| 终端 2 | 31,457,280 bytes / 30,000.545 ms | 30 MiB / 30 秒 | pass |
| 实测逐秒吞吐 | 终端 1：0.936—1.062 MiB/s；终端 2：0.937—1.063 MiB/s | 目标每条 1 MiB/s | 已记录采样波动 |
| WS 错误/丢量 | 0 错误，实际总量准确 | 无错误、足量 | pass |
| RSS 热身后斜率 | **1.4928 MiB/s** | ≤ 1 MiB/s | **fail** |
| RSS 首尾窗口中位增长 | 19.016 MiB | ≤ 32 MiB | pass |
| 服务峰值 RSS | 245.609 MiB；首样本 162.953 MiB | 记录实际值 | observed |
| shutdown | 1111 个持久任务，0 prompt，服务正常退出 | 全部子进程退出，无模型调用 | pass |

服务主线程 heapUsed 在约 24—49 MiB 间回落，external 在约 5—16 MiB 间波动；RSS 整体仍增长。主线程采样不足以判定 DB worker 堆或内存分配器的归因。当前结论是预设增长检查失败，**不是已证明存在某条确定泄漏路径，也不是无内存问题**。已及时通知主 agent，后续诊断/修复需要新的证据基线；本任务未改产品代码。

## 六类场景及覆盖边界

| 类别 | 需求/验收 | 此次实际覆盖 |
| --- | --- | --- |
| state-transition | R06/R13；V11/V25 | 111 次真实任务 queued→cancelled；观察流无控制或自动派发 |
| idempotency | R02/R06；V03 | 每个 HTTP 写操作使用独立 operation_id，最终任务数从 1000 到 1111；重复请求的业务幂等由已有专项测试覆盖，本压测未重发 |
| ordering | R09/R13；V18/V19 | 两条真实 CLI ready 后共同启动，在输出负载中串行 create/cancel 并检查业务响应；不用固定 sleep 推断退出 |
| recovery | R12/R13；V24/V25 | 正常 shutdown 等待 CLI/DB/服务退出；本压测不注入进程崩溃或磁盘故障，专项终端/存储测试另有证据 |
| association | R04/R08/R09；V07/V18 | 两条 WS 分别绑定独立 binding/CLI target，统计每条精确字节；新任务交替关联两个 binding，取消使用实际响应 task ID |
| isolation | R10/R13/R14；V21/V26/V29 | 专用临时 work/data、动态 loopback 端口、私有 bootstrap、真实认证 WS；FakeHerdr 与用户会话隔离，服务 RSS 与负载客户端隔离 |

本次没有测试模型响应、真实 herdr、浏览器渲染时间或状态到 UI 可见的 1 秒目标。独立 reviewer 可复核测试强度及数据；人工验收仍 pending。
