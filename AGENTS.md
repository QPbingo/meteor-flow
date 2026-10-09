# 项目协作约定

## 文档位置

- 后续所有需求、方案、方案 review、技术选型、实现计划和相关决策记录，统一写入仓库根目录的 `tasks/` 下。
- 每项工作使用独立目录，命名为 `tasks/NNN-<topic>/`；同一项工作的迭代继续放在原目录中。
- 根目录 `README.md` 维护文档入口，不在其他目录另建相同用途的方案文档。
- 文档使用中文，标明确认状态、日期、适用范围，以及需要后续确认的内容。

## 确认与执行流程

1. 先审查需求，细化异常、边界、时序、用户操作、数据隔离、扩展和迭代规则。
2. 需求经人工确认后，更新对应目录中的需求和 review 文档。
3. 基于已确认需求，单独提出技术选型、组件选择及实现逻辑，等待人工确认。
4. 技术方案确认不自动等于授权实现；人工明确决定开始实现后，才编写产品代码。
- 人工已明确确认的规则不重复请求确认；新增范围或改变已确认行为时，明确变更及影响。
- 不把候选技术、尚未执行的测试或尚未实现的能力写成已确认、已验证或已交付。
- 优先遵循用户在当前会话中的明确指示。

## 当前基线

- [本地 Agent 控制台需求](tasks/001-local-agent-console/requirements.md)：2026-10-06 已由用户确认。
- [需求方案 review](tasks/001-local-agent-console/review.md)：修订规则已纳入需求；实现与运行时验证分层记录于 [验证状态](tasks/001-local-agent-console/verification-status.md)，人工验收仍 pending。
- 用户于 2026-10-06 确认 [Node 技术方案 0.2](tasks/001-local-agent-console/technical-design.md)，并明确“请开始实现”；必需技能就绪后推进产品编码，无需重复请求技术确认或开始授权。实际进度见 [实施记录](tasks/001-local-agent-console/implementation-progress.md)。
- 开发工作流接入已于 2026-10-06 获准实施；这不等于授权实现本地 Agent 控制台。

## Skills 使用与开发前置条件

- 每个执行 agent（含新会话、恢复会话、独立 reviewer）先读 [Skills 使用条件与前置要求](tasks/002-development-workflow/skill-prerequisites.md)，按当前阶段及范围确定必需 skills。
- 编码前同时准备本次实现和后续验收所需能力：可执行代码至少准备 meteor-flow-verification、test-master、OCR 委托；涉及浏览器/界面时再准备 Playwright、Impeccable。按触发条件使用 brainstorming → forge-idea、Spec Kit specify → clarify → checklist。
- **当前 agent 未引入任何适用的必需 skill 时，先完成项目级引入/加载、依赖准备及实际可用性验证，再继续该阶段或开发；禁止先开发后补装。** 已确认选型的准备工作无需重复询问选型；无法补齐则记录具体阻塞。
- 区分“已选定、已引入待验证、当前执行环境就绪”；仓库有文件或其他会话用过不等于当前 agent 已加载。个人同名技能不能替代项目适配。任务范围改变后重新核对必需清单。
- 来源、触发原因、实际加载/能力检查和阻塞写入对应任务记录；详情与缺失修复顺序见上面的前置要求。安装技能不自动授予产品编码权限。

## 编码准备与完成后的验证关卡

- 工作流与安装状态见 [开发工作流](tasks/002-development-workflow/workflow.md)。
- 编码准备、修改代码/技能/工作流规则、请求 review、测试或验收时，使用本仓库 `.agents/skills/meteor-flow-verification/SKILL.md`；Codex 可显式调用 `$meteor-flow-verification`，Claude Code 可调用 `/meteor-flow-verification`。
- 后端由 test-master 组织实际测试；前端使用已选定的 Playwright 与 Impeccable。按前置要求在相关开发前补齐必需技能和工具，失败时保持阻塞，不虚报可用。
- OCR 仅使用委托模式。审查者须与编写者处于独立上下文；可创建独立审查 agent，不支持时用新会话完成，不以自审代替。审查者不直接修复待审代码。
- 每次行为变更必须分析状态迁移、幂等、时序、恢复、关联、隔离六类场景，关联需求、具体用例和证据；不适用必须给出理由。
- 先分析场景，执行测试与独立审查，修订后复验，最后交人工验收。缺失执行证据、关键测试未执行、未完成审查或存在未关闭的 critical/high 问题，不得宣布验收就绪。
- 代码或约束变化后重新核对证据基线；模拟通过不能冒充真实 herdr 集成通过；本地检查只检查记录与证据完整性，不证明测试真实充分，也不强制拦截 Git/CI。
- 执行记录归入对应任务的 `verification-runs/<run-id>/`，此目录只存报告和证据，禁止放业务代码或需求正文。人工验收不得由 agent 自行签署。

## 后续文档维护

- 修改需求时，保持需求、review、验收标准及技术方案一致，并记录确认状态。
- 区分 herdr 的版本化接口事实、Meteor Flow 自身规则与已知能力限制。
- 已确认文档中的“应”“必须”是待实现的要求，不代表仓库已有对应实现。
