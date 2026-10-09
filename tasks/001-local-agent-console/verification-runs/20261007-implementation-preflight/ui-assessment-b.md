# Assessment B：检测器与浏览器证据

日期：2026-10-07。状态：独立评估已执行；发现待作者修复及最终复验，不是人工验收。范围：`apps/web/src/App.tsx` 及其控制台视图，CLI 扫描 `apps/web/src`。评估者：`/root/ui_technical_review`，与作者和 Assessment A 独立；未读取 A 的输出。根 agent 将在 A 完成后统一综合。

## 技能与基线

已显式读取本仓库 AGENTS、task002 skill-prerequisites/workflow/mandatory-scenarios、meteor-flow-verification、完整 Impeccable SKILL/critique/audit、Playwright SKILL/running-code、test-master/E2E 引用和 OCR 委托技能。`doctor` 退出 0。`impeccable context --target apps/web/src/App.tsx` 仅运行一次，报告根文件缺失；依项目适配直接读取 task001 requirements/technical-design/DESIGN，不访谈、不创建根设计文档。`capture-constraints` 完整索引及 R-002 已读：仅本机审查辅助脚本，无线上部署，实际 Node v24.21.0、Playwright Test 1.63.0、CLI 0.1.22、Chromium 153.0.8010.12；没有声称线上兼容。

稳定 slug 为 `apps-web-src-app-tsx`。没有 `.impeccable/critique/ignore.md`。锁定 launcher 使用项目 Impeccable 0.1.11；未自动下载或使用全局版本。浏览器运行真实 HTTP/隔离 DB 的样例服务，herdr 是模拟边界，没有连接真实用户 agent。一次性入口仅从临时元数据指向的当前入口文件读取、在浏览器兑换，不记录 secret。首轮服务资源 JS 为 `index-D0Q6bECi.js`、CSS 为 `index-CNoaKRtv.css`，源码哈希见 `ui-b-baseline.json`。作者并行补充 ArtifactPreview 后，旧构建截图不能作为新预览的通过证据。

## 确定性检测

执行：`.agents/skills/impeccable/scripts/impeccable detect --json apps/web/src`。

- 退出码：0。
- 原始 JSON：`ui-detector-b.json`，内容 `[]`。
- findings：0；rule 名称：空；发现文件位置：空。
- 输入目录含六个 TSX 视图文件，另有 API TS 与 CSS；检测器未输出逐文件扫描元数据，不能据此宣称扫描到每种文件中的所有规则。
- 无待关闭误报；零发现只说明这个固定检测器的机械检查无命中，不代表人工、行为和无障碍审查无问题。

## 浏览器与 overlay

原生 IAB 新 tab 尝试返回 `Browser is not available: iab`。现有 CUA API 不支持 DOM evaluate/injection；没有猜测接口。项目 Playwright CLI 首次启动因其 daemon cache 位于沙箱外而失败（EPERM）；Playwright Test 直接启动 Chromium 的初次沙箱尝试受 macOS MachPortRendezvous 权限阻止。获自动审批后，使用项目固定 Chromium 的独立临时 context/page，所有已创建浏览器均在 finally 中关闭。

可变注入 preflight 实际成功：更改 document.title、插入非执行 JSON script 元素；保存 `{titleMutable:true, scriptAppended:true}`。随后临时 Impeccable live-server 首次沙箱启动超时，审批后 PID 53466、port 8400 正常启动。分别在任务列表、任务结果、Agent 三视图尝试加载 `http://localhost:8400/detect.js`；三次均被产品 `script-src 'self'` CSP 阻止。控制台原文已存 `ui-browser-b.json`。没有在页面运行 detector，没有可信用户可见 overlay；未声称 `[Human]` tab 对用户可见（fallback 为 headless 截图/DOM 测量）。没有更改 CSP。

停止临时服务：`kill 53466` 退出 0；其临时 `apps/web/.impeccable/live/server.json` 已删除，空目录清理。未运行 critique-storage write/trend/ignore；所有报告归入本次 verification-runs。产品样例服务器归根 agent 清理。

## 实际证据

- `ui-b-desktop.png`、`ui-b-form.png`、`ui-b-result.png`、`ui-b-agents.png`、`ui-b-narrow.png`、`ui-b-zoom-equivalent.png`：实际隔离服务截图。
- `ui-browser-b.json`：页面文字、控件尺寸、CSP/请求资源、preflight、焦点与布局测量。1440、390、720 CSS px 均无整页水平溢出；390 的任务表和详情 tab 各自水平滚动。720 仅模拟 1440 桌面在 200% 浏览器缩放下的有效布局宽度，不能冒充真实浏览器 zoom 或物理触控验证。
- `ui-browser-b-initial.json`：首次流程保留；关闭弹窗后 `:focus` 不存在导致探针超时。后续用 activeElement 检查确认落到 BODY，未删除首次失败。
- `ui-b-e2e.log`：执行 `pnpm exec playwright test tests/e2e/web-console.spec.ts --workers=1 --reporter=line`，退出 0，7/7 通过。这里是构建前端 + 模拟 API/WS；测试截图 `web-text-200.png` 实际将 HTML 字体从 14px 调至 28px并检查无页面溢出。不能替代真实 DB/herdr 完整 E2E。
- 独立前端 OCR preview/rule 都退出 0；13 个范围内 added 文件已逐一审查，清单与范围外说明见 `ui-ocr-coverage-b.json`；整个 workspace 150 个 reviewable 条目中只审查指定 13 个，范围外 137 个明确不由本 reviewer 覆盖。没有后端源码审查或完整项目 review 通过结论。

## 浏览器核验结论

机械检测无命中，但浏览器确认 Modal 关闭焦点回到 BODY；源码中的未决 operation_id 仅存在 useRef Map、终端收包不校验协议版本、placeholder 配色对比度不足，详见 `ui-audit.md`。这些不能被机械检测零发现或既有 7 项绿色测试覆盖。

Questions skipped: 当前实现与修复已获授权；按项目 Impeccable 适配由作者修复并复验，无新增范围或设计访谈。
