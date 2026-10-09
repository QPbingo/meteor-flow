# 当前网页流程与 API 契约独立审查

日期：2026-10-08。状态：独立审查完成，4 项 medium / P1 待修复；无 critical/high。审查者：`/root/ui_technical_review`。范围：`apps/web/**`、`tests/e2e/**`，及支撑这些流程的 HTTP schema、application、domain、terminal 调用方。只生成证据，未改候选源码。不是人工验收签署。

本轮重新走查当前实现，没有沿用旧 UI 问题关闭结论代替验证。界面结构仍符合 Operate 工作台的设计依据，但四处状态与恢复流程存在实际缺口，当前不能据此宣布用户流程全部完成。

## 基线与实际环境

- 重新构建 `pnpm -r build`，退出 0；浏览器载入 `index-VXk26kR3.js` / `index-D9rJBP-M.css`。14 个候选文件的精确 SHA-256 在 [ui-reviewed-baseline.json](ui-reviewed-baseline.json)，浏览器验证结束后复算未变化。
- 本机 Node v24.21.0、darwin/arm64，仓库固定 Playwright 1.63.0 / Chromium；使用每次新建的临时目录、动态 localhost 端口、真实 HTTP/SQLite worker/文件采集器。仅 herdr 与终端 CLI 边界使用仓库 FakeHerdr/terminal fixture；不连接用户 Agent、不确认真实登录或授权。
- 当前上下文已加载 AGENTS、prerequisites、verification/OCR/Playwright/Impeccable/test-master 及适用引用；本轮重读当前项目技能、audit、E2E/anti-patterns、已确认需求/方案和 DESIGN。沿用同一上下文先前一次 Impeccable context，不重访谈。临时复现脚本前重读 capture-constraints 完整索引及 R-002，核实实际 Node；本地产品无已部署线上环境，R-001 不适用。
- doctor、OCR preview/rule 和 Impeccable detector 均退出 0。原始文件分别为 `ui-doctor.log`、`ui-preview.json`、`ui-rules.json`、`ui-detector.json`。detector 输出 `[]`：0 findings、0 rules、0 files；它不检测下列业务流程缺陷。

## UIR01 · medium / P1 · 重试后详情默认停留旧执行并显示“无当前占用”

位置：`apps/web/src/Tasks.tsx` 的 TaskDetail（`attemptId` 初始化及 overview 占用文案）。关联 R01/R05/R06、V13。

触发：打开失败任务详情，不手动切换执行尝试；点击重试，恢复已暂停 Agent 并允许派发。真实服务已创建第二个 attempt，任务标题显示“投递中”，但 `useState(task.currentAttemptId)` 只初始化一次，所选执行仍为第一次。概览继续显示“无当前占用 / 已失败 / 第一次执行明确失败”，与当前占用事实不同。

证据：[ui-browser-observations.json](ui-browser-observations.json) 的 `retry_detail`、[截图](ui-retry-stale-detail.png)。本轮第二次 id 为 `7c00246a-97ef-4289-80cc-154ed106d204`，界面仍选 `159734b2-9db6-457e-b1bd-0cf4d275c7c9`。该场景未选择历史执行，旧执行停留并非用户主动历史查看。

建议：默认跟随当前 attempt；区分用户主动历史选择并保留其选择。查看历史时明确标注“所选执行占用”，同时展示当前任务是否有新执行占用。回归同时覆盖默认跟随与主动历史选择，不能只把 state 在每个刷新时重置。

## UIR02 · medium / P1 · 上游归档后，已选依赖从编辑表单消失

位置：`apps/web/src/Tasks.tsx:18` 的 `candidates` 过滤及依赖编辑。关联 R08/R11、V16/V28。

触发：一个 queued 下游依赖失败/取消上游；上游随后归档。打开下游编辑，`!candidate.archived` 将已经选择的上游排除，整个表单没有该依赖及其取消入口，但本地 state 和服务端仍持有它。用户无法通过网页移除这条阻塞依赖，保存其他字段也会继续携带隐藏依赖。

证据：[ui-browser-observations.json](ui-browser-observations.json) 的 `archived_dependency_editor`：服务端依赖数组非空，表单 `selectedDependencyVisible=0`；[截图](ui-archived-dependency-missing.png) 后方概览显示依赖，弹窗不显示。

建议：至少始终展示当前已选依赖（包括已归档上游），标明归档状态并允许尚未开始的任务取消/调整依赖；不要在默认新增候选筛选时丢掉已选项。测试归档前后编辑及取消选择后的真实数据库结果。

## UIR03 · medium / P1 · 已归档任务可接受重试，却永久留在队列之外

位置：`apps/web/src/Tasks.tsx` 的 retry 操作、`apps/server/src/domain/model.ts` 的 `task.action/retry` 与 `waiting()`。关联 R06/R07/R08。

触发：在“已归档”列表打开失败/取消任务，点击重试。UI 提供该操作，HTTP 返回接受；任务变为 `phase=queued`，但 `archived=true` 不变。调度谓词第一步拒绝归档任务，页面显示“待派发 / 任务不在等待队列”。默认列表隐藏它，现有 UI 也没有取消归档入口。

证据：[ui-browser-observations.json](ui-browser-observations.json) 的 `archived_retry` 保留真实任务字段和 UI 文本；[截图](ui-archived-retry-stuck.png)。这不是等待 Agent 或全局暂停导致，`waiting()` 在这些条件之前就拒绝 `archived`。

建议：保持已确认的归档语义，前后端一致拒绝归档任务重试并引导“复制为新任务”；如选择恢复归档则必须明示行为，不能返回成功却生成不可执行的 queued 记录。回归覆盖 UI 可用性及直接 API 请求。

## UIR04 · medium / P1 · 人工声明被强制绑定“已停止”确认，已有安全 API 无网页入口

位置：`apps/web/src/Tasks.tsx` 的 TaskActionDialog `stopped` required 和补录 description。关联 R05/R06；technical-design §6 明确“结论与占用解除分别校验……无法证明时只记录声明并维持暂停”。

触发：未知投递进入 needs_confirmation，用户已有结论/原因/证据，但无法确认执行停止。填写必填字段后不勾“我已核实本次执行已停止”，浏览器原生表单有效性为 false，点击确认不产生写入。强迫勾选会要求用户作自己无法核实的声明。

独立对照：同一真实 HTTP 服务提交 `record-conclusion` + `stopped:false` 返回 200，写入 `manualEvidence`，任务仍 needs_confirmation 且 `occupies=true`。后端已支持所需安全行为，网页关闭了这条路径。

证据：[ui-recovery-observations.json](ui-recovery-observations.json) 的 `manual_unverified_ui/manual_ui_no_write/manual_unverified_api`、[截图](ui-manual-declaration-blocked.png)。建议允许仅保存声明，明确告知不会解除占用；停止核实独立展示真实身份/连接事实，由后端决定能否释放。

## 通过的流程与六类场景

| 类别 | 本轮实际核对 |
| --- | --- |
| 状态迁移 | 创建→编辑（名称、说明、指定 Agent）真实保存，revision=2；启动记录→started→观察接入真实保存；重试/归档发现 UIR01/03 |
| 幂等 | 阅读 api.ts 的 sessionStorage operation ID、busy 门闩、明确拒绝清除及既有 E2E；本轮不新增声称已执行响应丢失测试，前轮证据仍需按最终基线聚合 |
| 时序 | 在第一个结果/归档和结束后重试，分别等待真实持久状态；启动与确认接入仍分离；UI stale attempt 问题有明确新旧 id |
| 恢复 | 真页面拦截 state HTTP 使读取失败，保留旧任务并禁写；解除拦截后“重新读取状态”恢复操作。未确认停止的人工声明由真实 API 保留占用，UI 缺入口 |
| 关联 | 改绑成功；上游归档后选中依赖不可见；重试新旧 attempt 误导；Markdown 同 attempt/root/冻结 hash 的当前代码与既有用例全文核对，本轮未重跑产物全套 |
| 隔离 | 每轮 mkdtemp、独立 DB/目录/端口、新 Chromium context；终端接管与释放使用 fixture，释放后 binding paused=true；未接触用户会话 |

额外实际通过：调度并行上限保存为 3 且 paused 保持；启动恰有 1 个 fake start，接入后 managed=true/confirmed=false；终端接管后再释放回只读；390px 视口测量 document.scrollWidth=390，未见页面横向溢出。截图使用模拟视口，不代表物理移动设备或新一轮触控兼容验收。

## Impeccable 技术审查

| 维度 | 0–4 | 依据及边界 |
| --- | --- | --- |
| 无障碍 | 3 | 可见标签、原生表单、Radix 对话框、焦点轮廓保留；本次表单键盘可达。未重做完整读屏/WCAG 认证 |
| 性能 | 3 | 终端 lazy load、有界输出、图片大小限制及清理存在；本轮未运行负载性能基准 |
| 响应式 | 3 | 1440 和 390px 当前页面可用，移动测量无横向溢出；本轮未重做合成触控/200% 文本缩放 |
| 主题 | 3 | 明确 light 范围，tokens 一致，未增加暗色范围；少量原有固定色保留 |
| 实现完整性 | 2 | detector 0；独立业务/浏览器核对发现 4 个流程缺口，不能由 detector clean 推断正确 |
| 总计 | 14/20 | Good（技术外观维度）；4 个 P1 流程问题仍须修复，不构成交付通过 |

本轮采用 audit 与用户流程核验，没有声称执行新一轮完整 critique A/B；不创建根 `.impeccable`、不启动 overlay live-server、不改 CSP。固定 detector 结果已核验，其规则无法覆盖这些状态关联问题。建议在授权修复中按 `$impeccable harden` 处理四条具体路径，最后以 `$impeccable polish` 做有界复查，不重做设计。

## 范围、失败保留与清理

[ui-scope.json](ui-scope.json) 逐项记录原始 preview 的 `(path,status)` 与排除原因：total_files=863、reviewable=168、reviewed=14、skipped=154、excluded=695；workspace 文件覆盖率 8.33%，明确网页/E2E 候选 14/14=100%。其他并行模块由根聚合，不能据此声称全仓库独立审查完成。

临时复现脚本在 `/tmp`，不是产品测试或业务代码。首次 `.ts` 被 tsx 当作 CJS、一次 Chromium 沙箱 MachPort 拒绝，以及两个复现脚本前置/等待问题均保留原始 `ui-browser*.log`，未伪装为产品断言失败或删除历史：前置问题为需要显式恢复已因无结果空闲观测暂停的 Agent；等待问题为归档 checkbox 前须等待关闭弹窗与路由提交。本轮没有把重新运行变绿当作产品修复。

最终主复现 `ui-browser-executed3.log` 与恢复复现 `ui-recovery.log` 都退出 0；它们成功证明缺陷存在，不表示四项问题通过。原始观察 JSON、截图与 [截图 SHA-256](ui-screenshot-sha256.json) 已保存。每次已启动浏览器、HTTP 服务、终端 fixture、DB/collector 均在 finally 关闭，仅清理自建临时数据；没有 user Agent 副作用。最终修订后需建立新证据与增量复查，不覆盖本轮缺陷基线。
