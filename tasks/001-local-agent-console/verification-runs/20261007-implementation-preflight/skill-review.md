# P0 浏览器与界面技能接入独立审查

日期：2026-10-07。范围：Playwright CLI、Impeccable 项目接入及 doctor 扩充。作者 `/root`，独立 reviewer `/root/technical_review`。状态：修订复查完成；两项 medium 已关闭，当前无未关闭 findings。本记录不修改技术方案历史 review，不代表产品实现或验收通过。

## 结论

本轮指定技能接入可继续用于 P0 能力准备。固定来源、文件/引用完整性、双端共享入口和当前 macOS arm64 引擎可执行性均已独立核对。未审查并行产品依赖配置或产品源码；未将其他会话的浏览器安装成功当成当前 reviewer 的实际浏览器交互成功。

## 原始发现及修订复查

### S01 · medium · Windows 启动器绕开项目固定引擎规则

- 路径：`.agents/skills/impeccable/scripts/impeccable.cmd`，原首轮约 25—106 行；类别 security；状态 fixed。
- 原因：SKILL Setup 明确在无 sh 的 Windows 调用该文件，而其上游实现依次接受 `IMPECCABLE_BIN`、用户缓存、PATH，最后自动下载。项目适配声称固定仓库引擎并禁止这些回退，但只替换了 Unix launcher；Windows 实际可执行入口仍有相反行为。
- 修订：作者将 Windows 入口缩为说明当前仅核验 macOS arm64 并 `exit /b 127`，移除替代引擎及下载行为，更新来源锁的适配哈希。
- 复查依据：完整读取三行新入口及最终 doctor；当前没有 Windows 运行环境，结论为静态失败关闭检查，不宣称 Windows 实机支持。Windows 文件虽被 OCR 扩展名规则排除，已手工补查并单列范围。

### S02 · medium · 文档声称映射 tasks，但上游命令仍使用原目录

- 路径：`.agents/skills/impeccable/SKILL.md` 项目适配段和 `reference/critique.md` 的 Setup/Persist the Snapshot；类别 bug；状态 fixed。
- 原因：初版只说 PRODUCT、DESIGN、surface brief 和快照路径“映射”到 tasks；launcher 实际仅设置 `IMPECCABLE_SKILL_DIR`、`IMPECCABLE_SELF` 后 exec，没有实现上下文/持久化路径重定向。固定上游 `crates/context/src/critique_storage.rs:12` 的 `get_critique_dir` 将 `resolve_project_root(cwd, …)` 与 `.impeccable/critique` 拼接。按未覆盖的 `critique-storage write` 执行会在任务目录外创建评估记录。
- 实际观察：独立 context 调用退出 0，却返回 `TARGET_SELECTION_REQUIRED`、各 workspace 的 product/design 缺失，并要求询问用户后切换到 app cwd。原始输出见 [skill-review-context.log](skill-review-context.log)。这不等于已加载 tasks 的需求或技术方案。
- 修订：作者明确覆盖 context 的缺文件、重新访谈及切换 cwd 指令；执行者直接读取 tasks 中已确认的 requirements、technical-design、DESIGN，不声称引擎自动读过。禁用上游 critique-storage write/trend/ignore，由 agent 将报告直接保存当前 verification-runs，原生 trend/ignore 标为不适用。
- 复查依据：完整读取最终适配段并核对哈希；这是一项明确的流程覆盖，不伪称二进制路径已改变。不需要修改引擎、复制已确认需求或创建根目录报告。

## 独立加载与实际检查

重新读取 AGENTS、skill-prerequisites、workflow、六类场景、项目 verification/test-master/OCR 和 capture-constraints。test-master 适用引用为 unit-testing、security-testing、testing-anti-patterns。读取两项待接入 SKILL；重点语义核查 audit、critique、session-management、playwright-tests、项目适配和 launcher。其他上游功能按固定来源与完整性核对，不宣称审计过 Impeccable 所有设计/素材/实时浏览器功能。

capture-constraints 使用可用来源 `/Users/heybox/.codex/skills/capture-constraints/`，完整读取索引与正文。R-002 对本次本地工作流运行环境适用：Python 3.9.6，macOS arm64，Impeccable 0.1.11；没有线上部署或中间件需要查询。系统 Node 为 25.8.1，不据此声称产品 Node 24 兼容。R-001 小黑盒搜索规范不适用。本轮未修改规则库或产品代码。

| 检查 | 实际结果与边界 |
| --- | --- |
| 固定来源与完整引用 | Playwright 上游 b85c7a736bb473bf55b584e54a09ffa698d6d871，共 12 文件；Impeccable 上游 cf3d2fa07d3ad1814ac5fbbbb5b2043b795eaef1，共 63 文件。全部已登记且原文哈希与本机固定上游一致，许可证保留；当前无缺失/未登记文件 |
| 本地链接 | Impeccable 引用无缺失；Playwright 检出的两项未解析链接是示例截图/快照，不是缺失依赖，按误报关闭 |
| doctor | 修订前及修订后退出 0。虽然其 markdown 正则只识别部分语法，完整 sources.lock 哈希集合覆盖了当前两项技能的全部引用；不能因此推断未来漏登记文件也会被发现 |
| doctor 错误路径 | 在独立临时副本删除各技能的一项引用、破坏各 Claude 链接，均被拒绝；没有修改作者候选 |
| OCR | 固定 v1.12.12；首轮与最终 preview/rule 均退出 0，原始 JSON 分别留存 |
| 双端入口 | `.claude/skills` 相对链接指向 `.agents/skills`；通过两个路径执行 engine-probe 都返回 impeccable-engine 0.1.11。证明共享入口及命令可执行，不证明 Claude 原生命令已经注册或调用 |
| 引擎校验 | Unix launcher 检验官方 SHA-256 7427918d6e75507401a1b7b691eefe58a7c01a2fc63b712016ffc5a0ac1c05e6 后 exec；隔离副本缺引擎/哈希错误时均 exit 127，即使指定 IMPECCABLE_BIN 也未运行替代引擎 |
| 工作流回归 | 独立执行 test_checks.py，26 项通过；仅证明工作流记录/检查器行为，不是产品测试 |

doctor 完整性不等于浏览器可启动或 UI 审查已完成；Playwright 的真实隔离浏览器操作、后台结果核对、宿主加载及后续产品 audit/critique 仍须由对应实际执行阶段记录。只查看技能目录或已有浏览器安装文件不能代替这些证据。

## 六类场景

本次关联工作流 W01/W02/W04/W05/W06；不把产品 R/V 的运行时验收转记为通过。

| 类别 | 本轮适用行为与证据 |
| --- | --- |
| state-transition | 技能文件完整时 doctor 通过，缺引用/坏链接时转为拒绝；negative-probes 保存结果 |
| idempotency | doctor 与 engine-probe 只读检查可重复执行；首轮/最终日志保留，没有安装或自动更新副作用 |
| ordering | 哈希检查在 exec 之前；伪引擎未执行。报告直接写 tasks 的流程取代未适配的上游持久化命令 |
| recovery | 缺引擎/校验失败停止，不下载或换用全局工具；Windows 未支持明确失败关闭 |
| association | source lock 将项目文件绑定固定上游与适配哈希；双端指向同一来源，context 不冒称已读 tasks |
| isolation | 错误路径仅操作 reviewer 的临时副本并清理；浏览器技能明确独立 session、测试目录/端口、禁止 close-all/kill-all 和真实用户 profile |

## 范围、证据与保留边界

最终 preview 共 149 项，其中 reviewable 94 项：本轮技能接入 78 项 reviewed，16 项因产品/历史方案等不属于本轮明确范围而 skipped；文件交代比例 82.98%。另有 55 项 excluded，Windows launcher 1 项手工补查，其余为验证证据、依赖锁或范围外材料。全部 `(path,status)` 及排除理由见 [skill-review-scope.json](skill-review-scope.json)。这是限定范围审查，不是 workspace 全量审查或产品验收关卡通过。

最终限定候选哈希见 [skill-review-baseline.json](skill-review-baseline.json)。来源与完整性核对见 [skill-review-source-check.json](skill-review-source-check.json)、[skill-review-integrity.json](skill-review-integrity.json)；实际拒绝路径见 [skill-review-negative-probes.json](skill-review-negative-probes.json)；26 项回归原始输出见 [skill-review-workflow-tests.log](skill-review-workflow-tests.log)。原始首轮证据没有覆盖，最终 preview/rule 以 `-final` 区分。

没有产品后端、UI、真实 herdr 集成或运行时性能验收结论；没有替人工签署验收。
