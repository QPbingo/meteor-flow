# 连续 90 秒性能诊断预声明

- 状态：探针执行前记录；不替代原 30 秒验收。
- 日期：2026-10-07。
- 范围：仅测试/fixture；当前数据库 Statement Map 候选保持原样。
- 已保留证据：原 full 30 秒和 Statement Map 候选 full 30 秒均因 RSS slope 超过 1 MiB/s 失败；不覆盖这些报告。

## 假设与可证伪预测

候选已使 worker global handles 固定，但短窗口 RSS 仍增长。待检验假设是 V8 堆容量扩张和回收周期影响 30 秒窗口，而非随时间持续保留同等速率的内存。

连续输出和写入 90 秒，不在 30 秒停止输出后空等。每条 CLI 精确输出 90 MiB，2 条共 180 MiB；每个创建/取消周期完成后间隔 250 ms，保持之前的真实 DB/HTTP/WS 路径和默认后台轮询。记录所有任务、操作数量、主线程和 worker heap、worker handles、RSS 与吞吐采样。

预先记录两组窗口：完整预热后第 10–90 秒，以及第 60–90 秒。每组均计算 RSS 最小二乘斜率，以及末 5 个样本与首 5 个样本 RSS 中位数之差，不仅报告好看的窗口。服务采样时间与客户端负载起点使用 epoch-relative monotonic 时间对齐，避免上一采样时刻导致约 1 秒偏移。

预测：最后 30 秒 slope <= 1 MiB/s，窗口中位增长 <= 32 MiB；worker global handles 固定；heapUsed 经 GC 出现回落。若最后窗口不满足，同一候选不盲目重跑，交主 agent 讨论快照分配进一步诊断。即使最后窗口满足，也不将原 30 秒失败改成通过，不将有限窗口解释为永久无泄漏证明。

## 执行约束

使用 `METEOR_FLOW_PERFORMANCE_DURATION_MS=90000` 显式启用，默认仍为 30000；1 MiB/s、1 MiB/s RSS 斜率和 32 MiB 增长上限不变。保留 FakeHerdr 边界，不调用真实模型。此目录保存本次独立原始证据。
