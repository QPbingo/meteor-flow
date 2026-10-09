# 交付文档与恢复疑点独立收尾审查

日期：2026-10-07。状态：**独立复核完成，0 未关闭 critical/high/medium/low**。Reviewer `/root/technical_review`，只写报告和证据，没有修改产品、测试或待审文档；人工验收仍 pending。

## 当前结论

1. `Collector.reapOrphans` 的疑点已按代码和调用方排除（false-positive）：`reconcile()` 调用 `reapOrphans(true)`，对 intent/running 即便退出无法证明也会持久化为 orphaned；后续 tick 继续复核，容量集合保留 intent/running/orphaned。只有 ESRCH 或已证明 PID 启动身份更换才解除容量；未知身份不按 PID 盲杀、不复用或清理 staging。详细状态表、行号、旧/新 SHA 及六类场景见 [只读复核](../20261007-review-closeout/collector-review.md)。此前中间报告范围仅对应当时快照，未覆盖当前四份文档；此报告与本目录新证据覆盖最终状态。
2. 本轮没有产品问题需要修复，也没有新增或修改测试。根作者撤销原拟追加镜像回归；本次没有重跑产品、浏览器、真实模型或性能测试，不把已正确逻辑改写为新功能。原 collector.ts SHA 为 `a9769ef0a756ad169708c4bfc73cbcad616ec3e1e6c36a601cd0a096e920513c`，collector.test.ts 为 `9183d32b9a38c305b679568680f5c4a4f5273c5bbbdcea5cbccb491916ee0e0c`，均与原 final 完全一致。
3. README、implementation-progress、verification-status 三份状态文档已全文复读，并对照原 final report/summary 及实际日志尾部。现在表述“实现、独立审查及分层验证完成”，保留人工验收 pending；常规 176、E2E 13、真实 herdr 2、真实模型 2、压力 1 与原日志一致。原测试基线与后续纯文档基线分别链接，没有把原测试冒称新执行；V01—V29 的模拟/真实/未测边界继续保留。
4. technical-review.md 的历史注释由另外的 `/root/ui_technical_review` 独立复查，L01 已 fixed，见 [L01 closure](../20261007-review-closeout/l01-independent-review.md)。当前 SHA `c853f1a89ff01c86dc468def0d4989c1e0301982786bc4d81dbc29fa82fa966a` 与该独立报告一致；精确去掉新增段落恢复旧 SHA `0b1211162afdc230a997a582ef97ffc65e74e839c5f16da788a1bd515ce18793`，历史原文保持。没有由原报告作者自审来关闭问题。

## 范围与基线

`reviewer-baseline-comparison.json` 独立核对前次最终全部 **170 项候选**：166 项内容完全一致，仅以下四项纯文档变化；已记录的文件类型/可执行位一致。产品、测试、构建/依赖、技能与其他文档均未变。

| 文档 | 当前 SHA-256 | 本轮独立来源 |
| --- | --- | --- |
| README.md | `3baedc00761723a82a917397334879d9005c9a91e5528cfadc857b20619514a1` | 本 reviewer |
| implementation-progress.md | `f404e8cf0483050e9e34f69779b9ba79a94d44abba2b518d4c03172b90657a4c` | 本 reviewer |
| technical-review.md | `c853f1a89ff01c86dc468def0d4989c1e0301982786bc4d81dbc29fa82fa966a` | `/root/ui_technical_review` |
| verification-status.md | `7eca70a0ac1b44dc59997552d98a3c8e6f9648c3e42e780deb681500246c3a72` | 本 reviewer |

新运行实际执行 OCR delegate preview/rule，原始 `reviewer-preview.json` 与 `reviewer-rules.json` 保留。截止快照 **838 条：168 reviewable 全部 reviewed，0 skipped；670 excluded 全部交代**。2 项非证据排除（pnpm lock、Windows cmd）按前次手工独立审查匹配当前 SHA；其余 668 项为 task-local 运行日志、数据、截图和审查报告。去除 run artifacts 后，前次与本轮 `(path,status)` 范围相同；六组规则内容相同，没有漏入新增产品文件。完整聚合为 `reviewer-coverage.json`，100% 仅指文件审查交代，不是测试覆盖率或业务正确性保证。

对根的 `baseline-and-evidence-audit.json` 还做了独立重算：使用 git 全部 tracked/nonignored untracked 路径、文件模式和原算法的 raw SHA digest，只将上述四份文档替回保存的旧摘要，得到 `28c43c0fde7b1a567235baa1e71b1717c73899a6e8338600587f37ffcb9bdcc2`，与原 `20261007-final/report.json` 完全一致；逐一重新散列根审计列出的 **297 项历史登记证据**，全部匹配。结果见 `reviewer-audit-check.json`。根临时审计曾误用 hex ASCII 的失败与原因保留在 audit-initial-error.json，该脚本错误未导致产品变化，也没有以其失败宣称产品测试失败。

当前完整 workspace fingerprint 为 `8dde26422e65edfff8a0a8fff92ab82e02da53195f803aca14105effa489dbfd`，与 `20261007-review-delivery` 初始化基线一致。证据目录的后续新增不被当作产品代码变化；旧 final 和中间 closeout 均保留原内容及原范围。

## 适用性与验证边界

延续同一独立 reviewer 上下文已实际加载的项目 verification/test-master/OCR 及适用引用，本轮重新读取 prerequisites、verification、AGENTS、需求相关条款、Collector 及 application/domain 调用方。doctor、固定 OCR v1.12.12 均成功，记录见 [本次前置](../20261007-review-closeout/reviewer-readiness.json)。不存在产品编码、选型变更或浏览器行为变更，因此无需新增开发约束、产品测试或 UI 设计循环。

恢复疑点的状态迁移、幂等、时序、恢复、关联、隔离六类均按实际现存逻辑核对，详见 Collector 报告；四份状态文档本身不改变六类运行时行为。人工授权无需重问，但最终人工验收没有被 agent 签署。

可以将本次独立增量覆盖与原准确产品执行证据关联完成交付记录；不存在本 reviewer 尚未完成的产品审查项。
