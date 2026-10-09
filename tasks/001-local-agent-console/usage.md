# 使用与开发说明

日期：2026-10-08。状态：按已确认方案实现；人工验收 pending。适用：macOS arm64、Node 24、herdr 0.9.0/0.9.3，Codex/Claude 首批适配。实际测试边界见 [验证状态](verification-status.md)。

## 启动与首次使用

1. 使用 `.node-version` 指定的 Node 24.21.0 和 pnpm 11.9.0。执行 `pnpm install --frozen-lockfile`、`pnpm build`；原生依赖需适配当前 Node ABI。
2. 先启动并配置 herdr；`herdr session list --json` 查看可用会话。本服务不会替用户启动 herdr。
3. `pnpm start -- serve --session <name>`。可传 `--data-dir /绝对路径`、`--port 4317`、`--herdr /herdr/可执行文件`。数据目录与 Agent 工作/输出目录应分开。
4. 打开终端打印的入口；一次性 fragment 凭据会换成仅本机 Cookie。再次打开使用 `pnpm start -- open`，自定义数据目录须继续传 `--data-dir`。Cookie 在服务重启后失效。
5. 创建项目，填写已存在目录。接入现有 Agent 或在独立目录启动 Codex/Claude。先观察其目录、会话及就绪状态，填写确认依据，再启用自动调度。首次登录、目录信任和工具权限由人处理。
6. 创建任务，指定一个 Agent，可选同项目依赖、必要产物和额外输出根。队列会解释等待原因；多个 Agent 默认最多并行 2 个任务，可调整到 1—8。

用 Ctrl-C 停止服务。重启后旧授权失效，活动执行进入核对状态；不会自动重发 prompt 或自动重新启动 Agent。同一数据目录以及同一 herdr 会话均有进程锁。

## 结果与依赖

控制台派发时提供完整结果协议及冻结输入文件路径。Agent 必须先完成文件，再将临时 JSON 原子重命名成工作目录内 `.meteor-flow/runs/<attempt_id>/result.json`。示例字段：

```json
{
  "protocol": "meteor-flow.result/v1",
  "task_id": "由本次派发提供",
  "attempt_id": "由本次派发提供",
  "outcome": "succeeded",
  "summary": "真实完成摘要",
  "artifacts": [
    { "root_id": "workdir", "path": "hello.txt", "label": "输出文件" }
  ]
}
```

业务失败使用 `outcome: "failed"`；无需文件时 `artifacts: []`。结果必须为严格 JSON，不允许重复 key、额外字段或跨执行 ID。结果文件最多 1 MiB，摘要最多 32 KiB；最多 100 个产物，单文件 50 MiB、总计 200 MiB。仅采集已授权根中的常规单链接文件，拒绝符号链接、越界和特殊文件。

有效结果、不可变归档与同一执行的活动/停止证据共同决定结束。Agent 显示空闲不会直接变成成功；短暂空闲可能触发暂停，之后收到结果仍会收集，下一次调度需核对后恢复。下游使用上游成功执行的冻结摘要和独立文件副本，重试不会回滚原工作目录。

文本/Markdown/JSON 预览上限 1 MiB，PNG/JPEG/GIF/WebP 图片上限 20 MiB。HTML、SVG 等内容只下载，Markdown 不加载远程资源。历史记录使用归档，不提供删除被依赖的产物接口。

## 人工控制与异常

- 终端默认只读。接管会先将 Agent 改成手动并暂停调度；只有当前页面、控制 token 和 epoch 全部有效才能输入。5 秒心跳、15 秒过期；释放/断线不会自动恢复调度，不补发按键。
- 取消先持久化，再发送一次中断。中断不证明子进程停止；证据不足时保留占用。人工补录必须填写依据，可在不勾选“已停止”的情况下先保存声明并保留占用。申请解除占用时，服务端另外核验原执行身份与停止证据；必要归档仍不可省略。
- prompt 或启动响应丢失：保留未知状态，不自动重复。若原 Agent 可见，先核对再接入。若未创建或已消失，到 Agent 页选择“人工核对启动”，在原生 herdr 核实原窗格和进程，填写证据并明确确认停止或未创建。服务端只有在新鲜枚举成功、无匹配目标或重叠目录实例、原启动调用已结束时才接受。解除记录标明人工来源，不代表服务端自行证明停止，也不会创建或关闭窗格；之后可用新的操作显式启动。
- 存储不可用：暂停新副作用。恢复存储后重新核对 Agent；只读故障模式的“紧急中断”明确不保证审计已保存，也不会直接释放执行占用。
- 同一执行已接受的结果声明发生冲突时，持久保存冲突并暂停；后续空闲或重启不会自动解除。请核对归档后补录结论，不能用“重新收集”清除冲突；已发布终态不翻转。
- 归档任务可复制为新任务，不直接重试；编辑其他待派发任务时可移除已归档的前置依赖。任务详情默认跟随当前执行，主动选择历史执行后保持该选择。
- 磁盘低于派发余量时不启动新任务；普通采集失败可单独重试。归档保留，不提供自动清理历史功能。
- 若 Codex 宿主提示 `Fatal error: application network permission was revoked`，先区分宿主工具错误与子进程退出日志。本次曾在并行 Agent 中发生，重新唤起失败 Agent 后恢复；这不证明 npm、代理或系统防火墙有问题。若持续复现，检查宿主应用网络授权并重新打开该会话，再重试原命令，保留具体命令及错误日志；不要因此删除依赖、凭据或项目数据。

## 开发与验证

开发模式在仓库根执行：

```bash
pnpm dev -- --session <会话名> --data-dir /绝对路径/开发数据
```

先完成初始构建，再启动 TypeScript 监听、服务进程监听和 Vite。默认后端 `http://127.0.0.1:4317`，开发页面 `http://127.0.0.1:5173`。先打开后端打印的带 fragment 入口完成认证，再打开开发页面；必须保持 `127.0.0.1` 同一主机名。后端重启会使 Cookie 失效，需要重新打开入口。`--port` 和 `--dev-port` 可分别改端口；`--herdr` 指定可执行文件。Ctrl-C 关闭本次启动的进程组。开发数据建议使用独立目录，服务仍要求已存在的显式 herdr 会话。

开发代理仅接受精确的本机开发 Host/Origin，再转发认证后的 API/WS；它没有关闭后端的 Cookie/CSRF 校验。不要将 Vite 或后端开放到局域网。

常规验证：

```bash
pnpm build
pnpm typecheck
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/playwright" pnpm test
PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/playwright" pnpm exec playwright test tests/e2e --workers=1
python3 scripts/workflow/check.py doctor
python3 -m unittest discover -s scripts/workflow/tests -v
```

测试使用构建出的 SQLite worker、采集子进程和服务入口，因此修改服务代码后须先 build。普通测试不会向真实模型发送任务；herdr 边界模拟与真实集成分别记录。

安装浏览器可执行 `PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/playwright" pnpm exec playwright install chromium`。项目选定的 OCR、Playwright 与 Impeccable 能力及固定来源见工作流文档。

显式开关（先 build）：

- `METEOR_FLOW_REAL_HERDR=1 pnpm exec vitest run apps/server/src/adapters/herdr/real-herdr.test.ts`：独立真实 herdr 会话，不启动模型 Agent。
- `METEOR_FLOW_REAL_AGENTS=1 METEOR_FLOW_CODEX_STANDALONE=1 pnpm exec vitest run tests/integration/real-agent.test.ts`：双 Agent 使用独立 herdr 会话/工作目录和本机已配置模型服务，可能产生费用；遇到交互更新、正在更新、登录、信任或工具权限停止。Codex 保留自身 workspace-write/on-request，不叠外层沙箱，配置只作前后哈希核对；Claude 保留外层配置只读保护。执行前须取得对应保护方式的明确授权；省略第二个开关时 Codex 用例跳过。
- `METEOR_FLOW_PERFORMANCE=1 pnpm exec vitest run tests/integration/performance.test.ts`：1000 历史任务、真实本机 HTTP/WS、两条 1 MiB/s 终端流持续 30 秒，Agent 边界模拟，不调用模型。

生产 API 为 `/api/v1`，OpenAPI 在 `/api/v1/openapi.json`；保留 `/api` 同构兼容入口。SSE 首包要求校准 `/api/v1/state`，支持持久化 sequence/Last-Event-ID；终端流独立使用带 `meteor-flow.terminal/v1` 的 WebSocket。应用不会透传任意 herdr 方法。

2026-10-08 实体测试补充：Codex 默认托管启动在 CLI 支持时使用独立后台实例并关闭单次启动更新检查，不改用户模型配置或默认执行权限。真实测试另外要求显式 METEOR_FLOW_CODEX_STANDALONE=1，并通过适配器显式施加 workspace-write/on-request；不叠外层 sandbox-exec，因此只保留配置前后哈希监测。Claude 仍使用原外层配置只读保护。发现交互更新、正在更新、登录、信任、工具权限或执行器错误会封闭实际输入通道并停止测试，不自动确认。已核实的 Claude 2.1.195 单行 Homebrew 更新通知只是被动提示；测试仅对这条完整通知作精确排除，同屏审批或更新操作仍停止。
