# 网页实现与验证记录

日期：2026-10-07。状态：网页实现完成，作者检查及浏览器测试完成；独立 OCR、Impeccable critique 与整体人工验收待根 agent 统一安排。
适用范围：`apps/web/`（未修改 package.json）、`tests/e2e/web-console.spec.ts`、`tests/e2e/web-server.spec.ts`。执行上下文：Codex 子 agent `/root/web`，macOS arm64。本记录不签署人工验收。

## 开发前检查与 skill-readiness

已读取 AGENTS、skill-prerequisites、workflow、mandatory-scenarios、已确认 requirements、technical-design §12、DESIGN 及 web-implementation-brief。需求/技术/开始实现授权依据为 2026-10-06 已确认材料；本轮继续实现，无新增产品选型，不重走 brainstorming / Spec Kit。

已显式完整读取并应用以下技能；加载方式为项目文件，不声称运行了宿主原生命令注册：

| 技能 | 原因、来源与能力核实 |
| --- | --- |
| capture-constraints | 编码前必需；个人技能完整 SKILL、完整 index/rules 已读。R-002 适用：本产品的部署目标是本机，不存在待核实远程线上服务；已确认 Node 24，实测 `v24.21.0`，依赖版本取 pnpm 锁定与安装包。R-001 限搜索模块，本任务不适用。 |
| meteor-flow-verification | 项目 `.agents/skills/meteor-flow-verification/SKILL.md`；六类场景与证据、独立审查边界已应用。 |
| test-master | 项目技能，锁定 Jeffallan/claude-skills `1be15d8064f88fc25216442406d40add8fd23b53`；读取 E2E/security/report 引用，测试使用独立临时目录与动态端口。 |
| playwright-cli | 项目技能，锁定 microsoft/playwright-cli `b85c7a736bb473bf55b584e54a09ffa698d6d871`；使用项目 Playwright Test 1.63.0。本人启动隔离 Chromium 153.0.8010.12、点击能力探针通过。首次沙箱启动因 Mach IPC 权限失败，正常 escalation 后通过；不使用个人浏览器资料。 |
| Impeccable | 项目技能，锁定 pbakaus/impeccable `cf3d2fa07d3ad1814ac5fbbbb5b2043b795eaef1`、引擎 0.1.11；读取 new-work、craft-floor、operate、audit/critique 相关规则。context 运行一次返回多应用选择；按项目适配直接采用已确认 apps/web 及 tasks 内 DESIGN，不重新访谈。detector 运行成功。 |
| OCR 委托 | 项目完整技能已读；固定 CLI `open-code-review v1.12.12 (182898c)` 本人检查成功。不以本作者自查充当独立审查。 |

`python3 scripts/workflow/check.py doctor`：退出 0，skills、双端链接、来源哈希与规则完整。当前执行所需技能与工具就绪。

## 实现内容

- React/TypeScript/Vite、React Router URL 查询状态、TanStack Query 每秒校准、Radix Dialog/Tabs、独立懒加载 xterm 终端；样式继承 DESIGN 的浅色工作台。
- 一次性 fragment 凭证立即清除后兑换 Cookie/CSRF；所有写入带 CSRF、操作标识。同一次失败请求重试复用标识，提交中禁止重复提交；失败保留表单。
- 项目创建、选择、归档并保留历史入口；session 选择与明示切换；全局暂停与 1—8 并行配置；真实空状态引导。
- Agent 发现、观察接入、目录/会话/能力声明确认（写入 evidence）、启动 Codex/Claude、自动/手动/暂停/恢复；存储异常显示恢复存储与显式确认的未持久化紧急中断。
- 任务创建/编辑、同项目依赖及必要归档输入、必要输出、授权输出根；搜索/状态/归档筛选和任务详情可通过 URL 恢复。
- 详情展示任务与 attempt 阶段、占用、等待原因、冻结输入、所选执行结果/产物、事件时间线；取消/重试/复制/归档/重采集/人工结论均有确认。人工证据即使没有 Agent 结果仍显示。
- Markdown 只允许被动文本结构，移除图片、链接、任意主动 HTML；产物预览按 text/plain 读取，下载走同源受保护端点。
- 终端默认观察，不发送输入或 resize；显式接管成功后每帧携带 token/epoch，5 秒心跳；释放/过期/断线清空租约，重连只读，不保存或重放输入。5000 行 scrollback，待渲染输出按 UTF-8 字节限制在 1 MiB，超限断开并说明原因。
- 根据安装的 xterm 6.0 源码逐项消费会产生自动响应的 CSI/DCS/OSC 查询，并阻断 OSC8、OSC52；控制模式仅转发用户输入，源输出不会作为输入回送。

## 实际命令与结果

所有 Node/pnpm 命令前使用 PATH `/tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin`；浏览器使用 `PLAYWRIGHT_BROWSERS_PATH=$PWD/.tools/playwright`。浏览器命令通过正常 sandbox escalation 运行。

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm --filter @meteor-flow/web build` | 退出 0；主包 gzip 150.57 kB、终端懒加载包 gzip 86.10 kB | `web-build.log` |
| `pnpm exec tsc --noEmit` | 最新执行退出 0 | `web-typecheck.log`（成功无输出） |
| `pnpm exec playwright test tests/e2e/web-console.spec.ts tests/e2e/web-server.spec.ts --workers=1 --reporter=list` | 退出 0；8/8 通过，约 7.4 秒 | `web-playwright.log` |
| `.agents/skills/impeccable/scripts/impeccable detect --json apps/web/src` | 退出 0，结果 `[]` | `web-detect.json` |

源文件 SHA-256 见 `web-source-hashes.json`。根 agent 持续实现其他模块，本记录是网页范围证据；整体最终基线由根 agent 冻结并复验。

## 六类场景

| 类别 | 需求/验收 | 实际用例、结果与边界 |
| --- | --- | --- |
| state-transition | R01/R05/R06，V01/V08 | 模拟 API：保留任务阶段与 Agent 观测区别，attempt 选择更换结果；真实服务：观察接入→确认→自动→任务派发→活动观测→结果采集→成功，SQLite 占用归零、归属一致。通过。 |
| idempotency | R02/R03，V03 | 提交中按钮禁用；模拟网络失败后表单保留且 operation_id 相同。真实 HTTP 项目创建已持久化后故意丢弃响应，网页重试，SQLite 只有一个项目。Agent prompt 仅一次。通过。 |
| ordering | R04/R09，V18/V19 | 终端 take 请求后才授予租约；输出先发送 CSI/DCS/OSC 查询，等待可见解析标记，确认无 input，再键入文本，收到内容恰好为用户文本并带 token/epoch。断线后键入无任何帧；重连不补发。通过。后端取消/成功两顺序由根后端测试负责，本网页记录不宣称覆盖。 |
| recovery | R09/R12/R13，V20/V24/V25 | 状态读取失败保留旧快照、禁写；恢复读取后恢复按钮。终端断线→观察、重连无旧输入；UTF-8 超量输出断开。存储异常展示恢复/紧急中断，确认前不发请求，响应明确未持久化且 UI 不解占。通过。 |
| association | R05/R08/R11，V13/V17 | 切换 attempt 后结果/冻结输入随执行变化。真实 HTTP/collector：结果文件 task_id/attempt_id，归档内容与 SQLite artifacts 的 task_id/attempt_id 一致；浏览器预览准确文本。通过。 |
| isolation | R10/R11/R14，V21/V23/V29 | 项目切换不显示其他项目任务，URL 重载恢复所选项目；Markdown 脚本/图片/链接剥离。真实服务使用专用 temp 数据目录、独立工作目录、动态端口和 FakeHerdr，finally 仅清理本次资源。通过。服务端跨站/目录攻击由根测试负责。 |

`web-console.spec.ts` 为 7 项浏览器 + 模拟 API/WS 证据。`web-server.spec.ts` 为 1 项真实网页、HTTP、调度器、数据库 worker、文件采集与归档证据，仅 herdr/agent 边界模拟；不能称为真实 herdr/真实 Agent 集成。

## 保留的失败与修复

1. 首轮浏览器 5 通过/1 失败：Radix Dialog 自动聚焦关闭按钮，测试期望首个字段。修复 Modal 的 onOpenAutoFocus，复验通过。
2. detector 首轮报告字体栈 Inter 警告。按照已确认 DESIGN 使用系统字体，移除未加载的 Inter，最终 detector `[]`。
3. 真实 HTTP 首轮 confirm 被后端 EVIDENCE 拒绝。联调确认 Action 已要求 evidence，修复为把两个用户显式声明及绑定目录/会话写入证据，保留服务端重新核验。
4. 真实 HTTP 第二轮失败于“必要产物”精确可访问名称匹配：Field 原生 label 将说明一起纳入名称。修复为单独 aria-labelledby 与 aria-describedby，真实完整流程通过。
5. 并行合同新增 Attempt.cancelAcceptedAt/attentionSince/remindedAt 后，类型检查发现模拟 fixture 缺字段；保留 `web-typecheck-contract-drift.log`，fixture 补 null 后类型检查退出 0。此前出现的 collector/terminal 后端类型错误已向根 agent 反馈，当前全库检查通过。

## 作者界面检查（不替代独立审查）

已查看真实服务截图及同一轮桌面、390px 窄屏和 200% 根文字尺寸截图：`web-real-service.png`、`web-desktop.png`、`web-narrow.png`、`web-text-200.png`。

- 桌面以任务表为主，等待原因与阶段分层；结果、Agent 观测与终端控制文字分别标记。
- 窄屏侧栏变为顶部分组，任务表在自身容器横向滚动，文档整体无横向溢出；200% 文字下布局仍可操作，侧栏独立可滚动。
- 语义标题/区域/表单标签、键盘焦点、Esc 关闭、首字段聚焦已实测；状态不只依赖颜色；按钮具有禁用/提交/失败状态。
- 对比度以已确认浅色视觉进行作者检查；未声称屏幕阅读器、所有 WCAG 条款或移动触控终端完整通过。
- 页面不加载外部字体/图片；终端懒加载且限量缓冲；未执行已确认的 1000 历史任务 p95 / 2 终端 1 MiB/s 30 秒性能目标。

Impeccable audit 作者检查结论：界面系统一致，核心技术可用性检查通过；独立 critique A/B 尚未运行。不得把 detector 空结果视为体验完整通过。

Questions skipped: 实现任务已获授权，后续独立审查结果用于当前范围内修复与复验。

## 待完成与验收边界

- 独立 OCR、独立 Impeccable critique A/B 与最终证据基线由根 agent 统一安排。
- 真实 herdr 与真实 Codex/Claude 结果交付、完整兼容矩阵及性能目标不在本记录内宣称通过。
- 本次浏览器只验证桌面 Chromium；窄屏属于布局测试，不代表移动终端输入兼容性。
- 人工验收仍为 pending。
