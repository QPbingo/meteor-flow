# 本轮内存分配候选

日期：2026-10-08。状态：候选待性能和独立审查，不代签验收。

默认 30 秒负载 RSS 斜率 1.394 MiB/s 超 1 MiB/s 阈值，主堆约 61→92 MiB，响应达标；同源码增加 telemetry 后斜率 0.560，但峰值仍 224 MiB，主堆 61→92 MiB、worker 30→31 MiB。该变化证明 GC 时间窗敏感，不构成修复，也不等于无限期泄漏证据。

假设：每次 worker 回执都 structured clone 全部历史行，会造成主线程历史对象反复分配；其次可能是 worker/native 句柄，第三是终端缓存。worker 与 native 句柄此前有缓存与 young16，本次 telemetry 较稳。候选只修改 worker 传输为已提交的行 upserts/settings patch，启动/重开仍完整快照，generation/确认/退出屏障不变。所有 v1 表无删除语义，未来删除须扩展 patch 协议，不能静默忽略。

先用既有原负载复现失败；增加真实 worker 语义回归：更新/重复 operation/冲突拒绝/旧快照不变/真实磁盘及重开状态一致。187 项常规与 typecheck 已通过，独立审查和原负载对照进行中，不改阈值、不删失败。
