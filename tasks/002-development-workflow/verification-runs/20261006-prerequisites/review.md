# Skills 前置要求独立审查

日期：2026-10-06。状态：已完成只读审查及修订复核，无未关闭发现；初审 1 项 medium 已修复，无 critical/high。人工验收未签署。

范围：`/private/tmp/meteor-flow-docs-20261006`，分支 `feat/skill-prerequisites`，workspace 全部未提交修改。基线为 `baseline.json` 中各文件 SHA-256；作者修订后重新采集固定 OCR preview/rule 和最终基线，随后复核内容未改变。初审原始记录保留在 `initial/`。固定 OCR preview 共 9 个文件，已逐一审查 9 个，无跳过、无排除，文件交代率 100%。这不表示产品测试覆盖率。

## 结论与发现

最终结论：本次规则变更可以进入人工验收，无未关闭的实质发现。所有 9 个未提交文件及后续两轮文字修订均已复核。

**F1 / medium / 已修复：待接入技能缺少已确认的准确来源指针。** 初审发现及原始证据见 `initial/review.md`、`initial/findings.json`。

作者已在 `skill-prerequisites.md` 的缺失引入流程前添加唯一来源定位表，明确 brainstorming、bmad-forge-idea、Spec Kit 三流程、Playwright CLI/Test、Impeccable 的准确项目及能力入口；并明确尚未接入的链接只作定位、首次接入仍需锁提交/完整依赖，不假定所有能力都有独立 SKILL.md。另补了 tasks 目录、项目级安装、人工关卡和不扩大选型的适配约束。本审查独立访问新增上游页面核实路径和能力声明，未只采用作者的完成声明；具体官方来源见 `upstream-verification.md`。F1 已关闭，见 `findings.json`。

其余重点要求覆盖完整：按阶段计算必需清单；编码前包含本次实现及后续验收；缺任何一项先引入、加载和能力验证；环境缺失不能当作不适用；不能仅记录 blocked 而忽略补齐步骤；保护用户修改和错误链接；独立 reviewer 重新加载；范围变化重新计算；doctor 和仓库文件不冒充当前会话就绪；不宣称 Git/CI 自动强制。

## 实际执行与边界

- 完整读取 AGENTS.md、workflow、skill-prerequisites、mandatory-scenarios 和三份项目 SKILL.md。
- `python3 scripts/workflow/check.py doctor`：退出 0，来源文件哈希、引用与双端链接通过。
- `python3 scripts/workflow/ocr.py install`：退出 0；已有固定二进制且校验符合，输出“已安装”，未下载或改写仓库文件。
- `python3 scripts/workflow/ocr.py --version`：退出 0，v1.12.12 (182898c)，darwin/arm64。
- `python3 scripts/workflow/ocr.py delegate preview --format json`：退出 0，原始 JSON 保存为 `preview.json`。
- 对 preview 的全部 9 个路径执行固定 `delegate rule --format json`：退出 0，原始 JSON 保存为 `rules.json`。
- `git diff --check`：退出 0；变更文档本地 Markdown 链接无缺失；审查末尾基线哈希未变化，见 `static-checks.json`。
- 未运行产品测试、未修改仓库、未创建 PR、未签署人工验收。当前审查只提供规则可执行性与一致性的静态证据，不声称两种宿主的新行为均已通过运行验证。

## 本次 skill-readiness

执行者：Codex 独立审查上下文 `/root/prerequisites_review`。当前阶段为文档/技能约束的独立审查。作者上下文与本审查上下文分离。

必需技能：本仓库 meteor-flow-verification（约束变更和审查入口）、open-code-review-delegate（明确独立 review 请求）。实际引入方式是读取上述完整项目 SKILL.md 并遵循其适配；未声称本会话原生 `$` 命令已注册。test-master 全文也已读取以审查其变更和适配；不因该阅读声称产品测试已运行。OCR 来源为锁定的 Alibaba 182898cf522da3d04157b422752d028417974e19/v1.12.12；test-master 来源为 Jeffallan 1be15d8064f88fc25216442406d40add8fd23b53；项目原生 verification 以本次 SHA-256 基线标识。所需能力由实际 doctor、OCR version、preview/rule 验证。

本轮无需引入 brainstorming/forge-idea/Spec Kit：执行的是已经授权规则修订的独立审查，不是新想法澄清或产品需求编写。Playwright/Impeccable 不适用：没有浏览器或界面行为变更。读取个人同名技能不能替代上述项目来源。

## 六类场景的静态核对

| 类别 | 本轮核对与边界 |
| --- | --- |
| 状态迁移 | 就绪明确区分缺失、已引入待验证、当前环境就绪，以及 blocked；不等同产品验证/人工验收。 |
| 幂等 | 已确认阶段不重复确认、已有锁定版本优先恢复，重复 readiness 追加而不覆盖历史。 |
| 时序 | 缺任何适用技能先补齐再继续，编码前准备后续验收所需技能；范围变化先重算。 |
| 恢复 | 恢复会话重新加载；入口缺失、引用缺失、宿主无法热加载均有处理顺序。首次未接入来源确定性 F1 经作者修订与独立复核已关闭。 |
| 关联 | 技能与项目来源、锁文件、Claude 相对链接、当前会话证据关联；已接入哈希一致。 |
| 隔离 | 不以作者会话就绪代替 reviewer；保护用户修改和全局配置；报告写到指定仓库外临时目录。 |

上述为规则静态核对，未模拟任何产品运行时状态或故障注入，不属于产品六类场景测试通过记录。

## 已核实但不单独报错的候选项

- workflow 执行约束中“当前阶段及后续验收”可能孤立读得过宽；其明确链接到详细前置规则，后者把“同时准备后续验收”限定于编码前，澄清/需求阶段按对应表项，因此未判定为必然滥装。
- verification 的完整步骤仍包含测试；详细触发说明和 test-master 项目覆盖明确纯文档不强制无关测试，因此不据此要求本轮产品测试。
- Playwright 表项的终端交互措辞可进一步写明“浏览器内”，但上下文是浏览器可见行为与浏览器 E2E，AGENTS 也以浏览器/界面限定，未作为独立实质缺陷。
- OCR 上游正文仍含文本降级、全局安装、静默丢弃、自动修复建议；项目适配明确覆盖这些默认规则，且未修改该优先关系，所以不重新报告已有上游正文为缺陷。


## 前置准备记录边界补充复核

复核范围仅为 `.agents/skills/meteor-flow-verification/SKILL.md` 第 1 步与 `skill-prerequisites.md` 的记录节。与上轮已审基线逐文件比较，实际变化恰好为这两个文件；其他 7 个文件哈希不变。上轮记录完整保留在 `before-preparation-clarification/`。

结论：无新增发现。两处文字一致地将“只做编码前准备”的产物限定为 skill-readiness，排除完整 report.json、init/evidence/check 和候选代码测试；缺少验收报告或尚未运行产品测试不会单独造成准备失败。该豁免没有移除必要的技能引入、来源校验、实际加载和最小能力检查；工具权限或能力检查真实失败仍须 blocked，不允许以文字记录冒充就绪。进入后续实现验收时，原完整验证流程仍然适用。

本次补充仅静态核对以上规则及交叉引用，重采集固定 OCR preview/rule，并执行 git diff --check。未执行宿主测试或产品测试，也未把作者反馈的宿主测试进展视为本审查自行验证的事实。最终范围仍为 9/9，无排除、跳过或未关闭发现。逐文件新旧哈希及复核范围见 `preparation-clarification-review.json`。
