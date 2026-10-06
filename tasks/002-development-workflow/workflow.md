# 开发工作流

状态：选型与本次接入范围已由用户确认，2026-10-06。适用：本仓库 Codex、Claude Code。
产品代码仍未授权；本次仅实施工作流基础设施。运行验证结果见 [validation.md](validation.md)。

本次接入验收要求：W01 双端共享与实际加载；W02 固定来源、完整引用与 OCR 仅委托；W03 六类场景及实际测试证据；W04 独立审查、完整范围与严重问题关卡；W05 基线/证据/目录隔离；W06 如实区分安装、验证与产品能力，最终人工验收。

## 流程与安装状态

| 阶段 | 已确认方案 | 本次安装范围 |
| --- | --- | --- |
| 发出想法 → 想法确认 | brainstorming 澄清目标/约束，再 forge-idea 深化 | 选型已确认；项目内待接入 |
| 想法确认 → 需求方案 | Spec Kit specify → clarify → checklist；输出可验收产品需求，不预定技术栈 | 选型已确认；项目内待接入 |
| 代码编写 → 测试验证走查：后端 | test-master | 已随仓库接入；产品测试待产品实现 |
| 代码编写 → 测试验证走查：浏览器 | Playwright 实际交互与可重复 E2E | 选型已确认；项目内待接入；不能因个人已安装就声称全项目可用 |
| 代码编写 → 测试验证走查：前端体验 | Impeccable audit / critique | 选型已确认；项目内待接入 |
| 代码编写 → 测试验证走查：独立代码审查 | Alibaba OCR 委托模式 | 已随仓库接入，CLI 本地显式安装 |
| 验收汇总 | meteor-flow-verification + 六类场景 + 本地检查 | 已随仓库接入 |

整体顺序：发出想法 → 想法确认 → 需求方案 → 代码编写 → 测试验证走查。
需求、实施方案及其独立 review、开始编码授权、最终验收是人工关卡；实施方案/review 是编码前准备，不替换上述产品流程。
关卡内允许按已授权范围修订与复查，已确认事项不重复询问；新增产品范围或改变确认行为需记录并确认。

## 双端使用与安装

所有技能的使用条件、编码前检查、缺失时的先引入流程，统一见 [Skills 使用条件与前置要求](skill-prerequisites.md)。
表中“待接入”不构成跳过理由：任务一旦触发该技能，必须先完成引入和当前执行环境验证，再开展相关开发。

技能单一来源为 `.agents/skills/`；Claude 目录通过相对软链接复用，根 `CLAUDE.md` 导入公共约束。
完整保留 test-master 的 10 个 references、MIT 许可证和来源；OCR 保留 Apache-2.0 许可证。
来源提交、原文哈希、适配后哈希、OCR 发布版及官方资产校验值在 `scripts/workflow/sources.lock.json`。
OCR 固定 v1.12.12；更新技能/CLI 时先评审差异，再更新锁定与双端验证，禁止运行时自动追随 latest。

前提：Python 3.9+、Git 2.41+、支持项目 skills 的 Codex/Claude Code，首次安装 OCR 需要访问 GitHub。
Python 仅是仓库工作流工具，不代表产品后端选型。macOS/Linux 正常 Git 软链接检出即可；Windows 检出须启用 symlink 支持，否则 doctor 会报错，不能声称加载成功。

在仓库根目录执行：

```bash
python3 scripts/workflow/check.py doctor
python3 scripts/workflow/ocr.py install
python3 scripts/workflow/ocr.py --version
```

Codex 使用 `$meteor-flow-verification`；Claude Code 使用 `/meteor-flow-verification`。
也可显式调用 `$test-master` / `/test-master` 和 `$open-code-review-delegate` / `/open-code-review-delegate`。
调用时核实路径属于本仓库；若个人同名技能遮蔽项目版本，读取项目技能绝对路径执行，并报告冲突，不修改用户全局配置。
安装后新开会话检查技能列表与实际调用；doctor 不能替代宿主运行验证。

## 执行约束

1. 明确任务需求、范围和版本；按 [前置要求](skill-prerequisites.md) 先引入并验证当前阶段及后续验收必需 skills，再继续该阶段。编码准备时提前逐项分析 [六类场景](mandatory-scenarios.md)。
2. test-master 组织并实际执行测试；沿用项目已确认框架。mock 单元测试、真实隔离集成、故障模拟和真实 E2E 分别报告。
3. 前端交互使用 Playwright；UI 技术/体验使用 Impeccable。相关开发前就应补齐能力；遗漏时先补齐，失败标记 blocked，不能只用 checklist 代替执行。
4. 独立审查者运行 OCR 委托，对照需求查代码与测试、调用方、删除影响、关联关系、模块边界、依赖方向、错误处理、兼容迁移及已确认扩展场景。
5. 编写者修订，重新测试并由独立上下文复查。保留原始问题、失败和误报关闭理由；不能重跑到绿或悄悄删除不利结果。
6. 汇总证据，运行本地检查，通过后交人工验收。未解决 critical/high 阻塞；medium/low 遗留需说明风险，由人工决定最终接受。

OCR 用法（不会配置 OCR 自己的 LLM 服务；宿主模型连接仍按各工具配置）：

```bash
python3 scripts/workflow/ocr.py delegate preview --format json
python3 scripts/workflow/ocr.py delegate preview --format json --from main --to HEAD
python3 scripts/workflow/ocr.py delegate rule --format json scripts/workflow/check.py
```

保留 preview 原始 JSON。检查时重新运行确定性 preview，核对 schema、仓库、比较范围与清单；CLI 不可用时不能标记审查通过。verification-runs 中的证据文件排除在变更基线及审查清单匹配之外，避免报告自引用；该目录禁止放业务实现。根据模式使用正确 Git diff，并以 `(path,status)` 交代全部 reviewable_files。
排除项均需说明：生成/依赖文件可有依据地不适用，删除及超大文件要手工补查影响；未补查则 blocked。
项目规则显式纳入测试与 fixtures，合并内置语言规则；include 不是白名单，第一条匹配规则生效。
上游语言建议须适合本项目实际框架，不能机械引入 React 等未选技术约束。

## 流程记录与本地检查

```bash
python3 scripts/workflow/check.py init tasks/001-local-agent-console --run <唯一运行标识>
python3 scripts/workflow/check.py evidence <report.json> <运行目录内的证据文件>
python3 scripts/workflow/check.py check <report.json>
python3 -m unittest discover -s scripts/workflow/tests -v
```

`init` 在该任务 `verification-runs/<run-id>/report.json` 生成未执行模板，不覆盖历史。
开始最终验证前冻结代码：基线包含 tracked 与未忽略新文件的内容、删除及执行位/软链接，排除 Git 忽略文件与任务的 verification-runs。
后者只放报告/证据，不能放实现、需求或配置。提交 SHA 是溯源元数据；代码内容相同不改变测试基线，但提交会改变 workspace 模式的审查范围，旧 preview 将不再通过范围检查。需要跨提交留存时，先提交待审代码，再使用固定提交 SHA 的 range/commit 模式采集 preview；报告与证据可随后单独提交。
代码/规则内容变动后创建新运行并复验，不能只替换旧报告的基线哈希。

主要字段：

- `scope`：变更类型 behavioral / non-behavioral、需求引用列表、范围说明。
- `scenarios`：固定六类，每类 applicability、reason、cases。每个 case 包含 id、requirements、setup、action、expected、status、actual、evidence；非通过时加 reason。
- `checks`：backend、e2e、ui、architecture，各自 status、reason、evidence。status 为 pass / fail / blocked / not-run / not-applicable；不适用也必须解释。
- `commands`：实际执行的 command、status、exit_code、evidence；通过必须退出码 0。失败记录保留原运行，修复后新运行引用历史并记录复验。
- `evidence`：运行目录内相对文件路径到 SHA-256 的映射，由 evidence 命令登记。证据包含命令日志、真实观察、截图/trace 或审查报告，避免凭据和生产数据。
- `review`：status、author_context、reviewer_context、preview、files、exclusions、findings、evidence。上下文必须独立，不能只改标签冒充独立。
- `review.files`：每个 path、status、outcome（reviewed / skipped）、reason；与 preview 精确对应。
- `review.exclusions`：每个 path、status、reason（对应 preview 的 exclude_reason）、outcome（reviewed-manually / not-applicable / blocked）、rationale，与 preview 对应。
- `review.findings`：content、severity、disposition（open / fixed / false-positive / deferred）、rationale、evidence。关闭问题需要证据。
- `human_acceptance`：pending / accepted / rejected；后两项必须引用真实人工决定，不得由 agent 自行签署。

`check` 退出码：0 表示记录具备人工验收条件；1 表示存在未完成/失败/严重问题；2 表示格式、基线或证据不合法。
本地检查不执行报告内的命令，不证明日志真实性、测试强度或 reviewer 身份，也不强制阻断 Git/PR。独立 review 和人工验收补足这些边界；CI 强制化留待后续。

## 接入差异与未完成事项

- test-master 上游的 CI/CD 默认要求改为本地实际执行；示例框架不成为产品选型；TDD 引用不授权删除既有代码。
- OCR 项目入口固定仓库和规则、只允许委托命令；不使用上游的自动修复、静默丢弃误报、版本不匹配时文本降级行为。
- 未安装环节登记选型状态；一旦本次任务触发其使用条件，必须先按已确认方案接入并验证，才能开展相关开发。当前没有产品后端或页面，不宣称产品测试或 E2E 已通过。

来源：[test-master](https://github.com/Jeffallan/claude-skills/tree/1be15d8064f88fc25216442406d40add8fd23b53/skills/test-master)、[OCR 委托技能](https://github.com/alibaba/open-code-review/blob/182898cf522da3d04157b422752d028417974e19/skills/open-code-review-delegate/SKILL.md)。
