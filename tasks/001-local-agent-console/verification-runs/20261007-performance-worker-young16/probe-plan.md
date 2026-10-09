# Worker young generation 单变量复验

- 状态：执行前声明；单次运行原默认 30 秒 combined benchmark。
- 日期：2026-10-07。
- 本轮候选：主 agent 在 `Store.open()` 的 Worker options 中仅增加 `resourceLimits.maxYoungGenerationSizeMb = 16`；保留固定 SQL Statement Map 候选，事务、状态语义与 CLI/主线程不变。
- 范围：本 agent 只运行测试和记录证据，不修改业务代码。

基于此前诊断，worker handles 已稳定，V8 堆容量扩张与主线程持续快照分配需要分开观察。本轮只限制 writer worker 的 young generation；预测其 heapTotal/physical heap 扩展减小，并观察原 10–30 秒 RSS slope 是否 <= 1 MiB/s，首尾各 5 个样本 RSS 中位数之差是否 <= 32 MiB。主线程 heap 分配未施加限制，独立记录，不把 worker 改善自动当成整个服务改善。

保持原 1000 条历史任务、两个终端各 1 MiB/s 连续 30 秒、真实创建/取消任务及原 250 ms 周期。分页 p95 < 200 ms，操作 p95 < 500 ms；不指定 duration，验证默认 30 秒。开启既有测试 fixture 的 telemetry；单独记录主线程/worker heap、handles、RSS、任务和 operation 数量。所有历史失败保留，此轮通过仅表示本轮原指标通过，不证明永久不存在泄漏；失败则报告数据，不盲重跑。
