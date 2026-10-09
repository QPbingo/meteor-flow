# 网页独立评估修复与复验

日期：2026-10-07。状态：作者修复与实际浏览器复验完成，等待独立审查者复查；人工验收仍为 pending。范围：apps/web（不修改 package.json）、tests/e2e/web-*。执行者：/root/web。本记录补充初始 web-report.md，不能把初始 8 项测试和旧截图当作本轮新行为的证据。

## 准备与边界

延续同一执行上下文已加载的 capture-constraints、项目 meteor-flow-verification、test-master、Playwright、Impeccable 与 OCR 委托能力；完整来源及实际能力检查见 web-report.md。本轮恢复后复核 capture-constraints 完整索引/正文，R-002 仍适用：目标为本机 Node 24.21.0、项目锁定 React 19.3.0/Vite 7.3.7/Playwright 1.63.0 与已安装 Chromium 153.0.8010.12；无远程服务/升级。R-001 不适用。已读独立 Assessment A、B 与 ui-audit.md，按现有授权修复，无新增产品范围和重新选型。

沿用已确认需求、技术方案 §12、DESIGN，以及 Impeccable Operate 模式。根 agent 负责后端目录错误、版本化端点/SSE 和最后独立复查；作者没有修改后端、没有把自查充当 OCR。所有测试为专用浏览器上下文、隔离数据库目录和动态端口；浏览器通过正常 sandbox escalation 执行，不访问外网或用户浏览器。

## 发现与处理

| 发现 | 修改及实际复验 | 状态 |
| --- | --- | --- |
| A-01 窄屏选择任务后详情不可见 | 选择/切换任务后聚焦详情标题并滚入视口；关闭后返回原任务按钮。390×844 实测标题获焦且全部在视口内；触摸点击路径同样通过。 | 作者修复完成，待独立复查 |
| A-02 无效目录错误不可行动 | 根 agent 将目录失败映射为具体 DomainError。真实服务 E2E 提交不存在目录，页面显示“此目录不存在。请先创建目录，或填写现有目录的绝对路径”，字段保留、数据库项目数仍为 0；纠正目录后继续创建成功。 | 后端修复，浏览器复验通过 |
| A-03 / B-04 弹窗关闭焦点丢失 | Modal 保存触发元素；关闭时优先还焦，触发元素已移除则回相邻按钮/详情/主区域。Escape、取消、关闭按钮、成功提交四路径均回到新建任务；真实图片预览关闭后回到原产物按钮。 | 作者修复完成，待独立复查 |
| B-01 刷新丢失未决操作标识 | sessionStorage 仅保存未决 operation_id + 路径/方法/规范化正文的 SHA-256；发送前保存，成功/明确 4xx 清除，网络/响应解码/5xx 保留。真实服务提交成功→故意丢响应→页面刷新→同内容重试，项目数据库记录仍只有 1 项。模拟测试另核对 ID 一致、正文不落 sessionStorage、明确拒绝清除。 | 作者修复完成，待独立复查 |
| B-02 终端入站协议/字段未校验 | 校验 meteor-flow.terminal/v1、消息类型、字段类型、epoch 与 control token；观察 epoch 0 合法，control 最小 1；旧 epoch、未知版本/类型、缺协议、畸形 state 均失权并关闭/提示。正常租约、用户输入与断线不重放仍通过。 | 作者修复完成，待独立复查 |
| B-03 placeholder 对比度不足 | 改为语义 token --placeholder:#647084；白底 sRGB 对比度约 5.009:1，可见标签保留。 | 作者修复完成，待独立复查 |
| B-05 触摸命中区偏小 | 窄屏/coarse pointer 主要按钮、任务标题/关闭图标和会话按钮至少 44px；触控上下文实际 tap 打开/关闭详情，CDP 合成 touch swipe 横向滚动表格成功。 | 作者修复完成，待独立复查 |

未决标识存储范围遵循根 agent 指定的 sessionStorage：同一页签刷新可恢复；关闭页签后重新建立浏览器会话不在该恢复证据内。服务端仍是操作事实来源，不把内容相同自动视为成功，不存表单正文或终端输入。

## SSE、API 与产物预览

所有前端 API/WS 请求使用 /api/v1。认证后订阅 /api/v1/events，对合法 snapshot/change 通知立即失效并读取 React Query 快照；保留每秒轮询校准。校验 meteor-flow.events/v1、事件类型和非负安全整数 sequence，未知协议/字段关闭通知并显示兼容提示；普通断线由 EventSource 重连，页面提示并继续轮询。

真实 E2E 在初始 snapshot 已接收后，把测试环境 1 秒轮询暂时改为 60 秒，保留正常 React 通知计时；通过 Console.settings 写入已持久化设置，观测到 change sequence 与可见暂停提示，单次耗时小于 1 秒。准确毫秒数及 sequence 见 web-sse-latency.json；计时包含持久化调用耗时，仅为 1 个样本，不是 p95、负载或延迟 SLA 验收。

保留根 agent 新增 PNG/JPEG/GIF/WebP 图片 Blob、Markdown 和 JSON 预览；前端只接受上述被动栅格 MIME 或 text/plain，其他类型引导下载。真实 HTTP 归档预览已验证：PNG naturalWidth=1、同源 blob URL 正常受 CSP 允许、关闭后 URL 已 revoke；Markdown 的 script/远程图片被移除、没有外部请求；JSON 可读缩进；text/plain 按文本读取。任务/attempt/产物的数据库关联及一次 prompt 均检查通过。这是实际产品 UI/HTTP/SQLite/worker/文件归档链路，唯一模拟边界为 FakeHerdr，不是实际 herdr/Agent E2E。

## 六类场景与证据

| 类别 | 需求 / 实際证据 |
| --- | --- |
| 状态迁移 | R01/R05/R09：真实观察→确认→自动→派发→活动→结果成功；终端合法 control→断线/坏帧→observe；SSE 通知驱动暂停状态更新。 |
| 幂等 | R02/R03/R12：真实已提交项目丢响应后刷新重试，SQLite count=1；模拟同 ID、明确失败清除与 pending 禁重复。 |
| 时序 | R09/R14：观察不发 resize/input，take 成功后才授权，查询输出解析完成仍无输入帧，随后用户文本才发送；旧 epoch 与断线输入不重放。 |
| 恢复 | R12/R13：过期快照保留/禁写；SSE 失联继续快照校准，坏协议明确关闭；未决操作跨刷新恢复；目录失败保留表单；弹窗退出保持键盘位置。 |
| 关联 | R05/R08/R11：切换 attempt 后结果/冻结输入一致；真实产物在 SQLite 的 task_id/attempt_id 与浏览器所选任务一致；预览关闭回原产物。 |
| 隔离 | R10/R11/R14：同项目筛选；被动 Markdown/MIME allowlist/CSP；blob 回收；独立 temp 数据和端口；没有外网资源或真实用户 Agent。 |

## 最终执行与保留失败

命令前 PATH 指向 /tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin；浏览器环境 PLAYWRIGHT_BROWSERS_PATH=$PWD/.tools/playwright。

- pnpm --filter @meteor-flow/web build：退出 0；web-refinement-build.log。
- pnpm exec tsc --noEmit：退出 0；web-refinement-typecheck.log（无输出）。
- pnpm exec playwright test tests/e2e/web-console.spec.ts tests/e2e/web-server.spec.ts --workers=1 --reporter=list：12/12，通过；web-refinement-playwright.log。11 项模拟 API/WS，1 项真实服务链路（FakeHerdr）。
- .agents/skills/impeccable/scripts/impeccable detect --json apps/web/src：退出 0，[]；web-refinement-detect.json。无机械发现不代表独立设计关卡通过。
- 源码/测试/构建 SHA-256：web-refinement-hashes.json；对应当前 index-BgaYm1Rr.js 与 TerminalPanel-DHr4zC5s.js。

本轮保留两类失败，未以重跑抹去：

1. 终端 PARSER_SAFE 可见文字断言连续失败。web-terminal-output-failure.json/png 显示终端 host top≈802.5，视口高度 780，完全在视口外；xterm 暂停离屏 DOM 渲染。测试明确 scrollIntoViewIfNeeded 后验证真实可见输出，仍验证查询不产生 input 与精确用户文本。web-refinement-terminal-first-failure.md 保存首次上下文。没有为了通过删除协议/输入隔离断言。
2. 初次 SSE 探针使用 clock.install 仍在走时，不能据此声明已停轮询；随后 pauseAt 冻结所有时间也冻结 React Query 的通知，出现 UI 未更新的测试失败（web-refinement-clock-failure.md）。最终只将 1 秒 interval 延长为 60 秒，并检查真实 snapshot/change 到达，证据已明确当前方法，旧时钟方法不作为性能结论。

作者检查了截图和焦点/几何记录：web-refinement-narrow-detail.png、web-refinement-focus.json、web-refinement-image-preview.png、web-real-service.png。fullPage 截图会保留截图时 sticky/fixed 的位置，窄屏实际视口证据以 web-refinement-narrow-detail.png 和坐标为准。前轮 web-desktop/web-narrow/web-text-200 截图仅用于当前测试布局记录。

Questions skipped: 授权内修复、版本化接口联调与复验；无新增决策需要用户确认。尚未声称真实 herdr/真实 Codex 或 Claude 完成交付、屏幕阅读器全覆盖、多浏览器兼容或既定高负载性能目标通过。独立复查及整体证据基线由根 agent 安排；本作者不签署人工验收。
