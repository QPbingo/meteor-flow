# 交付范围与分层证据：最终独立汇总审查

2026-10-08，审查者 `/root/technical_review`，与作者 `/root` 独立。审查对象为本 run 的 report.json、summary.md、review-coverage.json、evidence-provenance.json 及其原始执行/审查来源。结论：**可交人工验收**。本轮汇总发现 2 个 low 记录问题，作者已修正并复核关闭；没有未关闭 critical/high/medium/low。本结论不等于人工验收通过，report 的 human_acceptance 保持 pending。

## 范围与来源

独立重新执行 OCR [preview](aggregate-preview.json)/[rule](aggregate-rules.json)，按项目既定规则仅从审查范围滤除 verification-runs 证据目录。当前 173 个 reviewable 的 `(path,status)` 与汇总完全一致，无重复、无遗漏、pending 为空；另 2 项工具排除的 Windows launcher 和 pnpm-lock.yaml 均有精确 SHA 匹配的既有手工审查。逐项当前内容、声明 SHA 和对应独立 source manifest 全部相符，没有以作者自审补齐缺口。

独立重算包含文件模式与 symlink 目标的完整非证据工作区指纹，精确匹配 report baseline：`990feabafb5f6787d9fa5be6fdc128b2ca6e6652d636ed2a9b8393c458e8efac`。173 项候选与 2 项手工排除均按最终内容审计；未变部分继承已有独立审查，不声称本轮从零重审每行。

299 份来源复制记录均核对源文件、目标文件和 provenance 声明的 SHA 三者一致，并保留 copied_not_reexecuted。审查截止时 report 已登记 312 份证据，全部匹配，场景/checks/commands/findings 的证据引用均存在。完整逐文件/逐证据结果及汇总快照 SHA 见 [aggregate-review-final-audit.json](aggregate-review-final-audit.json)。最初审计助手将目录符号链接当普通文件读取而报错，已按项目算法改为散列链接目标，保留 [初次审计错误](aggregate-review-audit-initial-error.json)；这不是候选缺陷，也没有改动源码。

## 执行事实与边界

核对原始日志、JSON 和已审查测试入口后，报告的以下分层事实成立：常规 235 passed / 5 opt-in skipped；E2E 14 passed；真实 herdr 2 passed；Codex 与 Claude 分别完成固定小文件任务，均有 submitted、执行活动、同 task/attempt 的结构化结果、内容校验与持久归档。Codex 所在同次命令中的 Claude 是 blocked/skipped，汇总没有把它算成成功；Claude 成功来自后续独立新会话。

构建对应最后产品修改后的源码；最终类型检查对应最新测试文件。当前 Playwright 实际入口是 `pnpm test:e2e --reporter=list`，脚本限定 tests/e2e 与单 worker；此前裸入口扫描 Vitest 的失败仍保留。工作流 35 项明确继承未变 SHA 的此前执行，不冒称重跑。独立 reviewer 的 121 项和后续 19 项命令均记录固定 Node 直接 Vitest 入口，与实际工具调用一致。

性能证据为默认 30 秒、1000 历史任务、两条各 1 MiB/s 流，FakeHerdr 边界、无模型调用；原阈值未放宽。当前 JSON 列表 p95 1.063708 ms、操作 p95 29.466292 ms、峰值 RSS 202.546875 MiB；10–30 秒 RSS 斜率 -0.942406 MiB/s、retained growth -19.96875 MiB。它说明该有限负载窗口通过，不证明任意长运行无泄漏；此前超标与诊断仍保留。

真实 Claude 成功运行使用最终采样新鲜度/间隙/单调时钟增量之前的 3 秒 gate，初版完整 harness SHA 未捕获。最终 gate SHA 及 9 个虚拟时序场景另有独立证据，报告明确没有向最终测试脚本倒填模型实跑。该差异不改变相同产品源码的正常链路结果，不能据此宣称最后 harness 已逐字节完成真实执行。

Codex 保护方式有用户追加授权：自身 workspace-write/on-request、不叠测试外层 sandbox-exec、配置仅前后哈希核验；Claude 保留外层配置写拒绝。配置哈希相同不被表述为 Codex 有强制外层只读。没有把登录、目录信任、权限或更新提示自动确认作为通过方式。此次汇总审查没有调用任何模型、运行产品测试或改动产品/主文档。

## 两项汇总问题及关闭

- **DA01 — low / fixed**：RE-CODEX 已为 pass，但 reason 仍写替代保护方式“待授权”。作者已明确标为授权前历史，并说明随后已获新授权、完成真实产品链路；与授权记录一致。
- **DA02 — low / fixed**：汇总将 SR01 从独立原报告的 medium 写成 low。作者已恢复 medium/fixed；原发现、修订和虚拟时序关闭证据保留，没有静默降级。

详情见 [aggregate-review-findings.json](aggregate-review-findings.json)。历史 CODEX-STARTUP、CODEX-IDENTITY、REAL-TEST-GUARDS、CP01/CF01/SR01 的 fixed 均有对应独立复查和分层执行依据，不把旧失败日志删除或改写为成功。

原生启动 agent_pane_busy、确认后 NOT_READY、最终检查 unknown 导致 not_sent 属已保留的真实安全拒绝。独立查证的上游 RPC 间隙仍存在；成功的新样本没有被写成竞态已修复，产品继续暂停且不自动重放，人工恢复沿用既定规则。macOS arm64/0.9.3、小任务、浏览器模拟边界、0.9.0 仅合约等范围限制保持明确。

独立只读运行项目记录检查，结果为 [READY_FOR_HUMAN_ACCEPTANCE](aggregate-review-check.log)，无 INVALID/BLOCKED；检查器只核验记录、范围和哈希，不替代上述实质审查或人对结果质量的验收。报告登记本次审查材料后可再次运行记录检查；不得借该元数据更新改变候选基线或扩大通过范围。
