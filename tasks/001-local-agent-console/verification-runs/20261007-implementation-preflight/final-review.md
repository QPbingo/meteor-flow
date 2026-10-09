# 最终增量与全量范围独立审查

日期：2026-10-07。Reviewer：`/root/technical_review`，与产品作者 `/root`、`/root/herdr`、`/root/web` 独立。状态：独立审查与逐文件聚合完成；D01—D03 已关闭，0 未关闭 critical/high/medium，保留 1 项明确 deferred 的历史文档 low。本 reviewer 只读审查，没有修复业务源码或测试。人工验收仍为 pending。

## 前置、规则与准确基线

本独立上下文已完整加载项目 verification、test-master（unit/integration/security/testing-anti-patterns/e2e 引用）、OCR、Playwright/Impeccable，以及 capture-constraints 的开发前检查。此次范围扩大后重新核对 prerequisites、verification 与当前环境，追加 Vite skill 及 core-config；其参考针对 Vite 8，本项目实际为 7.3.7，以锁文件和安装源码为准，未升级。R-002 环境核对适用，R-001 小黑盒搜索规则不适用。Node 为 24.21.0、darwin arm64，SQLite 3.53.4。项目路径中无 capture-constraints，使用已记录的个人准确来源 `/Users/heybox/.codex/skills/capture-constraints/SKILL.md`。

doctor、固定 OCR `--version`、独立 delegate preview/rule 均成功，分别见 `final-review-doctor.log`、`final-review-ocr-version.log`、`final-review-preview-initial.json`、`final-review-rules-initial.json`。后续 preview/rule 保留独立文件，没有覆盖前轮范围。OCR 六组规则已逐组读取，按需求、调用关系和实际运行边界审查；本地 `workspace:*` 是固定工作区关系，未机械当作浮动外部版本问题。

最终候选由 `final-review-baseline-final.json` 给出每个路径 SHA-256（符号链接按链接文字散列），`final-review-coverage.json` 按每个 `(path,status)` 说明审查来源、当前摘要和排除理由。聚合仅接纳历史独立报告中与当前 SHA 完全匹配的文件；变化的文件必须由本轮增量重新覆盖，未把旧通过直接套到新内容。新增验证日志、截图、原始数据和 reviewer 报告属于 task-local run artifacts，逐项说明为证据排除；后续仅增加此类证据不构成新产品候选。

## 发现与关闭依据

| ID | 严重程度 | 路径与问题 | 修订与复查结果 |
| --- | --- | --- | --- |
| D01 | medium | `scripts/dev.mjs`：初始 build leader close 后无条件从 children 删除，失败/中断时抵抗 TERM 的孙进程失去进程组追踪，后续 KILL 无法覆盖。 | 已关闭。保留尚存进程组，初始 build 成功但遗留后台组也拒绝启动服务并清理。作者回归另发现 macOS `kill(-pgid,0)` 的 EPERM 需视为仍存在，修后保持等待。独立执行 failed/interrupted ready gate 两例及正常开发重启/组回收，均通过。 |
| D02 | medium | HTTP POST session：新增枚举在既有 operation 的 digest/replay 之前，已提交但丢回复后，枚举暂时失效/消失会遮蔽原回执。 | 已关闭。`switchSession` 在串行入口先 replay，再仅对新 operation 执行枚举回调。真实 HTTP/DB 测试覆盖首次成功、枚举 throw/空列表的同 ID 重试、同 ID 改 body 冲突、新 ID 拒绝和事件/operation 数量不重复。 |
| D03 | low | 当前文档把 V12 误称真实 Ctrl-C 已另测、技术方案仍称性能未测；常规 pnpm test 未给项目 Chromium 位置，历史分工稿未标明已被后续实现更新。 | 已关闭。V12 明确中断为模拟边界、真实官方终端测试不向模型发 Ctrl-C；技术方案链接实际性能状态；测试命令指定 `PLAYWRIGHT_BROWSERS_PATH`；三个分工稿明确为历史。未改变需求或以文档代替执行证据。 |

此前 S01/S02、P01、C01—C06、A01—A09 与 UI A/B/F-01 的原发现及关闭依据均保留在各批报告。本次不重新声称这些问题由本轮发现，也不删除历史宿主 `Fatal error: application network permission was revoked` / 内容检查中断事实；中断当时不算通过。本轮通过正常入口完成本地操作，没有修改或绕过宿主网络权限。

## 增量核验

- DB Statement Map 只缓存 schema 固定的 20 条读写 SQL，输入值仍绑定参数，事务、迁移 checksum、FK/唯一占用约束和幂等结果未改变。缓存不按用户内容建 key；关闭连接结束其生命周期。Worker 的 `maxYoungGenerationSizeMb:16` 是新生代 GC 配置，不是总 RSS 或任务数据硬上限。异常仍使 storage generation 失效、拒绝迟到回复，只有旧 writer exit 才允许重开。
- 新 session 校验在接受新意图时读取当前枚举，并在 application 串行处理器内保留持久操作回执。已确认同内容 operation 不依赖后来的发现服务可用性；异内容仍冲突。
- 开发入口要求显式 session，Node 24、独立端口，先完整构建再启动三项 tsc watch、Node CLI watch 与 Vite；包含独立 worker/collector dist 的重启目录。固定 argv、不使用 shell，SIGTERM/SIGINT 有序清理进程组。Vite 只绑定 loopback，HTTP/WS 转发前验证原始 Host/Origin/Fetch-Site；已查安装的 Vite 7.3.7 代码，bypass 对 HTTP 和 WS 都在转发前运行。认证、CSRF 与独立控制权仍由后端核验。
- 根 package、各 package/build 清单、tsconfig、vitest、pnpm workspace 与锁文件均核对。`final-review-lock-check.json` 实际解析所有 5 个 importer、38 项直接依赖与 330 项注册包，manifest/锁的名称、specifier、解析版本或工作区链接一致，注册包有 SHA-512 integrity；这不等于依赖漏洞扫描。原生构建许可只开放已选的 better-sqlite3、Koffi、esbuild，Vite release-age 例外只限准确版本。
- real-herdr 新测试使用专属 XDG/session/cwd，真实官方 observe/control/input/resize/控制冲突均在隔离 shell 中进行，没有模型调用。real-agent 测试仍仅固定授权 payload，专属 session/cwd、配置只读及前后摘要核对；登录/信任/工具许可不自动确认。已读取 Codex 和 Claude 最终证据，均一条 succeeded attempt、归档 hash 一致、配置未变；这是作者真实专项证据，本 reviewer 没有重发模型任务。
- performance 的 writes-only/terminals-only/90 秒诊断显式分离，不替代原 combined 30 秒验收。跨进程时钟用 timeOrigin+now 对齐，保留原 10—30 秒 slope 与首尾中位增长阈值；源码、fixture 和诊断 JSON 均已读。young16 原 30 秒证据当前源码摘要一致，有限窗口通过不能证明长期无泄漏。本 reviewer 未同时追加性能负载，最终独立运行由根流程单独调度。
- 两份 E2E 的输出目录改为 `METEOR_FLOW_E2E_EVIDENCE` / `test-results/evidence`，避免覆盖历史证据，未改变业务断言。web-server 的 UI 延迟增量用 30 次交替暂停状态，禁 1 秒轮询，计时从持久化命令前至匹配按钮可见并越过双 RAF，核对 SSE sequence；这是无负载情况下“落库到可见”的保守上界，不冒称双终端负载下的 UI 性能。该增量已静态审查，最终实际 E2E 由根执行，未算入本 reviewer 的 38 项。
- 当前中文 README/AGENTS、方案/计划/兼容、progress/usage/verification-status 及工作流 prerequisites 已对照实现和实际报告核对。V01—V29 表明确模拟/真实/未测边界，没有替模型、物理休眠、0.9.0 实体版本或人工验收补签。早期分工稿保留为历史，不另行新增产品行为。

## 独立执行

实际命令（Node 24.21.0；未运行真实模型或性能）：

```sh
METEOR_FLOW_REAL_HERDR=1 PLAYWRIGHT_BROWSERS_PATH="$PWD/.tools/playwright" PATH="/tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin:$PATH" /tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin/node node_modules/vitest/vitest.mjs run apps/server/src/storage/database.test.ts apps/server/src/storage/store.test.ts apps/server/src/application/console.test.ts apps/server/src/http/server.test.ts apps/server/src/adapters/herdr/real-herdr.test.ts tests/integration/dev.test.ts
```

退出 **0，6 文件、38/38 通过，19.51 秒**，原始输出 `final-review-tests.log`。分项：DB 5、Store 5、application 11、HTTP 10、真实无模型 herdr 2、dev 5。真实临时 SQLite/worker、只读目录、真实 loopback HTTP/WS、Chromium、受控子进程与专用 herdr shell 均在独立临时资源上执行并清理；没有访问用户现有 session。

执行前保存 `final-review-baseline-before-tests.json`，结束后业务源码/本次测试均未改变。唯一后续变动是另外范围的 `web-server.spec.ts` 30 样本测试，已按上节单独审查，未冒称在这 38 项中执行。构建由作者已完成，独立运行使用其生成的 dist，相关源/dist 摘要在 `final-review-verification.json` 留证。新 DB 缓存/young16 的正确性由本次真实 DB/Store/application/HTTP 回归补证，旧 112 项历史日志没有改写基线。

## 六类场景及完整性边界

| 类别 | 本轮与聚合核验 | 需求/用例 |
| --- | --- | --- |
| 状态迁移 | readonly cwd 准备失败零 prompt、自动/手动/待确认与活动占用；未知 start、采集有效结果与结束事实分离，UI 用不同标签展示。 | R03—R07；V01/V02/V05/V06/V08—V15 |
| 幂等 | 新 session 校验不破坏已存回执；DB 并发重复、UI 丢回复刷新、一个 binding/task 活跃 attempt；两个实例 data/session 锁。 | R03/R04/R06；V03/V04/V06/V26 |
| 时序 | DB generation/exit barrier、取消与终态接受序号、采集 verify/rename 后失效、终端 connection/epoch、dev build/退出先后。 | R06/R08/R09/R11；V11/V13/V18/V19 |
| 恢复 | 不重发未知外部副作用；存储 ACK 丢失、满页错误、采集孤儿与不可变归档恢复；dev 失败/中断不遗留运行组。 | R03/R11—R13；V04/V06/V24/V25 |
| 关联 | 摘要严格绑定 source/attempt/artifact 与 frozen hash；pane 位置不作身份，唯一同类型 PID/start 及辅助进程父链；报告聚合按准确源码 SHA。 | R04/R08/R10/R11；V07/V09/V13/V16/V17/V28 |
| 隔离 | nofollow/openat/bigint、FIFO/链接/路径竞争、CLOEXEC/flock；HTTP/WS 与 Vite 原始来源校验、有限下载与终端容量；所有本次执行资源独立。 | R09—R11/R14；V18/V20—V23/V26/V27/V29 |

六类均适用；详尽初始用例/修复证据分别保留在 skill/posix/core/application/UI 报告，聚合不是重复签署每条场景都在每个真实模型上执行。已知边界仍包括 herdr 缺少 terminal 原子 compare-and-send、0.9.0 只有契约、仅 macOS arm64 实测、30 秒性能窗口、部分故障为受控注入、物理休眠及完整屏幕阅读器未实测。

本报告只给独立代码审查结论；最终运行报告还需准确填写根流程实际命令与结果，人工验收由用户决定。源码/约束在最终冻结后再变动应建立新基线和增量复验，不能把此结论自动套用。

## 最终范围与收尾结论

最终 OCR 截止快照为 `final-review-preview-complete.json` / `final-review-rules-complete.json`：**525 条，168 reviewable 全部 reviewed、0 skipped，357 exclusions 全交代**。排除项中 Windows `.cmd` 与 `pnpm-lock.yaml` 两项手工审查，其余 355 项为 task-local 报告、原始日志/数据或图像。没有删除/超大产品文件被静默跳过。reviewable 文件覆盖率 **100%** 仅表示独立审查范围，不是测试覆盖率。

精确 SHA 聚合来源：技能 78 项、POSIX 3 项、core 22 项、application 20 项、UI final 8 项、UI F-01 3 项、本次增量 33 项、历史方案报告独立补查 1 项。变化的 POSIX/adapter 已由 application 后续审查指纹接管；新 DB/开发/文档/测试由本轮接管。两个手工排除项另列，不混入 168 计数。

`technical-review.md` 由 `/root/ui_technical_review` 全文独立补查，证据 `technical-document-independent-review.md`，SHA 与当前文件完全一致；我没有自审自己的方案报告来补齐清单。补查保留 **L01 low/deferred**：页首“待人工确认”为历史当时措辞，后续用户已确认及授权以 AGENTS/README/technical-design 为准。根作者明确决定保留历史原文及冻结基线，不因此重复请求授权；该项不影响产品行为或独立审查通过。

收尾核对 `final-review-scope-check.json` 确认所有非证据候选 SHA 未变、全部 `(path,status)` 和原始排除原因均已交代、当前 OCR 去除 run artifacts 后范围一致，且 workspace content fingerprint 与已初始化的 `20261007-final/report.json` 基线一致。截止后新增的最终执行日志、截图和本补充独立报告均属 run artifacts，不假装为新的已审产品代码。

**独立审查关卡完成。** 最终完整执行结果仍由 `20261007-final` 的真实命令与证据决定；本报告未预先宣布尚在运行的测试通过，也未签署人工验收。
