# 终端租约、协议与 CLI 生命周期修复

日期：2026-10-07。作者上下文：`/root/posix`。状态：作者实现与复验完成，A02/A06 及协议相关结论待独立 reviewer 复核；未自行签署问题关闭或人工验收。

范围仅 `apps/server/src/terminal/bridge.ts` 和新增 `apps/server/src/terminal/bridge.test.ts`。未修改 HTTP server、现有 HTTP 测试、共享 schema 或前端文件。需求关联 R09/R12/R13/R14、V18/V19/V24/V26/V29，技术方案 §7/§10/§11。

## 开发前检查

本上下文此前已完整加载 capture-constraints、项目 meteor-flow-verification/test-master/OCR 委托及引用；本轮重新读取 R-002、项目 verification/skill-prerequisites，运行 doctor 和 OCR version 均退出 0。Node v24.21.0 darwin/arm64 再次核对；目标为无既有线上部署的本机产品，保持此前已确认的 Node/Koffi/SQLite 版本，不升级依赖。

终端交互触发 Playwright：本轮完整读取项目 Playwright skill 和 test reference，实际启动临时 Chrome 页面、点击按钮并校验结果，退出 0。第一次默认 bundled headless shell 不存在；改用当前已安装 Chrome channel 后成功，没有下载或变更浏览器。Impeccable skill 已读取；本次只修后端授权、流协议和进程生命周期，不修改界面、布局或文案设计，不执行视觉审查；产品浏览器链路仍归主流程复验。原有技术和行为已获确认，本轮不重做需求澄清。

## 实现

- input/resize/heartbeat/release 每条消息检查单调时钟 lease age，必须 `0 <= age < 15000`，不依赖 1 秒清理 interval；过期 heartbeat 不能恢复控制权。保留 owner connection/token/epoch、绑定 fingerprint、新鲜 observation、session、storage generation 核对。
- 每个新观察页面需要完整重画：立即隔离旧 child 输出，同一 binding 的并发 attach 合并；收到旧 child `close` 后才启动下一 observer，`exit` 不代替 `close`。
- 活跃和退出中的观察/控制 CLI 统一记录，最多 8 个（4 观察+4 控制的总预算）；发送 SIGTERM，1 秒后 SIGKILL，3 秒仍没有 close 则报告无法确认且保留容量占用。只有 close 释放预算。`close()` 变为 Promise，等待全部 CLI close；失败拒绝，不虚报停止。
- 每个发往浏览器的 state/output/error 都有 `protocol: meteor-flow.terminal/v1`。未知协议/JSON/消息结构发送带版本的错误后 close(1008)，同时撤销 viewer，排队的后续消息不生效。初次 observe 仍为 epoch 0。
- 控制申请跨越持久化 manual 和 refresh 等待时保留 claim token、bridge generation、storage generation、session、binding fingerprint/target；失效代或身份变更无法启动 control。旧 claim 的 finally 不会删除新连接的 claim。

## 实际验证

`/tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin/node node_modules/typescript/bin/tsc -p apps/server/tsconfig.build.json` 退出 0；同 Node 的全仓 `tsc --noEmit --pretty false` 退出 0。

同 Node 执行 `node_modules/vitest/vitest.mjs run apps/server/src/terminal/bridge.test.ts apps/server/src/http/server.test.ts`，27/27 通过：新增可控边界测试 22 项，既有真实 HTTP/WS/CLI 集成 5 项。原始输出见 [terminal-fix-tests.log](terminal-fix-tests.log)。受控 child 是 EventEmitter+真实 Node streams 的单元替身；真实 HTTP 集成使用 FakeHerdr、隔离 SQLite 和 terminal-cli fixture，不是模型或真实 herdr 验证。

| 六类场景 | 顺序与断言 | 实际结果 |
| --- | --- | --- |
| state-transition | observe epoch 0 → control → lease 失效 → observe；CLI ready 才授予控制，关闭不恢复调度 | 新增租约用例与既有 HTTP 控制用例通过 |
| idempotency | close 重复调用；旧 claim finally 不能清掉新 claim；合法 input/resize 恰好各写 1 条 | 新增 lifecycle/claims/输入授权用例通过 |
| ordering | 推进单调时钟到 15 秒而不执行 interval，input/resize/heartbeat 零输入副作用；旧 stdout 在替换期间/之后不能到新 viewer；exit 前后都等待 close | 3 类过期消息、旧帧 fencing、exit/close 分离用例通过，无固定 sleep 判胜 |
| recovery | TERM 后 1 秒 KILL，确认 close 后恢复容量；3 秒未确认拒绝 shutdown 并保留占用；invalidate 发生在 pause/refresh barrier 时零 control spawn | 超时/kill/claims 用例通过 |
| association | 连接/token/epoch、storage generation、binding fingerprint 不匹配即拒绝；新旧 claim 和 observer 归属不串用 | 控制盗用、存储代、身份变化、旧 claim 用例通过 |
| isolation | 30 次接入/断开时最多 8 个尚未关闭 CLI；无权限 observer 无 stdin 写入；未知协议/shape close，所有响应带版本 | 单元上限与协议用例、真实 HTTP/WS 鉴权及双控制者争抢通过 |

## 后续边界

独立 reviewer 需核查最新 bridge 和新增测试，才能决定 A02/A06 关闭。主流程继续浏览器产品回归；本报告不把准备阶段 Chrome 点击探针当作产品 E2E。若 CLI 在 SIGKILL 后仍不能确认 close，服务 shutdown 会明确失败，容量保持占用；这是故障安全行为，不是已成功回收。
