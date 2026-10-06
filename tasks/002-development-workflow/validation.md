# 工作流接入验证

日期：2026-10-06。状态：实现与双端运行验证完成；最终人工验收 pending。
适用范围：工作流基础设施与独立样例。没有实现或验证 Meteor Flow 产品后端、网页或真实 herdr E2E。

## 环境与结果

| 项目 | 实际环境/结论 |
| --- | --- |
| 本机 | macOS arm64，Python 3.9.6，Git 2.50.1 |
| Codex | CLI 0.160.1；三个技能从项目路径加载，doctor 与 OCR 命令成功 |
| Claude Code | 2.1.195；从 `.claude/skills/` 相对链接加载三个技能，公共规则导入成功 |
| OCR | v1.12.12，官方发布二进制 SHA-256 校验通过；委托 preview/rule 实际执行 |
| 技能静态校验 | 三个 SKILL.md 均通过 Codex skill-creator quick_validate |
| 本地测试 | 35 项通过；包括 26 项记录/证据关卡测试、5 项真实 OCR 集成测试、4 项安装失败窗口测试 |
| 独立审查 | 初轮发现 3 个问题，修订后复查关闭；最终文件清单与报告保留在本次运行证据内 |

双端隔离样例由 `python3 scripts/workflow/tests/host_fixture.py` 创建，包含两个候选文件和独立需求。
两宿主均实际运行 3 个候选测试（2 失败、1 通过），识别重复提交造成重复副作用、旧 attempt 结果污染当前任务，并得出不可验收结论。
这属于工作流负例验证成功，不能把候选测试写成全部通过。Codex/Claude 均使用独立审查上下文；候选代码未被修改。
样例无页面/数据库，浏览器 E2E 合理不适用；该结论不适用于未来产品任务。

详细输出：[Codex 隔离走查](verification-runs/20261006-integration/codex-behavior.md)、[Claude 隔离走查](verification-runs/20261006-integration/claude-behavior.md)、[Codex 最终加载](verification-runs/20261006-integration/codex-final-load.md)、[Claude 最终加载](verification-runs/20261006-integration/claude-final-load.md)。

## 独立审查修订

| ID | 初轮问题 | 修订与验证 |
| --- | --- | --- |
| F1 / high | preview 未核对 schema、仓库与当前审查范围，空/旧清单可被接受 | 通过固定 CLI 重新生成相同模式的 preview，核对元数据及非证据文件；真实 CLI 与关卡负例覆盖 |
| F2 / medium | 删除/超大排除项可被标记不适用 | 强制手工补查或阻塞；进一步覆盖 status=deleted 且 exclude_reason=user_exclude 的生成文件删除 |
| F3 / medium | verification-runs 符号链接可将新报告写到任务外 | 初始化前核对解析后的完整路径仍在该任务内，负例确认不会向外创建报告 |

额外兼容处理：OCR 上游 compatibility frontmatter 移至正文前提说明，避免 Codex 随附校验器拒绝；来源及改动哈希均有记录。
上游 14 个文件的原文哈希和 6 个发行资产哈希已由独立审查者对照固定 GitHub 提交与 release API 核验。

## 证据与限制

- [本次运行记录](verification-runs/20261006-integration/report.json) 包含六类场景、实际执行命令、证据 SHA-256、独立 reviewer、最终 OCR 范围和发现处理记录。
- [独立审查报告](verification-runs/20261006-integration/review.md) 记录实际覆盖和复查结论。
- 本地检查具备结构约束，不能证明证据真实性、自动确认 reviewer 身份或替代人工验收；没有增加 PR/CI 强制关卡。
- Playwright、Impeccable、前两阶段仍是已确认待项目接入，不声称已安装或完成整条流程。双端兼容性当前实测范围为上述 macOS 版本；其他系统/版本需要同样冒烟验证。
- 双端负例先验证技能行为；其后的关卡修复通过新增回归和独立复查验证，最终技能加载另行复测。运行记录只代表明确列出的检查范围。
