# Skills 使用条件与开发前置要求

状态：用户已要求补充并实施，2026-10-06。适用：本仓库的 Codex、Claude Code，包括新会话、恢复会话及独立审查 agent。
本文件是 workflow 中技能使用条件的唯一详细来源；安装状态仍以 [workflow.md](workflow.md) 的清单和实际核验为准。

## 何时必须使用

| Skill / 流程 | 使用条件 | 使用时机与完成要求 |
| --- | --- | --- |
| brainstorming | 新想法进入澄清，或目标、用户、范围、约束发生实质变化 | 在想法确认前澄清目标与约束；已有有效确认不重复执行 |
| forge-idea | 目标和约束已澄清，准备确认想法；或想法价值/成立条件有新变化 | 接在 brainstorming 后进一步明确；不得自动进入技术设计或编码 |
| Spec Kit specify | 已确认想法需要形成需求方案，或产品行为发生实质变化 | 产出用户流程、功能规则、边界、异常和验收标准，不预定技术栈 |
| Spec Kit clarify | specify 后需要明确假设、歧义、边界和缺口 | 每轮需求定稿前执行澄清检查；无待澄清项则记录结论，不制造问题反复确认 |
| Spec Kit checklist | 需求方案首次提交人工确认，或修改已确认需求 | 在确认前检查需求完整性与可验收性；不替代代码测试 |
| meteor-flow-verification | 准备编写/修改可执行代码或测试；修改项目技能/工作流规则；请求审查、测试走查或验收 | 编码前检查必需 skills 与测试/审查能力；编码后按完整验证流程执行。仅做前置检查时不生成虚假的测试通过记录 |
| test-master | 编写/修改可执行代码或测试，分析测试策略、覆盖缺口、失败或 flaky；后端、CLI、状态与数据逻辑均适用 | 编码前准备测试策略与运行前提，验证阶段执行实际测试。纯文档变更不强制新增或重跑无关代码测试 |
| Playwright | 修改浏览器可见行为、用户操作、路由、终端交互、前后端联动，或需要浏览器 E2E 复验 | 此类编码开始前准备 skill 和可用浏览器工具；实现后执行真实交互并检查后台结果。相关后端修改若影响用户链路，也适用 |
| Impeccable audit / critique | 新增或修改界面、布局、组件状态、交互反馈、响应式、无障碍或视觉体验 | 此类编码开始前准备 skills；实现后分别做技术/可用性审查与体验评估。harden/polish 只在已有授权的修复范围内使用 |
| open-code-review-delegate | 代码、测试、技能指令或工作流约束发生行为变化，需要独立审查；明确请求代码 review | 编码前准备技能与固定 OCR CLI；审查阶段由独立上下文执行 preview/rule、查看上下文并报告。委托不自动等于独立审查 |

纯文案/格式变更只加载适用技能，不要求安装无关浏览器能力或重做已确认需求。
但“环境没有”“还未安装”“暂时不能跑”不能作为不适用理由。前端变更不能以“本轮先写代码”为由推迟准备 Playwright/Impeccable。
任务范围变化后重算必需清单；例如仅后端任务新增网页交互，应先补齐前端 skills 再开发该部分。

## 开始工作与编码前必须执行

1. 读取 AGENTS.md、workflow、对应任务的已确认材料，确定当前阶段及变更范围。逐项记录必需技能及其触发原因；跳过已有阶段需引用仍然有效的确认材料，不凭空补签确认。
2. 进入产品编码前，将**本次实现及后续验收所需技能**一起列为前置条件：可执行代码通常至少需要 meteor-flow-verification、test-master、OCR；涉及浏览器/界面时再加入 Playwright 和 Impeccable。思想澄清/需求阶段则准备表中对应技能，不提前编码。
3. 核对项目文件、完整引用、已锁定来源/适配版本、当前宿主加载路径和工具依赖。仓库有文件、个人曾安装、其他会话成功、文档写了已选定，都不等于本次执行 agent 已引入。
4. **缺少任何适用的必需 skill，先引入、验证再继续该阶段；不能先开发再补装。** 允许开展补装、来源核对和只读排障；不能把被阻塞的阶段标为完成。
5. Codex 与 Claude 共用项目来源，但每个实际执行会话需确认自己的加载情况。独立审查 agent 也要先读取公共规则及所需技能，不继承“作者已加载”的假设。调用已安装技能前必须读取其完整 SKILL.md，并按任务读取所需引用。

## 缺失时如何先引入

已确认选型的来源定位如下。未安装项的链接用于识别项目，不代表已锁定版本；实际接入时解析并记录完整提交 SHA，禁止运行时跟随 main/latest 更新。

| 已确认能力 | 唯一上游来源与入口 |
| --- | --- |
| brainstorming | [obra/superpowers：skills/brainstorming](https://github.com/obra/superpowers/tree/main/skills/brainstorming)；仅适配本项目目标/约束澄清，不自动转入其完整开发流程 |
| forge-idea | [bmad-code-org/BMAD-METHOD：skills/bmad-forge-idea](https://github.com/bmad-code-org/BMAD-METHOD/tree/main/skills/bmad-forge-idea)；实际技能名为 bmad-forge-idea，按所选版本核对必要引用 |
| specify / clarify / checklist | [github/spec-kit](https://github.com/github/spec-kit) 的这三个流程；按官方对应版本的命令/模板与依赖接入双端，不假定每个流程天然就是独立 SKILL.md |
| Playwright | [microsoft/playwright-cli：skills/playwright-cli](https://github.com/microsoft/playwright-cli/tree/main/skills/playwright-cli) 提供浏览器技能；可重复 E2E 使用 [microsoft/playwright](https://github.com/microsoft/playwright) 的 Playwright Test |
| Impeccable audit / critique | [pbakaus/impeccable](https://github.com/pbakaus/impeccable)；按固定版本接入 audit、critique 能力及必需公共引用。上游可能以一个 impeccable skill 的子命令提供，不按名字安装无关 audit/critique 技能 |
| test-master / OCR 委托 | 以项目 `scripts/workflow/sources.lock.json` 的 Jeffallan/claude-skills、alibaba/open-code-review 提交、文件清单和本地适配为准 |
| meteor-flow-verification | 本仓库 `.agents/skills/meteor-flow-verification/`，随仓库版本管理 |

待接入上游的文档目录、附带安装命令和自动衔接步骤必须适配本项目：方案仍写 `tasks/`，默认项目级安装，保留人工关卡，不因引用了额外 skill 就扩大选型或开发范围。

- **仓库已接入，当前会话未加载：** 先检查来源路径、宿主发现目录和同名遮蔽；Codex 从 `.agents/skills/` 加载，Claude 从 `.claude/skills/` 的项目链接加载。不要重新下载另一份个人版本代替项目适配。
- **Claude 项目链接缺失：** 在确认不存在用户有意移除/待处理改动后，为对应技能补回指向 `../../.agents/skills/<name>` 的相对链接；已存在但指向不同内容的路径先检查差异，不盲目覆盖。
- **已锁定技能文件或引用缺失：** 从已审阅 Git 版本恢复与锁文件一致的完整项目适配版本，或从锁定的上游提交恢复并重施已记录适配。保留许可证，校验哈希；不能只拷贝 SKILL.md 而漏掉它需要的引用/脚本。用户修改中的文件不得被安装器覆盖。
- **workflow 已选定，但项目尚未接入：** 先按已确认选型完成项目级接入：核对准确上游与所需子技能，固定提交/版本、完整依赖和许可证，按项目约束适配，登记 `sources.lock.json`，建立双端入口，再做实际加载验证并更新安装状态。不得拿名字相似的技能替换已选项目，也不直接执行上游整个套件的自动开发流程。
- **工具依赖缺失：** 补齐已选方案的本地依赖。OCR 使用 `python3 scripts/workflow/ocr.py install` 后执行 `--version`；Playwright 还需实际可启动的浏览器工具，不能只检查 prompt 文件。后端框架沿用已确认技术方案；未选定时先完成技术方案确认，不由安装步骤决定产品技术栈。
- **验证当前宿主可用：** 执行 `python3 scripts/workflow/check.py doctor`，再显式加载/调用本次必需的项目技能并做相应最小能力检查。2026-10-07 的 doctor 已核对五个项目技能及其完整性，仍不能证明工具实际执行成功、待接入技能已就绪或当前会话已加载。新增技能接入时同步扩展检查范围。
- 宿主无法热加载时，新建/重启会话后继续。宿主支持显式读取完整项目 SKILL.md 及引用执行时，可用该方式引入，但记录实际方式，不声称原生命令已注册；所需执行工具仍必须可用。
- 引入已确认选型、恢复缺失入口和本地可逆依赖属于本项目准备工作，无需重复确认。只有更换选型、新增超出范围的组件、需要凭据/权限或有无法判断的本地冲突时，才说明具体缺口并处理；网络/安装/校验失败则保持 blocked，不继续依赖该技能的开发。

引入依赖不等于获得产品编码授权。新依赖的适配与双端兼容性通过前，安装状态只能写“已引入待验证”，不能写“可用”。

## 记录与完成判定

在对应 `tasks/NNN-topic/` 的当前工作记录中保留 skill-readiness 记录；重复检查追加会话/日期，不覆盖旧结论。
最低内容：当前阶段与范围、宿主及版本/会话标识、各技能触发原因、来源路径与锁定版本、引入/修复动作、实际加载方式、能力检查结果、剩余阻塞。不适用项给出与变更范围对应的理由。
仅涉及已有规则的文字补充时，可在本次 review/验证记录中包含该节，不要求另建重复文档。
仅做编码前准备时，skill-readiness 即为本阶段记录；不要求 init/evidence/check 或 report.json，也不能把未执行产品测试当作技能准备失败。能力探针与候选代码验收应明确区分。

就绪状态区分为：缺失 → 已引入待验证 → 当前执行环境就绪；失败或冲突为 blocked。
就绪是当前阶段继续工作的必要条件，不代表代码已验证、需求已确认或人工验收已通过。
