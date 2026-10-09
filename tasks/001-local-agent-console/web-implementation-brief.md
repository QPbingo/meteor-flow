# 网页实现边界

历史分工稿（2026-10-07）：仅保留初次接口和分工，后续 Markdown 内嵌归档图片等已补齐；不作为最终实现或验收约束，当前行为以 requirements、technical-design 和 verification-status 为准。

状态：2026-10-07 已授权实现；本文件是分工接口，不改变已确认需求。

先读 AGENTS、skill-prerequisites、capture-constraints、项目 verification/test-master/Playwright/Impeccable 完整技能、requirements、technical-design §12、DESIGN。实现仅写 apps/web/（不修改 package.json），可写 tests/e2e/web-*。根 agent 负责 API 与最终独立审查。

Node24 路径 `/tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin`；pnpm workspace 依赖已装。Playwright 浏览器在 `.tools/playwright`，实际交互探针通过；若 Mach IPC 权限错误需正常申请 sandbox escalation。新 agent 必须亲自验证技能/工具，不能继承根级已加载声明。

## API 合约

共享类型 packages/contracts/src/index.ts。所有 JSON 写入带 operation_id（crypto.randomUUID），重试同一次操作必须复用。fetch same-origin credentials。GET /api/auth 返回 `{ authenticated:boolean, csrf:string|null }`；URL fragment 的 token（`#token=...`）通过 POST /api/bootstrap `{token}` 兑换并立即清除 fragment，响应 `{csrf}`。未认证展示从启动终端打开链接的说明。

GET /api/state 返回 ConsoleSnapshot；定时轮询 1s，失败保留快照明确过期，禁止依赖旧状态执行。GET /api/sessions 返回 `{sessions:{name,socketPath}[]}`。POST /api/session `{operation_id,session}`；POST /api/projects ProjectInput；POST /api/projects/:id/archive Operation；POST /api/bindings BindingInput；POST /api/starts StartInput；POST /api/bindings/:id/actions ActionInput；POST /api/tasks TaskInput；PUT /api/tasks/:id TaskUpdate；POST /api/tasks/:id/actions ActionInput；POST /api/settings SettingsInput。所有写入 header `x-csrf-token`。成功返回实体；失败 `{error:{code,message}}` 非2xx。以服务端状态为准，不乐观宣称执行成功。

GET /api/artifacts/:id/content?download=1 下载；默认返回安全纯文本（服务端限量），网页预览文本纯文本即可，图片不必内联，禁外链/主动内容。结果摘要 Markdown 渲染必须 sanitize，禁外网图片与任意 HTML。

WebSocket /api/terminal/:bindingId?csrf=... 同 origin Cookie，消息 TerminalInput。连接默认观察。服务端 `{type:'output',data:string}`、`{type:'state',mode:'observe'|'control',token?:string,epoch:number,message:string}`、`{type:'error',message}`。take 需界面明确确认；control 才转发 xterm input/resize，每帧 token+epoch。heartbeat 每5秒；release/断线后清空控制token，UI暂停提示。观察模式不传尺寸或输入。服务端可能拒绝接管活动执行，展示原因。xterm addon-fit仅本地尺寸，不能观察模式发resize。

## 必须覆盖的 UI

空状态引导、项目创建与切换、session 明示切换、agent发现/观察接入/确认接入（真实目录/会话/能力声明）/启动 Codex或Claude/自动手动暂停；任务创建、依赖与必要产物、授权输出根、等待原因、搜索状态筛选、详情/attempt历史/结果产物/事件；取消、重试、复制、归档、重采集、人工结论（原因+证据+已停止声明）；全局暂停/并发配置；终端独立面板与观察/接管/释放。不能把没有后端事实的按钮伪装为成功。所有危险转换用 Radix Dialog 或原生确认对话，键盘与焦点可用；中文界面。

实现 React + TypeScript + Vite、router/query/Radix/xterm，CSS 遵循 DESIGN。构建输出 apps/web/dist。开发 Vite proxy `/api` -> http://127.0.0.1:4317 且 ws:true；实际验收服务端静态同源。提供 index.html、vite.config.ts、src 主入口与样式。报告归入 verification-runs/20261007-implementation-preflight/web-report.md，区分构建/浏览器/模拟服务与真实产品证据。
