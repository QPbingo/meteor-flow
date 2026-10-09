# 最终验证说明

日期：2026-10-07。状态：产品实现与下列最终执行均通过；独立审查及本地证据检查见 report.json。人工验收 **pending**，未由 Agent 签署。适用：需求/技术方案 0.2，macOS arm64、Node 24.21.0、SQLite 3.53.4、herdr 0.9.3（protocol 22）。源码基线由本目录 `report.json` 的 content_sha256 固定，测试过程中没有改写业务源码。

## 结果

| 检查 | 实际结果 | 原始证据 |
| --- | --- | --- |
| 完整构建、类型检查 | 退出 0 | build.log、typecheck.log |
| 常规产品测试 | 176 passed；5 个真实/压力 opt-in 在专门命令中单独执行 | backend-tests.log |
| Chromium E2E | 13/13 passed | e2e.log、web-*.png/json |
| 真实 herdr | 2/2 passed；独立空会话与官方终端观察/控制/竞争/尺寸 | real-herdr.log |
| 真实 Codex / Claude | 各 1 个固定文件任务 passed；归档与 task/attempt 关联正确，配置文件前后未变 | real-agents.log、real-agent-codex.json、real-agent-claude.json |
| 默认压力测试 | 1/1 passed；1000 历史任务、2×1 MiB/s 持续 30 秒 | performance.log、perf.json |
| 工作流 | 35/35 passed；doctor 退出 0 | workflow-tests.log、doctor.log |
| 独立审查 | 分批来源按 SHA 聚合；代码增量另独立执行 38/38 定向测试。0 未关闭 critical/high/medium，1 项历史文档措辞 low 留档 | history/final-review.md、history/final-review-coverage.json |

最终常规测试的 5 个 opt-in skipped 分别是 herdr 2、真实模型 2、性能 1；在独立命令中全部通过，不把 skip 算作通过。13 项浏览器测试中，12 项是构建前端与模拟 API/WS；1 项实际运行 Meteor Flow HTTP、SQLite worker、调度、collector 和文件归档，herdr 边界模拟。开发代理测试另运行实际 Vite/浏览器/DB。真实模型专项通过应用层创建和调度；没有宣称网页到两种真实模型的组合路径逐一运行。

## 性能样本

- 1000 历史任务列表分页 p95 **1.007 ms**，目标 <200 ms。
- 压力期间 212 次创建/取消操作 p95 **31.338 ms**，目标 <500 ms；两条终端各完整 **31,457,280 bytes（30 MiB）**，无 WS/采样错误，零模型 prompt。
- 服务进程 RSS（含 DB worker，不含测试客户端/CLI 子进程）热身后 slope **0.7185 MiB/s**，首尾中位增长 **13.75 MiB**，峰值 **231.047 MiB**；原固定门槛分别≤1 MiB/s、≤32 MiB。
- 30 次交替设置经真实 SQLite/SSE 到浏览器匹配 UI 并越过绘制帧，p95 **48.348 ms**，目标 <1 s。禁用 1 秒轮询，计时含持久化命令耗时，是落库到可见的保守上界；这组 UI 样本不在双终端压力下执行。

原压力失败及 writes-only、terminals-only、statement-cache、90 秒、young16 的诊断全部保留在同任务的历史运行目录。本轮没有放宽阈值或以多次盲跑挑选通过。固定 SQL Statement 缓存限制原生句柄数量，DB worker 年轻代上限 16 MiB 减少分配压力；它不是整个应用 RSS 上限。30 秒通过仅说明这个固定负载窗口符合标准，不证明长期运行永不增长。

## 六类场景与审查

状态迁移、幂等、时序、恢复、关联、隔离全部适用。report.json 逐条列前置状态、操作、预期、实际观察、V01—V29 映射和证据。详细的验证层级与未测边界见 [验证状态](../../verification-status.md)。失败历史留存，当前通过不抹掉前次问题。

独立 reviewer 与作者分离，分批覆盖技能、POSIX、核心应用、UI、最后缓存/开发启动/文档。最终 reviewable 清单逐项聚合，超大 lock 文件和 Windows launcher 手工补查。历史技术方案报告另外交不同 reviewer 核对，避免作者自审。UI A/B 综合见 [界面审查](history/ui-critique-combined.md)，初次设计评分 24/40 与最终技术评分 16/20 使用不同尺度，不合成虚构分数。

唯一 deferred low 是 2026-10-06 的历史技术审查报告页首仍写当时“待人工确认”；保留历史原文，现行 AGENTS/README/技术方案均明确后续确认和实现授权。它不影响运行行为，最终人工判断仍归用户。

## 边界与清理

herdr 0.9.0 仅合约/源码验证，实体测试版本为 0.9.3。上游缺少原子“校验 terminal 身份并输入”能力；新鲜同代快照和 pane 映射缩小窗口，不能消除最后的外部竞争。首版仅 macOS arm64 实测；物理休眠、物理手机、完整屏幕阅读器及所有模型/插件/审批组合未穷举。真实中断向模型发送 Ctrl-C 未单独执行，取消/保留占用由可控状态及适配边界测试支持。人工负责登录、信任、审批和产物质量核验。

所有测试使用独立目录、数据库、动态端口和专用 herdr session。模型只执行授权的固定 hello.txt/结果 JSON；遇登录/信任/工具权限会停止。本次 UI 样例服务已按保存 PID 和命令核对后停止；测试自有服务/浏览器/子进程由 finally 清理，未停止用户现有 Agent。没有提交、推送或部署仓库，也没有发送外部消息。

本地 checker 只验证基线、证据、范围和记录结构，不证明测试充分或代替人工验收。运行步骤见 [使用说明](../../usage.md)。
