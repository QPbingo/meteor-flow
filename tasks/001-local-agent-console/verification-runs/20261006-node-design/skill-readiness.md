# Node 方案修订与准备记录

日期：2026-10-06。作者上下文：`/root`。适用：需求 0.2、技术方案 0.2；本轮为技术方案修订、依赖能力探针和独立 review，未进入产品编码或验收。

## 1. 授权与范围

- 用户要求实现 task 001，随后明确“尽量使用 node 系进行开发”。已按此方向将产品服务、前端、CLI 与测试统一为 Node.js/TypeScript；保留已确认行为与现有实现授权。
- 按用户最新 AGENTS.md 第 3 项，具体技术选型、组件和实现逻辑仍须人工确认；本轮提交修订方案，不把 Node 偏好当成全部方案已获确认。
- 原 Python 方案准备与 review 作为历史保留在 `20261006-implementation-preparation/`。本轮结论不可回填到旧证据，临时探针不是产品源码。
- 本轮没有新增产品目标、改需求行为或编写界面；无需重做已确认需求的 brainstorming/forge/Spec Kit 流程，也不以缺少产品测试作为方案阶段失败。

## 2. 当前会话技能加载

显式读取了用户最新 AGENTS.md 指令、仓库 AGENTS.md、workflow、skill-prerequisites、meteor-flow-verification 及下表技能全文和所需引用；不将文件存在视为已经加载。

| 能力 | 来源、触发与实际动作 | 当前边界 |
| --- | --- | --- |
| capture-constraints | 用户新约定强制用于代码/脚本开发前；指定的仓库 `skills/capture-constraints/` 不存在，按技能定位规则找到 `/Users/heybox/.codex/skills/capture-constraints/SKILL.md`，完整读取 index.md、rules.md，完成开发前检查 | 已加载当前可用原始来源；不是项目 `.agents` 同名适配。未新增或修改规则库 |
| meteor-flow-verification | 项目 `.agents/skills/meteor-flow-verification/SKILL.md`；方案 review 与编码准备。显式读取完整技能和前置要求，执行 doctor | 本阶段就绪；doctor 只覆盖当前已接入的三个技能 |
| test-master | 项目 `.agents/skills/test-master/SKILL.md`；修订测试策略、执行能力探针。锁定上游 `1be15d8064f88fc25216442406d40add8fd23b53`；本轮读取 unit-testing/integration-testing，前一阶段已读 e2e/security 引用 | 当前方案与探针范围就绪；Vitest 产品测试环境未创建 |
| OCR delegate | 项目 `.agents/skills/open-code-review-delegate/SKILL.md`；独立 review。CLI 固定 v1.12.12、提交 `182898cf522da3d04157b422752d028417974e19`，已执行 version | 工具就绪；独立 reviewer 须自行加载、运行 preview/rule 并报告，不能继承作者自审结论 |
| Playwright、Impeccable | 已选定的项目工作流，本轮未修改页面或执行 UI 评估 | 当前方案阶段不适用；项目级接入仍待完成，产品界面及相关链路编码前必须先引入并验证 |

capture-constraints 的 R-002 适用：目标是本机 macOS arm64 控制台，无已部署线上产品及远程中间件；不查询无关业务生产系统。先核对本机与隔离目标运行时，再探测实际 SQLite 版本，最后编写能力探针。R-001 仅适用于小黑盒搜索模块，本次不适用。未核实 Linux/Windows，不承诺兼容。

## 3. 实际环境与临时依赖

| 项目 | 2026-10-06 实测与来源 |
| --- | --- |
| 本机 | `uname -sr` → Darwin 25.6.0；Node 探测 → darwin/arm64 |
| 系统工具 | Node v25.8.1、pnpm 11.9.0；产品目标不据此宣称已验证 |
| 隔离运行时 | `/tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin/node` → v24.21.0，ABI 137 |
| npm 原生包 | 实际加载 Koffi 3.3.2、better-sqlite3 13.0.3 |
| SQLite | 先执行 `SELECT sqlite_version()` → 3.53.4，再进行 WAL/事务探针；该版本来自隔离 npm 依赖，不是线上数据库版本 |
| herdr | 延用本日已采集的 CLI 0.9.3/protocol 22 静态证据；未访问用户运行中 session，真实服务端仍待独立集成核对 |

临时安装命令（均退出 0，仅作用于 `/tmp`）：

```text
npm install --prefix /tmp/meteor-flow-node-design-probe-20261006 --save-exact --no-audit --no-fund --cache /tmp/meteor-flow-node-design-npm-cache node@24.21.0
env PATH=/tmp/meteor-flow-node-design-probe-20261006/node_modules/node/bin:$PATH npm install --prefix /tmp/meteor-flow-node-design-probe-20261006 --save-exact --no-audit --no-fund --cache /tmp/meteor-flow-node-design-npm-cache koffi@3.3.2 better-sqlite3@13.0.3
```

未创建产品 package.json 或锁文件，未更换全局 Node/npm/pnpm。这里选取的补丁版本只用于能力核实；方案确认后需固定产品锁文件并重新核对完整依赖组合。

## 4. 实际检查与边界

| 检查 | 命令/观察 | 结果与证据 |
| --- | --- | --- |
| 项目技能完整性 | `python3 scripts/workflow/check.py doctor` | 退出 0，[doctor.log](doctor.log)；不证明尚未接入的浏览器技能就绪 |
| OCR CLI | `python3 scripts/workflow/ocr.py --version` | 退出 0，[ocr-version.log](ocr-version.log) |
| Node 能力探针 | 隔离 Node 24 运行 `/tmp/meteor-flow-node-design-probe-20261006/probe.cjs` | 退出 0，[原始结果](node-capability-probe.json) |
| 文件原语 | 真实 openat 普通文件读取、父/叶符号链接拒绝、FIFO 作为目录拒绝、无 writer FIFO 非阻塞打开后拒绝读取；fstat bigint 元数据 | 仅验证原语与 ABI；未做目录替换竞争、完整路径适配或结果收集集成 |
| 进程锁 | 主进程持锁时独立进程获取失败，关闭描述符后获取成功；fcntl 验证 close-on-exec 标志 | 未测主进程崩溃、存活子进程的继承与恢复用例；这些已写入 V26 |
| DB worker | 真实 worker_threads 中加载 SQLite，WAL/FK/FULL，唯一冲突事务回滚 | 未测 commit 后确认丢失、磁盘故障、备份恢复；这些保留在实现验收计划 |

探针仅使用专用临时文件/FIFO/SQLite，最后关闭描述符并删除该次资源。未接入 herdr、未发送 agent 命令、未执行产品测试。探针源码保留在 `/tmp`，SHA-256：`9e0f2fe43c902ba60f37c4eddebc0dcdd40248b06b0efbffcf46c821de78a4a3`；临时 package-lock.json SHA-256：`15bbae0dce9e4f562a43ef3c2b783a730787669c9ed907b89a5dfeb23427bf0a`。临时文件可被系统清理，不把它们当作持久产品验证资产。

## 5. 剩余事项

独立方案审查结果见 [technical-review.md](../../technical-review.md)。具体技术方案仍待人工确认；产品依赖、Playwright/Impeccable 项目接入、产品实现、V01—V29 测试与最终人工验收尚未完成。本次不创建虚假的产品 report.json，不以探针通过宣布验收就绪。
