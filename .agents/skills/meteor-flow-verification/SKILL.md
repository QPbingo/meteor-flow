---
name: meteor-flow-verification
description: Verify Meteor Flow changes against confirmed requirements using test-master, independent OCR delegation review, and six mandatory scenario classes. Use after coding or when asked to review, test, walk through, or prepare acceptance of this repository's changes.
---

# Meteor Flow 验证入口

本技能只约束本项目代码完成后的验证。先读仓库根目录 `AGENTS.md` 与
`tasks/002-development-workflow/workflow.md`，确认本次需求、已授权范围和实际可用的工具。
路径以 Git 根目录为准，不依赖调用者当前子目录。不将产品规划授权当成产品编码授权。

## 执行

1. 运行 `python3 scripts/workflow/check.py doctor`。确认本技能、test-master、OCR 都来自
   本仓库 `.agents/skills/`；个人同名技能不能替代项目规则。
2. 读取本次任务的需求、验收与实现方案，以及
   `tasks/002-development-workflow/mandatory-scenarios.md`。逐项决定六类场景的适用性，
   给出需求编号、前置状态、操作顺序、预期业务结论和副作用。不适用须解释。
3. 用 `python3 scripts/workflow/check.py init tasks/NNN-topic --run <唯一标识>` 创建新记录。
   不覆盖历史运行。先补测试或修复时，完成修改后再创建最终复验记录，不能给旧证据换基线。
4. 加载本仓库 `.agents/skills/test-master/SKILL.md` 和相关 references，实际运行原生项目测试。
   后端集成测试使用独立测试数据/数据库/端口；单元 mock 不替代集成验证。
   前端相关变更调用已选定的 Playwright、Impeccable；发现未安装或无法运行就记录阻塞。
   真实 E2E 必须检查 UI 操作及后台持久化/结果关联，只有页面截图不够。
5. 将需求、准确变更基线与原始材料交给独立上下文审查者。审查者加载本仓库
   `.agents/skills/open-code-review-delegate/SKILL.md`，使用
   `python3 scripts/workflow/ocr.py delegate preview --format json` 和 `delegate rule --format json ...`。
   保留 preview JSON；逐一交代每个 `(path,status)` 和排除项，补查删除、调用方和数据关系。
   覆盖正确性、测试质量、模块边界、依赖方向、错误处理、兼容/迁移，以及已确认扩展需求。
   独立审查不能使用编写者给出的预设结论替代查证。审查者仅报告，编写者修复后交其复查。
6. 将命令、退出码、实际观察、审查与证据写入运行记录。使用
   `python3 scripts/workflow/check.py evidence <report.json> <证据文件>` 登记哈希，文件必须在该运行目录。
   失败、阻塞、未执行、不适用独立记录；所有发现保留处理依据，不静默丢弃疑似误报。
7. 运行 `python3 scripts/workflow/check.py check <report.json>`。结构检查通过只表示记录具备
   人工验收条件；报告残余风险、实际覆盖边界和运行环境。人工确认才是最终验收。

## 不可替代的证据

- 用可控事件/同步点测试竞争的不同顺序，不靠固定 sleep 猜测；重跑不抹去 flaky 失败。
- 缺少产品代码、测试命令、herdr 或浏览器能力时明确阻塞，不编造执行结果。
- 模拟器、独立工作流样例、真实产品 E2E 分别标记；样例通过不证明产品需求通过。
- 当前版本的 test-master 仅组织测试，不规定产品技术栈；可维护性与扩展性还需独立代码审查。
- critical/high 未关闭不能通过；其余未解决风险保留给人工验收。不得自行将人工验收改成 accepted。

报告字段与本地检查命令见 `tasks/002-development-workflow/workflow.md`。
