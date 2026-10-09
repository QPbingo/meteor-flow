# 最终状态与使用文档：独立增量审查

2026-10-08，审查者 `/root/technical_review`。范围：README、verification-status、implementation-progress、codex-integration-followup、usage，共 5 文件。独立完整阅读并对照候选实现、授权范围、已有执行和失败证据；无新增 findings。未修改主文档、未执行模型、未签人工验收。

最终路径/状态/SHA 见 [docs-reviewed-files.json](docs-reviewed-files.json)。[preview](docs-review-preview.json)、[rule](docs-review-rules.json) 与 [逐文件范围](docs-review-scope.json) 已保存：本批只认领 5 个文档，其余候选明确交由整体聚合按准确 SHA 关联历史独立审查。本报告不宣称正在编排中的 delivery/report.json 已最终审核。

核对结果：

1. README、状态页和实施记录已从 Codex 阻塞切换为本轮两种 Agent 正常链路通过，保留人工验收 pending。独立读到 Codex `real-agents/real-agent-codex.json` 与 Claude `real-agents-stable/real-agent-claude.json` 均为 task/attempt succeeded、submitted、seenActivity、归档成立、hello.txt 26 字节、相同预期摘要、配置前后哈希相同。相关执行是作者运行，不计为 reviewer 模型调用。
2. 文档没有把每次真实执行都写成成功：共享 daemon、外层沙箱、通知误报、NOT_READY、not_sent、agent_pane_busy 历史失败继续保留；上游没有原子“检查并发送”的边界明确。正常样本通过不证明状态竞态消失。
3. Codex followup 区分授权前问题、用户新增授权、诊断与产品修复。workspace-write/on-request 保留；不叠外层沙箱只作配置哈希核验，未把哈希相同冒充外层强制只读。Claude 的保护方式独立说明。更新交互/正在更新、登录、信任、审批与执行器错误继续停止；仅精确被动通知行有已审查豁免。
4. V01—V29 表区分实际 SQLite/浏览器/文件/进程、模拟 Agent、真实 herdr、真实模型层级；明确未做实体 0.9.0、物理休眠/手机/完整读屏认证，没有把真实模型归档与模拟浏览器流程合称真实模型浏览器 E2E。历史日期和新增恢复范围没有被改写为新需求。
5. usage 的双开关、命令路径、恢复、结果协议和界面权限说明与已审查实现一致。新的 screen guard / 连续就绪测试准备仅影响测试，不改变用户产品的身份或权限规则。

当前真实 Claude 成功运行在最后单调时钟/采样缺口/陈旧样本三项测试准备修订前启动。最终 harness 的静态审查与 9 种虚拟时序验证另见原证据目录的 stable-readiness-review.md；精确执行基线差异必须在最终 report/summary 明写，不能登记为最终测试文件的逐字节模型执行。5 份主文档仅概括同产品代码真实链路通过，并将细节链接至最终分层报告，不构成对该差异的隐去授权。

本地链接检查见 [docs-review-links.json](docs-review-links.json)，26 个本地链接均存在，包括刚落盘的 delivery/summary.md。最终 aggregate 核查仍需检查 report/summary 的具体证据编排；目标存在不等于汇总内容已审核，没有据此宣布整体收尾完成。

六类场景在纯状态文档中体现为准确叙述状态与历史、保持幂等/一次输入限制、保留授权及执行时序、恢复仍需核对、逐层关联证据、区分测试保护和真实用户数据隔离；本批没有新增业务行为。最终交付应继续关联原始失败与各次精确基线，人工验收只能由人完成。
