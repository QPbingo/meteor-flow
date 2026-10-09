# 开发启动链路实现与验证

状态：作者实现及实际验证完成，待根 agent 分配独立增量审查；不代表人工验收。日期：2026-10-07。适用：technical-design §2 中 macOS arm64 / Node 24 的开发启动方式。

最新复验：独立审查后的修订已完成，`dev-review-final.log` 为 5/5 通过，`dev-typecheck-review.log` 为类型检查通过；具体审查发现与修订见文末。独立审查结论仍由 reviewer 签署。

## 实现范围

- `scripts/dev.mjs`：要求显式 session，兼容 pnpm 传入的 `--` 分隔符，先运行实际 workspace build，成功后启动 contracts、posix-fs、server 的 TypeScript watch；Node 监听三个 dist 目录后运行编译后的 CLI，包含 worker/collector 的间接载入代码；Vite 使用独立开发端口。任何必需编排进程退出或收到 SIGINT/SIGTERM 时，终止本次进程组，等待最多 5 秒，再收割未退出的后代，不能仅因组长退出就留下孙进程。
- 根 `package.json` 与 `apps/server/package.json` 的 dev 均指向该启动器。没有修改其他包的脚本、业务代码、前端组件或契约。
- `apps/web/vite.config.ts`：仅绑定 127.0.0.1，严格端口；关闭跨源 CORS；HTTP 请求必须使用精确开发 Host，Origin 若存在必须为精确开发 Origin，写操作必须具有该 Origin，拒绝 `Sec-Fetch-Site: cross-site`。API 的 HTTP 与 WS 在转发前再次校验，只有合法请求才重写后端 Host/Origin；保留 Cookie、CSRF、后端鉴权，未开放宽泛 changeOrigin。WS 缺 Origin 同样拒绝。
- 测试仅新增 `tests/integration/dev.test.ts`、`tests/fixtures/dev-build.mjs`、`tests/fixtures/dev-server.mjs`。

## 使用方式

```sh
pnpm dev -- --session <已选择会话>
# 可选：--data-dir <路径> --herdr <绝对路径> --port 4317 --dev-port 5173
```

先打开服务输出的 `http://127.0.0.1:4317/#token=…` 完成一次性入口认证，再打开 `http://127.0.0.1:5173/`。Cookie 的同 hostname 作用域支持两端口，不能把其中一个改为 localhost。后端代码变化触发重启后，旧认证失效，需要重新打开服务输出的新入口；启动器也打印了这一说明。已实际执行 `pnpm dev -- --help` 验证根脚本参数转发。

## 编码前置

本会话读取并应用 capture-constraints 索引和 R-002，目标版本为 Node 24.21.0、TypeScript 5.9.3、pnpm 11.9.0、Vite 7.3.7、Chromium 153.0.8010.12。本地已确认技术方案继续有效，无新的选型或行为审批。

已加载项目 meteor-flow-verification、test-master（集成、安全、反模式引用）、OCR 委托，以及 Playwright、Impeccable。doctor 和 OCR 1.12.12 实际可用。Impeccable context 正常执行，但上游默认根目录上下文定位不适用本项目，因此直接读取 tasks 中的需求、technical-design 与 DESIGN；没有重新安装工具或要求用户重做设计确认。无界面设计改动，audit/critique 的视觉评分不适用；开发访问、认证和错误恢复由真实浏览器交互验证，机械检测 `dev-impeccable.json` 返回空 findings。

首次 Chromium 探针因使用默认缓存路径缺文件失败；改为项目既有 `PLAYWRIGHT_BROWSERS_PATH=$PWD/.tools/playwright` 后实际打开隔离页面并点击成功，未下载浏览器。

## 结果与六类场景

`dev-final.log`：3/3 测试通过，退出码 0，7.95 秒。`dev-typecheck.log`：类型检查退出码 0。

```sh
PLAYWRIGHT_BROWSERS_PATH=$PWD/.tools/playwright \
PATH=/tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin:$PATH \
node node_modules/vitest/vitest.mjs run tests/integration/dev.test.ts --reporter=verbose
```

| 类别 | 前置/顺序与断言 | 证据 |
| --- | --- | --- |
| 状态迁移 | 缺 session 不构建；build 失败不启动；成功后启动 runtime/Vite | dev-final.log，第 2/3 用例 |
| 幂等 | 本启动器不实现业务重试；重启只重新打开原数据。业务操作仍经原持久化机制；浏览器创建一个项目，真实 SQLite 恰好 1 行 | 第 1 用例，dev-root-smoke.json |
| 时序 | build 完成前没有 runtime；修改仅由子进程加载的 dist 文件后，新的 CLI 读取修改后的标记；退出按进程组处理 | 第 3 用例 |
| 恢复 | 程序接收 SIGTERM 后正常清理；故意忽略 SIGTERM 的孙进程必须被最终收割；所有采集到的后代 PID 消失，Vite 端口关闭 | 第 3 用例 |
| 关联 | session、data-dir、herdr、后端端口都原样传给编译 CLI；开发 Cookie 与 CSRF 对应真实后端会话 | 第 1/3 用例，根启动 smoke |
| 隔离 | 专用临时目录、随机端口、FakeHerdr；5 组恶意 Host/Origin/Fetch-Site 的 HTTP/WS 均 403，缺 Origin 写入/WS 403，后端转发计数不增加；正常 Cookie/API/WS 可用，缺认证仍 401，缺 CSRF 仍 403 | 第 1 用例 |

浏览器真实经过后端入口认证 → Vite 页面 → 表单创建项目 → SQLite 持久化，随后拿到终端模拟输出。只有 herdr 和终端 CLI 边界使用 fixture，其余为真实 HTTP、WebSocket、Vite、React、Chromium、SQLite 和应用服务；没有模型调用或用户现有 session 访问。

`dev-root-smoke.json` 另记录根目录真实 `pnpm dev -- --session ... --data-dir ... --herdr /usr/bin/false --port ... --dev-port ...`，实际 workspace build、三个编译 watcher、编译 CLI、Vite 全部运行。herdr 使用随机专用 session/XDG 且 executable 禁用；浏览器完成认证与创建项目，session 关联正确。退出后本次 9 个进程全部停止，临时目录删除。输出中的入口 token 已脱敏。

## 首次失败保留

- `dev-initial.log`：浏览器已创建项目，但测试误将产品 WS 的 `output` 帧当作 herdr 原始 `terminal.frame`；另两个启动器 fixture 因 pnpm 11 默认自动检查依赖与临时缩减 workspace 不匹配而失败。
- `dev-retest.log`：修正 WS 断言后代理测试通过；仅靠环境变量未覆盖 pnpm 的非 workspace 分支，fixture 仍失败。
- `dev-third.log`：为临时 fixture 增加最小 workspace 与 warn 检查策略后 3/3 通过；未更新或安装项目依赖。
- 随后补上忽略 SIGTERM 的后代清理回归，最终 `dev-final.log` 再次 3/3 通过。没有依靠重复运行掩盖首次失败。

启动器进程测试使用专用最小构建/CLI fixture 验证顺序和生命周期；根 smoke 另补真实 workspace 的联动证据。真实 Codex/Claude 专项仍维持其原审批状态，本任务没有重试该调用。

## 独立审查后的修订与最终证据

reviewer 发现初始 build leader 退出后直接从跟踪集合移除，会跳过其仍存活的后代。现仅在整个 group 消失后移除；失败或中断始终保留该组进入 stop；如果 build 报成功但仍遗留后台组，拒绝启动开发服务并清理，不把一个过期 group 标识长期留到后续停止时使用。

新增两个具有 ready 同步点的用例：build 的后代已安装忽略 SIGTERM 的处理器后，分别让 build 失败或中断整个开发启动。两个情况均不得启动 runtime，并必须最终收割后代。`dev-review-fix.log` 记录 4/5 通过，随后 `dev-review-diagnostic.log` 复现运行期清理的问题：macOS 在退出过程中对 `kill(-pgid, 0)` 返回 EPERM。两次均通过 require_escalated 正常执行，不是改用沙箱权限绕过测试。

EPERM 按“进程组存在”继续轮询，不被解释为已退出。该异常此前会提前抛出并中断其他组清理。修订后 `dev-review-final.log` 记录 5/5、退出码 0、19.27 秒，包括完整代理/浏览器验证及 3 个后代清理场景。`dev-typecheck-review.log` 退出 0。

诊断失败遗留的 3 个专用 fixture 进程（PID 74917、74920、75562）已通过 PID、PGID、UID、准确启动时间和完整唯一测试命令再次核对后单独收割。测试 finally 也增加只针对本次已记录 PID 的兜底清理；业务断言发生在兜底前，因此兜底不会把失败假装成通过。

初始 build group 修订后另执行真实根 `pnpm dev`：`dev-root-review-fix.json` 为 passed，真实 workspace build 后两个端口均正常，关闭后开发端口消失。该 smoke 未重新执行模型任务，仍使用新建的专用 session/XDG/data 与 `/usr/bin/false`。原浏览器/9 进程完整 smoke 的证据保留为 `dev-root-smoke.json`。

最终代码指纹为 `dev-baseline-review-fixed.json`；旧 `dev-baseline.json` 保留为审查前指纹。已通知根 agent 与独立 technical reviewer 复核，未自行关闭审查发现。
