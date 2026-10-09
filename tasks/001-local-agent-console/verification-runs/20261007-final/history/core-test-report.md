# 核心业务测试作者记录

状态：测试作者复验完成；不代表独立审查或人工验收通过。日期：2026-10-07。适用：domain、storage、results 与 application 的本轮测试基线，后续产品修改需重新验证。

本会话已加载 capture-constraints、项目 meteor-flow-verification、test-master 及集成/单元/安全/反模式引用、OCR 委托。R-002 的目标是本机 Node 24.21.0、Vitest 3.2.7、SQLite 3.53.4；无远程服务部署。工具 doctor、OCR 1.12.12、真实 Unix socket 能力检查已经执行，见 herdr-report.md 与原有准备记录。浏览器验收由独立 web agent 执行。

## 实际结果

`core-final.log` 记录 6 个文件、60 个测试通过，退出码 0，耗时 4.54 秒。执行命令：

```sh
/private/tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin/node node_modules/vitest/vitest.mjs run apps/server/src/domain/model.test.ts apps/server/src/storage apps/server/src/results apps/server/src/application/console.test.ts --reporter=verbose
```

真实 SQLite worker、collector 子进程、文件系统和 AgentConsole 参与测试。仅 herdr 外部边界在 application 测试中使用 `tests/fixtures/fake-herdr.ts`；这些结果不能替代真实 Codex/Claude 集成。所有数据库、工作目录和产物均来自专用临时目录，未访问用户 session。

| 场景 | 需求及用例 | 业务断言 |
| --- | --- | --- |
| 状态迁移 | V03–V12：已有与托管 agent 准备、工作/空闲基线、完整结果、人工停机 | 空闲不等于成功；执行证据与完整结果同时满足才成功；不能证明停止时保留占用 |
| 幂等 | V07/V10/V15：重复 operation、重复 start/cancel、提交 ACK 丢失 | 同一操作只有一次提交；中断仅一次；ACK 丢失恢复能找到已提交数据且不重放外部副作用 |
| 时序 | V08–V11/V22：成功与取消两种顺序、prompt ACK 阻塞、提交意图后 storage 故障、collector candidate/exit/close | 每种顺序有确定结果；故障后不启动外部 agent；候选消息不越过进程退出与 IPC 关闭屏障；超时必须收割子进程 |
| 恢复 | V12/V16：连接代与存储代失效、未知 prompt、孤儿采集 | 恢复使自动授权失效；不重发未知 prompt；未知采集占用计入容量，不能多启动写者 |
| 关联 | V09/V13/V14/V17/V24：错误 ID/版本/重复 JSON key、旧 attempt、DAG、下游冻结输入 | 旧结果不完成新 attempt；非法结构不归档；循环依赖回滚；独立任务继续；下游使用独立归档拷贝 |
| 隔离 | V13/V21/V22：真实归档、路径穿越、符号链接、FIFO、超限文件、私有 dataDir 重叠 | 不读取越界对象、不发布半归档；一个绑定只允许一个占用；业务失败和外键失败均原子回滚 |

新增用例文件为 `apps/server/src/{domain/model,storage/database,storage/store,results/protocol,results/collector,application/console}.test.ts`。故障夹具通过可控 ACK、事件和文件闸门安排顺序，不靠固定休眠猜测竞态。

## 发现与复验

1. result.json 限制错误为 256 KiB，summary 按字符计数而非 32 KiB UTF-8 字节。根作者修正，边界用例通过。
2. 两个并发 collector 准备请求均在 await 前看到空容量，可越过 maxJobs。根作者增加同步 reservation，并结合持久 jobs 计数，复验通过。
3. 绑定工作目录/额外输出根允许与私有 dataDir 重叠。根作者同时修正确认绑定与保存任务，复验通过。
4. durable start intent 写入后 storage 故障仍可能触发外部 start。根作者增加 storage generation、端口与健康状态校验，故障闸门用例通过；相同校验也应用于 interrupt。

保留失败材料：`state-storage-results-initial.log`（含测试夹具 UUID 错误，已修测试）、`collector-second.log`、`application-initial.log`、`application-retest.log`。后续 `state-storage-results-retest.log` 为 51/51，最终 `core-final.log` 为 60/60。未通过重跑掩盖竞态。

根作者随后依据独立 review 继续修改 collector 校验进程与 60 秒限制；本报告不将未来修改纳入已通过基线。后续复验由根作者记录。本作者下一阶段仅实施真实 herdr + Codex/Claude 专项，不再修改这些核心测试。
