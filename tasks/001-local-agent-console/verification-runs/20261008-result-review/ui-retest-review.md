# 网页修复独立最终复查

日期：2026-10-08。状态：本次定向复查通过，UIR01–UIR04 均关闭；未发现新增 critical/high/medium 或 P0–P3 问题。审查者：`/root/ui_technical_review`，独立于作者；只写报告和探针证据，未修改候选产品或测试。原始缺陷报告 [ui-independent-review.md](ui-independent-review.md) 保留为修复前快照。本报告不签署人工验收，也不替代其他模块最终审查。

## 独立执行与当前基线

没有仅继承作者测试结论。我完整阅读本次新增 `web-recovery.spec.ts`、修改后的 Tasks/Agents 及关联 HTTP schema/application/domain 分支，独立执行了该 Playwright 回归；另建临时浏览器探针验证历史产物、直接 API 拒绝、观测边界与成功响应丢失重放。

- 独立 `pnpm exec playwright test tests/e2e/web-recovery.spec.ts --reporter=list`：**1 passed (2.9s)**，原始输出 [ui-independent-retest.log](ui-independent-retest.log)。独立输出目录 `ui-independent-retest-output/`，截图 `ui-independent-retest-evidence/`，没有覆盖作者证据。
- 额外探针最终退出 0：[ui-retest-extra-run2.log](ui-retest-extra-run2.log)、[ui-retest-extra-observations.json](ui-retest-extra-observations.json)。真实 Chromium、HTTP、SQLite 与目录；外部 Agent 使用 FakeHerdr，未连接用户 Agent、未代为确认登录授权。
- Node v24.21.0 / Playwright 1.63.0。载入当前已构建 `index-BGGAzW85.js`、`index-D9rJBP-M.css`；所有源文件在执行前后 SHA256 一致，包含源、构建文件与截图的完整指纹见 [ui-retest-final-sha256.json](ui-retest-final-sha256.json)。不把作者的全套通过数量写成本人执行。
- 当前上下文已完成项目 prerequisites、verification、OCR 委托、Playwright、Impeccable、test-master 与临时脚本适用 capture-constraints 的加载/能力验证；本次是有界修复复查，不重复 context 访谈或完整 A/B 设计循环。

| 本次变更候选 | SHA256 |
| --- | --- |
| apps/web/src/Tasks.tsx | `4fd8bdb061e53ad20caea684cc61496eb65e02c1101c5d6fc223897369f43173` |
| apps/web/src/Agents.tsx | `b47412ee15516a27cf3216e84e22062fbcd8059327fdf8c2b20acdd363bdf662` |
| tests/e2e/web-recovery.spec.ts | `bf97bc5408ef5d2eaa46ce3494ee0ca88f235c2170185fc0fcdc41a0b67f4bc5` |

## 原发现关闭依据

| 原发现 | 当前实现与本人实测 | 结论 |
| --- | --- | --- |
| UIR01 / medium / P1：重试后默认停留旧执行 | Tasks:75 将 null 定义为跟随 `currentAttemptId`，选择历史才固定具体 id。真实创建第二 attempt 后下拉自动切换第二次，当前详情显示保留占用；手选第一次并刷新 Agent 状态后仍停留历史。 | 关闭 |
| UIR02 / medium / P1：已选归档依赖不可移除 | Tasks:18 保留当前已选归档上游，:36 保留已选历史 artifact，并明确标注状态。E2E 从编辑表单移除归档依赖，实际持久状态变为空数组；独立额外探针创建第二 attempt 后，旧 artifact 仍显示“历史执行”，取消后持久 dependencies 保留父任务但 artifacts=[]。 | 关闭 |
| UIR03 / medium / P1：已归档重试进入永久不可派发队列 | Tasks:86 隐藏已归档任务重试，保留“复制任务”。本人实际 UI 断言通过；直接 HTTP retry 返回 409 / ARCHIVED，说明复制为新任务，任务仍 archived=true、phase=failed。 | 关闭 |
| UIR04 / medium / P1：不能只保存人工声明 | Tasks:107 停止确认不再 required；提示只保存声明、继续保留占用。本人实际不勾 checkbox 提交补录，弹窗关闭，真实 DB 中 source=manual、occupies=true、phase=needs_confirmation，没有误解除。 | 关闭 |

UIR02 额外探针为了隔离编辑关联，直接写入受控的**归档元数据** fixture。该场景证明历史 artifact 选择与移除，不声称重新测试实际文件收集/预览。这些能力不属于本次四项修复范围。

## 新增未知启动人工核对

新增流程在原有未知启动记录上提供人工恢复入口，界面区分“列表未发现”和“真实进程停止”，展示原目录及终端；未取得 target 时要求核对相关窗格与进程。明确说明解除仅保存人工核对记录，重新启动须另行发起。

本次独立实际核对：

1. 仅 unknown 记录提供入口。对话框初始焦点落到“启动核对证据”；证据与停止核对 checkbox 均为必填，任一缺失保持弹窗和 unknown 状态。
2. 提供证据后模拟同 cwd Agent 仍可见：服务端拒绝解除，原状态与填写证据保留；[实际拒绝截图](ui-retest-start-visible-rejected.png)。同 target 拒绝分支源码已查，本次浏览器负例直接覆盖同 cwd。
3. 列表返回 6 秒前的观测：拒绝“观测已过期”，保持 unknown。服务端先 refresh，再验证 fresh 和 target/cwd；请求契约要求 confirmedStopped=true，人工记录来源不能由浏览器任意传入。
4. 移除可见匹配并恢复新鲜列表，服务端成功提交后由浏览器 route 中断**响应**。界面保持可恢复错误；再次点击重放相同 operation，最终弹窗关闭。只有 **1 条 start.resolve 事件**，resolution.source=manual；fake.start 总调用仍为最初失败启动的 **1 次**，interrupt **0 次**。
5. 页面刷新后保留“已由人工核对解除”，动作入口消失。独立 E2E 另直接只读 SQLite 核对 status=dismissed 与人工证据。

这条流程没有自动启动/终止副作用。人工声明不是服务端证明已停止；用词与实际 provenance 相符。

## 六类场景及技术审查

| 类别 | 适用证据 |
| --- | --- |
| 状态迁移 | failed→retry→新 attempt；archived 保持禁止 retry；unknown→dismissed；人工补录只改变声明并保留占用 |
| 幂等 | 成功响应被中断后实际点击重放；单事件、无重复启动/中断；源码先 replay 再判断 unknown |
| 时序 | 第二 attempt 与历史选择独立；核对前 refresh，过期与仍可见实例明确拒绝；仍在执行的启动调用另有 starting guard（源码） |
| 恢复 | 表单拒绝保留输入；成功响应未知可重放；浏览器 reload 与 SQLite 读回保持结果 |
| 关联 | 归档父依赖与历史 attempt artifact 可识别并移除；原 start id/cwd/target 与核对记录关联 |
| 隔离 | 每轮 mkdtemp、独立 DB/动态 localhost 端口/浏览器 context、FakeHerdr；仅清理自建测试资源，无真实用户 Agent 操作 |

Impeccable 固定 detector 对本次两个 UI 文件实际执行成功，输出 `[]`：0 findings、0 matched rules、0 affected files，见 [ui-retest-detector.json](ui-retest-detector.json)。没有将 detector clean 当作业务流程通过依据。未启 overlay/live-server、未改 CSP、未创建根 `.impeccable`。

在原审查的五维基础上，新增交互保持既有标签、原生表单和 Radix 对话框；错误信息出现在当前弹窗内。390×844 模拟视口 document.scrollWidth=390，[窄屏截图](ui-retest-narrow-viewport.png) 未见页面横向溢出。此次不声称物理触控、读屏认证、200% 缩放或重新运行性能负载基准。原无障碍/性能/响应式/主题各 3 分的证据范围保持；实现完整性因四项明确缺口关闭修订为 4 分，**16/20（Good）**，仅用于本次已审网页范围，不是全产品质量保证。

## OCR 覆盖与执行失败保留

本次 preview 与 rule 均实际执行退出 0：[ui-retest-preview.json](ui-retest-preview.json)、[ui-retest-rules.json](ui-retest-rules.json)。按规则检查相关状态、幂等、时序、恢复、关联、隔离、错误处理和调用链；不提出未确认产品语义。

[ui-retest-scope.json](ui-retest-scope.json) 为每个 preview 项保留 path/status/处置理由：total=921、reviewable=169、reviewed=15、skipped=154、excluded=752；workspace 文件覆盖 8.88%。明确网页/E2E 范围 **15/15**：修改两 UI 文件与新增 E2E 本次复查；另外 12 文件与本轮原审查指纹完全相同，继承其先前独立全文阅读。4 个后端/contracts 文件仅查关联分支，**不计为整文件 reviewed**，其精确指纹一并保留交根聚合。文件覆盖不等于语义或测试覆盖。

额外探针首次用 Playwright `uncheck()` 操作历史 artifact，取消后该历史候选按实现即时移出列表，定位器等待超时。保留 [ui-retest-extra.log](ui-retest-extra.log) 和 [首轮观察](ui-retest-extra-observations-first.json)；只调整临时测试为 click + 等待选项消失 + 真实保存断言，最终通过，没有为通过而改候选源码。作者此前路由 checkbox 等待失败仍由作者证据保存，本人未覆盖。

所有已启动浏览器、HTTP 服务、SQLite/collector 在 finally 关闭，自建临时数据删除。临时探针位于 `/tmp/meteor-flow-ui-retest-20261008.mts`，供需要时复现；不是产品代码。本次关闭结论适用于上述精确源/构建指纹。
