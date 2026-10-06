# 来源定位补充的独立复核

日期：2026-10-06。方式：只读浏览上游官方 GitHub 页面和项目文档；未安装任何待接入 skill。以下仅确认项目与入口能用于后续确定性接入，不代表已经锁定、安装或验证当前执行环境。

| 文档中的来源 | 本次独立观察 |
| --- | --- |
| [obra/superpowers brainstorming](https://github.com/obra/superpowers/tree/main/skills/brainstorming) | 目录存在，包含 SKILL.md 和附带资源。 |
| [BMAD-METHOD bmad-forge-idea](https://github.com/bmad-code-org/BMAD-METHOD/tree/main/skills/bmad-forge-idea) | 路径存在，包含 SKILL.md、scripts 等；文档给出的实际目录名可消除 forge-idea 简称歧义。 |
| [Spec Kit](https://github.com/github/spec-kit) | 仓库说明支持 Agent 工作流；[官方命令参考](https://github.github.io/spec-kit/reference/agentic-sdd.html) 明确列出 specify、clarify、checklist，且按宿主可采用命令或技能方式。 |
| [Playwright CLI skill](https://github.com/microsoft/playwright-cli/tree/main/skills/playwright-cli) | 目录存在，包含 SKILL.md 和 references；[Playwright 官方仓库](https://github.com/microsoft/playwright) 将 Playwright Test 与供 coding agents 使用的 CLI 分别列出，符合新增表项的能力区分。 |
| [Impeccable](https://github.com/pbakaus/impeccable) | README 列出 audit 与 critique，当前用单一 impeccable skill 下的子命令提供；与表项“不按名字安装无关 audit/critique 技能”的限定一致。 |

最终新文档明确 main 链接只用于定位，正式接入另行锁定完整提交 SHA；项目适配优先于上游安装位置、文档目录或自动衔接流程。因此没有把上游的最新状态误写为仓库已经引入或当前会话已加载。
