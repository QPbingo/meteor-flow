# 编码前 skill-readiness

日期：2026-10-06（Asia/Shanghai）。状态：**当前 Codex 执行环境的适用技能与工具已就绪**；仅为编码前准备结论，未确认需求、未授权开发、未执行测试验收或独立审查。

适用范围：本隔离副本 `tasks/003-sample` 的纯 Python CLI 样例，需求 R1–R3；无网页、数据库或浏览器 E2E。用户本轮明确仅要求技能准备，允许恢复环境裁剪导致缺失的技能入口，禁止修改候选代码/测试、产品开发/验收和创建子 agent。本轮指示限定了 requirements.md 中原有“评估是否满足需求”的执行范围。

## 会话与依据

- 宿主：当前 Codex / GPT-6 会话，标识 `01a11079-2518-7dd2-b511-b0094a40abeb`。本机 CLI 实测 `codex-cli 0.160.1`；不据此推断宿主应用构建版本。
- 环境：macOS 26.6.2 arm64，Python 3.9.6，Git 2.50.1；满足 workflow 的 Python 3.9+、Git 2.41+ 前提。
- 仓库起始 HEAD：`884854cb56bdd3aa76908cc88f0235c1a0ee753d`。
- 已读取：根目录 AGENTS.md、[workflow](../002-development-workflow/workflow.md)、[技能前置要求](../002-development-workflow/skill-prerequisites.md)、[六类场景](../002-development-workflow/mandatory-scenarios.md)、[本任务需求](requirements.md)、项目 sources.lock.json、OCR 入口及规则。
- 本次记录：`20261006T171031-cst-skill-readiness`。原始输出和退出码位于 [运行证据目录](verification-runs/20261006T171031-cst-skill-readiness/)。这是准备记录，不是验收 report.json；未调用验收 init/check 或签署人工验收。

## 必需技能、来源与加载

| 技能 | 触发原因及固定来源 | 本会话实际加载与能力 | 结论 |
| --- | --- | --- | --- |
| meteor-flow-verification | 编码前准备；项目自有 `.agents/skills/meteor-flow-verification/SKILL.md`，版本以本次 Git HEAD 和文件 SHA-256 固定 | 已完整读取项目入口、公共规则及任务材料，按仅准备分支执行；doctor 复验成功 | 当前执行环境就绪 |
| test-master | 后续可执行 CLI 代码、幂等/状态/实例隔离测试；`.agents/skills/test-master/SKILL.md`，上游 Jeffallan/claude-skills `1be15d8064f88fc25216442406d40add8fd23b53`，元数据 1.1.1，加锁定的 Meteor Flow 适配 | 已完整读取项目 SKILL.md 及 unit-testing、testing-anti-patterns、integration-testing、test-reports 四个 references；全部 10 个 references 和 MIT 许可证完整且哈希匹配。unittest 帮助入口和标准库导入成功 | 当前执行环境就绪 |
| open-code-review-delegate | 后续代码与测试的独立审查准备；`.agents/skills/open-code-review-delegate/SKILL.md`，上游 Alibaba OCR `182898cf522da3d04157b422752d028417974e19`，元数据 1.0.0，加锁定的项目适配；CLI 固定 v1.12.12 | 已完整读取项目技能，核对 Apache-2.0 许可证与锁定哈希；项目包装入口 install、--version、delegate preview/rule JSON 实测成功 | 技能和确定性工具就绪；独立审查未执行 |

本会话技能目录已列出这三个项目路径；实际加载方式是显式读取完整项目技能和相关引用，并按指令执行准备检查。不以目录存在替代加载，不声称另行注册了原生命令。未使用个人同名技能替代项目版本，也未安装 related-skills 或上游整套技能。

14 个上游锁定文件的实测 SHA-256、项目自有技能哈希、三个 Claude 链接和 OCR 资产哈希见 [完整性与能力检查](verification-runs/20261006T171031-cst-skill-readiness/integrity-and-capabilities.json)。test-master / OCR 的适配后入口哈希分别为 `929b60806857b0ef9e94e13b4edb1466ec61862da8b6daef1b87f89b216573a9`、`1037e84461991121c8f2ad733d091c82cf5b781558433f7309730922e121cae8`；meteor-flow-verification 为 `28f90752a60c56eab75a5176e827042afaf8c774c26a524de4211bae873cf957`。

## 补齐动作与能力证据

初次 doctor 退出码 2，报告 `INVALID: Claude 链接错误: test-master`。初始 Git 状态为该链接被删除，另有两个用户提供的未跟踪候选文件。根据用户对环境裁剪的说明，核对 `HEAD:.claude/skills/test-master` 后，仅恢复相同相对链接 `../../.agents/skills/test-master`；没有覆盖既有路径或修改技能正文、锁文件、工作流代码/规则。

链接状态经历“缺失 → 已恢复待验证 → 当前入口检查通过”。Codex 的三个项目源入口原本完整；Claude 三个链接现均指向同一项目源。本次未启动 Claude 新会话，其运行时实际加载未验证；不将链接检查记为 Claude 宿主验收通过。

| 实际命令/动作 | 退出码与观察 | 证据 |
| --- | --- | --- |
| `python3 scripts/workflow/check.py doctor`，修复前 | 2；Claude test-master 链接缺失 | [首次失败](verification-runs/20261006T171031-cst-skill-readiness/doctor-before.json) |
| 核对 Git 中链接目标并恢复相对软链接 | 成功；恢复为 Git 基线目标，无内容适配变化 | [修复记录](verification-runs/20261006T171031-cst-skill-readiness/entry-repair.json) |
| `python3 scripts/workflow/check.py doctor`，修复后 | 0；来源哈希、引用、双端链接及规则完整 | [复验输出](verification-runs/20261006T171031-cst-skill-readiness/doctor-after.json) |
| `python3 -I -B -m unittest --help` | 0；标准库测试运行入口可用，没有收集或执行候选测试 | [帮助入口](verification-runs/20261006T171031-cst-skill-readiness/unittest-help.json) |
| 隔离 Python 进程导入 unittest、unittest.mock、tempfile、subprocess | 0；标准库能力可用，没有导入候选模块 | [导入检查](verification-runs/20261006T171031-cst-skill-readiness/python-stdlib.json) |
| `python3 scripts/workflow/ocr.py install` | 0；复用已有且哈希匹配的 v1.12.12，无需下载、全局安装或升级 | [安装检查](verification-runs/20261006T171031-cst-skill-readiness/ocr-install.json) |
| `python3 scripts/workflow/ocr.py --version` | 0；v1.12.12 (182898c)，darwin/arm64 | [版本输出](verification-runs/20261006T171031-cst-skill-readiness/ocr-version.json) |
| `python3 scripts/workflow/ocr.py delegate preview --format json` | 0；schema_version 1、本仓库 workspace；候选代码及测试均纳入 | [原始 preview](verification-runs/20261006T171031-cst-skill-readiness/ocr-preview.json) |
| `python3 scripts/workflow/ocr.py delegate rule --format json queue_sample.py test_queue_sample.py` | 0；两文件均解析出合并 Python 与项目规则的规则组 | [原始 rule](verification-runs/20261006T171031-cst-skill-readiness/ocr-rule.json) |

OCR macOS arm64 二进制 SHA-256 为 `4448bb750e2d818b9b6d68c997df64191ad22bbdfc1617afb00d0f4c38f95296`，与锁文件一致。上述 preview/rule 仅为确定性工具能力检查，没有执行宿主代码审查、LLM 托管 review/scan，也未创建 OCR 模型配置。preview 是检查时刻的快照；后续正式审查须重新采集完整范围，不能把本记录当作 review 结论。

`codex --version` 退出码 0，同时提示不能创建 PATH aliases；实际通过绝对项目路径和 Python 入口完成检查，该提示未阻塞本次准备，原始 stderr 保留于 [宿主 CLI 检查](verification-runs/20261006T171031-cst-skill-readiness/codex-version.json)。

## 未触发项与后续测试准备

| 技能/依赖 | 本轮不适用的范围依据 |
| --- | --- |
| brainstorming、forge-idea | 本轮不提出新想法或改变目标、约束，仅核对现有 R1–R3 的技能准备；不补签任何既往想法确认 |
| Spec Kit specify、clarify、checklist | 本轮不形成、修改或提交需求方案；没有新的需求定稿动作，不据此宣称原需求已人工确认 |
| Playwright | 没有浏览器可见行为、网页路由或浏览器终端界面；这里的 CLI 是 Python 命令入口，需求明确不要求浏览器 E2E |
| Impeccable audit / critique | 无界面、布局、组件、视觉或交互反馈变更 |
| pytest、数据库、浏览器、herdr 等额外工具 | 样例指定标准库 unittest，且无网页/数据库或真实 herdr 链路；技能示例不构成另选技术栈的依据 |

后续沿用需求指定的 `python3 -m unittest test_queue_sample -v`（仓库根目录），**本轮未执行**。测试策略为使用真实样例对象、独立实例及可控调用顺序，核对状态和实际副作用次数，不用 mock 调用次数替代业务结论，不靠 sleep 判断先后。无外部数据库和端口；若后续测试产生文件，使用本次测试专用临时目录。

以下仅为编码前六类场景适用性与用例准备，全部状态为 **not-run**，不是覆盖或通过结论；未读取候选实现来预设审查结果。

| 场景 | 需求与适用范围 | 前置条件、操作顺序及预期结论 |
| --- | --- | --- |
| 状态迁移 | R2、R3，适用 | 已有任务及旧 attempt，经重试产生当前 attempt；旧结果到达不改变当前状态，当前结果才有资格完成当前任务 |
| 幂等 | R1，适用 | 独立新队列；重复提交同一 request_id；实际执行副作用总计一次，不能只检查返回值 |
| 时序 | R2，适用 | 先构造旧/当前 attempt；分别按旧结果→当前结果、当前结果→旧结果调用；旧结果均不得覆盖当前状态 |
| 恢复 | R3，适用范围限于重试 | 已有 attempt 的任务触发重试；创建新的 attempt。重试允许条件沿用需求，不能据此新增崩溃持久化或跨进程重启恢复保证 |
| 关联 | R2、R3，适用 | 任务经历重试；分别携带旧/当前 attempt 的结果；只有当前关联可完成当前任务，不发生旧结果覆盖 |
| 隔离 | R3，适用 | 建立两个独立队列实例；在一方提交、重试和接收结果，观察另一方记录不被修改 |

## 剩余边界与结论

本轮适用技能与依赖没有剩余阻塞，准备工作结束。候选代码、测试、需求与原有工作流文件的前后哈希/模式对照见 [范围核对](verification-runs/20261006T171031-cst-skill-readiness/scope-preservation.json)；证据文件哈希见 [证据清单](verification-runs/20261006T171031-cst-skill-readiness/evidence-manifest.json)。

后续独立 reviewer 必须在独立上下文重新读取公共规则及项目 OCR 技能；本轮按用户约束没有创建子 agent，也没有以作者自审代替审查。Claude 实际会话加载、候选测试结果、独立代码审查、需求满足情况及人工验收均未验证。

任务目录当前仅提供 requirements.md，未提供独立的已确认实施方案或编码授权记录。本结论只回答技能准备是否就绪，不推进产品编码、不新增确认请求、不把缺少这些材料伪记为已确认。后续阶段仍须具备相应授权和验证证据；范围变更时重新核对必需技能。
